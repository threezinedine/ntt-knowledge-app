import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { Keys } from './Keys';

/** Hover this long before the first tooltip shows... */
const SHOW_DELAY_MS = 500;
/** ...but moving to a neighbour within this window shows its tooltip at once. */
const WARM_MS = 400;
const GAP = 6;
const MARGIN = 8;

interface Tip {
  label: string;
  keys: string | null;
  anchor: DOMRect;
}

function tooltipTarget(target: EventTarget | null): HTMLElement | null {
  return target instanceof Element ? target.closest<HTMLElement>('[data-tooltip]') : null;
}

/**
 * One tooltip for the whole app, VS Code style: hover (mouse) or keyboard
 * focus any element with `data-tooltip` (see `useCommandTooltip`) and it
 * shows the label plus the shortcut as keycaps. Delegated, so controls need
 * only the attributes. Touch never shows it: there is no hover to undo.
 */
export function TooltipLayer() {
  const [tip, setTip] = useState<Tip | null>(null);
  const [pos, setPos] = useState<{ left: number; top: number } | null>(null);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let anchor: HTMLElement | null = null; // hovered/focused, shown or pending
    let shown = false;
    let hiddenAt = Number.NEGATIVE_INFINITY;
    let timer: ReturnType<typeof setTimeout> | undefined;

    const show = (el: HTMLElement) => {
      const label = el.dataset.tooltip;
      if (!label || !el.isConnected) return;
      shown = true;
      setTip({ label, keys: el.dataset.tooltipKeys ?? null, anchor: el.getBoundingClientRect() });
    };
    /** Hides; with `forget`, the same element may show it again right away. */
    const hide = (forget = true) => {
      clearTimeout(timer);
      if (shown) hiddenAt = performance.now();
      shown = false;
      if (forget) anchor = null;
      setTip(null);
    };
    const enter = (el: HTMLElement, immediate: boolean) => {
      if (el === anchor) return;
      const warm = shown || performance.now() - hiddenAt < WARM_MS;
      hide();
      anchor = el;
      if (immediate || warm) show(el);
      else
        timer = setTimeout(() => {
          show(el);
        }, SHOW_DELAY_MS);
    };

    const onPointerOver = (e: PointerEvent) => {
      if (e.pointerType !== 'mouse') return;
      const el = tooltipTarget(e.target);
      if (el) enter(el, false);
      else if (anchor) hide();
    };
    const onPointerOut = (e: PointerEvent) => {
      if (e.relatedTarget === null && anchor) hide(); // left the window
    };
    const onFocusIn = (e: FocusEvent) => {
      const el = tooltipTarget(e.target);
      // Keyboard focus only: a click also focuses, and that is no request.
      if (el && e.target instanceof Element && e.target.matches(':focus-visible')) enter(el, true);
    };
    const onFocusOut = (e: FocusEvent) => {
      if (anchor && e.target instanceof Node && anchor.contains(e.target)) hide();
    };
    // Acting on the control dismisses its tooltip until the pointer leaves it.
    const dismiss = () => {
      hide(false);
    };
    const reset = () => {
      if (anchor) hide();
    };

    const opts = { capture: true, passive: true } as const;
    document.addEventListener('pointerover', onPointerOver, opts);
    document.addEventListener('pointerout', onPointerOut, opts);
    document.addEventListener('focusin', onFocusIn, opts);
    document.addEventListener('focusout', onFocusOut, opts);
    document.addEventListener('pointerdown', dismiss, opts);
    document.addEventListener('keydown', dismiss, opts);
    document.addEventListener('scroll', reset, opts);
    window.addEventListener('resize', reset, opts);
    window.addEventListener('blur', reset, opts);
    return () => {
      clearTimeout(timer);
      document.removeEventListener('pointerover', onPointerOver, opts);
      document.removeEventListener('pointerout', onPointerOut, opts);
      document.removeEventListener('focusin', onFocusIn, opts);
      document.removeEventListener('focusout', onFocusOut, opts);
      document.removeEventListener('pointerdown', dismiss, opts);
      document.removeEventListener('keydown', dismiss, opts);
      document.removeEventListener('scroll', reset, opts);
      window.removeEventListener('resize', reset, opts);
      window.removeEventListener('blur', reset, opts);
    };
  }, []);

  // Below the control, centred; above it if there is no room; kept on screen.
  useLayoutEffect(() => {
    const box = ref.current;
    if (!tip || !box) {
      setPos(null);
      return;
    }
    const { width, height } = box.getBoundingClientRect();
    const { anchor } = tip;
    const below = anchor.bottom + GAP;
    const top =
      below + height + MARGIN <= window.innerHeight
        ? below
        : Math.max(MARGIN, anchor.top - GAP - height);
    const centred = anchor.left + anchor.width / 2 - width / 2;
    const left = Math.min(Math.max(MARGIN, centred), window.innerWidth - width - MARGIN);
    setPos({ left: Math.max(MARGIN, left), top });
  }, [tip]);

  if (!tip) return null;
  return (
    <div
      ref={ref}
      role="tooltip"
      className="tooltip"
      // Measured first (invisible), then placed.
      style={pos ? { left: pos.left, top: pos.top } : { left: 0, top: 0, visibility: 'hidden' }}
    >
      <span>{tip.label}</span>
      {tip.keys && <Keys binding={tip.keys} />}
    </div>
  );
}
