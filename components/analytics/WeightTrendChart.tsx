"use client";

import {
  CartesianGrid,
  Line,
  LineChart,
  ReferenceLine,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { BodyMetricPoint } from "@/app/(app)/analytics/data";

type Props = {
  data: BodyMetricPoint[];
  targetWeightKg: number | null;
};

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ dataKey: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-white px-3 py-2 text-xs shadow-lg dark:bg-slate-900">
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }} className="font-medium">
          {p.dataKey === "weightKg" ? "Weight" : "Body fat"}: {p.value}
          {p.dataKey === "weightKg" ? " kg" : "%"}
        </p>
      ))}
    </div>
  );
}

export function WeightTrendChart({ data, targetWeightKg }: Props) {
  const withWeight = data.filter((d) => d.weightKg != null);
  if (withWeight.length === 0) return null;

  const weights = withWeight.map((d) => d.weightKg as number);
  const minW = Math.floor(Math.min(...weights, targetWeightKg ?? Infinity) - 2);
  const maxW = Math.ceil(Math.max(...weights) + 2);

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={withWeight} margin={{ top: 4, right: 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            domain={[minW, maxW]}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}kg`}
          />
          <Tooltip content={<CustomTooltip />} />
          {targetWeightKg != null && (
            <ReferenceLine
              y={targetWeightKg}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{ value: `Target ${targetWeightKg}kg`, position: "insideTopRight", fontSize: 9, fill: "#10b981" }}
            />
          )}
          <Line
            type="monotone"
            dataKey="weightKg"
            name="Weight"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: "#6366f1" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
