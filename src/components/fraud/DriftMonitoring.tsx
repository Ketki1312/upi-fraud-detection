"use client";

import { useEffect, useState } from "react";
import { Activity, Loader2, RotateCw } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
  DialogClose,
} from "@/components/ui/dialog";

import type {
  DriftStatusResponse,
  DriftHistoryResponse,
  RetrainResponse,
  ModelInfo,
} from "@/lib/types";
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  LoadingState,
  fmtDate,
  fmtNumber,
} from "@/components/fraud/shared";
import { cn } from "@/lib/utils";

const STATUS_CLASS: Record<string, string> = {
  NO_DRIFT: "risk-low",
  WATCH: "risk-medium",
  DRIFT_DETECTED: "risk-critical",
};

export function DriftMonitoring() {
  const [retraining, setRetraining] = useState(false);
  const [retrainOutcome, setRetrainOutcome] = useState<RetrainResponse | null>(null);
  const [selectedModel, setSelectedModel] = useState<string>("transaction_xgboost");

  // Drift status — fetched on mount + on demand.
  const [driftStatus, setDriftStatus] = useState<DriftStatusResponse | null>(null);
  const [statusLoading, setStatusLoading] = useState(true);
  const [statusError, setStatusError] = useState<string | null>(null);

  const fetchStatus = async () => {
    setStatusLoading(true);
    setStatusError(null);
    try {
      const res = await fetch("/api/v1/drift/status", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const data = (await res.json()) as DriftStatusResponse;
      setDriftStatus(data);
    } catch (e) {
      setStatusError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setStatusLoading(false);
    }
  };

  // Drift history.
  const [driftHistory, setDriftHistory] = useState<DriftHistoryResponse | null>(null);
  const [historyLoading, setHistoryLoading] = useState(true);
  const [historyError, setHistoryError] = useState<string | null>(null);

  const fetchHistory = async () => {
    setHistoryLoading(true);
    setHistoryError(null);
    try {
      const res = await fetch("/api/v1/drift/history", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      setDriftHistory((await res.json()) as DriftHistoryResponse);
    } catch (e) {
      setHistoryError(e instanceof Error ? e.message : "Unknown error");
    } finally {
      setHistoryLoading(false);
    }
  };

  // Models (to populate the retrain model dropdown).
  const [models, setModels] = useState<ModelInfo[]>([]);
  useEffectOnce(() => {
    void fetchStatus();
    void fetchHistory();
    void (async () => {
      try {
        const res = await fetch("/api/v1/models", { cache: "no-store" });
        if (!res.ok) return;
        const data = (await res.json()) as { models: ModelInfo[] };
        setModels(data.models || []);
      } catch {
        // ignore — retrain just falls back to free text
      }
    })();
  });

  const doRetrain = async () => {
    setRetraining(true);
    setRetrainOutcome(null);
    try {
      const res = await fetch("/api/v1/models/retrain", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ model_name: selectedModel }),
      });
      const data = (await res.json()) as RetrainResponse & { error?: string; detail?: unknown };
      if (!res.ok) {
        throw new Error(data.error || `HTTP ${res.status}`);
      }
      setRetrainOutcome(data);
      toast[data.promoted ? "success" : "warning"](
        data.promoted ? "Candidate promoted!" : "Candidate rejected",
        {
          description: `Outcome: ${data.outcome} · F1 Δ ${fmtNumber(data.comparison.f1_delta, 4)}`,
        }
      );
      // Refresh history
      void fetchHistory();
    } catch (e) {
      const msg = e instanceof Error ? e.message : "Unknown error";
      toast.error("Retrain failed", { description: msg });
    } finally {
      setRetraining(false);
    }
  };

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
        <div>
          <h2 className="text-xl font-semibold text-foreground">Drift Monitoring</h2>
          <p className="text-sm text-muted-foreground">
            Real PSI (Population Stability Index) computed from the PaySim
            validation split vs the training reference distribution.
          </p>
        </div>
        <Button variant="outline" size="sm" onClick={() => { void fetchStatus(); void fetchHistory(); }}>
          <RotateCw className="size-3.5" aria-hidden="true" />
            Refresh
          </Button>
      </div>

      {/* Thresholds card */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">PSI thresholds</CardTitle>
          <CardDescription>
            Thresholds are env-configurable on the ML service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {driftStatus ? (
            <div className="flex flex-wrap gap-4 text-sm">
              <div>
                <span className="text-muted-foreground">Watch (PSI ≥)</span>{" "}
                <Badge variant="outline" className="risk-medium">{driftStatus.thresholds.watch}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Drift (PSI ≥)</span>{" "}
                <Badge variant="outline" className="risk-critical">{driftStatus.thresholds.drift}</Badge>
              </div>
              <div>
                <span className="text-muted-foreground">Generated:</span>{" "}
                <span className="text-xs">{fmtDate(driftStatus.generated_at)}</span>
              </div>
              <div className="text-xs text-muted-foreground">{driftStatus.source}</div>
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">Loading thresholds…</p>
          )}
        </CardContent>
      </Card>

      {/* Drift features table */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Per-feature PSI</CardTitle>
          <CardDescription>
            Each PaySim numeric feature is compared against the training reference.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {statusLoading ? (
            <LoadingState rows={4} />
          ) : statusError ? (
            <ErrorState message={statusError} onRetry={fetchStatus} />
          ) : !driftStatus || driftStatus.features.length === 0 ? (
            <EmptyState message="No drift status available — is the ML service running?" />
          ) : (
            <div className="max-h-96 overflow-y-auto scroll-area-thin">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Feature</TableHead>
                    <TableHead className="text-right">PSI</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead className="text-right">Watch threshold</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {driftStatus.features.map((f) => (
                    <TableRow key={f.feature}>
                      <TableCell className="font-mono text-xs">{f.feature}</TableCell>
                      <TableCell className="text-right tabular-nums">
                        {fmtNumber(f.psi, 6)}
                      </TableCell>
                      <TableCell>
                        <Badge variant="outline" className={cn("text-xs", STATUS_CLASS[f.status])}>
                          <Activity className="mr-1 size-3" aria-hidden="true" />
                          {f.status}
                        </Badge>
                      </TableCell>
                      <TableCell className="text-right tabular-nums text-xs text-muted-foreground">
                        {f.threshold}
                      </TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          )}
        </CardContent>
      </Card>

      {/* Drift history timeline */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drift / retrain history</CardTitle>
          <CardDescription>
            Append-only log from the ML service (retrain attempts + drift events).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <LoadingState rows={3} />
          ) : historyError ? (
            <ErrorState message={historyError} onRetry={fetchHistory} />
          ) : !driftHistory || driftHistory.events.length === 0 ? (
            <EmptyState message="No drift/retrain events yet." />
          ) : (
            <div className="space-y-3">
              {driftHistory.events.slice().reverse().map((ev) => (
                <div
                  key={ev.id}
                  className="rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex flex-wrap items-center gap-2">
                    <Badge
                      variant="outline"
                      className={cn(
                        "text-xs",
                        ev.promoted ? "risk-low" : ev.outcome === "rejected" ? "risk-medium" : "risk-high"
                      )}
                    >
                      {ev.promoted ? "PROMOTED" : ev.outcome?.toUpperCase() || ev.type?.toUpperCase() || "EVENT"}
                    </Badge>
                    <code className="font-mono text-xs">{ev.id}</code>
                    <span className="text-xs text-muted-foreground">
                      {ev.model_name || ev.feature || "global"}
                    </span>
                    <span className="ml-auto text-xs text-muted-foreground">
                      {fmtDate(ev.created_at)}
                    </span>
                  </div>
                  <div className="mt-2 grid grid-cols-1 gap-2 text-xs sm:grid-cols-3">
                    {ev.old_metrics && ev.new_metrics ? (
                      <>
                        <div className="rounded bg-background p-2">
                          <div className="text-muted-foreground">Old F1</div>
                          <div className="font-semibold tabular-nums">
                            {fmtNumber(ev.old_metrics.f1, 4)}
                          </div>
                        </div>
                        <div className="rounded bg-background p-2">
                          <div className="text-muted-foreground">New F1</div>
                          <div className="font-semibold tabular-nums">
                            {fmtNumber(ev.new_metrics.f1, 4)}
                          </div>
                        </div>
                        <div className="rounded bg-background p-2">
                          <div className="text-muted-foreground">Δ F1</div>
                          <div
                            className={cn(
                              "font-semibold tabular-nums",
                              (ev.comparison?.f1_delta ?? 0) >= 0 ? "text-accent" : "text-destructive"
                            )}
                          >
                            {(ev.comparison?.f1_delta ?? 0) >= 0 ? "+" : ""}
                            {fmtNumber(ev.comparison?.f1_delta ?? 0, 4)}
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="rounded bg-background p-2 text-muted-foreground">
                        No metric deltas recorded.
                      </div>
                    )}
                  </div>
                  {ev.drift_window ? (
                    <div className="mt-2 text-xs text-muted-foreground">
                      Drift window: <code className="font-mono">
                        step {ev.drift_window.min_step ?? "?"}–{ev.drift_window.max_step ?? "?"}
                      </code>{" "}
                      · candidate <code className="font-mono">{ev.candidate_version || "?"}</code>
                    </div>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Retrain action */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trigger candidate retrain</CardTitle>
          <CardDescription>
            Triggers the ML service's adaptive pipeline: it trains a candidate
            on (training + the latest validation drift window), evaluates vs the
            active model on the test split, and promotes only if
            <code className="mx-1 font-mono text-xs">new F1 ≥ old F1</code>
            AND
            <code className="mx-1 font-mono text-xs">new recall ≥ old recall</code>
            AND
            <code className="mx-1 font-mono text-xs">precision ≥ 0.95 × old</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-col gap-4 sm:flex-row sm:items-end">
            <div className="flex-1 space-y-1.5">
              <label className="text-xs font-medium text-foreground">Model to retrain</label>
              <Select value={selectedModel} onValueChange={setSelectedModel}>
                <SelectTrigger className="w-full sm:w-72">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {models.length > 0 ? (
                    models.map((m) => (
                      <SelectItem key={m.name} value={m.name}>{m.name}</SelectItem>
                    ))
                  ) : (
                    <SelectItem value="transaction_xgboost">transaction_xgboost</SelectItem>
                  )}
                </SelectContent>
              </Select>
            </div>

            <Dialog>
              <DialogTrigger asChild>
                <Button variant="default" disabled={retraining}>
                  {retraining ? (
                    <>
                      <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                      Retraining…
                    </>
                  ) : (
                    <>
                      <RotateCw className="size-4" aria-hidden="true" />
                      Retrain candidate
                    </>
                  )}
                </Button>
              </DialogTrigger>
              <DialogContent>
                <DialogHeader>
                  <DialogTitle>Confirm candidate retrain</DialogTitle>
                  <DialogDescription>
                    This will train a candidate version of{" "}
                    <code className="font-mono">{selectedModel}</code> on the training
                    set + the latest drift window. This may take a few seconds.
                    Promotion is automatic only if the candidate beats the active
                    model on F1, recall, and precision.
                  </DialogDescription>
                </DialogHeader>
                <DialogFooter>
                  <DialogClose asChild>
                    <Button variant="outline">Cancel</Button>
                  </DialogClose>
                  <DialogClose asChild>
                    <Button onClick={() => void doRetrain()}>
                      Confirm &amp; retrain
                    </Button>
                  </DialogClose>
                </DialogFooter>
              </DialogContent>
            </Dialog>
          </div>

          {retrainOutcome ? (
            <div className="mt-4 rounded-md border border-border bg-muted/30 p-4">
              <h4 className="text-sm font-semibold text-foreground">
                Retrain outcome: {retrainOutcome.outcome} (promoted={String(retrainOutcome.promoted)})
              </h4>
              <div className="mt-3 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
                <Metric label="Old F1" value={retrainOutcome.old_metrics.f1} />
                <Metric label="New F1" value={retrainOutcome.new_metrics.f1} />
                <Metric label="Δ F1" value={retrainOutcome.comparison.f1_delta} delta />
                <Metric label="Δ recall" value={retrainOutcome.comparison.recall_delta} delta />
                <Metric label="Old precision" value={retrainOutcome.old_metrics.precision} />
                <Metric label="New precision" value={retrainOutcome.new_metrics.precision} />
                <Metric label="Δ precision" value={retrainOutcome.comparison.precision_delta} delta />
                <Metric label="Precision ratio" value={retrainOutcome.comparison.precision_ratio} />
              </div>
              <div className="mt-3 text-xs text-muted-foreground">
                Candidate version: <code className="font-mono">{retrainOutcome.candidate_version}</code>{" "}
                · Event ID: <code className="font-mono">{retrainOutcome.event_id}</code>
              </div>
            </div>
          ) : null}
        </CardContent>
      </Card>

      <Disclaimer />
    </div>
  );
}

function Metric({
  label,
  value,
  delta,
}: {
  label: string;
  value: number;
  delta?: boolean;
}) {
  const positive = delta ? value >= 0 : true;
  return (
    <div className="rounded bg-background p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className={cn("font-semibold tabular-nums", delta && (positive ? "text-accent" : "text-destructive"))}>
        {delta && positive && value >= 0 ? "+" : ""}
        {fmtNumber(value, 4)}
      </div>
    </div>
  );
}

function useEffectOnce(fn: () => void) {
  useEffect(fn, []);
}

export default DriftMonitoring;

