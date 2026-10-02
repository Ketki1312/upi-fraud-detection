"use client";

import {
  BarChart,
  Bar,
  Cell,
  XAxis,
  YAxis,
  Tooltip,
  ResponsiveContainer,
  ReferenceLine,
  LabelList,
} from "recharts";

export interface ContributionItem {
  /** Human-readable label (e.g. "Sender's balance before" or "OTP"). */
  label: string;
  /** Signed contribution value — positive pushes toward fraud/scam, negative toward legitimate. */
  value: number;
  /** Optional raw feature value (shown in tooltip). */
  rawValue?: string | number;
}

interface ContributionsChartProps {
  items: ContributionItem[];
  /** "transaction" → "Pushes toward fraud"; "message" → "Pushes toward scam". */
  kind?: "transaction" | "message";
  /** Height in pixels (default 320). */
  height?: number;
}

/**
 * ContributionsChart — horizontal bar chart for SHAP/LIME contributions.
 * Positive contributions (toward fraud/scam) render red on the right;
 * negative (toward legitimate) render green on the left.
 */
export function ContributionsChart({
  items,
  kind = "transaction",
  height = 320,
}: ContributionsChartProps) {
  const data = items
    .slice()
    .sort((a, b) => Math.abs(b.value) - Math.abs(a.value))
    .slice(0, 8)
    .map((it) => ({
      label: it.label.length > 28 ? `${it.label.slice(0, 26)}…` : it.label,
      value: Number(it.value),
      rawValue: it.rawValue,
    }));

  const positiveLabel = kind === "transaction" ? "Pushes toward fraud" : "Pushes toward scam";
  const negativeLabel = "Pushes toward legitimate";

  return (
    <div className="w-full" style={{ height }}>
      <ResponsiveContainer width="100%" height="100%">
        <BarChart
          data={data}
          layout="vertical"
          margin={{ top: 8, right: 40, bottom: 8, left: 8 }}
          barCategoryGap="20%"
        >
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
            width={170}
            stroke="var(--muted-foreground)"
            tick={{ fontSize: 11 }}
            axisLine={false}
            tickLine={false}
          />
          <Tooltip
            cursor={{ fill: "var(--muted)" }}
            contentStyle={{
              background: "var(--popover)",
              border: "1px solid var(--border)",
              borderRadius: 8,
              color: "var(--popover-foreground)",
              fontSize: 12,
            }}
            labelStyle={{ color: "var(--foreground)", fontWeight: 600 }}
            formatter={(value: number, _name, item) => {
              const raw = item?.payload?.rawValue;
              const val = Number(value).toFixed(4);
              const direction = value >= 0 ? positiveLabel : negativeLabel;
              const rawStr =
                raw !== undefined && raw !== null && raw !== ""
                  ? ` (value: ${raw})`
                  : "";
              return [`${val} — ${direction}${rawStr}`, "Contribution"];
            }}
          />
          <ReferenceLine x={0} stroke="var(--border)" />
          <Bar dataKey="value" radius={[4, 4, 4, 4]} maxBarSize={28}>
            {data.map((entry, idx) => (
              <Cell
                key={idx}
                fill={entry.value >= 0 ? "var(--destructive)" : "var(--accent)"}
              />
            ))}
            <LabelList
              dataKey="value"
              position="right"
              style={{ fontSize: 10, fill: "var(--muted-foreground)" }}
              formatter={(v: number) => (v >= 0 ? `+${v.toFixed(3)}` : v.toFixed(3))}
            />
          </Bar>
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

export default ContributionsChart;
