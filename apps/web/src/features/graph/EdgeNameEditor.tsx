import { relationNameSchema } from '@km/core';
import { useEffect, useRef, useState } from 'react';
import { useI18n } from '../../i18n/context';

interface Props {
  initial: string;
  /** Called with a valid, changed name; anything else cancels. */
  onCommit: (name: string) => void;
  onCancel: () => void;
  className?: string;
}

/**
 * Inline rename for a link (edge): Enter or leaving the field saves, Escape
 * cancels. Like VS Code's rename box, the old name starts selected.
 */
export function EdgeNameEditor({ initial, onCommit, onCancel, className }: Props) {
  const { t } = useI18n();
  const [name, setName] = useState(initial);
  const ref = useRef<HTMLInputElement>(null);
  const done = useRef(false);
  useEffect(() => {
    ref.current?.select();
  }, []);

  const finish = (save: boolean) => {
    if (done.current) return; // Enter, then the blur it causes
    done.current = true;
    const parsed = relationNameSchema.safeParse(name);
    if (save && parsed.success && parsed.data !== initial) onCommit(parsed.data);
    else onCancel();
  };

  return (
    <input
      ref={ref}
      autoFocus
      className={className}
      aria-label={t('relation.editLabel')}
      aria-invalid={!relationNameSchema.safeParse(name).success}
      value={name}
      onChange={(e) => {
        setName(e.target.value);
      }}
      onKeyDown={(e) => {
        // Keep keys away from the canvas (Delete would remove the edge) and app shortcuts.
        e.stopPropagation();
        if (e.key === 'Enter') {
          e.preventDefault();
          finish(true);
        } else if (e.key === 'Escape') {
          e.preventDefault();
          finish(false);
        }
      }}
      onBlur={() => {
        finish(true);
      }}
    />
  );
}
