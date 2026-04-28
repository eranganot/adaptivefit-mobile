"use client";

import {
  CartesianGrid,
  Legend,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import type { SessionPoint } from "@/app/(app)/analytics/data";

type Props = {
  data: SessionPoint[];
};

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null;
  const d = payload[0]?.payload as SessionPoint;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{label}</p>
      {d.km !== null && <p className="text-muted-foreground">{d.km} km · {d.type}</p>}
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value}/10
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ data }: Props) {
  return (
    <div className="h-44 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend
            iconType="circle"
            iconSize={8}
            wrapperStyle={{ fontSize: 11, paddingTop: 4 }}
          />
          <Line
            type="monotone"
            dataKey="rpe"
            name="RPE"
            stroke="hsl(var(--primary))"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(var(--primary))" }}
            activeDot={{ r: 5 }}
          />
          <Line
            type="monotone"
            dataKey="footPain"
            name="Foot pain"
            stroke="hsl(38 92% 50%)"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(38 92% 50%)" }}
            activeDot={{ r: 5 }}
            strokeDasharray="4 2"
          />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
