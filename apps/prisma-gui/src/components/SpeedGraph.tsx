import React, { useMemo } from "react";
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, Legend, ResponsiveContainer,
} from "recharts";
import { useStore } from "@/store";

export default React.memo(function SpeedGraph() {
  const speedSamplesUp = useStore((s) => s.speedSamplesUp);
  const speedSamplesDown = useStore((s) => s.speedSamplesDown);

  const data = useMemo(
    () =>
      speedSamplesDown.map((down, i) => ({
        t:    i,
        down: +down.toFixed(2),
        up:   +(speedSamplesUp[i] ?? 0).toFixed(2),
      })),
    [speedSamplesUp, speedSamplesDown],
  );

  return (
    <ResponsiveContainer width="100%" height={180}>
      <LineChart data={data} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
        <XAxis dataKey="t" tick={false} />
        <YAxis tickFormatter={(v: number) => `${v}M`} tick={{ fontSize: 10 }} />
        <Tooltip
          contentStyle={{ background: "hsl(var(--popover))", border: "1px solid hsl(var(--border))", borderRadius: 6 }}
          labelFormatter={() => ""}
          formatter={(v: number) => [`${v} Mbps`]}
        />
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Line type="monotone" dataKey="down" stroke="#22c55e" dot={false} strokeWidth={2} name="↓ Download" isAnimationActive={false} />
        <Line type="monotone" dataKey="up"   stroke="#3b82f6" dot={false} strokeWidth={2} name="↑ Upload" isAnimationActive={false} />
      </LineChart>
    </ResponsiveContainer>
  );
});
