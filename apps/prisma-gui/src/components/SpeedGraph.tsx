import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { useTranslation } from "react-i18next";
import { useStore } from "@/store";
import { usePlatform } from "@/hooks/usePlatform";

/** Format a speed value (in Mbps) to adaptive units for canvas text. */
function formatSpeed(mbps: number): string {
  if (mbps < 1) return `${(mbps * 1000).toFixed(0)} Kbps`;
  if (mbps < 1000) return `${mbps.toFixed(1)} Mbps`;
  return `${(mbps / 1000).toFixed(2)} Gbps`;
}

/** Format speed in bytes-per-second style for the label overlay. */
function formatSpeedLabel(mbps: number): string {
  const bps = mbps * 1e6;
  if (bps >= 1e9) return `${(bps / 1e9).toFixed(1)} GB/s`;
  if (bps >= 1e6) return `${(bps / 1e6).toFixed(1)} MB/s`;
  if (bps >= 1e3) return `${(bps / 1e3).toFixed(0)} KB/s`;
  return `${bps.toFixed(0)} B/s`;
}

export default React.memo(function SpeedGraph() {
  const { t } = useTranslation();
  const connected = useStore((s) => s.connected);
  const speedSamplesUp = useStore((s) => s.speedSamplesUp);
  const speedSamplesDown = useStore((s) => s.speedSamplesDown);
  const { isMobile } = usePlatform();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<{ x: number; idx: number } | null>(null);

  const height = isMobile ? 120 : 180;

  // Current speed values (last sample, in Mbps)
  const currentDown = speedSamplesDown.length > 0 ? speedSamplesDown[speedSamplesDown.length - 1] : 0;
  const currentUp = speedSamplesUp.length > 0 ? speedSamplesUp[speedSamplesUp.length - 1] : 0;

  const maxVal = useMemo(() => {
    let m = 1;
    for (const v of speedSamplesDown) if (v > m) m = v;
    for (const v of speedSamplesUp) if (v > m) m = v;
    return Math.ceil(m * 1.15) || 1;
  }, [speedSamplesDown, speedSamplesUp]);

  const draw = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;

    const dpr = window.devicePixelRatio || 1;
    const w = container.clientWidth;
    const h = height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    canvas.style.width = `${w}px`;
    canvas.style.height = `${h}px`;

    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.scale(dpr, dpr);

    const pad = { top: 8, right: 8, bottom: 20, left: 40 };
    const plotW = w - pad.left - pad.right;
    const plotH = h - pad.top - pad.bottom;

    // Clear
    ctx.clearRect(0, 0, w, h);

    // Theme-aware colors
    const isDark = document.documentElement.classList.contains('dark');
    const colors = isDark ? {
      grid: "hsl(240 3.7% 15.9% / 0.4)",
      axis: "hsl(240 5% 64.9%)",
      tooltipBg: "hsl(240 10% 3.9% / 0.85)",
      tooltipLine: "hsl(240 5% 64.9% / 0.5)",
    } : {
      grid: "hsl(240 3.7% 84% / 0.5)",
      axis: "hsl(240 5% 40%)",
      tooltipBg: "hsl(0 0% 100% / 0.9)",
      tooltipLine: "hsl(240 5% 40% / 0.5)",
    };

    // Grid lines
    const gridLines = 4;
    ctx.strokeStyle = colors.grid;
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = colors.axis;
    ctx.font = "10px system-ui, sans-serif";
    ctx.textAlign = "right";
    ctx.textBaseline = "middle";
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (plotH / gridLines) * i;
      const val = maxVal * (1 - i / gridLines);
      ctx.fillText(`${val.toFixed(val >= 10 ? 0 : 1)}M`, pad.left - 4, y);
    }

    const n = speedSamplesDown.length;
    if (n < 2) return;

    function drawLine(samples: number[], color: string) {
      ctx!.strokeStyle = color;
      ctx!.lineWidth = 2;
      ctx!.lineJoin = "round";
      ctx!.lineCap = "round";
      ctx!.beginPath();
      for (let i = 0; i < n; i++) {
        const x = pad.left + (i / (n - 1)) * plotW;
        const y = pad.top + plotH - (samples[i] / maxVal) * plotH;
        if (i === 0) ctx!.moveTo(x, y);
        else ctx!.lineTo(x, y);
      }
      ctx!.stroke();
    }

    drawLine(speedSamplesDown, "#22c55e");
    drawLine(speedSamplesUp, "#3b82f6");

    // Legend
    const legendY = h - 6;
    ctx.font = "11px system-ui, sans-serif";
    ctx.textAlign = "left";

    ctx.fillStyle = "#22c55e";
    ctx.fillRect(pad.left, legendY - 5, 10, 2);
    ctx.fillText("↓ Download", pad.left + 14, legendY);

    ctx.fillStyle = "#3b82f6";
    const uploadX = pad.left + 100;
    ctx.fillRect(uploadX, legendY - 5, 10, 2);
    ctx.fillText("↑ Upload", uploadX + 14, legendY);

    // Tooltip
    const tip = tooltipRef.current;
    if (tip && tip.idx >= 0 && tip.idx < n) {
      const x = pad.left + (tip.idx / (n - 1)) * plotW;
      ctx.strokeStyle = colors.tooltipLine;
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const downMbps = speedSamplesDown[tip.idx] ?? 0;
      const upMbps = speedSamplesUp[tip.idx] ?? 0;
      const downText = `\u2193 ${formatSpeed(downMbps)}`;
      const upText = `\u2191 ${formatSpeed(upMbps)}`;

      ctx.font = "11px system-ui, sans-serif";
      const downW = ctx.measureText(downText).width;
      const upW = ctx.measureText(upText).width;
      const lineH = 16;
      const boxPadX = 8;
      const boxPadY = 4;
      const tw = Math.max(downW, upW) + boxPadX * 2;
      const th = lineH * 2 + boxPadY * 2;

      // Clamp horizontal position to stay within plot area (both edges)
      let tx = x - tw / 2;
      tx = Math.max(pad.left, Math.min(tx, w - pad.right - tw));

      const ty = pad.top + 4;

      // Background
      ctx.fillStyle = colors.tooltipBg;
      ctx.beginPath();
      ctx.roundRect(tx, ty, tw, th, 4);
      ctx.fill();

      // Download value in green
      ctx.textAlign = "left";
      ctx.fillStyle = "#22c55e";
      ctx.fillText(downText, tx + boxPadX, ty + boxPadY + lineH - 4);

      // Upload value in blue
      ctx.fillStyle = "#3b82f6";
      ctx.fillText(upText, tx + boxPadX, ty + boxPadY + lineH * 2 - 4);
    }
  }, [speedSamplesDown, speedSamplesUp, maxVal, height]);

  useEffect(() => {
    const id = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(id);
  }, [draw]);

  // Cache bounding rect to avoid synchronous layout recalculation on every mouse move
  const rectRef = useRef<DOMRect | null>(null);

  useEffect(() => {
    const container = containerRef.current;
    const canvas = canvasRef.current;
    if (!container) return;
    const ro = new ResizeObserver(() => {
      if (canvas) rectRef.current = canvas.getBoundingClientRect();
      draw();
    });
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  const mouseDrawRef = useRef<number | null>(null);
  function scheduleMouseDraw() {
    if (mouseDrawRef.current === null) {
      mouseDrawRef.current = requestAnimationFrame(() => {
        mouseDrawRef.current = null;
        draw();
      });
    }
  }

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const rect = rectRef.current;
    if (!rect) return;
    const x = e.clientX - rect.left;
    const pad = { left: 40, right: 8 };
    const plotW = rect.width - pad.left - pad.right;
    const n = speedSamplesDown.length;
    if (n < 2 || x < pad.left || x > rect.width - pad.right) {
      tooltipRef.current = null;
      scheduleMouseDraw();
      return;
    }
    const idx = Math.round(((x - pad.left) / plotW) * (n - 1));
    tooltipRef.current = { x, idx };
    scheduleMouseDraw();
  }

  function handleMouseLeave() {
    tooltipRef.current = null;
    scheduleMouseDraw();
  }

  if (!connected) {
    return (
      <div className="flex items-center justify-center text-xs text-muted-foreground" style={{ height: 60 }}>
        {t("status.disconnected")}
      </div>
    );
  }

  return (
    <div className="space-y-1">
      {/* Current speed labels */}
      <div className="flex items-center justify-between text-xs font-mono px-1">
        <span className="text-blue-400">{"\u2191"} {formatSpeedLabel(currentUp)}</span>
        <span className="text-green-400">{"\u2193"} {formatSpeedLabel(currentDown)}</span>
      </div>
      <div ref={containerRef} className="w-full" style={{ height }}>
        <canvas
          ref={canvasRef}
          onMouseMove={handleMouseMove}
          onMouseLeave={handleMouseLeave}
          className="w-full h-full"
          role="img"
          aria-label={t("home.speedGraph")}
        />
      </div>
    </div>
  );
});
