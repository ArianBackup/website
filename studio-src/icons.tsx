/**
 * The icons the Studio chrome uses, drawn to match lucide-react's geometry
 * (24x24 viewBox, 2px round stroke) so the ported UI keeps the same silhouettes
 * without pulling the icon package into this bundle.
 */
import React from 'react';

type Props = { className?: string; size?: number; strokeWidth?: number };

const Svg: React.FC<Props & { children: React.ReactNode }> = ({
    className,
    size = 16,
    strokeWidth = 2,
    children,
}) => (
    <svg
        className={className}
        width={size}
        height={size}
        viewBox="0 0 24 24"
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeLinejoin="round"
        aria-hidden
    >
        {children}
    </svg>
);

export const SlidersHorizontal: React.FC<Props> = (p) => (
    <Svg {...p}>
        <line x1="21" x2="14" y1="4" y2="4" />
        <line x1="10" x2="3" y1="4" y2="4" />
        <line x1="21" x2="12" y1="12" y2="12" />
        <line x1="8" x2="3" y1="12" y2="12" />
        <line x1="21" x2="16" y1="20" y2="20" />
        <line x1="12" x2="3" y1="20" y2="20" />
        <line x1="14" x2="14" y1="2" y2="6" />
        <line x1="8" x2="8" y1="10" y2="14" />
        <line x1="16" x2="16" y1="18" y2="22" />
    </Svg>
);

export const Undo2: React.FC<Props> = (p) => (
    <Svg {...p}>
        <path d="M9 14 4 9l5-5" />
        <path d="M4 9h10.5a5.5 5.5 0 0 1 5.5 5.5a5.5 5.5 0 0 1-5.5 5.5H11" />
    </Svg>
);

export const Redo2: React.FC<Props> = (p) => (
    <Svg {...p}>
        <path d="m15 14 5-5-5-5" />
        <path d="M20 9H9.5A5.5 5.5 0 0 0 4 14.5A5.5 5.5 0 0 0 9.5 20H13" />
    </Svg>
);

export const RotateCcw: React.FC<Props> = (p) => (
    <Svg {...p}>
        <path d="M3 12a9 9 0 1 0 9-9 9.75 9.75 0 0 0-6.74 2.74L3 8" />
        <path d="M3 3v5h5" />
    </Svg>
);

export const ChevronDown: React.FC<Props> = (p) => (
    <Svg {...p}>
        <path d="m6 9 6 6 6-6" />
    </Svg>
);

export const Search: React.FC<Props> = (p) => (
    <Svg {...p}>
        <circle cx="11" cy="11" r="8" />
        <path d="m21 21-4.3-4.3" />
    </Svg>
);
