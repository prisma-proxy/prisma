import React, { useRef, useEffect, useCallback, useMemo } from "react";
import { useStore } from "@/store";
import { usePlatform } from "@/hooks/usePlatform";

export default React.memo(function SpeedGraph() {
  const speedSamplesUp = useStore((s) => s.speedSamplesUp);
  const speedSamplesDown = useStore((s) => s.speedSamplesDown);
  const { isMobile } = usePlatform();
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const tooltipRef = useRef<{ x: number; idx: number } | null>(null);

  const height = isMobile ? 120 : 180;

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

    // Grid lines
    const gridLines = 4;
    ctx.strokeStyle = "hsl(240 3.7% 15.9% / 0.4)";
    ctx.lineWidth = 0.5;
    for (let i = 0; i <= gridLines; i++) {
      const y = pad.top + (plotH / gridLines) * i;
      ctx.beginPath();
      ctx.moveTo(pad.left, y);
      ctx.lineTo(w - pad.right, y);
      ctx.stroke();
    }

    // Y-axis labels
    ctx.fillStyle = "hsl(240 5% 64.9%)";
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
      ctx.strokeStyle = "hsl(240 5% 64.9% / 0.5)";
      ctx.lineWidth = 1;
      ctx.setLineDash([3, 3]);
      ctx.beginPath();
      ctx.moveTo(x, pad.top);
      ctx.lineTo(x, pad.top + plotH);
      ctx.stroke();
      ctx.setLineDash([]);

      const downVal = speedSamplesDown[tip.idx]?.toFixed(2) ?? "0";
      const upVal = speedSamplesUp[tip.idx]?.toFixed(2) ?? "0";
      const text = `↓${downVal} ↑${upVal} Mbps`;
      ctx.fillStyle = "hsl(240 10% 3.9%)";
      ctx.font = "11px system-ui, sans-serif";
      const tw = ctx.measureText(text).width + 12;
      const tx = Math.min(x - tw / 2, w - pad.right - tw);
      const ty = pad.top - 2;
      ctx.fillStyle = "hsl(240 10% 3.9% / 0.85)";
      ctx.beginPath();
      ctx.roundRect(Math.max(pad.left, tx), ty - 14, tw, 16, 4);
      ctx.fill();
      ctx.fillStyle = "#fff";
      ctx.textAlign = "center";
      ctx.fillText(text, Math.max(pad.left + tw / 2, x), ty - 3);
    }
  }, [speedSamplesDown, speedSamplesUp, maxVal, height]);

  useEffect(() => {
    draw();
  }, [draw]);

  useEffect(() => {
    const container = containerRef.current;
    if (!container) return;
    const ro = new ResizeObserver(draw);
    ro.observe(container);
    return () => ro.disconnect();
  }, [draw]);

  function handleMouseMove(e: React.MouseEvent<HTMLCanvasElement>) {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const pad = { left: 40, right: 8 };
    const plotW = rect.width - pad.left - pad.right;
    const n = speedSamplesDown.length;
    if (n < 2 || x < pad.left || x > rect.width - pad.right) {
      tooltipRef.current = null;
      draw();
      return;
    }
    const idx = Math.round(((x - pad.left) / plotW) * (n - 1));
    tooltipRef.current = { x, idx };
    draw();
  }

  function handleMouseLeave() {
    tooltipRef.current = null;
    draw();
  }

  return (
    <div ref={containerRef} className="w-full" style={{ height }}>
      <canvas
        ref={canvasRef}
        onMouseMove={handleMouseMove}
        onMouseLeave={handleMouseLeave}
        className="w-full h-full"
      />
    </div>
  );
});
