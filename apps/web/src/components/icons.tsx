/**
 * Small line icons in the style of VS Code's codicons (16×16 grid, drawn with
 * `currentColor`). Decorative: the control carrying one supplies the label.
 */
import type { SVGProps } from 'react';

function Icon({ children, size = 16, ...rest }: SVGProps<SVGSVGElement> & { size?: number }) {
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 16 16"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.2}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
      {...rest}
    >
      {children}
    </svg>
  );
}

type P = SVGProps<SVGSVGElement> & { size?: number };

export const ChevronRightIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 4l4 4-4 4" />
  </Icon>
);

export const GraphIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="4" cy="4" r="2" />
    <circle cx="12" cy="5" r="2" />
    <circle cx="7" cy="12.5" r="2" />
    <path d="M5.9 4.3l4.2.5M4.8 5.8l1.5 4.9M11 6.8l-3 4" />
  </Icon>
);

export const TagIcon = (p: P) => (
  <Icon {...p}>
    <path d="M2 2.5v5l6.5 6.5 5.5-5.5L7.5 2H2.5a.5.5 0 0 0-.5.5z" />
    <circle cx="5" cy="5" r="1" />
  </Icon>
);

/** Two stacked cards: spaced repetition. */
export const ReviewIcon = (p: P) => (
  <Icon {...p}>
    <rect x="4" y="2.5" width="9.5" height="8" rx="1" />
    <path d="M2.5 5v7.5a1 1 0 0 0 1 1h8" />
  </Icon>
);

export const KeyboardIcon = (p: P) => (
  <Icon {...p}>
    <rect x="1.5" y="4" width="13" height="8" rx="1" />
    <path d="M4 6.5h.01M6.5 6.5h.01M9 6.5h.01M11.5 6.5h.01M4.5 9.5h7" />
  </Icon>
);

export const SearchIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="7" cy="7" r="4.5" />
    <path d="M10.5 10.5L14 14" />
  </Icon>
);

export const SidebarIcon = (p: P) => (
  <Icon {...p}>
    <rect x="1.5" y="2.5" width="13" height="11" rx="1" />
    <path d="M6 2.5v11" />
  </Icon>
);

export const SignOutIcon = (p: P) => (
  <Icon {...p}>
    <path d="M6 2.5H3.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1H6M10.5 11l3-3-3-3M13.5 8H6" />
  </Icon>
);

export const CloseIcon = (p: P) => (
  <Icon {...p}>
    <path d="M4 4l8 8M12 4l-8 8" />
  </Icon>
);

/** A gear: settings. */
export const SettingsIcon = (p: P) => (
  <Icon {...p}>
    <circle cx="8" cy="8" r="2.2" />
    <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" />
  </Icon>
);

/** Two arrows chasing each other round: sync. */
export const SyncIcon = (p: P) => (
  <Icon {...p}>
    <path d="M13 6.5A5 5 0 0 0 3.6 5M3 9.5A5 5 0 0 0 12.4 11" />
    <path d="M3.5 2.5V5H6M12.5 13.5V11H10" />
  </Icon>
);
