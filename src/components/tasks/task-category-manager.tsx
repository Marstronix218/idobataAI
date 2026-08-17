"use client";

import { Check, Pencil, Plus, Trash2, X } from "lucide-react";
import { FormEvent, useEffect, useState } from "react";
import type { TaskCategory } from "@/types";

type TaskCategoryManagerProps = {
  categories: TaskCategory[];
  taskCount: (categoryName: string) => number;
  busyId: string | null;
  status: string;
  onAdd: (name: string) => Promise<boolean>;
  onRename: (category: TaskCategory, name: string) => Promise<boolean>;
  onDelete: (category: TaskCategory) => Promise<boolean>;
  onClose: () => void;
};

export function TaskCategoryManager({
  categories,
  taskCount,
  busyId,
  status,
  onAdd,
  onRename,
  onDelete,
  onClose,
}: TaskCategoryManagerProps) {
  const [newName, setNewName] = useState("");
  const [editingId, setEditingId] = useState<string | null>(null);
  const [renameDraft, setRenameDraft] = useState("");
  const [deleteId, setDeleteId] = useState<string | null>(null);

  useEffect(() => {
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape" && busyId === null) onClose();
    }
    document.addEventListener("keydown", closeOnEscape);
    return () => document.removeEventListener("keydown", closeOnEscape);
  }, [busyId, onClose]);

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (await onAdd(newName)) setNewName("");
  }

  async function rename(event: FormEvent<HTMLFormElement>, category: TaskCategory) {
    event.preventDefault();
    if (await onRename(category, renameDraft)) {
      setEditingId(null);
      setRenameDraft("");
    }
  }

  async function remove(category: TaskCategory) {
    if (await onDelete(category)) setDeleteId(null);
  }

  return (
    <div className="fixed inset-0 z-[60] grid place-items-end bg-overlay/70 backdrop-blur-sm sm:place-items-center sm:p-5">
      <section role="dialog" aria-modal="true" aria-labelledby="category-manager-title" className="flex max-h-[88dvh] w-full max-w-xl flex-col overflow-hidden rounded-t-[1.5rem] border border-line bg-canvas shadow-2xl sm:rounded-[1.5rem]">
        <div className="flex items-start justify-between gap-5 border-b border-line p-5 sm:p-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-[.1em] text-brand">Optional organization</p>
            <h2 id="category-manager-title" className="display mt-1 text-2xl font-bold">Edit categories</h2>
            <p className="mt-2 text-sm leading-6 text-muted">Create labels once, then reuse them from any task dropdown.</p>
          </div>
          <button type="button" className="icon-btn shrink-0" aria-label="Close category editor" onClick={onClose}><X size={18} /></button>
        </div>

        <div className="overflow-y-auto p-5 sm:p-6">
          <form onSubmit={add}>
            <label className="field-label" htmlFor="new-category">Add a category</label>
            <div className="mt-2 flex gap-2">
              <input id="new-category" className="field min-w-0 flex-1" value={newName} onChange={(event) => setNewName(event.target.value)} placeholder="For example, Work" maxLength={48} autoFocus />
              <button className="btn btn-primary shrink-0" disabled={!newName.trim() || busyId !== null}><Plus size={17} /> Add</button>
            </div>
          </form>
          <p className="mt-3 min-h-5 text-sm font-bold text-muted" role="status" aria-live="polite">{status}</p>

          <div className="mt-7">
            <div className="flex items-baseline justify-between gap-4">
              <h3 className="display text-lg font-bold">Your categories</h3>
              <span className="text-xs font-bold text-muted">{categories.length}</span>
            </div>

            {categories.length ? (
              <ul className="mt-3 divide-y divide-line overflow-hidden rounded-2xl border border-line bg-surface">
                {categories.map((category) => {
                  const count = taskCount(category.name);
                  const isEditing = editingId === category.id;
                  const isConfirmingDelete = deleteId === category.id;
                  return (
                    <li key={category.id} className="p-3 sm:p-4">
                      {isEditing ? (
                        <form className="flex flex-col gap-2 sm:flex-row" onSubmit={(event) => void rename(event, category)}>
                          <label htmlFor={`rename-category-${category.id}`} className="sr-only">New name for {category.name}</label>
                          <input id={`rename-category-${category.id}`} className="field min-w-0 flex-1" value={renameDraft} onChange={(event) => setRenameDraft(event.target.value)} maxLength={48} autoFocus />
                          <div className="flex gap-2">
                            <button className="btn btn-primary min-h-11 flex-1 px-3 sm:flex-none" disabled={!renameDraft.trim() || busyId !== null}><Check size={16} /> Save</button>
                            <button type="button" className="btn btn-secondary min-h-11 flex-1 px-3 sm:flex-none" onClick={() => setEditingId(null)} disabled={busyId !== null}>Cancel</button>
                          </div>
                        </form>
                      ) : isConfirmingDelete ? (
                        <div role="alert" className="rounded-xl bg-danger-soft p-3">
                          <p className="font-bold">Remove “{category.name}”?</p>
                          <p className="mt-1 text-sm leading-6 text-muted">It will be cleared from {count} current {count === 1 ? "task" : "tasks"}. Published posts will not change.</p>
                          <div className="mt-3 flex flex-wrap justify-end gap-2">
                            <button type="button" className="btn btn-secondary min-h-11" onClick={() => setDeleteId(null)} disabled={busyId !== null}>Keep category</button>
                            <button type="button" className="btn btn-danger min-h-11" onClick={() => void remove(category)} disabled={busyId !== null}><Trash2 size={16} /> Remove category</button>
                          </div>
                        </div>
                      ) : (
                        <div className="flex items-center gap-3">
                          <div className="min-w-0 flex-1">
                            <p className="truncate font-bold">{category.name}</p>
                            <p className="mt-1 text-xs font-semibold text-muted">{count} current {count === 1 ? "task" : "tasks"}</p>
                          </div>
                          <button type="button" className="icon-btn shrink-0" aria-label={`Rename ${category.name}`} onClick={() => { setEditingId(category.id); setRenameDraft(category.name); setDeleteId(null); }} disabled={busyId !== null}><Pencil size={16} /></button>
                          <button type="button" className="icon-btn shrink-0 text-danger" aria-label={`Delete ${category.name}`} onClick={() => { setDeleteId(category.id); setEditingId(null); }} disabled={busyId !== null}><Trash2 size={16} /></button>
                        </div>
                      )}
                    </li>
                  );
                })}
              </ul>
            ) : (
              <div className="mt-3 rounded-2xl border border-dashed border-line p-6 text-center">
                <p className="font-bold">No categories yet</p>
                <p className="mt-1 text-sm text-muted">That is completely fine. Tasks never require one.</p>
              </div>
            )}
          </div>
        </div>
      </section>
    </div>
  );
}
