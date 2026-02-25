"use client";

import { useState } from "react";

import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import type { TransactionType } from "@/types/finance";

export interface CreateTransactionPayload {
  type: TransactionType;
  amount: number;
  category: string;
  description?: string;
  entity?: string;
  transaction_date: string;
}

interface TransactionFormProps {
  onSubmit: (payload: CreateTransactionPayload) => Promise<void>;
}

export function TransactionForm({ onSubmit }: TransactionFormProps) {
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [type, setType] = useState<TransactionType>("income");
  const [amount, setAmount] = useState("0.00");
  const [category, setCategory] = useState("");
  const [description, setDescription] = useState("");
  const [entity, setEntity] = useState("");
  const [date, setDate] = useState(() => new Date().toISOString().slice(0, 16));

  const handleSubmit = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    setIsSubmitting(true);

    try {
      await onSubmit({
        type,
        amount: Number(amount),
        category,
        description: description || undefined,
        entity: entity || undefined,
        transaction_date: new Date(date).toISOString(),
      });

      setAmount("0.00");
      setCategory("");
      setDescription("");
      setEntity("");
      setDate(new Date().toISOString().slice(0, 16));
    } finally {
      setIsSubmitting(false);
    }
  };

  return (
    <Card>
      <CardHeader>
        <CardTitle>Create transaction</CardTitle>
      </CardHeader>
      <CardContent>
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={handleSubmit}>
          <div className="space-y-2">
            <Label htmlFor="type">Type</Label>
            <select
              id="type"
              className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
              value={type}
              onChange={(event) => setType(event.target.value as TransactionType)}
            >
              <option value="income">Income</option>
              <option value="expense">Expense</option>
            </select>
          </div>

          <div className="space-y-2">
            <Label htmlFor="amount">Amount</Label>
            <Input
              id="amount"
              type="number"
              min="0"
              step="0.01"
              value={amount}
              onChange={(event) => setAmount(event.target.value)}
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="category">Category</Label>
            <Input
              id="category"
              value={category}
              onChange={(event) => setCategory(event.target.value)}
              placeholder="operations"
              required
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="entity">Entity</Label>
            <Input
              id="entity"
              value={entity}
              onChange={(event) => setEntity(event.target.value)}
              placeholder="Client / Vendor"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="description">Description</Label>
            <Input
              id="description"
              value={description}
              onChange={(event) => setDescription(event.target.value)}
              placeholder="Optional detail"
            />
          </div>

          <div className="space-y-2 sm:col-span-2">
            <Label htmlFor="transaction_date">Date</Label>
            <Input
              id="transaction_date"
              type="datetime-local"
              value={date}
              onChange={(event) => setDate(event.target.value)}
              required
            />
          </div>

          <Button className="sm:col-span-2" type="submit" disabled={isSubmitting}>
            {isSubmitting ? "Saving..." : "Save transaction"}
          </Button>
        </form>
      </CardContent>
    </Card>
  );
}
