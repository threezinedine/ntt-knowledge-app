import type { TagExp } from '@km/core';
import { useMemo } from 'react';
import { useExp } from '../../api/queries';
import { tooltip } from '../../commands/useCommandTooltip';
import { useI18n } from '../../i18n/context';
import { DEFAULT_TAG_COLOR } from '../tags/colors';
import { useTagIndex } from '../tags/useTagIndex';

/** Share of the way from this level to the next, 0–1 (1 at the top level). */
export function levelProgress(e: TagExp): number {
  if (e.nextLevelExp === null) return 1;
  const span = e.nextLevelExp - e.levelStartExp;
  return span > 0 ? Math.min(1, Math.max(0, (e.exp - e.levelStartExp) / span)) : 1;
}

/**
 * Under the sidebar's node list: every field (tag) in tree order with its
 * level and a bar to the next one. Read-only; the level table is set in the
 * server's config file.
 */
export function FieldLevels() {
  const { t, errorText } = useI18n();
  const index = useTagIndex();
  const exp = useExp();
  const byTag = useMemo(() => new Map((exp.data?.tags ?? []).map((e) => [e.tagId, e])), [exp.data]);

  return (
    <section className="field-levels" aria-labelledby="field-levels-heading">
      <h2 id="field-levels-heading" className="field-levels-heading">
        {t('exp.heading')}
      </h2>
      {exp.isError && <p className="error">{errorText(exp.error)}</p>}
      {index.flat.length === 0 && !index.isPending && <p className="muted">{t('exp.empty')}</p>}
      <ul className="field-list">
        {index.flat.map((node) => {
          const e = byTag.get(node.tag.id);
          if (!e) return null; // tag newer than the last EXP fetch
          const top = e.nextLevelExp === null;
          const name = node.tag.name;
          const detail =
            e.nextLevelExp === null
              ? t('exp.detailMax', { exp: e.exp, nodes: e.nodeCount })
              : t('exp.detail', { exp: e.exp, next: e.nextLevelExp, nodes: e.nodeCount });
          return (
            <li
              key={node.tag.id}
              className="field-row"
              data-testid={`field-${name}`}
              style={{ paddingLeft: 8 + node.depth * 12 }}
              {...tooltip(detail)}
            >
              <span
                className="field-dot"
                style={{ background: node.tag.color ?? DEFAULT_TAG_COLOR }}
                aria-hidden="true"
              />
              <span className="field-name">{name}</span>
              <span className="field-level">
                {top ? t('exp.levelMax', { level: e.level }) : t('exp.level', { level: e.level })}
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
    </section>
  );
}
