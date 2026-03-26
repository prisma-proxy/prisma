"use client";

interface MapTooltipProps {
  content: string | null;
  position: { x: number; y: number } | null;
}

export function MapTooltip({ content, position }: MapTooltipProps) {
  if (!content || !position) return null;

  return (
    <div
      className="pointer-events-none absolute z-20 rounded-md border bg-popover px-3 py-1.5 text-xs font-medium text-popover-foreground shadow-md"
      style={{
        left: position.x + 12,
        top: position.y - 28,
      }}
    >
      {content}
    </div>
  );
}
