"use client";

import { Bar, BarChart, CartesianGrid, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { WeeklyBucket } from "@/app/(app)/analytics/data";

type Metric = "km" | "sessions";
type Props = { data: WeeklyBucket[]; metric?: Metric };

function buildTooltip(metric: Metric) {
  return function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value: number }>; label?: string }) {
    if (!active || !payload?.length) return null;
    const value = payload[0].value;
    const suffix = metric === "km" ? "km" : value === 1 ? "session" : "sessions";
    return (
      <div className="rounded-xl border bg-white px-3 py-2 text-xs shadow-lg dark:bg-slate-900">
        <p className="font-semibold text-slate-700 dark:text-slate-200">{label}</p>
        <p className="font-medium text-emerald-600">{value} {suffix}</p>
      </div>
    );
  };
}

export function VolumeChart({ data, metric = "km" }: Props) {
  const last4 = data.slice(-4);
  const Tt = buildTooltip(metric);
  return (
    <div className="h-40 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={last4} margin={{ top: 4, right: 4, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="week" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis tick={{ fontSize: 10 }} tickLine={false} axisLine={false} allowDecimals={metric === "km"} />
          <Tooltip content={<Tt />} />
          <Bar
            dataKey={metric}
            name={metric === "km" ? "Distance" : "Sessions"}
            fill={metric === "km" ? "#10b981" : "#6366f1"}
            radius={[4, 4, 0, 0]}
          />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
