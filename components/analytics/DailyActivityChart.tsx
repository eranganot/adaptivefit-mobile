"use client";

import {
  Bar,
  ComposedChart,
  CartesianGrid,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { DailyActivityPoint } from "@/app/(app)/analytics/data";

type Props = { data: DailyActivityPoint[] };

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-white px-3 py-2 text-xs shadow-lg dark:bg-slate-900">
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-medium">
          {p.name}:{" "}
          {p.dataKey === "avgRpe" ? `${p.value}/10` : `${p.value} min`}
        </p>
      ))}
    </div>
  );
}

export function DailyActivityChart({ data }: Props) {
  // Show last 14 days so bars aren't too narrow on mobile
  const last14 = data.slice(-14);

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={last14} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="day"
            tick={{ fontSize: 9 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          {/* Left axis — active minutes */}
          <YAxis
            yAxisId="min"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}m`}
          />
          {/* Right axis — RPE */}
          <YAxis
            yAxisId="rpe"
            orientation="right"
            domain={[0, 10]}
            ticks={[0, 5, 10]}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} />
          <Bar
            yAxisId="min"
            dataKey="activeMin"
            name="Active time"
            fill="#6366f1"
            fillOpacity={0.75}
            radius={[3, 3, 0, 0]}
            maxBarSize={24}
          />
          <Line
            yAxisId="rpe"
            type="monotone"
            dataKey="avgRpe"
            name="Avg RPE"
            stroke="#f97316"
            strokeWidth={2}
            dot={{ r: 3, fill: "#f97316" }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
