"use client";

import {
  PieChart,
  Pie,
  Cell,
  Tooltip,
  ResponsiveContainer,
  Legend,
} from "recharts";

export interface SimplePieDatum {
  name: string;
  value: number;
  color?: string;
}

interface SimplePieChartProps {
  data: SimplePieDatum[];
  height?: number;
  /** Optional center label (e.g. "predictions"). */
  centerLabel?: string;
  /** Whether to show the legend (default true). */
  showLegend?: boolean;
  formatValue?: (n: number) => string;
}

/**
 * SimplePieChart — donut-style pie chart using the design palette.
 * Falls back to chart-* tokens if individual `color` is missing.
 */
export function SimplePieChart({
  data,
  height = 260,
  showLegend = true,
  formatValue,
}: SimplePieChartProps) {
  const palette = [
    "var(--primary)",     // orange
    "var(--accent)",      // green
    "var(--destructive)", // red
    "var(--chart-4)",     // navy
    "var(--chart-5)",     // amber
  ];
  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <PieChart>
          <Pie
            data={data}
            dataKey="value"
            nameKey="name"
            innerRadius="55%"
            outerRadius="80%"
            paddingAngle={2}
            stroke="var(--background)"
            strokeWidth={2}
          >
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.color || palette[idx % palette.length]}
              />
            ))}
          </Pie>
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
          {showLegend ? (
            <Legend
              iconType="circle"
              wrapperStyle={{ fontSize: 11, color: "var(--muted-foreground)" }}
            />
          ) : null}
        </PieChart>
      </ResponsiveContainer>
    </div>
  );
}

export default SimplePieChart;
