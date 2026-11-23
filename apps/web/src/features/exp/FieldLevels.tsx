import type { TagExp } from '@km/core';
import { useMemo, useRef, useState, type KeyboardEvent } from 'react';
import { useExp } from '../../api/queries';
import { readJson, writeJson } from '../../commands/storage';
import { tooltip } from '../../commands/useCommandTooltip';
import { ChevronRightIcon } from '../../components/icons';
import { useI18n } from '../../i18n/context';
import { DEFAULT_TAG_COLOR } from '../tags/colors';
import { useTagIndex } from '../tags/useTagIndex';
import { treeKeyAction, visibleFieldRows } from './fieldTree';

const COLLAPSED_KEY = 'km.fields.collapsed';
const SECTION_KEY = 'km.fields.sectionCollapsed';
const LIST_ID = 'field-levels-tree';

/** Share of the way from this level to the next, 0–1 (1 at the top level). */
export function levelProgress(e: TagExp): number {
  if (e.nextLevelExp === null) return 1;
  const span = e.nextLevelExp - e.levelStartExp;
  return span > 0 ? Math.min(1, Math.max(0, (e.exp - e.levelStartExp) / span)) : 1;
}

function readCollapsed(): Set<string> {
  const raw = readJson(COLLAPSED_KEY);
  return new Set(Array.isArray(raw) ? raw.filter((x): x is string => typeof x === 'string') : []);
}

/**
 * Under the sidebar's node list: every field (tag) as a collapsible tree, like
 * VS Code's explorer, with its level and a bar to the next one. The section
 * itself folds away from its header. Read-only; the level table is set in the
 * server's config file. Fold state is a per-device view preference.
 */
export function FieldLevels() {
  const { t, errorText } = useI18n();
  const index = useTagIndex();
  const exp = useExp();
  const byTag = useMemo(() => new Map((exp.data?.tags ?? []).map((e) => [e.tagId, e])), [exp.data]);

  const [sectionOpen, setSectionOpenState] = useState(() => readJson(SECTION_KEY) !== true);
  const setSectionOpen = (open: boolean) => {
    setSectionOpenState(open);
    writeJson(SECTION_KEY, !open);
  };
  const [collapsed, setCollapsed] = useState(readCollapsed);
  const toggle = (id: string) => {
    const next = new Set(collapsed);
    if (!next.delete(id)) next.add(id);
    setCollapsed(next);
    // Drop ids of tags that no longer exist so storage doesn't grow forever.
    writeJson(
      COLLAPSED_KEY,
      [...next].filter((x) => index.byId.has(x)),
    );
  };

  // A tag whose EXP isn't fetched yet (brand new) is left out, subtree and all,
  // until it is, so levels, positions and parents stay consistent.
  const rows = useMemo(
    () => visibleFieldRows(index.tree, collapsed, (n) => byTag.has(n.tag.id)),
    [index.tree, collapsed, byTag],
  );

  // Roving tabindex: one row in the tab order, arrows move within the tree.
  const [activeId, setActiveId] = useState<string | null>(null);
  const tabStop = rows.some((r) => r.node.tag.id === activeId)
    ? activeId
    : (rows[0]?.node.tag.id ?? null);
  const rowEls = useRef(new Map<string, HTMLLIElement>());

  const onKeyDown = (e: KeyboardEvent<HTMLLIElement>, id: string) => {
    if (e.altKey || e.ctrlKey || e.metaKey) return;
    const action = treeKeyAction(e.key, rows, id);
    if (action.kind === 'none') return;
    e.preventDefault();
    if (action.kind === 'toggle') toggle(action.id);
    else {
      setActiveId(action.id);
      rowEls.current.get(action.id)?.focus();
    }
  };

  return (
    <section
      className={`field-levels${sectionOpen ? '' : ' collapsed'}`}
      aria-labelledby="field-levels-heading"
    >
      <h2 className="field-levels-heading">
        <button
          type="button"
          id="field-levels-heading"
          className="pane-header"
          aria-expanded={sectionOpen}
          aria-controls={LIST_ID}
          onClick={() => {
            setSectionOpen(!sectionOpen);
          }}
        >
          <ChevronRightIcon className="chevron" />
          {t('exp.heading')}
        </button>
      </h2>
      {/* Kept mounted while folded: aria-controls stays valid, scroll is kept. */}
      <div className="field-levels-body" id={LIST_ID} hidden={!sectionOpen}>
        {exp.isError && <p className="error">{errorText(exp.error)}</p>}
        {index.flat.length === 0 && !index.isPending && <p className="muted">{t('exp.empty')}</p>}
        <ul className="field-list" role="tree" aria-labelledby="field-levels-heading">
          {rows.map((row) => {
            const { node } = row;
            const id = node.tag.id;
            const e = byTag.get(id);
            if (!e) return null;
            const top = e.nextLevelExp === null;
            const name = node.tag.name;
            const detail =
              e.nextLevelExp === null
                ? t('exp.detailMax', { exp: e.exp, nodes: e.nodeCount })
                : t('exp.detail', { exp: e.exp, next: e.nextLevelExp, nodes: e.nodeCount });
            return (
              <li
                key={id}
                ref={(el) => {
                  if (el) rowEls.current.set(id, el);
                  else rowEls.current.delete(id);
                }}
                role="treeitem"
                aria-level={node.depth + 1}
                aria-posinset={row.posInSet}
                aria-setsize={row.setSize}
                aria-expanded={row.hasChildren ? row.expanded : undefined}
                aria-label={name}
                aria-describedby={`${id}-desc`}
                tabIndex={id === tabStop ? 0 : -1}
                className="field-row"
                data-testid={`field-${name}`}
                style={{ paddingLeft: 4 + node.depth * 12 }}
                {...tooltip(detail)}
                onFocus={() => {
                  setActiveId(id);
                }}
                onClick={() => {
                  setActiveId(id);
                  if (row.hasChildren) toggle(id);
                }}
                onKeyDown={(ev) => {
                  onKeyDown(ev, id);
                }}
              >
                <span className="field-twistie" aria-hidden="true">
                  {row.hasChildren && (
                    <ChevronRightIcon className={`chevron${row.expanded ? ' open' : ''}`} />
                  )}
                </span>
                <span
                  className="field-dot"
                  style={{ background: node.tag.color ?? DEFAULT_TAG_COLOR }}
                  aria-hidden="true"
                />
                <span className="field-name">{name}</span>
                <span className="field-level">
                  {top ? t('exp.levelMax', { level: e.level }) : t('exp.level', { level: e.level })}
                </span>
                {/* Read after the name: the level and EXP are what this list is for. */}
                <span id={`${id}-desc`} className="visually-hidden">
                  {`${top ? t('exp.levelMax', { level: e.level }) : t('exp.level', { level: e.level })} · ${detail}`}
                </span>
                {/* Visible too: touch screens have no hover for the tooltip. */}
                <span className="field-exp">
                  {e.nextLevelExp === null
                    ? t('exp.short', { exp: e.exp })
                    : t('exp.shortNext', { exp: e.exp, next: e.nextLevelExp })}
                </span>
                <span
                  className="field-bar"
                  role="progressbar"
                  aria-label={t('exp.barLabel', { name, level: e.level })}
                  aria-valuemin={0}
                  aria-valuemax={100}
                  aria-valuenow={Math.round(levelProgress(e) * 100)}
                  aria-valuetext={detail}
                >
                  <span
                    className="field-bar-fill"
                    style={{ width: `${String(levelProgress(e) * 100)}%` }}
                  />
                </span>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
