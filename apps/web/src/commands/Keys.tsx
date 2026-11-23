import { formatPress, splitBinding, type Keybinding } from './keybinding';

/** A binding as keycaps: "Ctrl+K Ctrl+S" → [Ctrl+K] [Ctrl+S]. */
export function Keys({ binding }: { binding: Keybinding }) {
  return (
    <span className="keys">
      {splitBinding(binding).map((press, i) => (
        <kbd key={i}>{formatPress(press)}</kbd>
      ))}
    </span>
  );
}
