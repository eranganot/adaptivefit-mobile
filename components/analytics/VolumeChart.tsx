"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { WeeklyBucket } from "@/app/(app)/analytics/data";

type Props = {
  data: WeeklyBucket[];
  peakWeekKm: number;
};

type TooltipProps = {
  active?: boolean;
  payload?: Array<{ payload: WeeklyBucket }>;
  label?: string;
};

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  const d = payload[0].payload;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{label}</p>
      <p className="text-muted-foreground">
        {d.km > 0 ? `${d.km} km` : "Rest week"}
        {d.sessions > 0 && ` · ${d.sessions} session${d.sessions > 1 ? "s" : ""}`}
      </p>
    </div>
  );
}

export function VolumeChart({ data, peakWeekKm }: Props) {
  // Show only last 8 of 12 weeks on mobile to avoid crowding
  const visible = data.slice(-8);

  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={visible} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="week"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval={1}
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}`}
            domain={[0, Math.max(peakWeekKm * 1.2, 5)]}
          />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: "transparent" }} />
          <Bar
            dataKey="km"
            radius={[4, 4, 0, 0]}
            fill="hsl(var(--primary))"
            maxBarSize={32}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
