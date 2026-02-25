"use client";

import Link from "next/link";
import { useCallback, useEffect, useMemo, useState } from "react";
import { Pencil, Trash2 } from "lucide-react";

import {
  ConfirmModal,
  getConfirmSkipPreference,
  setConfirmSkipPreference,
} from "@/components/common/confirm-modal";
import {
  CreateTransactionPayload,
  TransactionForm,
} from "@/components/finance/transaction-form";
import { BankStatementUploadModal } from "@/components/finance/bank-statement-upload-modal";
import {
  TransactionEditModal,
  type UpdateTransactionPayload,
} from "@/components/finance/transaction-edit-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import { emitFinanceDataRefresh } from "@/lib/finance-events";
import { formatCurrency, formatDate } from "@/lib/format";
import type {
  ApiEnvelope,
  Client,
  Member,
  Transaction,
  Vendor,
} from "@/types/finance";

function EntityBadge({ transaction }: { transaction: Transaction }) {
  if (transaction.member_id) {
    return (
      <Link href={`/dashboard/members?memberId=${transaction.member_id}`}>
        <Badge variant="outline" className="hover:bg-accent">
          Member: {transaction.member_name || "View"}
        </Badge>
      </Link>
    );
  }

  if (transaction.client_id) {
    return (
      <Link href={`/dashboard/clients?clientId=${transaction.client_id}`}>
        <Badge variant="outline" className="hover:bg-accent">
          Client: {transaction.client_name || "View"}
        </Badge>
      </Link>
    );
  }

  if (transaction.vendor_id) {
    return (
      <Link href={`/dashboard/vendors?vendorId=${transaction.vendor_id}`}>
        <Badge variant="outline" className="hover:bg-accent">
          Vendor: {transaction.vendor_name || "View"}
        </Badge>
      </Link>
    );
  }

  return <span className="text-xs text-muted-foreground">-</span>;
}

export default function DashboardTransactionsPage() {
  const notify = useNotify();

  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [members, setMembers] = useState<Member[]>([]);
  const [clients, setClients] = useState<Client[]>([]);
  const [vendors, setVendors] = useState<Vendor[]>([]);

  const [isLoading, setIsLoading] = useState(true);
  const [isMetaLoading, setIsMetaLoading] = useState(true);
  const [isBankUploadOpen, setIsBankUploadOpen] = useState(false);
  const [selectedMemberId, setSelectedMemberId] = useState("all");

  const [editingTransaction, setEditingTransaction] = useState<Transaction | null>(null);
  const [isEditOpen, setIsEditOpen] = useState(false);
  const [isSavingEdit, setIsSavingEdit] = useState(false);
  const [deletingTransaction, setDeletingTransaction] = useState<Transaction | null>(null);
  const [isDeleting, setIsDeleting] = useState(false);

  const loadTransactions = useCallback(async () => {
    setIsLoading(true);
    try {
      const searchParams = new URLSearchParams({
        limit: "50",
        offset: "0",
      });

      if (selectedMemberId !== "all") {
        searchParams.set("member_id", selectedMemberId);
      }

      const response = await clientApiFetch<ApiEnvelope<Transaction[]>>(
        `/api/finance/transactions?${searchParams.toString()}`
      );
      setTransactions(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not fetch transactions";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoading(false);
    }
  }, [notify, selectedMemberId]);

  const loadMeta = useCallback(async () => {
    setIsMetaLoading(true);
    try {
      const [membersResponse, clientsResponse, vendorsResponse] = await Promise.all([
        clientApiFetch<ApiEnvelope<Member[]>>("/api/finance/members?active=true"),
        clientApiFetch<ApiEnvelope<Client[]>>("/api/finance/clients?active=true"),
        clientApiFetch<ApiEnvelope<Vendor[]>>("/api/finance/vendors?active=true"),
      ]);

      setMembers(membersResponse.data);
      setClients(clientsResponse.data);
      setVendors(vendorsResponse.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not load entities";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsMetaLoading(false);
    }
  }, [notify]);

  useEffect(() => {
    loadTransactions();
  }, [loadTransactions, selectedMemberId]);

  useEffect(() => {
    loadMeta();
  }, [loadMeta]);

  const handleCreateTransaction = async (payload: CreateTransactionPayload) => {
    try {
      await clientApiFetch<ApiEnvelope<Transaction>>("/api/finance/transactions", {
        method: "POST",
        headers: {
          "content-type": "application/json",
        },
        body: JSON.stringify(payload),
      });

      notify.success({
        title: "Transaction created",
        description: "The entry was saved successfully.",
      });
      await loadTransactions();
      emitFinanceDataRefresh("transaction_create");
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not create transaction";
      notify.error({
        title: "Transaction failed",
        description: message,
      });
      throw error;
    }
  };

  const openEdit = (transaction: Transaction) => {
    setEditingTransaction(transaction);
    setIsEditOpen(true);
  };

  const closeEdit = () => {
    if (isSavingEdit) {
      return;
    }

    setIsEditOpen(false);
    setEditingTransaction(null);
  };

  const handleEditSave = async (payload: UpdateTransactionPayload) => {
    if (!editingTransaction) {
      return;
    }

    setIsSavingEdit(true);
    try {
      await clientApiFetch<ApiEnvelope<Transaction>>(
        `/api/finance/transactions/${editingTransaction.id}`,
        {
          method: "PUT",
          headers: {
            "content-type": "application/json",
          },
          body: JSON.stringify(payload),
        }
      );

      notify.success({
        title: "Transaction updated",
        description: "Changes were saved successfully.",
      });
      await loadTransactions();
      emitFinanceDataRefresh("transaction_update");
      closeEdit();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not update transaction";
      notify.error({ title: "Update failed", description: message });
    } finally {
      setIsSavingEdit(false);
    }
  };

  const runDeleteTransaction = async (
    transaction: Transaction,
    rememberChoice = false
  ) => {
    setIsDeleting(true);
    try {
      await clientApiFetch<ApiEnvelope<{ id: string; deleted: boolean }>>(
        `/api/finance/transactions/${transaction.id}`,
        {
          method: "DELETE",
        }
      );

      notify.success({
        title: "Transaction deleted",
        description: "Transaction was removed.",
      });
      await loadTransactions();
      emitFinanceDataRefresh("transaction_delete");
      setDeletingTransaction(null);

      if (rememberChoice) {
        setConfirmSkipPreference("vf_skip_confirm_transaction_delete", true);
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete transaction";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeleting(false);
    }
  };

  const requestDeleteTransaction = async (transaction: Transaction) => {
    if (getConfirmSkipPreference("vf_skip_confirm_transaction_delete")) {
      await runDeleteTransaction(transaction, true);
      return;
    }

    setDeletingTransaction(transaction);
  };

  const transactionRows = useMemo(() => transactions, [transactions]);

  return (
    <div className="space-y-6">
      <TransactionForm onSubmit={handleCreateTransaction} />

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Recent transactions</CardTitle>
          <div className="flex flex-wrap items-center gap-2">
            <select
              className="h-9 min-w-[180px] rounded-lg border border-border bg-card px-3 text-sm"
              value={selectedMemberId}
              onChange={(event) => setSelectedMemberId(event.target.value)}
              disabled={isMetaLoading}
            >
              <option value="all">All members</option>
              {members.map((member) => (
                <option key={member.id} value={member.id}>
                  {member.full_name}
                </option>
              ))}
            </select>
            <Button variant="secondary" onClick={() => setIsBankUploadOpen(true)}>
              Upload Bank Statement
            </Button>
          </div>
        </CardHeader>
        <CardContent>
          {isLoading ? (
            <p className="text-sm text-muted-foreground">Loading transactions...</p>
          ) : (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Type</TableHead>
                  <TableHead>Amount</TableHead>
                  <TableHead>Category</TableHead>
                  <TableHead>Linked Entity</TableHead>
                  <TableHead>Notes</TableHead>
                  <TableHead>Date</TableHead>
                  <TableHead className="text-right">Actions</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {transactionRows.length === 0 ? (
                  <TableRow>
                    <TableCell colSpan={7} className="text-center text-muted-foreground">
                      No transactions yet.
                    </TableCell>
                  </TableRow>
                ) : (
                  transactionRows.map((transaction) => (
                    <TableRow key={transaction.id}>
                      <TableCell>
                        <Badge variant={transaction.type === "income" ? "success" : "danger"}>
                          {transaction.type}
                        </Badge>
                      </TableCell>
                      <TableCell className="font-medium">
                        {formatCurrency(transaction.amount)}
                      </TableCell>
                      <TableCell>{transaction.category}</TableCell>
                      <TableCell>
                        <EntityBadge transaction={transaction} />
                      </TableCell>
                      <TableCell className="max-w-[220px] truncate">
                        {transaction.notes || "-"}
                      </TableCell>
                      <TableCell>{formatDate(transaction.transaction_date)}</TableCell>
                      <TableCell className="text-right">
                        <div className="flex flex-wrap justify-end gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => openEdit(transaction)}
                          >
                            <Pencil className="mr-1 h-3.5 w-3.5" />
                            Edit
                          </Button>
                          <Button
                            size="sm"
                            variant="danger"
                            onClick={() => requestDeleteTransaction(transaction)}
                            disabled={transaction.editable === false}
                          >
                            <Trash2 className="mr-1 h-3.5 w-3.5" />
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
        </CardContent>
      </Card>

      <BankStatementUploadModal
        open={isBankUploadOpen}
        onOpenChange={setIsBankUploadOpen}
        onImportConfirmed={async () => {
          await loadTransactions();
          emitFinanceDataRefresh("bank_statement_confirm");
        }}
        members={members}
        clients={clients}
      />

      <TransactionEditModal
        open={isEditOpen}
        transaction={editingTransaction}
        members={members}
        clients={clients}
        vendors={vendors}
        isSaving={isSavingEdit}
        onClose={closeEdit}
        onSubmit={handleEditSave}
      />

      <ConfirmModal
        open={Boolean(deletingTransaction)}
        title="Delete Transaction?"
        description="This action cannot be undone."
        confirmLabel="Delete"
        cancelLabel="Cancel"
        rememberChoiceKey="vf_skip_confirm_transaction_delete"
        isLoading={isDeleting}
        onCancel={() => {
          if (!isDeleting) {
            setDeletingTransaction(null);
          }
        }}
        onConfirm={async (rememberChoice) => {
          if (!deletingTransaction) {
            return;
          }
          await runDeleteTransaction(deletingTransaction, rememberChoice);
        }}
      />
    </div>
  );
}
