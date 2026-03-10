"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Edit3, Trash2 } from "lucide-react";

import { ConfirmModal } from "@/components/common/confirm-modal";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
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
import type { ApiEnvelope, Category, Subcategory } from "@/types/finance";

interface CategoryFormState {
  name: string;
  icon: string;
  color: string;
  active: boolean;
}

interface SubcategoryFormState {
  name: string;
  icon: string;
  color: string;
  active: boolean;
}

const EMPTY_CATEGORY_FORM: CategoryFormState = {
  name: "",
  icon: "",
  color: "",
  active: true,
};

const EMPTY_SUBCATEGORY_FORM: SubcategoryFormState = {
  name: "",
  icon: "",
  color: "",
  active: true,
};

const PAGE_SIZE_OPTIONS = [10, 20, 50] as const;

function toCategoryPayload(form: CategoryFormState) {
  return {
    name: form.name.trim(),
    icon: form.icon.trim() || null,
    color: form.color.trim() || null,
    active: form.active,
  };
}

function toSubcategoryPayload(form: SubcategoryFormState) {
  return {
    name: form.name.trim(),
    icon: form.icon.trim() || null,
    color: form.color.trim() || null,
    active: form.active,
  };
}

export default function DashboardCategoriesPage() {
  const notify = useNotify();

  const [categories, setCategories] = useState<Category[]>([]);
  const [subcategories, setSubcategories] = useState<Subcategory[]>([]);
  const [isLoadingCategories, setIsLoadingCategories] = useState(true);
  const [isLoadingSubcategories, setIsLoadingSubcategories] = useState(false);
  const [showInactive, setShowInactive] = useState(false);

  const [selectedCategoryId, setSelectedCategoryId] = useState<string>("");

  const [categoryForm, setCategoryForm] = useState<CategoryFormState>(
    EMPTY_CATEGORY_FORM
  );
  const [subcategoryForm, setSubcategoryForm] = useState<SubcategoryFormState>(
    EMPTY_SUBCATEGORY_FORM
  );

  const [editingCategoryId, setEditingCategoryId] = useState<string | null>(null);
  const [editingSubcategoryId, setEditingSubcategoryId] = useState<string | null>(null);

  const [isSavingCategory, setIsSavingCategory] = useState(false);
  const [isSavingSubcategory, setIsSavingSubcategory] = useState(false);

  const [deletingCategory, setDeletingCategory] = useState<Category | null>(null);
  const [deletingSubcategory, setDeletingSubcategory] =
    useState<Subcategory | null>(null);

  const [isDeletingCategory, setIsDeletingCategory] = useState(false);
  const [isDeletingSubcategory, setIsDeletingSubcategory] = useState(false);
  const [categorySearchQuery, setCategorySearchQuery] = useState("");
  const [subcategorySearchQuery, setSubcategorySearchQuery] = useState("");
  const [categoryPage, setCategoryPage] = useState(1);
  const [subcategoryPage, setSubcategoryPage] = useState(1);
  const [categoryPageSize, setCategoryPageSize] = useState<number>(PAGE_SIZE_OPTIONS[0]);
  const [subcategoryPageSize, setSubcategoryPageSize] = useState<number>(
    PAGE_SIZE_OPTIONS[0]
  );

  const selectedCategory = useMemo(
    () => categories.find((item) => item.id === selectedCategoryId) || null,
    [categories, selectedCategoryId]
  );

  const loadCategories = useCallback(async () => {
    setIsLoadingCategories(true);

    try {
      const search = new URLSearchParams();
      search.set("active", showInactive ? "all" : "true");

      const response = await clientApiFetch<ApiEnvelope<Category[]>>(
        `/api/finance/categories?${search.toString()}`
      );
      setCategories(response.data);

      if (!selectedCategoryId && response.data.length > 0) {
        setSelectedCategoryId(response.data[0].id);
      }

      if (
        selectedCategoryId &&
        !response.data.some((category) => category.id === selectedCategoryId)
      ) {
        setSelectedCategoryId(response.data[0]?.id || "");
      }
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not fetch categories";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoadingCategories(false);
    }
  }, [notify, selectedCategoryId, showInactive]);

  const loadSubcategories = useCallback(async () => {
    if (!selectedCategoryId) {
      setSubcategories([]);
      return;
    }

    setIsLoadingSubcategories(true);
    try {
      const search = new URLSearchParams();
      search.set("active", showInactive ? "all" : "true");

      const response = await clientApiFetch<ApiEnvelope<Subcategory[]>>(
        `/api/finance/categories/${selectedCategoryId}/subcategories?${search.toString()}`
      );
      setSubcategories(response.data);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not fetch subcategories";
      notify.error({ title: "Load failed", description: message });
    } finally {
      setIsLoadingSubcategories(false);
    }
  }, [notify, selectedCategoryId, showInactive]);

  useEffect(() => {
    loadCategories();
  }, [loadCategories]);

  useEffect(() => {
    loadSubcategories();
  }, [loadSubcategories]);

  const submitCategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    const payload = toCategoryPayload(categoryForm);
    if (!payload.name) {
      notify.error({ title: "Validation", description: "Category name is required" });
      return;
    }

    setIsSavingCategory(true);

    try {
      if (editingCategoryId) {
        await clientApiFetch<ApiEnvelope<Category>>(
          `/api/finance/categories/${editingCategoryId}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Category updated",
          description: "Category changes were saved.",
        });
      } else {
        const created = await clientApiFetch<ApiEnvelope<Category>>(
          "/api/finance/categories",
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        setSelectedCategoryId(created.data.id);
        notify.success({
          title: "Category created",
          description: "Category added successfully.",
        });
      }

      setEditingCategoryId(null);
      setCategoryForm(EMPTY_CATEGORY_FORM);
      await loadCategories();
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not save category";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSavingCategory(false);
    }
  };

  const submitSubcategory = async (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();

    if (!selectedCategoryId) {
      notify.error({
        title: "Validation",
        description: "Select a category first",
      });
      return;
    }

    const payload = toSubcategoryPayload(subcategoryForm);
    if (!payload.name) {
      notify.error({ title: "Validation", description: "Subcategory name is required" });
      return;
    }

    setIsSavingSubcategory(true);

    try {
      if (editingSubcategoryId) {
        await clientApiFetch<ApiEnvelope<Subcategory>>(
          `/api/finance/subcategories/${editingSubcategoryId}`,
          {
            method: "PUT",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Subcategory updated",
          description: "Subcategory changes were saved.",
        });
      } else {
        await clientApiFetch<ApiEnvelope<Subcategory>>(
          `/api/finance/categories/${selectedCategoryId}/subcategories`,
          {
            method: "POST",
            headers: { "content-type": "application/json" },
            body: JSON.stringify(payload),
          }
        );

        notify.success({
          title: "Subcategory created",
          description: "Subcategory added successfully.",
        });
      }

      setEditingSubcategoryId(null);
      setSubcategoryForm(EMPTY_SUBCATEGORY_FORM);
      await loadSubcategories();
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not save subcategory";
      notify.error({ title: "Save failed", description: message });
    } finally {
      setIsSavingSubcategory(false);
    }
  };

  const editCategory = (category: Category) => {
    setEditingCategoryId(category.id);
    setCategoryForm({
      name: category.name,
      icon: category.icon || "",
      color: category.color || "",
      active: category.active,
    });
  };

  const editSubcategory = (subcategory: Subcategory) => {
    setEditingSubcategoryId(subcategory.id);
    setSubcategoryForm({
      name: subcategory.name,
      icon: subcategory.icon || "",
      color: subcategory.color || "",
      active: subcategory.active,
    });
  };

  const softDeleteCategory = async (category: Category) => {
    setIsDeletingCategory(true);
    try {
      await clientApiFetch<ApiEnvelope<Category>>(`/api/finance/categories/${category.id}`, {
        method: "DELETE",
      });

      notify.success({
        title: "Category deactivated",
        description: "Category was soft deleted (active=false).",
      });

      if (editingCategoryId === category.id) {
        setEditingCategoryId(null);
        setCategoryForm(EMPTY_CATEGORY_FORM);
      }

      await loadCategories();
      await loadSubcategories();
      setDeletingCategory(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError ? error.message : "Could not delete category";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeletingCategory(false);
    }
  };

  const softDeleteSubcategory = async (subcategory: Subcategory) => {
    setIsDeletingSubcategory(true);
    try {
      await clientApiFetch<ApiEnvelope<Subcategory>>(
        `/api/finance/subcategories/${subcategory.id}`,
        {
          method: "DELETE",
        }
      );

      notify.success({
        title: "Subcategory deactivated",
        description: "Subcategory was soft deleted (active=false).",
      });

      if (editingSubcategoryId === subcategory.id) {
        setEditingSubcategoryId(null);
        setSubcategoryForm(EMPTY_SUBCATEGORY_FORM);
      }

      await loadSubcategories();
      setDeletingSubcategory(null);
    } catch (error) {
      const message =
        error instanceof ApiClientError
          ? error.message
          : "Could not delete subcategory";
      notify.error({ title: "Delete failed", description: message });
    } finally {
      setIsDeletingSubcategory(false);
    }
  };

  const activeCategoryCount = useMemo(
    () => categories.filter((category) => category.active).length,
    [categories]
  );

  const activeSubcategoryCount = useMemo(
    () => subcategories.filter((subcategory) => subcategory.active).length,
    [subcategories]
  );

  const filteredCategories = useMemo(() => {
    const query = categorySearchQuery.trim().toLowerCase();
    if (!query) {
      return categories;
    }

    return categories.filter((category) => {
      const searchable = [
        category.name,
        category.icon || "",
        category.color || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [categories, categorySearchQuery]);

  const categoryTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredCategories.length / categoryPageSize)),
    [categoryPageSize, filteredCategories.length]
  );

  useEffect(() => {
    setCategoryPage((current) => Math.min(current, categoryTotalPages));
  }, [categoryTotalPages]);

  const paginatedCategories = useMemo(() => {
    const start = (categoryPage - 1) * categoryPageSize;
    return filteredCategories.slice(start, start + categoryPageSize);
  }, [categoryPage, categoryPageSize, filteredCategories]);

  const filteredSubcategories = useMemo(() => {
    const query = subcategorySearchQuery.trim().toLowerCase();
    if (!query) {
      return subcategories;
    }

    return subcategories.filter((subcategory) => {
      const searchable = [
        subcategory.name,
        subcategory.icon || "",
        subcategory.color || "",
      ]
        .join(" ")
        .toLowerCase();
      return searchable.includes(query);
    });
  }, [subcategories, subcategorySearchQuery]);

  const subcategoryTotalPages = useMemo(
    () => Math.max(1, Math.ceil(filteredSubcategories.length / subcategoryPageSize)),
    [filteredSubcategories.length, subcategoryPageSize]
  );

  useEffect(() => {
    setSubcategoryPage((current) => Math.min(current, subcategoryTotalPages));
  }, [subcategoryTotalPages]);

  const paginatedSubcategories = useMemo(() => {
    const start = (subcategoryPage - 1) * subcategoryPageSize;
    return filteredSubcategories.slice(start, start + subcategoryPageSize);
  }, [filteredSubcategories, subcategoryPage, subcategoryPageSize]);

  return (
    <div className="space-y-6">
      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-3">
          <CardTitle>Categories</CardTitle>
          <label className="flex items-center gap-2 text-sm text-muted-foreground">
            <input
              type="checkbox"
              checked={showInactive}
              onChange={(event) => setShowInactive(event.target.checked)}
            />
            Show inactive
          </label>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Badge variant="secondary">
              {activeCategoryCount}/{categories.length} active
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={categorySearchQuery}
                onChange={(event) => {
                  setCategorySearchQuery(event.target.value);
                  setCategoryPage(1);
                }}
                placeholder="Search categories..."
                className="min-w-[220px] max-w-sm"
              />
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={String(categoryPageSize)}
                onChange={(event) => {
                  setCategoryPageSize(Number(event.target.value));
                  setCategoryPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredCategories.length} results
              </span>
            </div>

            {isLoadingCategories ? (
              <p className="text-sm text-muted-foreground">Loading categories...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedCategories.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        No categories found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedCategories.map((category) => (
                      <TableRow key={category.id}>
                        <TableCell>
                          <button
                            type="button"
                            className="text-left font-medium underline-offset-4 hover:underline"
                            onClick={() => setSelectedCategoryId(category.id)}
                          >
                            {category.name}
                          </button>
                        </TableCell>
                        <TableCell>
                          <Badge variant={category.active ? "success" : "secondary"}>
                            {category.active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editCategory(category)}
                            >
                              <Edit3 className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setDeletingCategory(category)}
                              disabled={!category.active}
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
            {!isLoadingCategories ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Page {categoryPage} of {categoryTotalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCategoryPage((current) => Math.max(1, current - 1))
                    }
                    disabled={categoryPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setCategoryPage((current) =>
                        Math.min(categoryTotalPages, current + 1)
                      )
                    }
                    disabled={categoryPage >= categoryTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-border/80 p-4">
            <h3 className="font-heading text-base font-semibold">
              {editingCategoryId ? "Edit category" : "Create category"}
            </h3>

            <form className="grid gap-4" onSubmit={submitCategory}>
              <div className="space-y-2">
                <Label htmlFor="category_name">Name</Label>
                <Input
                  id="category_name"
                  value={categoryForm.name}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, name: event.target.value }))
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_icon">Icon</Label>
                <Input
                  id="category_icon"
                  value={categoryForm.icon}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, icon: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_color">Color</Label>
                <Input
                  id="category_color"
                  value={categoryForm.color}
                  onChange={(event) =>
                    setCategoryForm((current) => ({ ...current, color: event.target.value }))
                  }
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="category_active">Status</Label>
                <select
                  id="category_active"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={categoryForm.active ? "active" : "inactive"}
                  onChange={(event) =>
                    setCategoryForm((current) => ({
                      ...current,
                      active: event.target.value === "active",
                    }))
                  }
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isSavingCategory}>
                  {isSavingCategory ? "Saving..." : "Save category"}
                </Button>
                {editingCategoryId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingCategoryId(null);
                      setCategoryForm(EMPTY_CATEGORY_FORM);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>
            Subcategories {selectedCategory ? `for ${selectedCategory.name}` : ""}
          </CardTitle>
        </CardHeader>
        <CardContent className="grid gap-6 lg:grid-cols-2">
          <div className="space-y-4">
            <Badge variant="secondary">
              {activeSubcategoryCount}/{subcategories.length} active
            </Badge>
            <div className="flex flex-wrap items-center gap-2">
              <Input
                value={subcategorySearchQuery}
                onChange={(event) => {
                  setSubcategorySearchQuery(event.target.value);
                  setSubcategoryPage(1);
                }}
                placeholder="Search subcategories..."
                className="min-w-[220px] max-w-sm"
              />
              <select
                className="h-10 rounded-xl border border-border bg-card px-3 text-sm"
                value={String(subcategoryPageSize)}
                onChange={(event) => {
                  setSubcategoryPageSize(Number(event.target.value));
                  setSubcategoryPage(1);
                }}
              >
                {PAGE_SIZE_OPTIONS.map((size) => (
                  <option key={size} value={size}>
                    {size} / page
                  </option>
                ))}
              </select>
              <span className="text-xs text-muted-foreground">
                {filteredSubcategories.length} results
              </span>
            </div>

            {isLoadingSubcategories ? (
              <p className="text-sm text-muted-foreground">Loading subcategories...</p>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Actions</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {paginatedSubcategories.length === 0 ? (
                    <TableRow>
                      <TableCell colSpan={3} className="text-center text-muted-foreground">
                        No subcategories found.
                      </TableCell>
                    </TableRow>
                  ) : (
                    paginatedSubcategories.map((subcategory) => (
                      <TableRow key={subcategory.id}>
                        <TableCell className="font-medium">{subcategory.name}</TableCell>
                        <TableCell>
                          <Badge variant={subcategory.active ? "success" : "secondary"}>
                            {subcategory.active ? "active" : "inactive"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right">
                          <div className="flex justify-end gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => editSubcategory(subcategory)}
                            >
                              <Edit3 className="mr-1 h-3.5 w-3.5" />
                              Edit
                            </Button>
                            <Button
                              size="sm"
                              variant="danger"
                              onClick={() => setDeletingSubcategory(subcategory)}
                              disabled={!subcategory.active}
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
            {!isLoadingSubcategories ? (
              <div className="mt-2 flex flex-wrap items-center justify-between gap-2 text-sm">
                <span className="text-muted-foreground">
                  Page {subcategoryPage} of {subcategoryTotalPages}
                </span>
                <div className="flex items-center gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSubcategoryPage((current) => Math.max(1, current - 1))
                    }
                    disabled={subcategoryPage <= 1}
                  >
                    Previous
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    onClick={() =>
                      setSubcategoryPage((current) =>
                        Math.min(subcategoryTotalPages, current + 1)
                      )
                    }
                    disabled={subcategoryPage >= subcategoryTotalPages}
                  >
                    Next
                  </Button>
                </div>
              </div>
            ) : null}
          </div>

          <div className="space-y-4 rounded-2xl border border-border/80 p-4">
            <h3 className="font-heading text-base font-semibold">
              {editingSubcategoryId ? "Edit subcategory" : "Create subcategory"}
            </h3>

            <form className="grid gap-4" onSubmit={submitSubcategory}>
              <div className="space-y-2">
                <Label htmlFor="subcategory_category">Category</Label>
                <select
                  id="subcategory_category"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={selectedCategoryId}
                  onChange={(event) => setSelectedCategoryId(event.target.value)}
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
                <Label htmlFor="subcategory_name">Name</Label>
                <Input
                  id="subcategory_name"
                  value={subcategoryForm.name}
                  onChange={(event) =>
                    setSubcategoryForm((current) => ({
                      ...current,
                      name: event.target.value,
                    }))
                  }
                  required
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subcategory_icon">Icon</Label>
                <Input
                  id="subcategory_icon"
                  value={subcategoryForm.icon}
                  onChange={(event) =>
                    setSubcategoryForm((current) => ({
                      ...current,
                      icon: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subcategory_color">Color</Label>
                <Input
                  id="subcategory_color"
                  value={subcategoryForm.color}
                  onChange={(event) =>
                    setSubcategoryForm((current) => ({
                      ...current,
                      color: event.target.value,
                    }))
                  }
                  placeholder="Optional"
                />
              </div>

              <div className="space-y-2">
                <Label htmlFor="subcategory_active">Status</Label>
                <select
                  id="subcategory_active"
                  className="h-10 w-full rounded-xl border border-border bg-card px-3 text-sm"
                  value={subcategoryForm.active ? "active" : "inactive"}
                  onChange={(event) =>
                    setSubcategoryForm((current) => ({
                      ...current,
                      active: event.target.value === "active",
                    }))
                  }
                >
                  <option value="active">active</option>
                  <option value="inactive">inactive</option>
                </select>
              </div>

              <div className="flex flex-wrap items-center gap-2">
                <Button type="submit" disabled={isSavingSubcategory || !selectedCategoryId}>
                  {isSavingSubcategory ? "Saving..." : "Save subcategory"}
                </Button>
                {editingSubcategoryId ? (
                  <Button
                    type="button"
                    variant="outline"
                    onClick={() => {
                      setEditingSubcategoryId(null);
                      setSubcategoryForm(EMPTY_SUBCATEGORY_FORM);
                    }}
                  >
                    Cancel
                  </Button>
                ) : null}
              </div>
            </form>
          </div>
        </CardContent>
      </Card>

      <ConfirmModal
        open={Boolean(deletingCategory)}
        title="Deactivate category?"
        description="This sets category active=false."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        isLoading={isDeletingCategory}
        onCancel={() => {
          if (!isDeletingCategory) {
            setDeletingCategory(null);
          }
        }}
        onConfirm={async () => {
          if (!deletingCategory) {
            return;
          }
          await softDeleteCategory(deletingCategory);
        }}
      />

      <ConfirmModal
        open={Boolean(deletingSubcategory)}
        title="Deactivate subcategory?"
        description="This sets subcategory active=false."
        confirmLabel="Deactivate"
        cancelLabel="Cancel"
        isLoading={isDeletingSubcategory}
        onCancel={() => {
          if (!isDeletingSubcategory) {
            setDeletingSubcategory(null);
          }
        }}
        onConfirm={async () => {
          if (!deletingSubcategory) {
            return;
          }
          await softDeleteSubcategory(deletingSubcategory);
        }}
      />
    </div>
  );
}
