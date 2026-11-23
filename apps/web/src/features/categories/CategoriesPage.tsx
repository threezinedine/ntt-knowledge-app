import {
  buildCategoryTree,
  categoryNameSchema,
  flattenCategoryTree,
  wouldCreateCategoryCycle,
  type Category,
  type CategoryTreeNode,
} from '@km/core';
import { useMemo, useState, type KeyboardEvent, type SubmitEvent } from 'react';
import { errorMessage } from '../../api/client';
import {
  useCategories,
  useCreateCategory,
  useDeleteCategory,
  useUpdateCategory,
} from '../../api/queries';

export const DEFAULT_CATEGORY_COLOR = '#8b929c';

export function CategoriesPage() {
  const categories = useCategories();
  const all = useMemo(() => categories.data ?? [], [categories.data]);
  const tree = useMemo(() => buildCategoryTree(all), [all]);

  return (
    <div className="categories-page">
      <h2>Task categories</h2>
      <p className="muted">
        Nest as deep as you like: Work → Backend → API. Use <kbd>+</kbd> on a row to add a
        sub-category, <kbd>✎</kbd> to rename, recolour or move it.
      </p>
      <NewCategoryForm parentId={null} label="New top-level category" />
      {categories.isError && <p className="error">{errorMessage(categories.error)}</p>}
      {categories.data?.length === 0 && <p className="muted">No categories yet.</p>}
      <CategoryList nodes={tree} all={all} />
    </div>
  );
}

function CategoryList({ nodes, all }: { nodes: CategoryTreeNode[]; all: Category[] }) {
  if (nodes.length === 0) return null;
  return (
    <ul className="category-tree">
      {nodes.map((node) => (
        <CategoryRow key={node.category.id} node={node} all={all} />
      ))}
    </ul>
  );
}

type Mode = 'view' | 'edit' | 'add-child' | 'confirm-delete';

function CategoryRow({ node, all }: { node: CategoryTreeNode; all: Category[] }) {
  const { category, children } = node;
  const [mode, setMode] = useState<Mode>('view');
  const [expanded, setExpanded] = useState(true);
  const deleteCategory = useDeleteCategory();
  const hasChildren = children.length > 0;
  const backToView = () => {
    setMode('view');
  };

  return (
    <li data-testid={`category-${category.name}`}>
      {mode === 'edit' ? (
        <EditCategoryForm category={category} all={all} onDone={backToView} />
      ) : (
        <div className="category-row">
          <button
            type="button"
            className="icon subtle toggle"
            aria-label={`${expanded ? 'Collapse' : 'Expand'} ${category.name}`}
            aria-expanded={hasChildren ? expanded : undefined}
            disabled={!hasChildren}
            onClick={() => {
              setExpanded((v) => !v);
            }}
          >
            {hasChildren ? (expanded ? '▾' : '▸') : '·'}
          </button>
          <span
            className="color-dot"
            style={{ background: category.color ?? DEFAULT_CATEGORY_COLOR }}
          />
          <span className="category-name">{category.name}</span>
          {hasChildren && <span className="muted count">{children.length}</span>}
          <span className="row-actions">
            <button
              type="button"
              className="icon subtle"
              aria-label={`Add sub-category to ${category.name}`}
              onClick={() => {
                setMode('add-child');
                setExpanded(true);
              }}
            >
              +
            </button>
            <button
              type="button"
              className="icon subtle"
              aria-label={`Edit category ${category.name}`}
              onClick={() => {
                setMode('edit');
              }}
            >
              ✎
            </button>
            <button
              type="button"
              className="icon danger subtle"
              aria-label={`Delete category ${category.name}`}
              onClick={() => {
                setMode('confirm-delete');
              }}
            >
              ×
            </button>
          </span>
        </div>
      )}

      {mode === 'confirm-delete' && (
        <div className="confirm-row inset">
          <span>Delete “{category.name}”? Its tasks become uncategorised.</span>
          <button
            type="button"
            className="danger"
            disabled={deleteCategory.isPending}
            onClick={() => {
              deleteCategory.mutate(category.id, { onSuccess: backToView });
            }}
          >
            Delete
          </button>
          <button
            type="button"
            className="subtle"
            onClick={() => {
              deleteCategory.reset();
              backToView();
            }}
          >
            Cancel
          </button>
          {deleteCategory.isError && <p className="error">{errorMessage(deleteCategory.error)}</p>}
        </div>
      )}

      {mode === 'add-child' && (
        <div className="inset">
          <NewCategoryForm
            parentId={category.id}
            label={`New sub-category of ${category.name}`}
            autoFocus
            onDone={backToView}
          />
        </div>
      )}

      {expanded && <CategoryList nodes={children} all={all} />}
    </li>
  );
}

function NewCategoryForm(props: {
  parentId: string | null;
  label: string;
  autoFocus?: boolean;
  /** When set, the form is transient: closes after a successful add or on Escape. */
  onDone?: () => void;
}) {
  const [name, setName] = useState('');
  const createCategory = useCreateCategory();
  const valid = categoryNameSchema.safeParse(name).success;

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    createCategory.mutate(
      { name, parentId: props.parentId },
      {
        onSuccess: () => {
          setName('');
          props.onDone?.();
        },
      },
    );
  };

  const onKeyDown = (e: KeyboardEvent) => {
    if (e.key === 'Escape') props.onDone?.();
  };

  return (
    <form className="toolbar" onSubmit={submit} aria-label={props.label}>
      <input
        aria-label={props.label}
        placeholder={props.label}
        autoFocus={props.autoFocus}
        value={name}
        onKeyDown={onKeyDown}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <button type="submit" disabled={!valid || createCategory.isPending}>
        Add
      </button>
      {props.onDone && (
        <button type="button" className="subtle" onClick={props.onDone}>
          Cancel
        </button>
      )}
      {createCategory.isError && (
        <span className="error">{errorMessage(createCategory.error)}</span>
      )}
    </form>
  );
}

function EditCategoryForm(props: { category: Category; all: Category[]; onDone: () => void }) {
  const { category, all } = props;
  const [name, setName] = useState(category.name);
  const [color, setColor] = useState(category.color);
  const [parentId, setParentId] = useState(category.parentId ?? '');
  const updateCategory = useUpdateCategory();
  const valid = categoryNameSchema.safeParse(name).success;

  // Only parents that can't create a cycle (not itself, not its descendants).
  const parentOptions = useMemo(
    () =>
      flattenCategoryTree(buildCategoryTree(all)).filter(
        (n) => !wouldCreateCategoryCycle(all, category.id, n.category.id),
      ),
    [all, category.id],
  );

  const submit = (e: SubmitEvent) => {
    e.preventDefault();
    if (!valid) return;
    updateCategory.mutate(
      { id: category.id, patch: { name, color, parentId: parentId || null } },
      { onSuccess: props.onDone },
    );
  };

  return (
    <form
      className="toolbar category-edit"
      onSubmit={submit}
      aria-label={`Edit ${category.name}`}
      onKeyDown={(e) => {
        if (e.key === 'Escape') props.onDone();
      }}
    >
      <input
        aria-label="Category name"
        autoFocus
        value={name}
        onChange={(e) => {
          setName(e.target.value);
        }}
      />
      <input
        type="color"
        aria-label="Category colour"
        value={color ?? DEFAULT_CATEGORY_COLOR}
        onChange={(e) => {
          setColor(e.target.value);
        }}
      />
      {color !== null && (
        <button
          type="button"
          className="subtle small"
          onClick={() => {
            setColor(null);
          }}
        >
          No colour
        </button>
      )}
      <select
        aria-label="Parent category"
        value={parentId}
        onChange={(e) => {
          setParentId(e.target.value);
        }}
      >
        <option value="">(top level)</option>
        {parentOptions.map((n) => (
          <option key={n.category.id} value={n.category.id}>
            {n.path.join(' / ')}
          </option>
        ))}
      </select>
      <button type="submit" disabled={!valid || updateCategory.isPending}>
        Save
      </button>
      <button type="button" className="subtle" onClick={props.onDone}>
        Cancel
      </button>
      {updateCategory.isError && (
        <span className="error">{errorMessage(updateCategory.error)}</span>
      )}
    </form>
  );
}
