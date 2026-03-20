"use client";

import type React from "react";
import { cn } from "@/lib/utils";

interface SkeletonProps extends React.HTMLAttributes<HTMLDivElement> {
  className?: string;
}

export function Skeleton({ className, ...props }: SkeletonProps) {
  return <div className={cn("skeleton", className)} {...props} />;
}

/** Card-shaped skeleton with header and content lines. */
export function SkeletonCard({ className }: SkeletonProps) {
  return (
    <div className={cn("rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-4", className)}>
      <Skeleton className="h-4 w-1/3" />
      <Skeleton className="h-8 w-2/3" />
    </div>
  );
}

/** Grid of metric card skeletons matching MetricsCards layout. */
export function SkeletonMetrics() {
  return (
    <div className="grid grid-cols-2 gap-4 sm:grid-cols-3 lg:grid-cols-6">
      {Array.from({ length: 6 }).map((_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

/** Table skeleton with rows. */
export function SkeletonTable({ rows = 5 }: { rows?: number }) {
  return (
    <div className="space-y-3">
      <Skeleton className="h-8 w-full" />
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-10 w-full" />
      ))}
    </div>
  );
}

/** Chart skeleton placeholder. */
export function SkeletonChart({ height = 300 }: { height?: number }) {
  return (
    <div className="rounded-xl ring-1 ring-foreground/10 bg-card p-4 space-y-4">
      <div className="flex items-center justify-between">
        <Skeleton className="h-4 w-32" />
        <div className="flex gap-1.5">
          {Array.from({ length: 4 }).map((_, i) => (
            <Skeleton key={i} className="h-6 w-10" />
          ))}
        </div>
      </div>
      <Skeleton className="w-full" style={{ height }} />
    </div>
  );
}
