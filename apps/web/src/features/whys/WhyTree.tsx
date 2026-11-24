import type { WhyItem } from '@km/core';
import { useI18n } from '../../i18n/context';
import { addChild, addSiblingAfter, emptyWhy, removeWhy, updateWhy } from './treeEdit';

/** Saved or pasted whys as a nested list; a deeper why sits under its parent. */
export function WhyTreeView({ items, label }: { items: readonly WhyItemLike[]; label: string }) {
  return (
    <ol className="why-tree" aria-label={label}>
      <ViewItems items={items} prefix="" />
    </ol>
  );
}

/** Pasted whys have no ids yet. */
type WhyItemLike = Omit<WhyItem, 'id' | 'children'> & {
  id?: string | undefined;
  children: WhyItemLike[];
};

function ViewItems({ items, prefix }: { items: readonly WhyItemLike[]; prefix: string }) {
  const { t } = useI18n();
  return items.map((w, i) => {
    const path = `${prefix}${String(i + 1)}`;
    return (
      <li key={w.id ?? path} className="why-item">
        <p className="why-question">
          <span className="why-path">{path}</span> {w.question}
        </p>
        <p className={w.answer ? 'why-answer' : 'why-answer muted'}>
          {w.answer || t('whys.unanswered')}
        </p>
        {w.takeaway && <p className="why-takeaway">→ {w.takeaway}</p>}
        {w.children.length > 0 && (
          <ol className="why-tree">
            <ViewItems items={w.children} prefix={`${path}.`} />
          </ol>
        )}
      </li>
    );
  });
}

interface EditorProps {
  items: readonly WhyItem[];
  onChange: (items: WhyItem[]) => void;
}

/** The same tree with every field editable, and whys to add or remove. */
export function WhyTreeEditor({ items, onChange }: EditorProps) {
  const { t } = useI18n();
  return (
    <div className="why-editor">
      <ol className="why-tree">
        <EditItems all={items} items={items} prefix="" onChange={onChange} />
      </ol>
      <button
        type="button"
        className="subtle"
        onClick={() => {
          onChange([...items, emptyWhy()]);
        }}
      >
        {t('whys.addRoot')}
      </button>
    </div>
  );
}

function EditItems({
  all,
  items,
  prefix,
  onChange,
}: {
  all: readonly WhyItem[];
  items: readonly WhyItem[];
  prefix: string;
  onChange: (items: WhyItem[]) => void;
}) {
  const { t } = useI18n();
  return items.map((w, i) => {
    const path = `${prefix}${String(i + 1)}`;
    const set = (patch: Partial<WhyItem>) => {
      onChange(updateWhy(all, w.id, patch));
    };
    return (
      <li key={w.id} className="why-item editing">
        <div className="why-fields" role="group" aria-label={t('whys.whyN', { path })}>
          <label className="why-field">
            <span>
              <span className="why-path">{path}</span> {t('whys.question')}
            </span>
            <input
              value={w.question}
              aria-invalid={w.question.trim() === '' || undefined}
              onChange={(e) => {
                set({ question: e.target.value });
              }}
            />
          </label>
          <label className="why-field">
            <span>{t('whys.answer')}</span>
            <textarea
              rows={2}
              value={w.answer}
              onChange={(e) => {
                set({ answer: e.target.value });
              }}
            />
          </label>
          <label className="why-field">
            <span>{t('whys.takeaway')}</span>
            <input
              value={w.takeaway}
              onChange={(e) => {
                set({ takeaway: e.target.value });
              }}
            />
          </label>
          <div className="why-item-actions">
            <button
              type="button"
              className="subtle"
              aria-label={t('whys.addChildN', { path })}
              onClick={() => {
                onChange(addChild(all, w.id, emptyWhy()));
              }}
            >
              {t('whys.addChild')}
            </button>
            <button
              type="button"
              className="subtle"
              aria-label={t('whys.addSiblingN', { path })}
              onClick={() => {
                onChange(addSiblingAfter(all, w.id, emptyWhy()));
              }}
            >
              {t('whys.addSibling')}
            </button>
            <button
              type="button"
              className="danger subtle"
              aria-label={t('whys.removeN', { path })}
              onClick={() => {
                onChange(removeWhy(all, w.id));
              }}
            >
              {t('whys.remove')}
            </button>
          </div>
        </div>
        {w.children.length > 0 && (
          <ol className="why-tree">
            <EditItems all={all} items={w.children} prefix={`${path}.`} onChange={onChange} />
          </ol>
        )}
      </li>
    );
  });
}
