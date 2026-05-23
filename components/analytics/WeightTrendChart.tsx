"use client";

import {
  CartesianGrid,
  ComposedChart,
  Line,
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
  /**
   * Phase-7 cleanup: when true (e.g. body_shape goal), render a second axis
   * with bodyFatPct overlaid. Replaces the separate Body Composition card,
   * which used to render this same chart twice.
   */
  showBodyFat?: boolean;
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

export function WeightTrendChart({ data, targetWeightKg, showBodyFat = false }: Props) {
  const withWeight = data.filter((d) => d.weightKg != null);
  if (withWeight.length === 0) return null;

  const weights = withWeight.map((d) => d.weightKg as number);
  const minW = Math.floor(Math.min(...weights, targetWeightKg ?? Infinity) - 2);
  const maxW = Math.ceil(Math.max(...weights) + 2);

  // Only render the body-fat overlay if the caller asked for it AND there's
  // at least one bodyFat reading in the window. Otherwise the right axis
  // takes up space with no line, which looks broken.
  const hasBodyFatData = withWeight.some((d) => d.bodyFatPct != null);
  const renderBodyFat = showBodyFat && hasBodyFatData;

  return (
    <div className="h-48 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={withWeight} margin={{ top: 4, right: renderBodyFat ? 8 : 8, left: -24, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="kg"
            domain={[minW, maxW]}
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}kg`}
          />
          {renderBodyFat && (
            <YAxis
              yAxisId="bf"
              orientation="right"
              domain={["auto", "auto"]}
              tick={{ fontSize: 10 }}
              tickLine={false}
              axisLine={false}
              width={30}
              tickFormatter={(v) => `${v}%`}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          {targetWeightKg != null && (
            <ReferenceLine
              yAxisId="kg"
              y={targetWeightKg}
              stroke="#10b981"
              strokeDasharray="4 4"
              label={{ value: `Target ${targetWeightKg}kg`, position: "insideTopRight", fontSize: 9, fill: "#10b981" }}
            />
          )}
          <Line
            yAxisId="kg"
            type="monotone"
            dataKey="weightKg"
            name="Weight"
            stroke="#6366f1"
            strokeWidth={2}
            dot={{ r: 3, fill: "#6366f1" }}
            activeDot={{ r: 5 }}
            connectNulls={false}
          />
          {renderBodyFat && (
            <Line
              yAxisId="bf"
              type="monotone"
              dataKey="bodyFatPct"
              name="Body fat"
              stroke="#f97316"
              strokeWidth={2}
              dot={{ r: 3, fill: "#f97316" }}
              activeDot={{ r: 5 }}
              connectNulls={false}
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
