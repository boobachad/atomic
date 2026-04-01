import { memo, useMemo } from 'react';
import { AtomSummary } from '../../stores/atoms';

interface AtomNodeProps {
  atom: AtomSummary;
  x: number;
  y: number;
  isFaded: boolean;
  isHub?: boolean;
  isHighlighted?: boolean;
  connectionCount?: number;
  onClick: (atomId: string) => void;
  atomId: string;
  style?: React.CSSProperties;
}

// Generate a consistent color from a string (tag name)
interface TagColor {
  h: number;
  s: number;
  l: number;
  hsl: string;
}

function stringToColor(str: string): TagColor {
  let hash = 0;
  for (let i = 0; i < str.length; i++) {
    hash = str.charCodeAt(i) + ((hash << 5) - hash);
  }

  // Convert to HSL for better control over saturation and lightness
  const h = Math.abs(hash % 360);
  const s = 50 + (hash % 20); // 50-70% saturation
  const l = 45 + (hash % 10); // 45-55% lightness

  return { h, s, l, hsl: `hsl(${h}, ${s}%, ${l}%)` };
}

function colorWithAlpha(color: TagColor, alpha: number): string {
  return `hsla(${color.h}, ${color.s}%, ${color.l}%, ${alpha})`;
}

export const AtomNode = memo(function AtomNode({
  atom,
  x,
  y,
  isFaded,
  isHub = false,
  isHighlighted = false,
  // connectionCount available via props if needed
  onClick,
  atomId,
  style: externalStyle,
}: AtomNodeProps) {
  // Use title if available, fall back to snippet
  const displayContent = useMemo(() => {
    const text = atom.title || atom.snippet || 'Empty atom';
    return text;
  }, [atom.title, atom.snippet]);

  // Get color from primary tag
  const tagColor = useMemo(() => {
    if (atom.tags.length === 0) return null;
    return stringToColor(atom.tags[0].name);
  }, [atom.tags]);

  const nodeWidth = 110;

  return (
    <div
      className={`absolute cursor-pointer select-none transition-all duration-150 ${
        isFaded ? 'opacity-20 pointer-events-none' : 'opacity-100'
      }`}
      style={{
        left: x,
        top: y,
        transform: 'translate(-50%, -50%)',
        ...externalStyle,
        width: `${nodeWidth}px`,
      }}
      onClick={() => onClick(atomId)}
    >
      <div
        className={`
          bg-[var(--color-bg-card)] border rounded px-2 py-1.5
          hover:scale-[1.04] transition-all duration-150
          relative overflow-hidden
          ${isHighlighted
            ? 'border-[var(--color-success)] shadow-[0_0_20px_rgb(var(--color-success-rgb) / 0.5)] animate-pulse ring-2 ring-[var(--color-success)] ring-opacity-50'
            : isHub
            ? 'border-[var(--color-accent)] shadow-[0_0_8px_rgb(var(--color-accent-rgb) / 0.3)]'
            : 'border-[var(--color-border)] hover:border-[var(--color-border-hover)]'}
        `}
      >
        {/* Tag color indicator */}
        {tagColor && (
          <div
            className="absolute left-0 top-0 bottom-0 w-0.5 rounded-l"
            style={{ backgroundColor: tagColor.hsl }}
          />
        )}

        <p className={`text-[10px] text-[var(--color-text-primary)] truncate leading-tight ${isHub ? 'font-medium' : ''}`}>
          {displayContent}
        </p>

        {/* Compact tag badge */}
        {atom.tags.length > 0 && (
          <div className="flex items-center gap-1 mt-1">
            <span
              className="text-[9px] px-1 py-px rounded leading-tight"
              style={{
                backgroundColor: tagColor ? colorWithAlpha(tagColor, 0.35) : 'var(--color-bg-hover)',
                color: 'var(--color-text-primary)'
              }}
            >
              {atom.tags[0].name.length > 10
                ? atom.tags[0].name.substring(0, 8) + '..'
                : atom.tags[0].name}
            </span>
            {atom.tags.length > 1 && (
              <span className="text-[9px] text-[var(--color-text-tertiary)]">
                +{atom.tags.length - 1}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
