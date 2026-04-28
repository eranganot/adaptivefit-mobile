"use client";

import {
  Area,
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

function CustomTooltip({ active, payload, label }: TooltipProps) {
  if (!active || !payload?.length) return null;
  return (
    <div className="rounded-xl border bg-card px-3 py-2 text-xs shadow-md">
      <p className="font-semibold">{label}</p>
      {payload.map((p) => (
        <p key={p.dataKey} style={{ color: p.color }}>
          {p.name}: {p.value}
          {p.dataKey === "footPain" ? "/10" : ""}
        </p>
      ))}
    </div>
  );
}

export function TrendChart({ data }: Props) {
  const maxRtl = Math.max(...data.map((s) => s.rtl), 1);

  return (
    <div className="h-52 w-full">
      <ResponsiveContainer width="100%" height="100%">
        <ComposedChart data={data} margin={{ top: 4, right: 4, left: -20, bottom: 0 }}>
          <defs>
            <linearGradient id="rtlGradient" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="hsl(270 60% 60%)" stopOpacity={0.4} />
              <stop offset="95%" stopColor="hsl(270 60% 60%)" stopOpacity={0.05} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" vertical={false} stroke="hsl(var(--border))" />
          <XAxis
            dataKey="label"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="rtl"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[0, Math.ceil(maxRtl * 1.3)]}
            tickFormatter={(v) => `${v}`}
          />
          <YAxis
            yAxisId="pain"
            orientation="right"
            tick={{ fontSize: 10 }}
            tickLine={false}
            axisLine={false}
            domain={[0, 10]}
            ticks={[0, 2, 4, 6, 8, 10]}
            width={28}
          />
          <Tooltip content={<CustomTooltip />} />
          <Legend iconType="circle" iconSize={8} wrapperStyle={{ fontSize: 11, paddingTop: 4 }} />
          <Area
            yAxisId="rtl"
            type="monotone"
            dataKey="rtl"
            name="Training load"
            stroke="hsl(270 60% 60%)"
            strokeWidth={2}
            fill="url(#rtlGradient)"
            dot={{ r: 3, fill: "hsl(270 60% 60%)" }}
            activeDot={{ r: 5 }}
          />
          <Line
            yAxisId="pain"
            type="monotone"
            dataKey="footPain"
            name="Foot pain"
            stroke="hsl(38 92% 50%)"
            strokeWidth={2}
            dot={{ r: 3, fill: "hsl(38 92% 50%)" }}
            activeDot={{ r: 5 }}
          />
        </ComposedChart>
      </ResponsiveContainer>
    </div>
  );
}
