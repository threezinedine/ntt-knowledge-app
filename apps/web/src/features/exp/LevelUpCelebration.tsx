import { useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { useExp } from '../../api/queries';
import { CloseIcon } from '../../components/icons';
import { useI18n } from '../../i18n/context';
import { tagColor, useTagIndex } from '../tags/useTagIndex';
import { detectLevelUps, type LevelUp } from './levelUps';

const SHOW_MS = 5000;
const CONFETTI = 18;

/**
 * Mount once. When a field (tag) reaches a new level during this session, a
 * card pops up with confetti and the fields that levelled up (a child and its
 * parent often level together). It goes away by itself, or from its close
 * button; hovering or focusing it keeps it open. Levels already reached when
 * the app loads are not celebrated.
 */
export function LevelUpCelebration() {
  const { t } = useI18n();
  const exp = useExp();
  const index = useTagIndex();
  const best = useRef<Map<string, number>>(new Map());
  const [shown, setShown] = useState<{ ups: LevelUp[]; id: number } | null>(null);
  const [held, setHeld] = useState(false);

  useEffect(() => {
    if (!exp.data) return;
    const result = detectLevelUps(best.current, exp.data.tags);
    best.current = result.best;
    if (result.ups.length === 0) return;
    // Still on screen: add to it (newer level wins) and restart the timer.
    setShown((s) => ({
      ups: [
        ...(s?.ups ?? []).filter((u) => !result.ups.some((r) => r.tagId === u.tagId)),
        ...result.ups,
      ],
      id: (s?.id ?? 0) + 1,
    }));
    // A remount fires no mouseleave/blur, so a stale hold would pin it forever.
    setHeld(false);
  }, [exp.data]);

  /** Where focus was before it entered the card, to give it back on close. */
  const returnFocus = useRef<HTMLElement | null>(null);
  const cardRef = useRef<HTMLDivElement>(null);
  const close = () => {
    if (cardRef.current?.contains(document.activeElement)) returnFocus.current?.focus();
    returnFocus.current = null;
    setShown(null);
    setHeld(false);
  };

  useEffect(() => {
    if (!shown) return;
    const onKey = (e: globalThis.KeyboardEvent) => {
      if (e.key === 'Escape' && !e.defaultPrevented) close();
    };
    window.addEventListener('keydown', onKey);
    if (held) {
      return () => {
        window.removeEventListener('keydown', onKey);
      };
    }
    const timer = setTimeout(close, SHOW_MS);
    return () => {
      clearTimeout(timer);
      window.removeEventListener('keydown', onKey);
    };
  }, [shown, held]);

  // Tree order puts a parent before its child.
  const ups = useMemo(() => {
    if (!shown) return [];
    const order = new Map(index.flat.map((n, i) => [n.tag.id, i]));
    return shown.ups
      .filter((u) => index.byId.has(u.tagId))
      .sort((a, b) => (order.get(a.tagId) ?? 0) - (order.get(b.tagId) ?? 0));
  }, [shown, index]);

  return (
    <div className="level-up-region" role="status" aria-live="polite">
      {shown && ups.length > 0 && (
        <div
          key={shown.id}
          ref={cardRef}
          className="level-up"
          onMouseEnter={() => {
            setHeld(true);
          }}
          onMouseLeave={() => {
            setHeld(false);
          }}
          onFocus={(e) => {
            const from = e.relatedTarget;
            if (from instanceof HTMLElement && !e.currentTarget.contains(from)) {
              returnFocus.current = from;
            }
            setHeld(true);
          }}
          onBlur={() => {
            setHeld(false);
          }}
        >
          <div className="level-up-confetti" aria-hidden="true">
            {Array.from({ length: CONFETTI }, (_, i) => (
              <span key={i} style={{ '--i': i } as CSSProperties} />
            ))}
          </div>
          <span className="level-up-badge" aria-hidden="true">
            ★
          </span>
          <div className="level-up-text">
            <strong className="level-up-title">{t('levelUp.title')}</strong>
            <ul className="level-up-list">
              {ups.map((u) => {
                const node = index.byId.get(u.tagId);
                return (
                  <li key={u.tagId}>
                    <span
                      className="field-dot"
                      style={{ background: tagColor(index, u.tagId) }}
                      aria-hidden="true"
                    />
                    {t('levelUp.reached', { name: node?.tag.name ?? '', level: u.level })}
                  </li>
                );
              })}
            </ul>
          </div>
          <button
            type="button"
            className="level-up-close"
            aria-label={t('levelUp.dismiss')}
            onClick={close}
          >
            <CloseIcon size={14} />
          </button>
        </div>
      )}
    </div>
  );
}
