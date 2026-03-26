"use client";

import { useMemo } from "react";
import { Card, CardContent } from "@/components/ui/card";
import { useSystemInfo } from "@/hooks/use-system-info";
import { useMetricsContext } from "@/contexts/metrics-context";
import { useI18n } from "@/lib/i18n";

function computeHealthScore(
  cpuUsage: number | undefined,
  memoryUsedMb: number | undefined,
  memoryTotalMb: number | undefined,
  certExpiryDays: number | null | undefined,
  handshakeFailures: number | undefined,
  totalConnections: number | undefined,
  activeConnections: number | undefined,
  maxConnections: number | undefined,
): number {
  let score = 0;

  // CPU < 80% -> +25
  if (cpuUsage !== undefined && cpuUsage < 80) {
    score += 25;
  }

  // Memory < 80% -> +25
  if (
    memoryUsedMb !== undefined &&
    memoryTotalMb !== undefined &&
    memoryTotalMb > 0
  ) {
    const memPercent = (memoryUsedMb / memoryTotalMb) * 100;
    if (memPercent < 80) {
      score += 25;
    }
  }

  // cert_expiry > 30 days -> +20
  if (certExpiryDays !== undefined && certExpiryDays !== null) {
    if (certExpiryDays > 30) {
      score += 20;
    }
  } else {
    // No cert configured: neutral, give partial credit
    score += 10;
  }

  // error_rate < 1% -> +15
  if (
    handshakeFailures !== undefined &&
    totalConnections !== undefined &&
    totalConnections > 0
  ) {
    const errorRate = (handshakeFailures / totalConnections) * 100;
    if (errorRate < 1) {
      score += 15;
    }
  } else if (totalConnections === 0 || totalConnections === undefined) {
    // No connections yet: no errors, give credit
    score += 15;
  }

  // connections < max -> +15
  if (
    activeConnections !== undefined &&
    maxConnections !== undefined &&
    maxConnections > 0
  ) {
    if (activeConnections < maxConnections) {
      score += 15;
    }
  } else {
    // No limit set or unknown: give credit
    score += 15;
  }

  return score;
}

function getScoreColor(score: number): string {
  if (score > 80) return "#22c55e";
  if (score >= 50) return "#eab308";
  return "#ef4444";
}

interface HealthRingProps {
  score: number;
  size?: number;
  strokeWidth?: number;
}

function HealthRing({ score, size = 80, strokeWidth = 6 }: HealthRingProps) {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (score / 100) * circumference;
  const color = getScoreColor(score);

  return (
    <svg
      width={size}
      height={size}
      viewBox={`0 0 ${size} ${size}`}
      className="block"
      role="img"
      aria-label={`Health score: ${score}`}
    >
      {/* Background ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke="currentColor"
        strokeWidth={strokeWidth}
        className="text-muted-foreground/20"
      />
      {/* Score ring */}
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        strokeLinecap="round"
        transform={`rotate(-90 ${size / 2} ${size / 2})`}
        className="transition-all duration-500 ease-out"
      />
      {/* Score text */}
      <text
        x="50%"
        y="50%"
        textAnchor="middle"
        dominantBaseline="central"
        fill={color}
        fontSize={size * 0.28}
        fontWeight="bold"
      >
        {score}
      </text>
    </svg>
  );
}

export function HealthScore() {
  const { t } = useI18n();
  const { data: systemInfo } = useSystemInfo();
  const { current: metrics } = useMetricsContext();

  const score = useMemo(
    () =>
      computeHealthScore(
        systemInfo?.cpu_usage,
        systemInfo?.memory_used_mb,
        systemInfo?.memory_total_mb,
        systemInfo?.cert_expiry_days,
        metrics?.handshake_failures,
        metrics?.total_connections,
        metrics?.active_connections,
        undefined, // maxConnections not easily available here without config query
      ),
    [systemInfo, metrics],
  );

  return (
    <Card className="group transition-all hover:ring-2 hover:ring-primary/20">
      <CardContent className="flex items-center gap-3 pt-4">
        <HealthRing score={score} />
        <div className="space-y-1">
          <p className="text-xs font-medium text-muted-foreground leading-none">
            {t("health.title")}
          </p>
          <p
            className="text-sm font-semibold"
            style={{ color: getScoreColor(score) }}
          >
            {score > 80
              ? t("health.good")
              : score >= 50
                ? t("health.fair")
                : t("health.poor")}
          </p>
        </div>
      </CardContent>
    </Card>
  );
}
