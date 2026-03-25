"use client";

import React from "react";

interface SparklineProps {
  data: number[];
  color?: string;
  width?: number;
  height?: number;
}

export const Sparkline = React.memo(function Sparkline({
  data,
  color = "currentColor",
  width = 80,
  height = 24,
}: SparklineProps) {
  if (data.length < 2) return null;

  const max = Math.max(...data);
  const min = Math.min(...data);
  const range = max - min || 1;

  const padding = 2;
  const effectiveHeight = height - padding * 2;

  const points = data
    .map((value, index) => {
      const x = (index / (data.length - 1)) * width;
      const y = padding + effectiveHeight - ((value - min) / range) * effectiveHeight;
      return `${x},${y}`;
    })
    .join(" ");

  return (
    <svg
      width="100%"
      height={height}
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      className="block"
    >
      <polyline
        points={points}
        fill="none"
        stroke={color}
        strokeWidth="1.5"
        strokeLinejoin="round"
        strokeLinecap="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
});
