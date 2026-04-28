"use client";

import {
  Bar,
  CartesianGrid,
  ComposedChart,
  Legend,
  Line,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionPoint } from "@/app/(app)/analytics/data";

type Props = {
  data: SessionPoint[];
};

type TooltipEntry = {
  dataKey: string;
  name: string;
  value: number;
  color: string;
};

type TooltipProps = {
  active?: boolean;
  payload?: TooltipEntry[];
  label?: string;
};

function fmtPace(minPerKm: number): string {
  const m = Math.floor(minPerKm);
  const s = Math.round((minPerKm - m) * 60);
  return `${m}:${s.toString().padStart(2, "0")}`;
}

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}:{" "}
          {p.dataKey === "paceMinPerKm" ? fmtPace(p.value) + " /km" : p.value + " km"}
        </p>
      ))}
    </div>
  );
}

export function VolumeChart({ data }: Props) {
  const runs = data.filter((s) => s.type === "run" && s.km != null);

  const maxKm = Math.max(...runs.map((s) => s.km ?? 0), 1);
  const paces = runs.filter((s) => s.paceMinPerKm != null).map((s) => s.paceMinPerKm as number);
  const minPace = paces.length ? Math.min(...paces) : 6;
  const maxPace = paces.length ? Math.max(...paces) : 8;
  const paceBuffer = 0.3;

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={runs} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="km"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[0, Math.ceil(maxKm * 1.2)]}
            tickFormatter={(v) => `${v}`}
          />
          <YAxis
            yAxisId="pace"
            orientation="right"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[maxPace + paceBuffer, minPace - paceBuffer]}
            tickFormatter={fmtPace}
            width={36}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Bar
            yAxisId="km"
            dataKey="km"
            name="Distance"
            fill="hsl(210 80% 70%)"
            radius={[4, 4, 0, 0]}
            maxBarSize={32}
          />
          <Line
            yAxisId="pace"
            type="monotone"
            dataKey="paceMinPerKm"
            name="Pace"
            stroke="hsl(0 72% 51%)"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(0 72% 51%)" }}
            activeDot={{ r: 5 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
