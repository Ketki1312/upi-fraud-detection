"use client";

import {
  LineChart,
  Line,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  CartesianGrid,
} from "recharts";

export interface SimpleLineDatum {
  label: string;
  value: number;
  secondary?: number;
}

interface SimpleLineChartProps {
  data: SimpleLineDatum[];
  height?: number;
  /** Color for the primary line (CSS var, defaults to primary). */
  stroke?: string;
  /** Color for the secondary line, if present. */
  secondaryStroke?: string;
  /** Y-axis tick format. */
  formatY?: (n: number) => string;
  /** Tooltip value format. */
  formatValue?: (n: number) => string;
  /** Show the secondary line if any datum has a `secondary` value. */
  showSecondary?: boolean;
}

export function SimpleLineChart({
  data,
  height = 260,
  stroke = "var(--primary)",
  secondaryStroke = "var(--accent)",
  formatY,
  formatValue,
  showSecondary = true,
}: SimpleLineChartProps) {
  const hasSecondary = showSecondary && data.some((d) => d.secondary !== undefined);
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <LineChart data={data} margin={{ top: 8, right: 16, bottom: 8, left: 0 }}>
          <CartesianGrid stroke="var(--border)" strokeDasharray="3 3" vertical={false} />
          <XAxis
            dataKey="label"
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            minTickGap={20}
          />
          <YAxis
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
            tickFormatter={formatY}
          />
          <Tooltip
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
          <Line
            type="monotone"
            dataKey="value"
            stroke={stroke}
            strokeWidth={2}
            dot={false}
            activeDot={{ r: 4 }}
          />
          {hasSecondary ? (
            <Line
              type="monotone"
              dataKey="secondary"
              stroke={secondaryStroke}
              strokeWidth={2}
              dot={false}
              activeDot={{ r: 4 }}
            />
          ) : null}
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SimpleLineChart;
