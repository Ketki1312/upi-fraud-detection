"use client";

import {
  BarChart,
  Bar,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  Cell,
} from "recharts";

export interface SimpleBarDatum {
  label: string;
  value: number;
  color?: string;
}

interface SimpleBarChartProps {
  data: SimpleBarDatum[];
  height?: number;
  /** Default fill color for bars without an explicit `color`. */
  fill?: string;
  horizontal?: boolean;
  /** Optional format function for tooltip values. */
  formatValue?: (n: number) => string;
}

/**
 * SimpleBarChart — thin recharts wrapper using the design palette.
 */
export function SimpleBarChart({
  data,
  height = 260,
  fill = "var(--primary)",
  horizontal = false,
  formatValue,
}: SimpleBarChartProps) {
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout={horizontal ? "vertical" : "horizontal"}
          margin={{ top: 8, right: 16, bottom: 8, left: horizontal ? 8 : 0 }}
        >
          {horizontal ? (
            <>
              <XAxis
                type="number"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                type="category"
                dataKey="label"
                width={120}
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
            </>
          ) : (
            <>
              <XAxis
                dataKey="label"
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
              <YAxis
                stroke="var(--muted-foreground)"
                tick={{ fontSize: 11 }}
                axisLine={false}
                tickLine={false}
              />
            </>
          )}
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            formatter={(v: number) =>
              formatValue ? formatValue(v) : String(v)
            }
          />
          <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={40}>
            {data.map((entry, idx) => (
              <Cell key={idx} fill={entry.color || fill} />
            ))}
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SimpleBarChart;
