"use client";

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

import type { ModelInfo } from "@/lib/types";
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  LoadingState,
  fmtDate,
  fmtNumber,
  useAsync,
} from "@/components/fraud/shared";
import { SimpleBarChart } from "@/components/charts/SimpleBarChart";
import { cn } from "@/lib/utils";

interface ModelsResponse {
  models: ModelInfo[];
  active_transaction_model?: string;
  english_status?: string;
  generated_at: string;
  disclaimer: string;
}

export function ModelPerformance() {
  const async_ = useAsync<ModelsResponse>(
    async () => {
      const res = await fetch("/api/v1/models", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ModelsResponse;
    },
    []
  );
  const data = async_.data;

  const f1Bars = (data?.models || []).map((m) => ({
    label: m.name,
    value: m.metrics.f1,
    color: m.active ? "var(--primary)" : "var(--muted-foreground)",
  }));

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Model Performance</h2>
        <p className="text-sm text-muted-foreground">
          Real per-model metrics from the ML service metadata. All numbers come
          from real evaluation on real held-out splits — none are hardcoded.
        </p>
      </div>

      {data ? (
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Service status</CardTitle>
            <CardDescription>ML service metadata snapshot.</CardDescription>
          </CardHeader>
          <CardContent>
            <div className="flex flex-wrap gap-3 text-sm">
              <div>
                <span className="text-muted-foreground">Active TX model:</span>{" "}
                <code className="font-mono text-xs">
                  {data.active_transaction_model || "—"}
                </code>
              </div>
              <div>
                <span className="text-muted-foreground">English status:</span>{" "}
                <Badge variant="outline" className="text-xs">{data.english_status || "—"}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Generated:</span>{" "}
                <span className="text-xs">{fmtDate(data.generated_at)}</span>
              </div>
            </div>
          </CardContent>
        </Card>
      ) : null}

      {/* F1 comparison bar chart */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">F1 comparison</CardTitle>
          <CardDescription>
            Real F1 scores per model. Active model is highlighted in primary colour.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={2} />
          ) : async_.error ? (
            <ErrorState message={async_.error} onRetry={async_.refetch} />
          ) : f1Bars.length > 0 ? (
            <SimpleBarChart data={f1Bars} horizontal height={280} formatValue={(n) => fmtNumber(n, 4)} />
          ) : (
            <EmptyState />
          )}
        </CardContent>
      </Card>

      {/* Per-model table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-model metrics</CardTitle>
          <CardDescription>
            Includes transaction (XGBoost / LR / RF) and NLP (TF-IDF + LR per language) models.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={5} />
          ) : async_.error ? (
            <ErrorState message={async_.error} onRetry={async_.refetch} />
          ) : !data || data.models.length === 0 ? (
            <EmptyState message="No models available — is the ML service running?" />
          ) : (
            <div className="max-h-[28rem] overflow-y-auto scroll-area-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Name</TableHead>
                    <TableHead>Version</TableHead>
                    <TableHead className="w-20">Status</TableHead>
                    <TableHead className="text-right">Precision</TableHead>
                    <TableHead className="text-right">Recall</TableHead>
                    <TableHead className="text-right">F1</TableHead>
                    <TableHead className="text-right">ROC-AUC</TableHead>
                    <TableHead className="text-right">PR-AUC</TableHead>
                    <TableHead className="w-36 text-right">Trained</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {data.models.map((m) => (
                    <TableRow key={m.name}>
                      <TableCell className="font-mono text-xs">{m.name}</TableCell>
                      <TableCell className="font-mono text-xs">{m.version}</TableCell>
                      <TableCell>
                        <Badge
                          variant="outline"
                          className={cn("text-xs", m.active ? "risk-low" : "border-border text-muted-foreground")}
                        >
                          {m.active ? "active" : m.status || "—"}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtNumber(m.metrics.precision)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtNumber(m.metrics.recall)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs font-semibold">{fmtNumber(m.metrics.f1)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtNumber(m.metrics.roc_auc)}</TableCell>
                      <TableCell className="text-right tabular-nums text-xs">{fmtNumber(m.metrics.pr_auc)}</TableCell>
                      <TableCell className="text-right text-xs text-muted-foreground">
                        {fmtDate(m.training_timestamp)}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Static vs adaptive comparison — read from drift history (we'd need a fetch here). */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Static vs adaptive comparison</CardTitle>
          <CardDescription>
            Latest retrain outcome from the ML service drift history. Shows whether
            the most recent adaptive candidate was promoted over the static baseline.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <StaticVsAdaptive />
        </CardContent>
      </Card>

      <Disclaimer />
    </div>
  );
}

function StaticVsAdaptive() {
  const async_ = useAsync<{
    events: {
      id: string;
      model_name?: string;
      old_metrics?: { f1?: number; recall?: number; precision?: number };
      new_metrics?: { f1?: number; recall?: number; precision?: number };
      promoted?: boolean;
      outcome?: string;
      created_at: string;
    }[];
  }>(
    async () => {
      const res = await fetch("/api/v1/drift/history", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as {
        events: {
          id: string;
          model_name?: string;
          old_metrics?: { f1?: number; recall?: number; precision?: number };
          new_metrics?: { f1?: number; recall?: number; precision?: number };
          promoted?: boolean;
          outcome?: string;
          created_at: string;
        }[];
      };
    },
    []
  );

  if (async_.loading) return <LoadingState rows={2} />;
  if (async_.error) return <ErrorState message={async_.error} onRetry={async_.refetch} />;
  const events = async_.data?.events || [];
  if (events.length === 0) {
    return (
      <EmptyState message="No retrain events yet — trigger one from the Drift Monitoring tab." />
    );
  }
  // Show the latest retrain event with metrics
  const latest = events
    .slice()
    .reverse()
    .find((e) => e.old_metrics && e.new_metrics);
  if (!latest) {
    return <EmptyState message="Latest drift event has no metric comparison." />;
  }
  const oldF1 = latest.old_metrics?.f1 ?? 0;
  const newF1 = latest.new_metrics?.f1 ?? 0;
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2 text-sm">
        <Badge variant="outline" className={cn(latest.promoted ? "risk-low" : "risk-medium")}>
          {latest.promoted ? "PROMOTED" : latest.outcome?.toUpperCase() || "EVENT"}
        </Badge>
        <span className="text-xs text-muted-foreground">
          {latest.model_name} · {fmtDate(latest.created_at)}
        </span>
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        <CompareCell label="Static F1" value={oldF1} />
        <CompareCell label="Candidate F1" value={newF1} highlight={newF1 >= oldF1 ? "good" : "bad"} />
        <CompareCell label="Static recall" value={latest.old_metrics?.recall ?? 0} />
        <CompareCell
          label="Candidate recall"
          value={latest.new_metrics?.recall ?? 0}
          highlight={(latest.new_metrics?.recall ?? 0) >= (latest.old_metrics?.recall ?? 0) ? "good" : "bad"}
        />
      </div>
      <p className="text-xs text-muted-foreground">
        Promotion rule: candidate is promoted only if F1 ≥, recall ≥, and
        precision ≥ 0.95 × static. If any condition fails, the candidate is
        archived but not promoted — disclosed honestly.
      </p>
    </div>
  );
}

function CompareCell({
  label,
  value,
  highlight,
}: {
  label: string;
  value: number;
  highlight?: "good" | "bad";
}) {
  return (
    <div className="rounded-md border border-border bg-muted/30 p-3">
      <div className="text-xs uppercase tracking-wider text-muted-foreground">{label}</div>
      <div
        className={cn(
          "mt-1 text-lg font-bold tabular-nums",
          highlight === "good" && "text-accent",
          highlight === "bad" && "text-destructive"
        )}
      >
        {fmtNumber(value, 4)}
      </div>
    </div>
  );
}

export default ModelPerformance;
