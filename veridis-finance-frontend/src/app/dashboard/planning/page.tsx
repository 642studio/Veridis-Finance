"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  CartesianGrid,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Bar,
  BarChart,
  Legend,
} from "recharts";
import { Plus, RefreshCw, Save, Trash2 } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import { useNotify } from "@/hooks/use-notify";
import { ApiClientError, clientApiFetch } from "@/lib/api-client";
import { formatCurrency } from "@/lib/format";
import type {
  ApiEnvelope,
  FinancialPlan,
  PlanningFixedCostRow,
  PlanningFixedCostsResponse,
  PlanningImportResult,
  PlanningOverview,
  PlanningProductRow,
  PlanningProductsResponse,
  PlanningResultsResponse,
  PlanningVariableRow,
  PlanningVariablesResponse,
} from "@/types/finance";

type PlanningTab = "overview" | "products" | "fixed-costs" | "variables" | "import";

type VariableKey =
  | "accounts_receivable"
  | "accounts_payable"
  | "discount_rate"
  | "inventory";

type VariableType = "percentage" | "fixed";

type VariableDraft = {
  id: string;
  key: VariableKey;
  enabled: boolean;
  type: VariableType;
  value: string;
  applies_to: string;
};

const PLANNING_TABS: Array<{ id: PlanningTab; label: string }> = [
  { id: "overview", label: "Overview" },
  { id: "products", label: "Products" },
  { id: "fixed-costs", label: "Fixed Costs" },
  { id: "variables", label: "Variables" },
  { id: "import", label: "Import" },
];

const VARIABLE_DEFINITIONS: Array<{ key: VariableKey; label: string; defaultType: VariableType }> = [
  { key: "accounts_receivable", label: "Accounts Receivable", defaultType: "percentage" },
  { key: "accounts_payable", label: "Accounts Payable", defaultType: "percentage" },
  { key: "discount_rate", label: "Discount Rate", defaultType: "percentage" },
  { key: "inventory", label: "Inventory", defaultType: "percentage" },
];

function toNumber(value: string, fallback = 0) {
  const parsed = Number.parseFloat(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function hasMaxTwoDecimals(value: number) {
  return Number(value.toFixed(2)) === value;
}

function displayPlanName(plan: FinancialPlan) {
  const planName = plan.plan_name || plan.name || "Financial Plan";
  return `${planName} (${plan.start_year} - ${plan.end_year})`;
}

function buildVariableDrafts(
  rows: PlanningVariableRow[],
  products: PlanningProductRow[]
): VariableDraft[] {
  const byKey = new Map<string, PlanningVariableRow>();
  for (const row of rows) {
    byKey.set(row.variable_key, row);
  }

  const firstProductId = products[0]?.id || "global";

  return VARIABLE_DEFINITIONS.map((definition) => {
    const row = byKey.get(definition.key);
    const type = row?.type || row?.variable_type || definition.defaultType;
    const appliesTo = row?.applies_to || "global";

    return {
      id: row?.id || `new-${definition.key}`,
      key: definition.key,
      enabled: Boolean(row),
      type,
      value: row?.value !== undefined && row?.value !== null ? String(row.value) : "",
      applies_to:
        appliesTo === "global" || products.some((product) => product.id === appliesTo)
          ? appliesTo
          : firstProductId,
    };
  });
}

export default function DashboardPlanningPage() {
  const notify = useNotify();

  const [activeTab, setActiveTab] = useState<PlanningTab>("overview");

  const [plans, setPlans] = useState<FinancialPlan[]>([]);
  const [selectedPlanId, setSelectedPlanId] = useState<string>("");
  const [isLoadingPlans, setIsLoadingPlans] = useState(true);

  const [overview, setOverview] = useState<PlanningOverview | null>(null);
  const [results, setResults] = useState<PlanningResultsResponse | null>(null);
  const [products, setProducts] = useState<PlanningProductsResponse | null>(null);
  const [fixedCosts, setFixedCosts] = useState<PlanningFixedCostsResponse | null>(null);
  const [variables, setVariables] = useState<PlanningVariablesResponse | null>(null);
  const [isLoadingData, setIsLoadingData] = useState(false);

  const [planNameInput, setPlanNameInput] = useState("");
  const [startYearInput, setStartYearInput] = useState("");
  const [endYearInput, setEndYearInput] = useState("");
  const [taxRateInput, setTaxRateInput] = useState("0");
  const [inflationInput, setInflationInput] = useState("0");
  const [isSavingConfig, setIsSavingConfig] = useState(false);

  const [newProduct, setNewProduct] = useState({
    product_name: "",
    category: "",
    base_monthly_units: "0",
    price: "0",
    cogs_percent: "0",
    growth_percent_annual: "0",
  });
  const [isSavingProduct, setIsSavingProduct] = useState(false);

  const [newFixedCost, setNewFixedCost] = useState({
    cost_name: "",
    monthly_amount: "0",
    growth_percent_annual: "0",
  });
  const [isSavingFixedCost, setIsSavingFixedCost] = useState(false);

  const [variableDrafts, setVariableDrafts] = useState<VariableDraft[]>([]);
  const [isSavingVariables, setIsSavingVariables] = useState(false);

  const [importFile, setImportFile] = useState<File | null>(null);
  const [importPlanName, setImportPlanName] = useState("");
  const [importStartYear, setImportStartYear] = useState("");
  const [importEndYear, setImportEndYear] = useState("");
  const [isImporting, setIsImporting] = useState(false);
  const [importResult, setImportResult] = useState<PlanningImportResult | null>(null);
  const [importError, setImportError] = useState<string | null>(null);

  const selectedPlan = useMemo(
    () => plans.find((plan) => plan.id === selectedPlanId) || null,
    [plans, selectedPlanId]
  );

  const chartRows = useMemo(
    () => results?.rows ?? overview?.results ?? [],
    [results?.rows, overview?.results]
  );

  const chartData = useMemo(
    () =>
      chartRows.map((row) => ({
        year: String(row.year),
        revenue: row.total_revenue,
        net_profit: row.net_profit,
        margin_percent: row.margin_percent,
        cashflow: (row as { cashflow?: number }).cashflow || 0,
      })),
    [chartRows]
  );

  const summary = overview?.summary;

  const applyPlanToConfigInputs = useCallback((plan: FinancialPlan | null) => {
    if (!plan) {
      setPlanNameInput("");
      setStartYearInput("");
      setEndYearInput("");
      setTaxRateInput("0");
      setInflationInput("0");
      return;
    }

    setPlanNameInput(plan.plan_name || plan.name || "");
    setStartYearInput(String(plan.start_year || plan.year || ""));
    setEndYearInput(String(plan.end_year || plan.start_year || ""));
    setTaxRateInput(String(plan.tax_rate ?? 0));
    setInflationInput(String(plan.inflation ?? 0));
  }, []);

  const loadPlans = useCallback(async () => {
    setIsLoadingPlans(true);

    try {
      const response = await clientApiFetch<ApiEnvelope<FinancialPlan[]>>("/api/planning/plans");
      setPlans(response.data);

      if (!response.data.length) {
        setSelectedPlanId("");
        setActiveTab("import");
        applyPlanToConfigInputs(null);
        return;
      }

      setSelectedPlanId((current) => {
        if (current && response.data.some((plan) => plan.id === current)) {
          return current;
        }
        return response.data[0].id;
      });
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not load plans";
      notify.error({ title: "Load failed", description: message });
      setPlans([]);
      setSelectedPlanId("");
      applyPlanToConfigInputs(null);
    } finally {
      setIsLoadingPlans(false);
    }
  }, [applyPlanToConfigInputs, notify]);

  const loadPlanData = useCallback(
    async (planId: string) => {
      if (!planId) {
        setOverview(null);
        setResults(null);
        setProducts(null);
        setFixedCosts(null);
        setVariables(null);
        setVariableDrafts([]);
        return;
      }

      setIsLoadingData(true);

      try {
        const [overviewResponse, resultsResponse, productsResponse, fixedCostsResponse, variablesResponse] =
          await Promise.all([
            clientApiFetch<ApiEnvelope<PlanningOverview>>(`/api/planning/plans/${planId}/overview`),
            clientApiFetch<ApiEnvelope<PlanningResultsResponse>>(`/api/planning/plans/${planId}/results`),
            clientApiFetch<ApiEnvelope<PlanningProductsResponse>>(`/api/planning/plans/${planId}/products`),
            clientApiFetch<ApiEnvelope<PlanningFixedCostsResponse>>(
              `/api/planning/plans/${planId}/fixed-costs`
            ),
            clientApiFetch<ApiEnvelope<PlanningVariablesResponse>>(`/api/planning/plans/${planId}/variables`),
          ]);

        setOverview(overviewResponse.data);
        setResults(resultsResponse.data);
        setProducts(productsResponse.data);
        setFixedCosts(fixedCostsResponse.data);
        setVariables(variablesResponse.data);
        setVariableDrafts(
          buildVariableDrafts(variablesResponse.data.rows, productsResponse.data.rows)
        );

        applyPlanToConfigInputs(overviewResponse.data.plan);
      } catch (error) {
        const message =
          error instanceof ApiClientError ? error.message : "Could not load plan details";
        notify.error({ title: "Load failed", description: message });
      } finally {
        setIsLoadingData(false);
      }
    },
    [applyPlanToConfigInputs, notify]
  );

  useEffect(() => {
    loadPlans();
  }, [loadPlans]);

  useEffect(() => {
    if (!selectedPlanId) {
      return;
    }

    loadPlanData(selectedPlanId);
  }, [selectedPlanId, loadPlanData]);

  const refreshCurrentPlan = useCallback(async () => {
    if (!selectedPlanId) {
      return;
    }

    await loadPlanData(selectedPlanId);
  }, [loadPlanData, selectedPlanId]);

  const validatePercent = (value: number, min: number, max: number, field: string) => {
    if (!Number.isFinite(value)) {
      notify.error({ title: "Validation", description: `${field} must be numeric.` });
      return false;
    }

    if (!hasMaxTwoDecimals(value)) {
      notify.error({ title: "Validation", description: `${field} must use max 2 decimals.` });
      return false;
    }

    if (value < min || value > max) {
      notify.error({ title: "Validation", description: `${field} must be between ${min} and ${max}.` });
      return false;
    }

    return true;
  };

  const validateNonNegative = (value: number, field: string) => {
    if (!Number.isFinite(value)) {
      notify.error({ title: "Validation", description: `${field} must be numeric.` });
      return false;
    }

    if (!hasMaxTwoDecimals(value)) {
      notify.error({ title: "Validation", description: `${field} must use max 2 decimals.` });
      return false;
    }

    if (value < 0) {
      notify.error({ title: "Validation", description: `${field} cannot be negative.` });
      return false;
    }

    return true;
  };

  const handleSaveConfig = async () => {
    if (!selectedPlanId) {
      return;
    }

    const startYear = Number.parseInt(startYearInput, 10);
    const endYear = Number.parseInt(endYearInput, 10);
    const taxRate = toNumber(taxRateInput, NaN);
    const inflation = toNumber(inflationInput, NaN);

    if (!planNameInput.trim()) {
      notify.error({ title: "Validation", description: "Plan name is required." });
      return;
    }

    if (!Number.isInteger(startYear) || !Number.isInteger(endYear) || endYear < startYear) {
      notify.error({
        title: "Validation",
        description: "Year range is invalid. Ensure end year is >= start year.",
      });
      return;
    }

    if (!validatePercent(taxRate, 0, 100, "Tax Rate")) {
      return;
    }

    if (!validatePercent(inflation, 0, 100, "Inflation")) {
      return;
    }

    setIsSavingConfig(true);

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/config`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          plan_name: planNameInput.trim(),
          start_year: startYear,
          end_year: endYear,
          tax_rate: taxRate,
          inflation,
        }),
      });

      notify.success({ title: "Plan updated", description: "Projection recalculated successfully." });
      await Promise.all([loadPlans(), refreshCurrentPlan()]);
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not update plan";
      notify.error({ title: "Update failed", description: message });
    } finally {
      setIsSavingConfig(false);
    }
  };

  const handleCreateProduct = async () => {
    if (!selectedPlanId) {
      return;
    }

    if (!newProduct.product_name.trim()) {
      notify.error({ title: "Validation", description: "Product name is required." });
      return;
    }

    const baseUnits = toNumber(newProduct.base_monthly_units, NaN);
    const price = toNumber(newProduct.price, NaN);
    const cogsPercent = toNumber(newProduct.cogs_percent, NaN);
    const growthPercentAnnual = toNumber(newProduct.growth_percent_annual, NaN);

    if (!validateNonNegative(baseUnits, "Base Units")) {
      return;
    }

    if (!validateNonNegative(price, "Price")) {
      return;
    }

    if (!validatePercent(cogsPercent, 0, 100, "COGS %")) {
      return;
    }

    if (!validatePercent(growthPercentAnnual, 0, 300, "Annual Unit Growth %")) {
      return;
    }

    setIsSavingProduct(true);

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/products`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          product_name: newProduct.product_name.trim(),
          category: newProduct.category.trim() || null,
          base_monthly_units: baseUnits,
          price,
          cogs_percent: cogsPercent,
          growth_percent_annual: growthPercentAnnual,
        }),
      });

      setNewProduct({
        product_name: "",
        category: "",
        base_monthly_units: "0",
        price: "0",
        cogs_percent: "0",
        growth_percent_annual: "0",
      });

      notify.success({ title: "Product added", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not create product";
      notify.error({ title: "Create failed", description: message });
    } finally {
      setIsSavingProduct(false);
    }
  };

  const updateProductLocal = (productId: string, patch: Partial<PlanningProductRow>) => {
    setProducts((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        rows: current.rows.map((row) => (row.id === productId ? { ...row, ...patch } : row)),
      };
    });
  };

  const handleSaveProductRow = async (row: PlanningProductRow) => {
    if (!selectedPlanId) {
      return;
    }

    if (!row.product_name.trim()) {
      notify.error({ title: "Validation", description: "Product name is required." });
      return;
    }

    if (!validateNonNegative(row.base_monthly_units, "Base Units")) {
      return;
    }

    if (!validateNonNegative(row.price, "Price")) {
      return;
    }

    if (!validatePercent(row.cogs_percent, 0, 100, "COGS %")) {
      return;
    }

    if (!validatePercent(row.growth_percent_annual, 0, 300, "Annual Unit Growth %")) {
      return;
    }

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/products/${row.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          product_name: row.product_name,
          category: row.category,
          base_monthly_units: row.base_monthly_units,
          price: row.price,
          cogs_percent: row.cogs_percent,
          growth_percent_annual: row.growth_percent_annual,
          active: row.active,
        }),
      });

      notify.success({ title: "Product updated", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not update product";
      notify.error({ title: "Update failed", description: message });
    }
  };

  const handleDeleteProduct = async (productId: string) => {
    if (!selectedPlanId) {
      return;
    }

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/products/${productId}`, {
        method: "DELETE",
      });

      notify.success({ title: "Product removed", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not delete product";
      notify.error({ title: "Delete failed", description: message });
    }
  };

  const handleCreateFixedCost = async () => {
    if (!selectedPlanId) {
      return;
    }

    if (!newFixedCost.cost_name.trim()) {
      notify.error({ title: "Validation", description: "Cost name is required." });
      return;
    }

    const monthlyAmount = toNumber(newFixedCost.monthly_amount, NaN);
    const growthPercentAnnual = toNumber(newFixedCost.growth_percent_annual, NaN);

    if (!validateNonNegative(monthlyAmount, "Monthly Amount")) {
      return;
    }

    if (!validatePercent(growthPercentAnnual, 0, 300, "Annual Growth %")) {
      return;
    }

    setIsSavingFixedCost(true);

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/fixed-costs`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cost_name: newFixedCost.cost_name.trim(),
          monthly_amount: monthlyAmount,
          growth_percent_annual: growthPercentAnnual,
        }),
      });

      setNewFixedCost({
        cost_name: "",
        monthly_amount: "0",
        growth_percent_annual: "0",
      });

      notify.success({ title: "Fixed cost added", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create fixed cost";
      notify.error({ title: "Create failed", description: message });
    } finally {
      setIsSavingFixedCost(false);
    }
  };

  const updateFixedCostLocal = (costId: string, patch: Partial<PlanningFixedCostRow>) => {
    setFixedCosts((current) => {
      if (!current) {
        return current;
      }

      return {
        ...current,
        rows: current.rows.map((row) => (row.id === costId ? { ...row, ...patch } : row)),
      };
    });
  };

  const handleSaveFixedCostRow = async (row: PlanningFixedCostRow) => {
    if (!selectedPlanId) {
      return;
    }

    if (!row.cost_name.trim()) {
      notify.error({ title: "Validation", description: "Cost name is required." });
      return;
    }

    if (!validateNonNegative(row.monthly_amount, "Monthly Amount")) {
      return;
    }

    if (!validatePercent(row.growth_percent_annual, 0, 300, "Annual Growth %")) {
      return;
    }

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/fixed-costs/${row.id}`, {
        method: "PATCH",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({
          cost_name: row.cost_name,
          category: row.category,
          monthly_amount: row.monthly_amount,
          growth_percent_annual: row.growth_percent_annual,
          active: row.active,
        }),
      });

      notify.success({ title: "Fixed cost updated", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not update cost";
      notify.error({ title: "Update failed", description: message });
    }
  };

  const handleDeleteFixedCost = async (costId: string) => {
    if (!selectedPlanId) {
      return;
    }

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/fixed-costs/${costId}`, {
        method: "DELETE",
      });

      notify.success({ title: "Fixed cost removed", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not delete cost";
      notify.error({ title: "Delete failed", description: message });
    }
  };

  const handleVariableDraftChange = (id: string, patch: Partial<VariableDraft>) => {
    setVariableDrafts((current) =>
      current.map((row) => (row.id === id ? { ...row, ...patch } : row))
    );
  };

  const handleSaveVariables = async () => {
    if (!selectedPlanId) {
      return;
    }

    const productIds = new Set((products?.rows || []).map((row) => row.id));

    const payload: Array<{
      key: VariableKey;
      type: VariableType;
      value: number;
      applies_to: string | null;
    }> = [];

    for (const draft of variableDrafts) {
      if (!draft.enabled) {
        continue;
      }

      const valueNumber = toNumber(draft.value, NaN);
      if (!Number.isFinite(valueNumber)) {
        notify.error({
          title: "Validation",
          description: `${draft.key} value must be numeric.`,
        });
        return;
      }

      if (!hasMaxTwoDecimals(valueNumber)) {
        notify.error({
          title: "Validation",
          description: `${draft.key} must use max 2 decimals.`,
        });
        return;
      }

      if (draft.type === "percentage" && (valueNumber < 0 || valueNumber > 100)) {
        notify.error({
          title: "Validation",
          description: `${draft.key} percentage must be between 0 and 100.`,
        });
        return;
      }

      if (draft.type === "fixed" && valueNumber < 0) {
        notify.error({
          title: "Validation",
          description: `${draft.key} fixed value cannot be negative.`,
        });
        return;
      }

      if (draft.applies_to !== "global" && !productIds.has(draft.applies_to)) {
        notify.error({
          title: "Validation",
          description: `${draft.key} applies_to must be global or a valid product.`,
        });
        return;
      }

      payload.push({
        key: draft.key,
        type: draft.type,
        value: Number(valueNumber.toFixed(2)),
        applies_to: draft.applies_to === "global" ? "global" : draft.applies_to,
      });
    }

    setIsSavingVariables(true);

    try {
      await clientApiFetch(`/api/planning/plans/${selectedPlanId}/variables`, {
        method: "PUT",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify({ variables: payload }),
      });

      notify.success({ title: "Variables saved", description: "Projection recalculated." });
      await refreshCurrentPlan();
    } catch (error) {
      const message = error instanceof ApiClientError ? error.message : "Could not save variables";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSavingVariables(false);
    }
  };

  const handleImport = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!importFile) {
      const message = "Select an XLSX file first.";
      setImportError(message);
      notify.error({ title: "Validation", description: message });
      return;
    }

    const startYearRaw = importStartYear.trim();
    const endYearRaw = importEndYear.trim();
    const startYear =
      startYearRaw.length > 0 ? Number.parseInt(startYearRaw, 10) : undefined;
    const endYear = endYearRaw.length > 0 ? Number.parseInt(endYearRaw, 10) : undefined;

    if (
      (startYearRaw.length > 0 && !Number.isInteger(startYear)) ||
      (endYearRaw.length > 0 && !Number.isInteger(endYear))
    ) {
      const message = "Start Year and End Year must be valid integers when provided.";
      setImportError(message);
      notify.error({
        title: "Validation",
        description: message,
      });
      return;
    }

    if (
      startYear !== undefined &&
      endYear !== undefined &&
      endYear < startYear
    ) {
      const message = "End Year must be greater than or equal to Start Year.";
      setImportError(message);
      notify.error({
        title: "Validation",
        description: message,
      });
      return;
    }

    if (
      startYear !== undefined &&
      endYear !== undefined &&
      endYear - startYear + 1 > 20
    ) {
      const message = "Year range cannot exceed 20 years.";
      setImportError(message);
      notify.error({
        title: "Validation",
        description: message,
      });
      return;
    }

    setImportError(null);
    setIsImporting(true);

    try {
      const formData = new FormData();
      formData.append("file", importFile);

      if (importPlanName.trim()) {
        formData.append("plan_name", importPlanName.trim());
      }

      if (startYear !== undefined) {
        formData.append("start_year", String(startYear));
      }
      if (endYear !== undefined) {
        formData.append("end_year", String(endYear));
      }

      const response = await clientApiFetch<ApiEnvelope<PlanningImportResult>>(
        "/api/planning/import",
        {
          method: "POST",
          body: formData,
        }
      );

      setImportResult(response.data);
      setImportError(null);
      notify.success({
        title: "Planning imported",
        description: `${response.data.parsed_counts.products} products loaded and projected.`,
      });

      await loadPlans();
      setSelectedPlanId(response.data.plan_id);
      setImportFile(null);
      setImportPlanName("");
      setImportStartYear("");
      setImportEndYear("");
      setActiveTab("overview");
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not import planning workbook";
      setImportError(message);
      notify.error({ title: "Import failed", description: message });
    } finally {
      setIsImporting(false);
    }
  };

  return (
    <div className="min-h-screen space-y-6 rounded-2xl bg-slate-950/45 p-6 text-white shadow-[inset_0_0_0_1px_rgba(51,65,85,0.45)]">
      <Card>
        <CardHeader>
          <CardTitle>Financial Planning Engine</CardTitle>
          <CardDescription>
            Product-driven planning with deterministic projections and editable assumptions.
          </CardDescription>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="grid gap-4 lg:grid-cols-[1fr_auto]">
            <div className="space-y-2">
              <Label htmlFor="planning_plan">Plan</Label>
              <select
                id="planning_plan"
                className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                value={selectedPlanId}
                onChange={(event) => setSelectedPlanId(event.target.value)}
                disabled={isLoadingPlans || plans.length === 0}
              >
                {plans.length === 0 ? (
                  <option value="">No plans yet</option>
                ) : (
                  plans.map((plan) => (
                    <option key={plan.id} value={plan.id}>
                      {displayPlanName(plan)}
                    </option>
                  ))
                )}
              </select>
            </div>

            <div className="flex items-end gap-2">
              <Button variant="outline" onClick={loadPlans} disabled={isLoadingPlans}>
                <RefreshCw className="mr-2 h-4 w-4" />
                {isLoadingPlans ? "Refreshing..." : "Refresh"}
              </Button>
              <Button variant="outline" onClick={refreshCurrentPlan} disabled={!selectedPlanId}>
                Reload data
              </Button>
            </div>
          </div>

          <div className="flex flex-wrap gap-2">
            {PLANNING_TABS.map((tab) => (
              <Button
                key={tab.id}
                variant={activeTab === tab.id ? "default" : "outline"}
                onClick={() => setActiveTab(tab.id)}
              >
                {tab.label}
              </Button>
            ))}
          </div>
        </CardContent>
      </Card>

      {selectedPlan ? (
        <Card>
          <CardHeader>
            <CardTitle>Plan Configuration</CardTitle>
            <CardDescription>
              Update core settings. Projections recalculate after every save.
            </CardDescription>
          </CardHeader>
          <CardContent className="grid gap-3 md:grid-cols-6">
            <div className="space-y-2 md:col-span-2">
              <Label htmlFor="plan_name">Plan Name</Label>
              <Input
                id="plan_name"
                value={planNameInput}
                onChange={(event) => setPlanNameInput(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_start_year">Start Year</Label>
              <Input
                id="plan_start_year"
                type="number"
                value={startYearInput}
                onChange={(event) => setStartYearInput(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_end_year">End Year</Label>
              <Input
                id="plan_end_year"
                type="number"
                value={endYearInput}
                onChange={(event) => setEndYearInput(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_tax_rate">Tax Rate %</Label>
              <Input
                id="plan_tax_rate"
                type="number"
                value={taxRateInput}
                onChange={(event) => setTaxRateInput(event.target.value)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="plan_inflation">Inflation %</Label>
              <Input
                id="plan_inflation"
                type="number"
                value={inflationInput}
                onChange={(event) => setInflationInput(event.target.value)}
              />
            </div>
            <div className="md:col-span-6">
              <Button onClick={handleSaveConfig} disabled={isSavingConfig || isLoadingData}>
                <Save className="mr-2 h-4 w-4" />
                {isSavingConfig ? "Saving..." : "Save Configuration"}
              </Button>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "overview" ? (
        <div className="space-y-6">
          <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Revenue</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(summary?.total_revenue || 0)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Cost</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(summary?.total_cost || 0)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Net Profit</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(summary?.total_net_profit || 0)}</CardTitle>
              </CardHeader>
            </Card>
            <Card>
              <CardHeader className="pb-2">
                <CardDescription>Total Cashflow</CardDescription>
                <CardTitle className="text-2xl">{formatCurrency(summary?.total_cashflow || 0)}</CardTitle>
              </CardHeader>
            </Card>
          </section>

          <section className="grid gap-6 xl:grid-cols-2">
            <Card className="border-slate-800/80 bg-slate-950/65 text-slate-100">
              <CardHeader>
                <CardTitle>Revenue and Net Profit</CardTitle>
                <CardDescription className="text-slate-400">
                  Deterministic yearly projection computed in backend.
                </CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={chartData}>
                      <CartesianGrid stroke="#233252" strokeDasharray="3 3" />
                      <XAxis dataKey="year" tick={{ fill: "#cbd5e1" }} />
                      <YAxis tick={{ fill: "#cbd5e1" }} />
                      <Tooltip
                        formatter={(value) => formatCurrency(Number(value))}
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 12,
                          color: "#e2e8f0",
                        }}
                      />
                      <Legend />
                      <Line type="monotone" dataKey="revenue" name="Revenue" stroke="#22d3ee" strokeWidth={2.5} />
                      <Line type="monotone" dataKey="net_profit" name="Net Profit" stroke="#34d399" strokeWidth={2.5} />
                      <Line type="monotone" dataKey="cashflow" name="Cashflow" stroke="#f59e0b" strokeWidth={2.5} />
                    </LineChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>

            <Card className="border-slate-800/80 bg-slate-950/65 text-slate-100">
              <CardHeader>
                <CardTitle>Margin % by Year</CardTitle>
                <CardDescription className="text-slate-400">Net margin trend over selected range.</CardDescription>
              </CardHeader>
              <CardContent className="h-80">
                {chartData.length === 0 ? (
                  <div className="flex h-full items-center justify-center text-sm text-muted-foreground">
                    No data available
                  </div>
                ) : (
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={chartData}>
                      <CartesianGrid stroke="#233252" strokeDasharray="3 3" />
                      <XAxis dataKey="year" tick={{ fill: "#cbd5e1" }} />
                      <YAxis tick={{ fill: "#cbd5e1" }} />
                      <Tooltip
                        formatter={(value) => `${Number(value).toFixed(2)}%`}
                        contentStyle={{
                          background: "#0f172a",
                          border: "1px solid #334155",
                          borderRadius: 12,
                          color: "#e2e8f0",
                        }}
                      />
                      <Bar dataKey="margin_percent" name="Margin %" fill="#f59e0b" radius={[8, 8, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                )}
              </CardContent>
            </Card>
          </section>

          <Card>
            <CardHeader>
              <CardTitle>Projected Years</CardTitle>
              <CardDescription>Revenue, gross profit, net profit and cashflow.</CardDescription>
            </CardHeader>
            <CardContent>
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Year</TableHead>
                    <TableHead>Revenue</TableHead>
                    <TableHead>Gross Profit</TableHead>
                    <TableHead>Net Profit</TableHead>
                    <TableHead>Cashflow</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {chartRows.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={5} className="text-center text-muted-foreground">
                        No data available
                      </TableCell>
                    </TableRow>
                  ) : (
                    chartRows.map((row) => (
                      <TableRow key={row.id}>
                        <TableCell>{row.year}</TableCell>
                        <TableCell>{formatCurrency(row.total_revenue)}</TableCell>
                        <TableCell>{formatCurrency(row.gross_profit)}</TableCell>
                        <TableCell>{formatCurrency(row.net_profit)}</TableCell>
                        <TableCell>
                          {formatCurrency((row as { cashflow?: number }).cashflow || 0)}
                        </TableCell>
                      </TableRow>
                    ))
                  )}
                </TableBody>
              </Table>
            </CardContent>
          </Card>
        </div>
      ) : null}

      {activeTab === "products" ? (
        <Card>
          <CardHeader>
            <CardTitle>Products and Services</CardTitle>
            <CardDescription>
              Growth affects unit volume only. COGS is applied as percentage of revenue.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-border bg-card/40 p-4 md:grid-cols-7">
              <Input
                placeholder="Product name"
                value={newProduct.product_name}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, product_name: event.target.value }))
                }
                className="md:col-span-2"
              />
              <Input
                placeholder="Category"
                value={newProduct.category}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, category: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Base Units"
                value={newProduct.base_monthly_units}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, base_monthly_units: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Price"
                value={newProduct.price}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, price: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="COGS %"
                value={newProduct.cogs_percent}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, cogs_percent: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Annual Unit Growth %"
                value={newProduct.growth_percent_annual}
                onChange={(event) =>
                  setNewProduct((current) => ({ ...current, growth_percent_annual: event.target.value }))
                }
              />
              <div className="md:col-span-7">
                <Button onClick={handleCreateProduct} disabled={isSavingProduct}>
                  <Plus className="mr-2 h-4 w-4" />
                  {isSavingProduct ? "Adding..." : "Add Product"}
                </Button>
              </div>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Product</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Base Units</TableHead>
                  <TableHead>Price</TableHead>
                  <TableHead>COGS %</TableHead>
                  <TableHead>Annual Unit Growth %</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(products?.rows || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No products configured
                    </TableCell>
                  </TableRow>
                ) : (
                  products?.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Input
                          value={row.product_name}
                          onChange={(event) =>
                            updateProductLocal(row.id, { product_name: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          value={row.category || ""}
                          onChange={(event) =>
                            updateProductLocal(row.id, {
                              category: event.target.value.trim() ? event.target.value : null,
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.base_monthly_units}
                          onChange={(event) =>
                            updateProductLocal(row.id, {
                              base_monthly_units: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.price}
                          onChange={(event) =>
                            updateProductLocal(row.id, {
                              price: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.cogs_percent}
                          onChange={(event) =>
                            updateProductLocal(row.id, {
                              cogs_percent: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.growth_percent_annual}
                          onChange={(event) =>
                            updateProductLocal(row.id, {
                              growth_percent_annual: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" onClick={() => handleSaveProductRow(row)}>
                          <Save className="mr-1 h-4 w-4" /> Save
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteProduct(row.id)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "fixed-costs" ? (
        <Card>
          <CardHeader>
            <CardTitle>Fixed Costs</CardTitle>
            <CardDescription>
              Fixed costs can include own growth, and are also inflation-adjusted in projections.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 rounded-xl border border-border bg-card/40 p-4 md:grid-cols-4">
              <Input
                placeholder="Cost name"
                value={newFixedCost.cost_name}
                onChange={(event) =>
                  setNewFixedCost((current) => ({ ...current, cost_name: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Monthly amount"
                value={newFixedCost.monthly_amount}
                onChange={(event) =>
                  setNewFixedCost((current) => ({ ...current, monthly_amount: event.target.value }))
                }
              />
              <Input
                type="number"
                placeholder="Annual growth %"
                value={newFixedCost.growth_percent_annual}
                onChange={(event) =>
                  setNewFixedCost((current) => ({
                    ...current,
                    growth_percent_annual: event.target.value,
                  }))
                }
              />
              <Button onClick={handleCreateFixedCost} disabled={isSavingFixedCost}>
                <Plus className="mr-2 h-4 w-4" />
                {isSavingFixedCost ? "Adding..." : "Add Cost"}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Cost</TableHead>
                  <TableHead>Monthly Amount</TableHead>
                  <TableHead>Annual Growth %</TableHead>
                  <TableHead className="w-[180px]">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {(fixedCosts?.rows || []).length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-muted-foreground">
                      No fixed costs configured
                    </TableCell>
                  </TableRow>
                ) : (
                  fixedCosts?.rows.map((row) => (
                    <TableRow key={row.id}>
                      <TableCell>
                        <Input
                          value={row.cost_name}
                          onChange={(event) =>
                            updateFixedCostLocal(row.id, { cost_name: event.target.value })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.monthly_amount}
                          onChange={(event) =>
                            updateFixedCostLocal(row.id, {
                              monthly_amount: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell>
                        <Input
                          type="number"
                          value={row.growth_percent_annual}
                          onChange={(event) =>
                            updateFixedCostLocal(row.id, {
                              growth_percent_annual: toNumber(event.target.value),
                              annual_growth_percent: toNumber(event.target.value),
                            })
                          }
                        />
                      </TableCell>
                      <TableCell className="space-x-2">
                        <Button size="sm" variant="outline" onClick={() => handleSaveFixedCostRow(row)}>
                          <Save className="mr-1 h-4 w-4" /> Save
                        </Button>
                        <Button
                          size="sm"
                          variant="danger"
                          onClick={() => handleDeleteFixedCost(row.id)}
                        >
                          <Trash2 className="mr-1 h-4 w-4" /> Delete
                        </Button>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "variables" ? (
        <Card>
          <CardHeader>
            <CardTitle>Working Capital Variables</CardTitle>
            <CardDescription>
              Structured assumptions only: accounts_receivable, accounts_payable, discount_rate, inventory.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="flex gap-2">
              <Button onClick={handleSaveVariables} disabled={isSavingVariables}>
                <Save className="mr-2 h-4 w-4" />
                {isSavingVariables ? "Saving..." : "Save Variables"}
              </Button>
            </div>

            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Enabled</TableHead>
                  <TableHead>Key</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Value</TableHead>
                  <TableHead>Applies To</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {variableDrafts.map((row) => (
                  <TableRow key={row.id}>
                    <TableCell>
                      <input
                        type="checkbox"
                        checked={row.enabled}
                        onChange={(event) =>
                          handleVariableDraftChange(row.id, { enabled: event.target.checked })
                        }
                      />
                    </TableCell>
                    <TableCell>{VARIABLE_DEFINITIONS.find((item) => item.key === row.key)?.label || row.key}</TableCell>
                    <TableCell>
                      <select
                        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                        value={row.type}
                        disabled={!row.enabled}
                        onChange={(event) =>
                          handleVariableDraftChange(row.id, {
                            type: event.target.value as VariableType,
                          })
                        }
                      >
                        <option value="percentage">percentage</option>
                        <option value="fixed">fixed</option>
                      </select>
                    </TableCell>
                    <TableCell>
                      <Input
                        type="number"
                        value={row.value}
                        disabled={!row.enabled}
                        onChange={(event) =>
                          handleVariableDraftChange(row.id, { value: event.target.value })
                        }
                      />
                    </TableCell>
                    <TableCell>
                      <select
                        className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                        value={row.applies_to}
                        disabled={!row.enabled}
                        onChange={(event) =>
                          handleVariableDraftChange(row.id, { applies_to: event.target.value })
                        }
                      >
                        <option value="global">global</option>
                        {(products?.rows || []).map((product) => (
                          <option key={product.id} value={product.id}>
                            {product.product_name}
                          </option>
                        ))}
                      </select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>

            <div className="text-sm text-muted-foreground">
              {variables?.rows?.length || 0} persisted structured variables for this plan.
            </div>
          </CardContent>
        </Card>
      ) : null}

      {activeTab === "import" ? (
        <Card>
          <CardHeader>
            <CardTitle>Import Input-Based Template</CardTitle>
            <CardDescription>
              Upload your XLSX template. After import, all edits are done directly in the app.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleImport} className="space-y-4">
              <div className="grid gap-4 md:grid-cols-3">
                <div className="space-y-2 md:col-span-3">
                  <Label htmlFor="planning_file">Template (.xlsx)</Label>
                  <Input
                    id="planning_file"
                    type="file"
                    accept=".xlsx"
                    disabled={isImporting}
                    onChange={(event) => {
                      const file = event.target.files?.[0] || null;
                      setImportFile(file);
                    }}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import_plan_name">Override Plan Name (optional)</Label>
                  <Input
                    id="import_plan_name"
                    value={importPlanName}
                    onChange={(event) => setImportPlanName(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import_start_year">Start Year (optional override)</Label>
                  <Input
                    id="import_start_year"
                    type="number"
                    value={importStartYear}
                    disabled={isImporting}
                    onChange={(event) => setImportStartYear(event.target.value)}
                  />
                </div>

                <div className="space-y-2">
                  <Label htmlFor="import_end_year">End Year (optional override)</Label>
                  <Input
                    id="import_end_year"
                    type="number"
                    value={importEndYear}
                    disabled={isImporting}
                    onChange={(event) => setImportEndYear(event.target.value)}
                  />
                </div>
              </div>

              <Button
                type="submit"
                disabled={isImporting || !importFile}
              >
                {isImporting ? "Importing..." : "Import Workbook"}
              </Button>
            </form>

            {importError ? (
              <div className="mt-4 rounded-xl border border-red-500/35 bg-red-500/10 p-4 text-sm text-red-200">
                {importError}
              </div>
            ) : null}

            {importResult ? (
              <div className="mt-6 rounded-xl border border-emerald-500/35 bg-emerald-500/10 p-4 text-sm">
                <div className="font-medium text-emerald-300">Import completed</div>
                <div className="mt-2 text-emerald-200/90">Plan ID: {importResult.plan_id}</div>
                <div className="text-emerald-200/90">Years: {importResult.years.join(", ")}</div>
                <div className="text-emerald-200/90">Products parsed: {importResult.parsed_counts.products}</div>
                <div className="text-emerald-200/90">Fixed costs parsed: {importResult.parsed_counts.fixed_costs}</div>
              </div>
            ) : null}
          </CardContent>
        </Card>
      ) : null}

      {isLoadingData ? (
        <Card>
          <CardContent className="py-8 text-sm text-muted-foreground">Loading plan data...</CardContent>
        </Card>
      ) : null}
    </div>
  );
}
