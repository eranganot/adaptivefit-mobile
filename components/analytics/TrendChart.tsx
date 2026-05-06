"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionPoint } from "@/app/(app)/analytics/data";

export type TrendMode = "rpe" | "distance";

type Props = { data: SessionPoint[]; mode?: TrendMode };

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
          {p.dataKey === "paceMinPerKm"
            ? `${p.value.toFixed(1)} min/km`
            : p.dataKey === "km"
            ? `${p.value.toFixed(1)} km`
            : `${p.value}/10`}
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ data, mode = "rpe" }: Props) {
  const last7 = data.slice(-7).map((s) => ({
    ...s,
    paceMinPerKm: s.paceMinPerKm ?? undefined,
    km: s.km ?? undefined,
  }));

  if (mode === "distance") {
    // Distance × Pace dual-axis
    return (
      <div className="h-48 w-full">
        <ResponsiveContainer width="100%" height="100%">
          <ComposedChart data={last7} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
            <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
            <YAxis yAxisId="km" domain={[0, "auto"]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}k`} />
            <YAxis yAxisId="pace" orientation="right" domain={[4, 10]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={30} tickFormatter={(v) => `${v}'`} />
            <Tooltip content={<CustomTooltip />} />
            <Line yAxisId="km" type="monotone" dataKey="km" name="Distance" stroke="#6366f1" strokeWidth={2} dot={{ r: 3, fill: "#6366f1" }} activeDot={{ r: 5 }} connectNulls={false} />
            <Line yAxisId="pace" type="monotone" dataKey="paceMinPerKm" name="Pace" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: "#dc2626" }} activeDot={{ r: 5 }} connectNulls={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>
    );
  }

  // Default: RPE × Pace dual-axis
  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={last7} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis dataKey="label" tick={{ fontSize: 10 }} tickLine={false} axisLine={false} interval="preserveStartEnd" />
          <YAxis yAxisId="rpe" domain={[0, 10]} ticks={[0, 5, 10]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} />
          <YAxis yAxisId="pace" orientation="right" domain={[4, 10]} tick={{ fontSize: 10 }} tickLine={false} axisLine={false} width={30} tickFormatter={(v) => `${v}'`} />
          <Tooltip content={<CustomTooltip />} />
          <Line yAxisId="rpe" type="monotone" dataKey="rpe" name="RPE" stroke="#2563eb" strokeWidth={2} dot={{ r: 3, fill: "#2563eb" }} activeDot={{ r: 5 }} />
          <Line yAxisId="pace" type="monotone" dataKey="paceMinPerKm" name="Pace" stroke="#dc2626" strokeWidth={2} dot={{ r: 3, fill: "#dc2626" }} activeDot={{ r: 5 }} connectNulls={false} />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
