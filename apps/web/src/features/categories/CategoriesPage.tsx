import {
  buildCategoryTree,
  categoryNameSchema,
  flattenCategoryTree,
  type CategoryTreeNode,
} from '@km/core';
import { useMemo, useState, type SubmitEvent } from 'react';
import { errorMessage } from '../../api/client';
import { useCategories, useCreateCategory, useDeleteCategory } from '../../api/queries';

export function CategoriesPage() {
  const categories = useCategories();
  const tree = useMemo(() => buildCategoryTree(categories.data ?? []), [categories.data]);
  const deleteCategory = useDeleteCategory();

  return (
    <div className="categories-page">
      <h2>Task categories</h2>
      <p className="muted">Categories nest freely: Work → Backend → API …</p>
      <AddCategoryForm tree={tree} />
      {categories.isError && <p className="error">{errorMessage(categories.error)}</p>}
      {deleteCategory.isError && <p className="error">{errorMessage(deleteCategory.error)}</p>}
      <CategoryTree
        nodes={tree}
        onDelete={(id) => {
          deleteCategory.mutate(id);
        }}
      />
    </div>
  );
}

function CategoryTree({
  nodes,
  onDelete,
}: {
  nodes: CategoryTreeNode[];
  onDelete: (id: string) => void;
}) {
  if (nodes.length === 0) return null;
  return (
    <ul className="category-tree">
      {nodes.map((node) => (
        <li key={node.category.id}>
          <span className="category-name">{node.category.name}</span>
          <button
            type="button"
            className="icon danger subtle"
            aria-label={`Delete category ${node.category.name}`}
            onClick={() => {
              onDelete(node.category.id);
            }}
          >
            ×
          </button>
          <CategoryTree nodes={node.children} onDelete={onDelete} />
        </li>
      ))}
    </ul>
  );
}

function AddCategoryForm({ tree }: { tree: CategoryTreeNode[] }) {
  const [name, setName] = useState('');
  const [parentId, setParentId] = useState('');
  const createCategory = useCreateCategory();
  const valid = categoryNameSchema.safeParse(name).success;
  const flat = useMemo(() => flattenCategoryTree(tree), [tree]);

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    createCategory.mutate(
      { name, parentId: parentId || null },
      {
        onSuccess: () => {
          setName('');
        },
      },
    );
  };

  return (
    <form className="toolbar" onSubmit={submit} aria-label="Add category">
      <input
        aria-label="Category name"
        placeholder="Category name"
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <select
        aria-label="Parent category"
        value={parentId}
        onChange={(e) => {
          setParentId(e.target.value);
        }}
      >
        <option value="">(top level)</option>
        {flat.map((n) => (
          <option key={n.category.id} value={n.category.id}>
            {n.path.join(' / ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid || createCategory.isPending}>
        Add
      </button>
      {createCategory.isError && (
        <span className="error">{errorMessage(createCategory.error)}</span>
      )}
    </form>
  );
}
