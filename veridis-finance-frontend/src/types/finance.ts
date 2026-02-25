export type UserRole = "owner" | "admin" | "ops" | "viewer";
export type PlanTier = "free" | "pro" | "enterprise";
export type TransactionType = "income" | "expense";
export type InvoiceStatus = "pending" | "paid";
export type BankStatementStatus = "preview" | "confirmed";
export type SupportedBank = "santander" | "bbva" | "banorte";
export type CashflowTrend = "growing" | "stable" | "declining";
export type AiProviderName = "openai" | "google" | "qwen";
export type PlanningScenario = "base" | "optimistic" | "conservative";
export type PlanningBudgetType =
  | "income"
  | "cost"
  | "expense"
  | "capex"
  | "loan_payment";
export type PlanningFundingSource = "capital" | "debt" | "mixed";
export type VendorType =
  | "ads"
  | "software"
  | "rent"
  | "utilities"
  | "payroll"
  | "other";

export interface SessionClaims {
  user_id: string;
  organization_id: string;
  role: UserRole;
  exp?: number;
  iat?: number;
}

export interface AuthUser {
  user_id: string;
  organization_id: string;
  email: string;
  full_name: string;
  role: UserRole;
}

export interface OrganizationSummary {
  organization_id: string;
  name: string;
  slug: string;
  subdomain: string;
  plan: PlanTier;
  subscription_status: string;
}

export interface AuthResponseData {
  token: string;
  user: AuthUser;
  organization: OrganizationSummary;
}

export interface Transaction {
  id: string;
  organization_id: string;
  type: TransactionType;
  amount: number;
  category: string;
  description?: string | null;
  entity?: string | null;
  member_id?: string | null;
  member_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  editable?: boolean;
  notes?: string | null;
  match_confidence?: number | null;
  match_method?: "rule" | "fuzzy" | "manual" | null;
  transaction_date: string;
  created_at: string;
}

export interface Client {
  id: string;
  organization_id: string;
  name: string;
  business_name?: string | null;
  email?: string | null;
  phone?: string | null;
  notes?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Vendor {
  id: string;
  organization_id: string;
  name: string;
  type: VendorType;
  default_category_id?: string | null;
  active: boolean;
  created_at: string;
  updated_at: string;
}

export interface Member {
  id: string;
  organization_id: string;
  full_name: string;
  alias?: string | null;
  bank_account_last4?: string | null;
  rfc?: string | null;
  salary_estimate?: number | null;
  active: boolean;
  created_at: string;
}

export interface Invoice {
  id: string;
  organization_id: string;
  uuid_sat: string;
  emitter: string;
  receiver: string;
  total: number;
  status: InvoiceStatus;
  invoice_date: string;
  created_at: string;
}

export interface CategorySummary {
  category: string;
  total_income: number;
  total_expense: number;
  net_profit: number;
  transaction_count: number;
}

export interface MonthlySummary {
  organization_id: string;
  month: number;
  year: number;
  total_income: number;
  total_expense: number;
  net_profit: number;
  transaction_count: number;
  by_category: CategorySummary[];
}

export interface CashflowProjection {
  current_balance: number;
  avg_monthly_income: number;
  avg_monthly_expenses: number;
  projected_30_days: number;
  projected_end_month: number;
  estimated_negative_date: string | null;
  trend: CashflowTrend;
}

export interface ApiEnvelope<T> {
  data: T;
}

export interface ApiErrorEnvelope {
  error: string;
  details?: unknown;
}

export interface AiProviderConfig {
  id: string | null;
  organization_id: string;
  provider: string;
  model: string;
  active: boolean;
  use_system_key: boolean;
  created_at: string | null;
  key_configured: boolean;
  api_key_masked: string | null;
  system_key_available: boolean;
}

export interface AiConnectionTestResult {
  ok: boolean;
  provider: string;
  model: string;
  key_source: "organization" | "system";
  usage_tokens: number;
  estimated_cost_usd: number;
  checked_at: string;
}

export interface AiUsageStats {
  organization_id: string;
  month: number;
  year: number;
  monthly_tokens_used: number;
  estimated_cost_usd: number;
  total_requests: number;
}

export interface AccountUserProfile {
  user_id: string;
  organization_id: string;
  full_name: string;
  email: string;
  role: UserRole;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface OrganizationSettings {
  organization_id: string;
  name: string;
  slug: string;
  subdomain: string | null;
  logo_url: string | null;
  currency: string;
  timezone: string;
  plan: PlanTier;
  subscription_status: string;
  created_at: string;
  updated_at: string;
}

export interface AccountSettingsData {
  user: AccountUserProfile;
  organization: OrganizationSettings;
}

export interface BankStatementPreviewTransaction {
  transaction_date: string;
  type: TransactionType;
  amount: number;
  concept: string;
  category?: string;
  category_id?: string | null;
  subcategory_id?: string | null;
  member_id?: string | null;
  member_name?: string | null;
  client_id?: string | null;
  client_name?: string | null;
  vendor_id?: string | null;
  vendor_name?: string | null;
  entity_link_source?: string | null;
  match_confidence?: number | null;
  match_method?: "rule" | "fuzzy" | "manual" | null;
  is_payroll_candidate?: boolean;
  confidence_score?: number;
  classification_status?: "classified" | "uncategorized";
  classification_match_type?: "exact" | "like" | "fuzzy" | null;
  classification_rule_id?: string | null;
  normalized_description?: string;
  keyword_pattern?: string;
  raw_description: string;
  folio: string;
  bank: string;
}

export interface BankStatementUploadData {
  import_id: string;
  bank: string;
  account_number: string | null;
  period_start: string | null;
  period_end: string | null;
  preview_count: number;
  transactions_preview: BankStatementPreviewTransaction[];
  status: BankStatementStatus;
}

export interface BankStatementConfirmData {
  import_id: string;
  inserted_count: number;
  skipped_duplicates: number;
  skipped_invalid: number;
  already_confirmed: boolean;
}

export interface FinancialPlan {
  id: string;
  organization_id: string;
  user_id: string | null;
  plan_name: string;
  start_year: number;
  end_year: number;
  tax_rate?: number;
  inflation?: number;
  created_at: string;
  updated_at: string;

  // Backward-compatible aliases from older payloads.
  year?: number;
  scenario?: PlanningScenario;
  name?: string;
}

export interface PlanningYearResult {
  id: string;
  organization_id: string;
  plan_id: string;
  year: number;
  total_revenue: number;
  total_cost: number;
  gross_profit: number;
  net_profit: number;
  margin_percent: number;
  created_at: string;
  updated_at: string;
}

export interface PlanningOverview {
  plan: FinancialPlan;
  summary: {
    years_count: number;
    total_revenue: number;
    total_cost: number;
    total_net_profit: number;
    total_cashflow?: number;
    average_margin_percent: number;
    net_profit_year_1: number;
  };
  counts: {
    products: number;
    fixed_costs: number;
    variables: number;
  };
  results: PlanningYearResult[];
  years?: number[];
  revenue?: number[];
  gross_profit?: number[];
  net_profit?: number[];
  cashflow?: number[];
}

export interface PlanningResultsResponse {
  plan: FinancialPlan;
  rows: PlanningYearResult[];
  years?: number[];
  revenue?: number[];
  gross_profit?: number[];
  net_profit?: number[];
  cashflow?: number[];
}

export interface PlanningProductRow {
  id: string;
  organization_id: string;
  plan_id: string;
  product_name: string;
  base_monthly_units: number;
  price: number;
  growth_percent_annual: number;
  cogs_percent: number;
  monthly_price: number;
  monthly_cost: number;
  growth_rate_percent: number;
  category: string | null;
  active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanningProductsResponse {
  plan: FinancialPlan;
  rows: PlanningProductRow[];
}

export interface PlanningFixedCostRow {
  id: string;
  organization_id: string;
  plan_id: string;
  cost_name: string;
  category?: string | null;
  monthly_amount: number;
  growth_percent_annual: number;
  annual_growth_percent: number;
  active?: boolean;
  created_at: string;
  updated_at: string;
}

export interface PlanningFixedCostsResponse {
  plan: FinancialPlan;
  rows: PlanningFixedCostRow[];
}

export interface PlanningVariableRow {
  id: string;
  organization_id: string;
  plan_id: string;
  variable_key: string;
  key: string;
  type: "percentage" | "fixed";
  variable_type: "percentage" | "fixed";
  value: number;
  applies_to: string | null;
  variable_value: {
    key: string;
    type: "percentage" | "fixed";
    value: number;
    applies_to: string | null;
  };
  created_at: string;
  updated_at: string;
}

export interface PlanningVariablesResponse {
  plan: FinancialPlan;
  rows: PlanningVariableRow[];
}

export interface PlanningImportResult {
  success: boolean;
  plan_id: string;
  years: number[];
  summary: {
    total_products: number;
    total_revenue: number;
    net_income_year_1: number;
  };
  warnings: string[];
  parsed_counts: {
    products: number;
    fixed_costs: number;
    variables: number;
    year_results: number;
  };
}
