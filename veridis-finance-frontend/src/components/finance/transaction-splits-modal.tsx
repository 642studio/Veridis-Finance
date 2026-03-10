"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

import { ConfirmModal } from "@/components/common/confirm-modal";
import { Button } from "@/components/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
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
  Category,
  Subcategory,
  Transaction,
  TransactionSplit,
} from "@/types/finance";

interface TransactionSplitsModalProps {
  open: boolean;
  transaction: Transaction | null;
  categories: Category[];
  onOpenChange: (open: boolean) => void;
  onChanged?: () => Promise<void> | void;
}

function toSafeAmount(value: string) {
  const parsed = Number(value);
  if (!Number.isFinite(parsed) || parsed <= 0) {
    return null;
  }

  return Number(parsed.toFixed(2));
}

export function TransactionSplitsModal({
  open,
  transaction,
  categories,
  onOpenChange,
  onChanged,
}: TransactionSplitsModalProps) {
  const notify = useNotify();

  const [splits, setSplits] = useState<TransactionSplit[]>([]);
  const [subcategoriesByCategory, setSubcategoriesByCategory] = useState<
    Record<string, Subcategory[]>
  >({});

  const [isLoading, setIsLoading] = useState(false);
  const [isSaving, setIsSaving] = useState(false);
  const [isDeleting, setIsDeleting] = useState(false);

  const [editingSplitId, setEditingSplitId] = useState<string | null>(null);
  const [deletingSplit, setDeletingSplit] = useState<TransactionSplit | null>(null);

  const [categoryId, setCategoryId] = useState("");
  const [subcategoryId, setSubcategoryId] = useState("");
  const [amount, setAmount] = useState("0.00");

  const splitTotal = useMemo(
    () => splits.reduce((total, split) => total + Number(split.amount || 0), 0),
    [splits]
  );

  const remainingAmount = useMemo(() => {
    const transactionAmount = Number(transaction?.amount || 0);
    return Number((transactionAmount - splitTotal).toFixed(2));
  }, [splitTotal, transaction?.amount]);

  const currentSubcategories = useMemo(() => {
    if (!categoryId) {
      return [] as Subcategory[];
    }

    return subcategoriesByCategory[categoryId] || [];
  }, [categoryId, subcategoriesByCategory]);

  const loadSubcategories = useCallback(
    async (nextCategoryId: string) => {
      if (!nextCategoryId || subcategoriesByCategory[nextCategoryId]) {
        return;
      }

      try {
        const response = await clientApiFetch<ApiEnvelope<Subcategory[]>>(
          `/api/finance/categories/${nextCategoryId}/subcategories?active=true`
        );
        setSubcategoriesByCategory((current) => ({
          ...current,
          [nextCategoryId]: response.data,
        }));
      } catch (error) {
        const message =
          error instanceof ApiClientError
            ? error.message
            : "Could not load subcategories";
        notify.error({ title: "Load failed", description: message });
      }
    },
    [notify, subcategoriesByCategory]
  );

  const loadSplits = useCallback(async () => {
    if (!transaction?.id) {
      setSplits([]);
      return;
    }

    setIsLoading(true);
    try {
      const response = await clientApiFetch<ApiEnvelope<TransactionSplit[]>>(
        `/api/finance/transactions/${transaction.id}/splits`
      );
      setSplits(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not load transaction splits";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, transaction?.id]);

  const resetForm = useCallback(() => {
    setEditingSplitId(null);

    const defaultCategoryId = categories[0]?.id || "";
    setCategoryId(defaultCategoryId);
    setSubcategoryId("");

    const suggested = remainingAmount > 0 ? remainingAmount : Number(transaction?.amount || 0);
    setAmount(Number.isFinite(suggested) ? suggested.toFixed(2) : "0.00");
  }, [categories, remainingAmount, transaction?.amount]);

  useEffect(() => {
    if (!open || !transaction?.id) {
      return;
    }

    void loadSplits();
    resetForm();
  }, [loadSplits, open, resetForm, transaction?.id]);

  useEffect(() => {
    if (!open || !categoryId) {
      return;
    }

    void loadSubcategories(categoryId);
  }, [categoryId, loadSubcategories, open]);

  const closeModal = () => {
    if (isSaving || isDeleting) {
      return;
    }

    onOpenChange(false);
    setEditingSplitId(null);
    setDeletingSplit(null);
  };

  const submitSplit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!transaction?.id) {
      return;
    }

    if (!categoryId) {
      notify.error({ title: "Validation", description: "Category is required" });
      return;
    }

    const safeAmount = toSafeAmount(amount);
    if (!safeAmount) {
      notify.error({ title: "Validation", description: "Amount must be greater than 0" });
      return;
    }

    setIsSaving(true);
    try {
      const payload = {
        category_id: categoryId,
        subcategory_id: subcategoryId || null,
        amount: safeAmount,
      };

      if (editingSplitId) {
        await clientApiFetch<ApiEnvelope<TransactionSplit>>(
          `/api/finance/transaction-splits/${editingSplitId}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Split updated",
          description: "Transaction split was updated.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<TransactionSplit>>(
          `/api/finance/transactions/${transaction.id}/splits`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Split created",
          description: "Transaction split was added.",
        });
      }

      await loadSplits();
      resetForm();
      await onChanged?.();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save split";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSaving(false);
    }
  };

  const startEdit = async (split: TransactionSplit) => {
    setEditingSplitId(split.id);
    setCategoryId(split.category_id);
    setSubcategoryId(split.subcategory_id || "");
    setAmount(Number(split.amount || 0).toFixed(2));
    await loadSubcategories(split.category_id);
  };

  const deleteSplit = async (split: TransactionSplit) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<{ id: string; deleted: boolean }>>(
        `/api/finance/transaction-splits/${split.id}`,
        {
          method: "DELETE",
        }
      );

      notify.success({
        title: "Split deleted",
        description: "Transaction split was removed.",
      });

      if (editingSplitId === split.id) {
        resetForm();
      }

      await loadSplits();
      await onChanged?.();
      setDeletingSplit(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete split";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  if (!open || !transaction) {
    return null;
  }

  return (
    <>
      <Dialog open={open} onOpenChange={(next) => (!next ? closeModal() : undefined)}>
        <DialogContent className="max-h-[92vh] max-w-4xl overflow-y-auto border-slate-700 bg-slate-950 text-slate-100">
          <DialogHeader>
            <DialogTitle>Transaction Splits</DialogTitle>
            <DialogDescription className="text-slate-300">
              Transaction {transaction.id.slice(0, 8)}... | Amount {formatCurrency(transaction.amount)}
            </DialogDescription>
          </DialogHeader>

          <div className="grid gap-4 sm:grid-cols-3">
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Transaction amount</p>
              <p className="mt-1 text-base font-semibold text-slate-100">
                {formatCurrency(transaction.amount)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Split total</p>
              <p className="mt-1 text-base font-semibold text-slate-100">
                {formatCurrency(splitTotal)}
              </p>
            </div>
            <div className="rounded-xl border border-slate-700 bg-slate-900/70 p-3">
              <p className="text-xs uppercase tracking-wide text-slate-400">Remaining</p>
              <p
                className={`mt-1 text-base font-semibold ${
                  remainingAmount < 0 ? "text-red-400" : "text-emerald-400"
                }`}
              >
                {formatCurrency(remainingAmount)}
              </p>
            </div>
          </div>

          <div className="rounded-xl border border-slate-700 bg-slate-900/50 p-4">
            <h4 className="mb-3 text-sm font-semibold text-slate-100">
              {editingSplitId ? "Edit split" : "Add split"}
            </h4>

            <form className="grid gap-3 sm:grid-cols-4" onSubmit={submitSplit}>
              <div className="space-y-2 sm:col-span-2">
                <Label htmlFor="split_category">Category</Label>
                <select
                  id="split_category"
                  className="h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                  value={categoryId}
                  onChange={(event) => {
                    setCategoryId(event.target.value);
                    setSubcategoryId("");
                  }}
                >
                  <option value="">Select category</option>
                  {categories.map((category) => (
                    <option key={category.id} value={category.id}>
                      {category.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="split_subcategory">Subcategory</Label>
                <select
                  id="split_subcategory"
                  className="h-10 w-full rounded-xl border border-slate-700 bg-slate-900 px-3 text-sm text-slate-100"
                  value={subcategoryId}
                  onChange={(event) => setSubcategoryId(event.target.value)}
                  disabled={!categoryId}
                >
                  <option value="">None</option>
                  {currentSubcategories.map((subcategory) => (
                    <option key={subcategory.id} value={subcategory.id}>
                      {subcategory.name}
                    </option>
                  ))}
                </select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="split_amount">Amount</Label>
                <Input
                  id="split_amount"
                  type="number"
                  step="0.01"
                  min="0"
                  value={amount}
                  onChange={(event) => setAmount(event.target.value)}
                  required
                />
              </div>

              <div className="flex flex-wrap items-end gap-2 sm:col-span-4">
                <Button type="submit" disabled={isSaving || !transaction.editable}>
                  {isSaving ? "Saving..." : editingSplitId ? "Update split" : "Add split"}
                </Button>
                {editingSplitId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={resetForm}
                    disabled={isSaving}
                  >
                    Cancel edit
                  </Button>
                ) : null}
              </div>
            </form>
          </div>

          {isLoading ? (
            <p className="text-sm text-slate-400">Loading splits...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Category</TableHead>
                  <TableHead>Subcategory</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {splits.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={4} className="text-center text-slate-400">
                      No splits yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  splits.map((split) => (
                    <TableRow key={split.id}>
                      <TableCell>{split.category_name || split.category_id}</TableCell>
                      <TableCell>{split.subcategory_name || "-"}</TableCell>
                      <TableCell className="font-semibold">
                        {formatCurrency(split.amount)}
                      </TableCell>
                      <TableCell className="text-right">
                        <div className="flex justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => void startEdit(split)}
                            disabled={isDeleting || !transaction.editable}
                          >
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => setDeletingSplit(split)}
                            disabled={isDeleting || !transaction.editable}
                          >
                            Delete
                          </Button>
                        </div>
                      </TableCell>
                    </TableRow>
                  ))
                )}
              </TableBody>
            </Table>
          )}

          <div className="flex justify-end">
            <Button variant="outline" onClick={closeModal}>
              Close
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <ConfirmModal
        open={Boolean(deletingSplit)}
        title="Delete split?"
        description="This split line will be removed from the transaction."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingSplit(null);
          }
        }}
        onConfirm={async () => {
          if (!deletingSplit) {
            return;
          }

          await deleteSplit(deletingSplit);
        }}
      />
    </>
  );
}
