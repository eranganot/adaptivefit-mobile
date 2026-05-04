"use client";

import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
  Legend,
} from "recharts";
import type { LiftPoint } from "@/app/(app)/analytics/data";

type Props = { data: LiftPoint[] };

// Colours per exercise
const EXERCISE_COLORS: Record<string, string> = {
  "Bench Press": "#6366f1",
  Squat: "#f59e0b",
  Deadlift: "#ef4444",
  "Overhead Press": "#8b5cf6",
  "Barbell Row": "#10b981",
};

function getColor(exercise: string): string {
  return EXERCISE_COLORS[exercise] ?? "#94a3b8";
}

function CustomTooltip({
  active,
  payload,
  label,
}: {
  active?: boolean;
  payload?: Array<{ name: string; value: number; color: string }>;
  label?: string;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-white px-3 py-2 text-xs shadow-lg dark:bg-slate-900">
      <p className="mb-1 font-semibold text-slate-700 dark:text-slate-200">{label}</p>
      {payload.map((p) => (
        <p key={p.name} style={{ color: p.color }} className="font-medium">
          {p.name}: {p.value} kg
        </p>
      ))}
    </div>
  );
}

export function LiftProgressChart({ data }: Props) {
  if (data.length === 0) return null;

  // Group by date, pivot exercises as columns
  const exerciseSet = Array.from(new Set(data.map((d) => d.exercise)));

  const byDate = new Map<string, Record<string, number>>();
  for (const point of data) {
    const existing = byDate.get(point.date) ?? {};
    existing[point.exercise] = Math.max(existing[point.exercise] ?? 0, point.weightKg);
    byDate.set(point.date, existing);
  }

  const chartData = Array.from(byDate.entries()).map(([date, lifts]) => ({
    date,
    ...lifts,
  }));

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <BarChart data={chartData} margin={{ top: 4, right: 8, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="date"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            tickFormatter={(v) => `${v}kg`}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            wrapperStyle={{ fontSize: "10px" }}
            formatter={(value) => <span style={{ fontSize: 10 }}>{value}</span>}
          />
          {exerciseSet.map((ex) => (
            <Bar key={ex} dataKey={ex} fill={getColor(ex)} radius={[3, 3, 0, 0]} maxBarSize={18} />
          ))}
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}
