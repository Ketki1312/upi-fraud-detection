"use client";

import {
  Activity,
  AlertTriangle,
  MessageSquareWarning,
  ShieldCheck,
  TrendingUp,
} from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";

import type { DashboardSummary, DashboardTrends } from "@/lib/types";
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  LoadingState,
  fmtDate,
  fmtNumber,
  fmtPct,
  riskClass,
  useAsync,
} from "@/components/fraud/shared";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";
import { SimplePieChart } from "@/components/charts/SimplePieChart";
import { SimpleLineChart } from "@/components/charts/SimpleLineChart";
import { cn } from "@/lib/utils";

interface TrendsResponse {
  prisma_trends: {
    bucket: string;
    risk_low: number;
    risk_medium: number;
    risk_high: number;
    risk_critical: number;
    fraud_count: number;
    total: number;
    fraud_rate: number;
  }[];
  bucket_mode: "hour" | "day";
  prisma_total: number;
  paysim_benchmark: DashboardTrends | null;
  ml_service_online: boolean;
  disclaimer: string;
}

const KPI_CARDS = [
  {
    id: "total",
    label: "Total predictions",
    icon: Activity,
    color: "text-primary",
  },
  {
    id: "fraud",
    label: "Fraud detected",
    icon: AlertTriangle,
    color: "text-destructive",
  },
  {
    id: "scam",
    label: "Scams detected",
    icon: MessageSquareWarning,
    color: "text-destructive",
  },
  {
    id: "high",
    label: "High / critical risk",
    icon: ShieldCheck,
    color: "text-primary",
  },
  {
    id: "drift",
    label: "Drift status",
    icon: TrendingUp,
    color: "text-accent",
  },
] as const;

export function Dashboard() {
  const summaryAsync = useAsync<DashboardSummary>(
    async () => {
      const res = await fetch("/api/v1/dashboard/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as DashboardSummary;
    },
    []
  );

  const trendsAsync = useAsync<TrendsResponse>(
    async () => {
      const res = await fetch("/api/v1/dashboard/trends", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as TrendsResponse;
    },
    []
  );

  const summary = summaryAsync.data;
  const trends = trendsAsync.data;

  // KPI values
  const kpis: Record<string, number | string> = summary
    ? {
        total: summary.total_predictions,
        fraud: summary.fraud_count,
        scam: summary.scam_count,
        high: summary.high_risk_count,
        drift: summary.drift_status_summary.drift_detected > 0
          ? `${summary.drift_status_summary.drift_detected} drift`
          : summary.drift_status_summary.watch > 0
            ? `${summary.drift_status_summary.watch} watch`
            : `${summary.drift_status_summary.no_drift} stable`,
      }
    : {};

  // Risk distribution (pie)
  const riskPie = summary
    ? [
        { name: "Low", value: summary.risk_distribution.low, color: "var(--accent)" },
        { name: "Medium", value: summary.risk_distribution.medium, color: "var(--chart-5)" },
        { name: "High", value: summary.risk_distribution.high, color: "var(--primary)" },
        { name: "Critical", value: summary.risk_distribution.critical, color: "var(--destructive)" },
      ]
    : [];

  // Language distribution (pie)
  const langPie =
    summary?.language_distribution.map((l, i) => ({
      name: l.language,
      value: l.count,
      color: ["var(--primary)", "var(--accent)", "var(--destructive)", "var(--chart-4)", "var(--chart-5)"][i % 5],
    })) ?? [];

  // Fraud-rate trend — prefer PaySim benchmark if Prisma is empty.
  const prismaTrend = trends?.prisma_trends ?? [];
  const paysim = trends?.paysim_benchmark ?? null;
  const usePaysim = prismaTrend.length === 0 && paysim !== null;
  const fraudRateData = usePaysim
    ? paysim!.timestamps.map((t, i) => ({
        label: String(t),
        value: paysim!.fraud_rate_trend[i] ?? 0,
      }))
    : prismaTrend.map((b) => ({
        label: b.bucket.slice(5, 16), // YYYY-MM-DDTHH -> MM-DD HH
        value: b.fraud_rate,
      }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Dashboard</h2>
        <p className="text-sm text-muted-foreground">
          Live KPIs and trends from real Prisma predictions + real ML service metadata.
          All numbers come from API responses — none are hardcoded.
        </p>
      </div>

      {/* KPI row */}
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-5">
        {KPI_CARDS.map((k) => {
          const Icon = k.icon;
          const value = kpis[k.id] ?? "—";
          return (
            <Card key={k.id}>
              <CardHeader className="pb-2">
                <div className="flex items-center justify-between">
                  <CardDescription className="text-xs uppercase tracking-wider">
                    {k.label}
                  </CardDescription>
                  <Icon className={cn("size-4", k.color)} aria-hidden="true" />
                </div>
              </CardHeader>
              <CardContent>
                <div className={cn("text-2xl font-bold tabular-nums", k.color)}>
                  {summaryAsync.loading ? "…" : value}
                </div>
              </CardContent>
            </Card>
          );
        })}
      </div>

      {summaryAsync.error ? (
        <ErrorState
          message={`Failed to load dashboard summary: ${summaryAsync.error}`}
          onRetry={summaryAsync.refetch}
        />
      ) : null}

      {/* ML service status banner */}
      {summary && !summary.ml_service_online ? (
        <Card className="border-destructive/30 bg-destructive/5">
          <CardContent className="flex items-center gap-2 py-3 text-sm text-destructive">
            <AlertTriangle className="size-4" aria-hidden="true" />
            The Python ML service is currently unreachable. KPIs above come from
            the Prisma database; per-model metrics and dataset summary below may
            be unavailable until the service is back online.
          </CardContent>
        </Card>
      ) : null}

      {/* Charts row 1: risk distribution + language distribution */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Risk distribution</CardTitle>
            <CardDescription>
              Predictions grouped by risk level (from Prisma).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summaryAsync.loading ? (
              <LoadingState rows={2} />
            ) : summary && (summary.risk_distribution.low + summary.risk_distribution.medium + summary.risk_distribution.high + summary.risk_distribution.critical) > 0 ? (
              <SimplePieChart data={riskPie} height={260} formatValue={fmtNumber} />
            ) : (
              <EmptyState />
            )}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Language distribution</CardTitle>
            <CardDescription>
              Predictions grouped by detected language (from Prisma).
            </CardDescription>
          </CardHeader>
          <CardContent>
            {summaryAsync.loading ? (
              <LoadingState rows={2} />
            ) : summary && summary.language_distribution.length > 0 ? (
              <SimplePieChart data={langPie} height={260} formatValue={fmtNumber} />
            ) : (
              <EmptyState message="No message predictions yet — analyze a message to populate." />
            )}
          </CardContent>
        </Card>
      </div>

      {/* Charts row 2: fraud rate trend */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">
            Fraud-rate trend {usePaysim ? "(PaySim benchmark)" : "(live session)"}
          </CardTitle>
          <CardDescription>
            {usePaysim
              ? "No live predictions yet — showing fraud rate per PaySim step-window (10-hour buckets) from the public mobile-money simulator training split."
              : trends && trends.bucket_mode === "day"
                ? "Per-day fraud rate for the last 7 days (per-hour buckets would be too sparse)."
                : "Per-hour fraud rate for the last 24 hours."}
          </CardDescription>
        </CardHeader>
        <CardContent>
          {trendsAsync.loading ? (
            <LoadingState rows={2} />
          ) : trendsAsync.error ? (
            <ErrorState
              message={`Failed to load trends: ${trendsAsync.error}`}
              onRetry={trendsAsync.refetch}
            />
          ) : fraudRateData.length > 0 ? (
            <SimpleLineChart
              data={fraudRateData}
              height={260}
              formatY={(n) => fmtPct(n, 0)}
              formatValue={(n) => fmtPct(n, 2)}
            />
          ) : (
            <EmptyState message="No trend data yet — make a prediction to start populating live trends." />
          )}
        </CardContent>
      </Card>

      {/* Charts row 3: model metrics F1 comparison */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Model F1 comparison</CardTitle>
          <CardDescription>
            Real F1 scores from the ML service metadata for each trained model.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summaryAsync.loading ? (
            <LoadingState rows={2} />
          ) : summary && summary.model_metrics.length > 0 ? (
            <SimpleBarChart
              data={summary.model_metrics.map((m) => ({
                label: m.name,
                value: m.metrics.f1,
                color: m.active ? "var(--primary)" : "var(--muted-foreground)",
              }))}
              height={260}
              horizontal
              formatValue={(n) => fmtNumber(n, 4)}
            />
          ) : (
            <EmptyState message="Model metrics unavailable — is the ML service running?" />
          )}
        </CardContent>
      </Card>

      {/* Recent predictions */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Recent predictions</CardTitle>
          <CardDescription>
            Top 10 most recent predictions persisted in Prisma (SQLite).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {summaryAsync.loading ? (
            <LoadingState rows={4} />
          ) : summary && summary.recent_predictions.length > 0 ? (
            <div className="max-h-96 overflow-y-auto scroll-area-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead className="w-20">Type</TableHead>
                    <TableHead>Summary</TableHead>
                    <TableHead className="w-20">Label</TableHead>
                    <TableHead className="w-20">Risk</TableHead>
                    <TableHead className="w-32 text-right">Score</TableHead>
                    <TableHead className="w-32 text-right">When</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {summary.recent_predictions.slice(0, 10).map((p) => (
                    <TableRow key={p.id}>
                      <TableCell>
                        <Badge variant="outline" className="text-xs">
                          {p.input_type === "transaction" ? "TX" : "MSG"}
                        </Badge>
                      </TableCell>
                      <TableCell className="max-w-[280px] truncate text-xs text-muted-foreground">
                        {p.input_summary}
                      </TableCell>
                      <TableCell>
                        <Badge
                          variant={p.predicted_label === 1 ? "destructive" : "secondary"}
                          className="text-xs"
                        >
                          {p.predicted_label === 1 ? "Fraud/Scam" : "Legit"}
                        </Badge>
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", riskClass(p.risk_level))}>
                          {p.risk_level}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">
                        {fmtNumber(p.risk_score)}
                      </TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {fmtDate(p.created_at)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : (
            <EmptyState />
          )}
        </CardContent>
      </Card>

      <Disclaimer />
    </div>
  );
}

export default Dashboard;
