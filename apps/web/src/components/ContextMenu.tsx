import { useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { suspendKeybindings } from '../commands/dispatch';
import { Keys } from '../commands/Keys';

export interface MenuItem {
  id: string;
  label: string;
  /** A keybinding to show on the right (display only). */
  keys?: string;
  danger?: boolean;
  disabled?: boolean;
  /** Draws a separator above this item. */
  separatorBefore?: boolean;
  onSelect: () => void;
}

interface Props {
  /** Accessible name of the menu, e.g. the node title. */
  label: string;
  /** Viewport point to open at (the click, or the opener's corner). */
  x: number;
  y: number;
  items: readonly MenuItem[];
  onClose: () => void;
}

const MARGIN = 8;

/**
 * A right-click menu: keyboard (arrows, Home/End, Enter, Escape, typing the
 * first letter), closes on outside press, scroll, resize or blur, and gives
 * focus back to whatever had it. Kept inside the viewport.
 */
export function ContextMenu({ label, x, y, items, onClose }: Props) {
  const ref = useRef<HTMLUListElement>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const enabled = items.filter((i) => !i.disabled);

  useLayoutEffect(() => {
    const box = ref.current?.getBoundingClientRect();
    if (!box) return;
    setPos({
      left: Math.max(MARGIN, Math.min(x, window.innerWidth - box.width - MARGIN)),
      top: Math.max(MARGIN, Math.min(y, window.innerHeight - box.height - MARGIN)),
    });
  }, [x, y]);

  // Focus the first item once placed: while measuring it is visibility:hidden,
  // which can't take focus.
  const placed = pos !== null;
  useEffect(() => {
    if (!placed) return;
    ref.current
      ?.querySelector<HTMLElement>('[role="menuitem"]:not([aria-disabled="true"])')
      ?.focus();
  }, [placed]);

  useEffect(() => {
    const returnTo = document.activeElement;
    const resume = suspendKeybindings(); // the menu owns the keyboard while open
    const outside = (e: Event) => {
      if (!(e.target instanceof Node) || !ref.current?.contains(e.target)) onClose();
    };
    const opts = { capture: true } as const;
    document.addEventListener('pointerdown', outside, opts);
    document.addEventListener('scroll', onClose, opts);
    window.addEventListener('resize', onClose);
    window.addEventListener('blur', onClose);
    return () => {
      resume();
      document.removeEventListener('pointerdown', outside, opts);
      document.removeEventListener('scroll', onClose, opts);
      window.removeEventListener('resize', onClose);
      window.removeEventListener('blur', onClose);
      if (returnTo instanceof HTMLElement && returnTo.isConnected) returnTo.focus();
    };
  }, [onClose]);

  const focusAt = (index: number) => {
    const all = [
      ...(ref.current?.querySelectorAll<HTMLElement>(
        '[role="menuitem"]:not([aria-disabled="true"])',
      ) ?? []),
    ];
    all.at(((index % all.length) + all.length) % all.length)?.focus();
  };
  const current = () =>
    enabled.findIndex((i) => i.id === (document.activeElement as HTMLElement | null)?.dataset.id);

  const onKeyDown = (e: KeyboardEvent) => {
    const handled = () => {
      e.preventDefault();
      e.stopPropagation();
    };
    if (e.key === 'ArrowDown') {
      handled();
      focusAt(current() + 1);
    } else if (e.key === 'ArrowUp') {
      handled();
      focusAt(current() - 1);
    } else if (e.key === 'Home') {
      handled();
      focusAt(0);
    } else if (e.key === 'End') {
      handled();
      focusAt(-1);
    } else if (e.key === 'Escape' || e.key === 'Tab') {
      handled();
      onClose();
    } else if (e.key.length === 1 && /\S/.test(e.key)) {
      // Type-ahead: the next item starting with that letter.
      const from = current();
      const next = enabled.findIndex(
        (item, i) =>
          i > from && item.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()),
      );
      const wrap = enabled.findIndex((item) =>
        item.label.toLocaleLowerCase().startsWith(e.key.toLocaleLowerCase()),
      );
      if (next >= 0 || wrap >= 0) {
        handled();
        focusAt(next >= 0 ? next : wrap);
      }
    }
  };

  const select = (item: MenuItem) => {
    if (item.disabled) return;
    onClose();
    // After the menu is gone and focus is back on the opener, so what the
    // action opens (quick pick, dialog) returns focus there too.
    setTimeout(item.onSelect, 0);
  };

  return createPortal(
    <ul
      ref={ref}
      role="menu"
      aria-label={label}
      className="context-menu"
      style={pos ?? { left: x, top: y, visibility: 'hidden' }}
      onKeyDown={onKeyDown}
      onContextMenu={(e) => {
        e.preventDefault(); // no browser menu on top of ours
      }}
    >
      {items.map((item) => (
        <li
          key={item.id}
          role="menuitem"
          data-id={item.id}
          tabIndex={-1}
          aria-disabled={item.disabled || undefined}
          className={`context-menu-item${item.danger ? ' danger' : ''}${
            item.separatorBefore ? ' separated' : ''
          }`}
          onClick={() => {
            select(item);
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              select(item);
            }
          }}
        >
          <span>{item.label}</span>
          {item.keys && <Keys binding={item.keys} />}
        </li>
      ))}
    </ul>,
    document.body,
  );
}
