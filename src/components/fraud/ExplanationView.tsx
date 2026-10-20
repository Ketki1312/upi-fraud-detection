"use client";

import { useState } from "react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import type {
  PredictionRow,
  TransactionExplanation,
  MessageExplanation,
} from "@/lib/types";
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  LoadingState,
  fmtDate,
  fmtPct,
  riskClass,
  useAsync,
} from "@/components/fraud/shared";
import { ContributionsChart } from "@/components/charts/ContributionsChart";
import { cn } from "@/lib/utils";

interface PredictionsResponse {
  predictions: PredictionRow[];
  count: number;
  total: number;
}

interface ExplanationResponse {
  prediction_id: string;
  method: string;
  payload: TransactionExplanation | MessageExplanation | null;
  human_readable: string | null;
  prediction: {
    id: string;
    input_type: "transaction" | "message";
    predicted_label: 0 | 1;
    probability: number;
    risk_score: number;
    risk_level: "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
    input_summary: string;
    model_version: string;
    language_detected: string | null;
    created_at: string;
  };
}

export function ExplanationView({
  initialPredictionId,
}: {
  initialPredictionId?: string;
} = {}) {
  const [selectedId, setSelectedId] = useState<string | undefined>(initialPredictionId);
  // Sync external `initialPredictionId` changes (e.g. user clicked a History row)
  // using React's "adjust state when a prop changes" pattern — no effect needed.
  const [prevInitialId, setPrevInitialId] = useState(initialPredictionId);
  if (initialPredictionId !== prevInitialId) {
    setPrevInitialId(initialPredictionId);
    setSelectedId(initialPredictionId);
  }

  const listAsync = useAsync<PredictionsResponse>(
    async () => {
      const res = await fetch("/api/v1/predictions?limit=100", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PredictionsResponse;
    },
    []
  );

  const predictions = listAsync.data?.predictions || [];

  // Auto-select the first prediction if none is selected yet. Same pattern.
  const effectiveSelectedId =
    selectedId ?? (predictions.length > 0 ? predictions[0].id : undefined);

  const detailAsync = useAsync<ExplanationResponse | null>(
    async () => {
      if (!effectiveSelectedId) return null;
      const res = await fetch(
        `/api/v1/explanations/${encodeURIComponent(effectiveSelectedId)}`,
        { cache: "no-store" }
      );
      if (res.status === 404) return null;
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as ExplanationResponse;
    },
    [effectiveSelectedId]
  );

  const detail = detailAsync.data;

  // Determine explanation kind for chart + labels.
  const isMessage =
    detail?.prediction?.input_type === "message" ||
    (detail?.payload && "tokens" in (detail.payload as Record<string, unknown>));

  const contributions = (() => {
    if (!detail?.payload) return [];
    if (isMessage) {
      const p = detail.payload as MessageExplanation;
      return (p.tokens || []).map((t) => ({ label: t.token, value: Number(t.weight) }));
    }
    const p = detail.payload as TransactionExplanation;
    return (p.contributions || []).map((c) => ({
      label: c.human_label || c.feature,
      value: Number(c.contribution),
      rawValue: c.value,
    }));
  })();

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Explanation View</h2>
        <p className="text-sm text-muted-foreground">
          Inspect SHAP (transactions) or LIME (messages) explanations for any past
          prediction. Select from the dropdown — data is read from Prisma SQLite.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-1">
          <CardHeader>
            <CardTitle className="text-base">Select a prediction</CardTitle>
            <CardDescription>{predictions.length} predictions available.</CardDescription>
          </CardHeader>
          <CardContent>
            {listAsync.loading ? (
              <LoadingState rows={4} />
            ) : listAsync.error ? (
              <ErrorState message={listAsync.error} onRetry={listAsync.refetch} />
            ) : predictions.length === 0 ? (
              <EmptyState />
            ) : (
              <Select
                value={effectiveSelectedId}
                onValueChange={(v) => setSelectedId(v)}
              >
                <SelectTrigger className="w-full">
                  <SelectValue placeholder="Choose a prediction…" />
                </SelectTrigger>
                <SelectContent className="max-h-80">
                  {predictions.map((p) => (
                    <SelectItem key={p.id} value={p.id}>
                      <span className="font-mono text-xs">{p.id.slice(0, 8)}</span>{" "}
                      · {p.input_type === "transaction" ? "TX" : "MSG"} ·{" "}
                      {p.risk_level}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            )}

            {detail ? (
              <div className="mt-4 space-y-2 text-xs">
                <div>
                  <span className="text-muted-foreground">Method:</span>{" "}
                  <Badge variant="outline" className="text-xs">
                    {detail.method?.toUpperCase() || (isMessage ? "LIME" : "SHAP")}
                  </Badge>
                </div>
                <div>
                  <span className="text-muted-foreground">Created:</span>{" "}
                  {fmtDate(detail.prediction.created_at)}
                </div>
                <div>
                  <span className="text-muted-foreground">Model:</span>{" "}
                  <code className="font-mono">{detail.prediction.model_version}</code>
                </div>
              </div>
            ) : null}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Prediction & explanation</CardTitle>
            <CardDescription>
              Visualisation of the SHAP / LIME contributions for the selected prediction.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!effectiveSelectedId ? (
              <EmptyState message="Select a prediction from the dropdown." />
            ) : detailAsync.loading ? (
              <LoadingState rows={3} />
            ) : detailAsync.error ? (
              <ErrorState message={detailAsync.error} onRetry={detailAsync.refetch} />
            ) : !detail ? (
              <EmptyState message="No explanation found for this prediction." />
            ) : (
              <div className="space-y-5">
                {/* Prediction summary */}
                <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Prediction</div>
                    <Badge
                      variant={detail.prediction.predicted_label === 1 ? "destructive" : "secondary"}
                      className="mt-1 text-sm"
                    >
                      {detail.prediction.predicted_label === 1
                        ? detail.prediction.input_type === "transaction" ? "Fraud" : "Scam"
                        : "Legitimate"}
                    </Badge>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Probability</div>
                    <div className="mt-1 font-semibold tabular-nums">
                      {fmtPct(detail.prediction.probability)}
                    </div>
                  </div>
                  <div>
                    <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk</div>
                    <Badge variant="outline" className={cn("mt-1 text-sm", riskClass(detail.prediction.risk_level))}>
                      {detail.prediction.risk_score} · {detail.prediction.risk_level}
                    </Badge>
                  </div>
                  {detail.prediction.language_detected ? (
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Language</div>
                      <div className="mt-1 text-sm font-medium">{detail.prediction.language_detected}</div>
                    </div>
                  ) : null}
                </div>

                {/* Input summary */}
                <div className="rounded-md border border-border bg-muted/30 p-3">
                  <div className="text-xs uppercase tracking-wider text-muted-foreground">Input summary</div>
                  <div className="mt-1 text-sm">{detail.prediction.input_summary}</div>
                </div>

                {/* Contributions chart */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    {isMessage ? "Top LIME tokens" : "Top SHAP contributions"}
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Red bars push toward {isMessage ? "scam" : "fraud"}; green bars push toward legitimate.
                    {isMessage ? " LIME weights describe model contributions, not causal effects." : " SHAP values describe model contributions, not causal effects."}
                  </p>
                  {contributions.length === 0 ? (
                    <EmptyState message="No contributions returned for this prediction." />
                  ) : (
                    <ContributionsChart
                      items={contributions}
                      kind={isMessage ? "message" : "transaction"}
                      height={320}
                    />
                  )}
                </div>

                {/* Human-readable text */}
                {detail.human_readable ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-sm text-foreground">
                    <div className="mb-1 text-xs uppercase tracking-wider text-muted-foreground">
                      Human-readable summary
                    </div>
                    {detail.human_readable}
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Disclaimer />
    </div>
  );
}

export default ExplanationView;
