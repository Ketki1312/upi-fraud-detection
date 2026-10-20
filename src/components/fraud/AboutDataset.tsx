"use client";

import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Disclaimer, EmptyState, ErrorState, LoadingState, fmtDate, fmtNumber, fmtPct, useAsync } from "@/components/fraud/shared";
import type { DashboardSummary } from "@/lib/types";

type Summary = DashboardSummary;

export function AboutDataset() {
  const async_ = useAsync<Summary>(
    async () => {
      const res = await fetch("/api/v1/dashboard/summary", { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as Summary;
    },
    []
  );

  const data = async_.data;
  const datasets = data?.datasets_summary || {};

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">About & Dataset Provenance</h2>
        <p className="text-sm text-muted-foreground">
          Honest disclosure of every dataset used to train the models in this
          prototype. None of these datasets are real UPI banking data, and no
          causal transaction–message relationship is claimed.
        </p>
      </div>

      <Disclaimer />

      {/* Architecture diagram (ASCII boxes) */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Architecture</CardTitle>
          <CardDescription>
            Single-page Next.js app (port 3000) ↔ Next.js API routes ↔ Python
            FastAPI ML service (port 4000) + Prisma SQLite.
          </CardDescription>
        </CardHeader>
        <CardContent>
          <pre className="overflow-x-auto rounded-md border border-border bg-muted/40 p-4 font-mono text-[11px] leading-relaxed text-muted-foreground">
{`┌─────────────────────────────────────────────────────────────────────┐
│   Browser  (single page / route) — Next.js 16 App Router           │
│   - shadcn/ui tabs: Dashboard, TX, MSG, Unified, Explanation,      │
│     Drift, Models, History, About                                    │
│   - recharts + custom SVG (Plotly-equivalent, SSR-safe)             │
└────────────────────────────────┬────────────────────────────────────┘
                                 │ relative fetches to /api/v1/*
                                 ▼
┌─────────────────────────────────────────────────────────────────────┐
│   Next.js API routes  (server-side, no 'use client')                │
│   /api/v1/health                                                     │
│   /api/v1/transactions/analyze  /api/v1/messages/analyze             │
│   /api/v1/risk/analyze          /api/v1/predictions[?...]            │
│   /api/v1/explanations/[id]    /api/v1/dashboard/(summary|trends)   │
│   /api/v1/drift/(status|history)   /api/v1/models[/retrain]         │
│   - persist: Prediction, Explanation, RiskAssessment, DriftEvent    │
│   - calls Python ML service via server-side fetch                    │
└──────────────┬─────────────────────────────────────┬─────────────────┘
               │ http://localhost:4000 (server)        │ Prisma (SQLite)
               ▼                                       ▼
┌──────────────────────────────────┐  ┌────────────────────────────────┐
│ Python FastAPI ML service (:4000) │  │ Prisma SQLite (db/custom.db)    │
│ - XGBoost / LR / RF (transactions)│  │ - Transaction, Message         │
│ - TF-IDF + LR per language (NLP)  │  │ - Prediction, Explanation      │
│ - SHAP TreeExplainer (XAI)        │  │ - RiskAssessment, DriftEvent   │
│ - LIME LimeTextExplainer (XAI)    │  │ - ModelVersion, ModelMetric    │
│ - PSI drift engine (drift)        │  │ - SystemEvent, DatasetAudit    │
│ - adaptive candidate retrain      │  └────────────────────────────────┘
│ - real artifacts in models/      │
└──────────────────────────────────┘
`}
          </pre>
        </CardContent>
      </Card>

      {/* Dataset audit summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Dataset audit summary</CardTitle>
          <CardDescription>
            Pulled live from <code className="font-mono text-xs">/api/v1/dashboard/summary</code>,
            which itself merges ML service metadata from{" "}
            <code className="font-mono text-xs">metadata/dataset_audit.json</code>.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={3} />
          ) : async_.error ? (
            <ErrorState message={async_.error} onRetry={async_.refetch} />
          ) : !data || Object.keys(datasets).length === 0 ? (
            <EmptyState message="Dataset audit unavailable — is the ML service running?" />
          ) : (
            <div className="space-y-4">
              <DatasetCard name="PaySim" ds={datasets.PaySim} />
              <DatasetCard name="Hindi" ds={datasets.Hindi} />
              <DatasetCard name="Hinglish" ds={datasets.Hinglish} />
              <DatasetCard name="English" ds={datasets.English} />
            </div>
          )}
        </CardContent>
      </Card>

      {/* Model metrics overview */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Trained models overview</CardTitle>
          <CardDescription>
            Real F1 / precision / recall from the ML service (training-time
            evaluation on held-out test splits).
          </CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={3} />
          ) : !data || data.model_metrics.length === 0 ? (
            <EmptyState message="No model metrics available." />
          ) : (
            <ul className="space-y-2 text-sm">
              {data.model_metrics.map((m) => (
                <li
                  key={m.name}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-border bg-muted/30 p-3"
                >
                  <div className="flex items-center gap-2">
                    {m.active ? (
                      <Badge variant="outline" className="text-xs risk-low">active</Badge>
                    ) : null}
                    <code className="font-mono text-xs">{m.name}</code>
                    <span className="text-xs text-muted-foreground">v{m.version}</span>
                  </div>
                  <div className="text-xs text-muted-foreground">
                    F1 <span className="font-mono text-foreground">{fmtNumber(m.metrics.f1)}</span>{" "}
                    · P <span className="font-mono text-foreground">{fmtNumber(m.metrics.precision)}</span>{" "}
                    · R <span className="font-mono text-foreground">{fmtNumber(m.metrics.recall)}</span>{" "}
                    · ROC-AUC <span className="font-mono text-foreground">{fmtNumber(m.metrics.roc_auc)}</span>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </CardContent>
      </Card>

      {/* Drift summary */}
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Drift summary</CardTitle>
          <CardDescription>
            Latest drift + adaptive retrain events recorded by the ML service.
          </CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={2} />
          ) : !data ? (
            <EmptyState />
          ) : (
            <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-3">
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Reference features</div>
                <div className="mt-1 font-semibold tabular-nums">
                  {data.drift_summary.reference_features_count}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Total drift events</div>
                <div className="mt-1 font-semibold tabular-nums">
                  {data.drift_summary.total_events}
                </div>
              </div>
              <div>
                <div className="text-xs uppercase tracking-wider text-muted-foreground">Per-feature status</div>
                <div className="mt-1 font-semibold tabular-nums">
                  {data.drift_status_summary.no_drift} stable · {data.drift_status_summary.watch} watch · {data.drift_status_summary.drift_detected} drift
                </div>
              </div>
              {data.drift_summary.latest_event ? (
                <div className="col-span-2 sm:col-span-3 rounded-md border border-border bg-muted/30 p-3 text-xs">
                  <div className="font-semibold">Latest retrain event</div>
                  <div className="mt-1 text-muted-foreground">
                    {data.drift_summary.latest_event.model_name} · {data.drift_summary.latest_event.outcome} ·{" "}
                    promoted={String(data.drift_summary.latest_event.promoted)} · {fmtDate(data.drift_summary.latest_event.created_at)}
                  </div>
                  <div className="mt-1 text-muted-foreground">
                    F1 delta {fmtNumber(data.drift_summary.latest_event.comparison?.f1_delta ?? 0, 4)} ·{" "}
                    old F1 {fmtNumber(data.drift_summary.latest_event.old_metrics?.f1 ?? 0)} ·{" "}
                    new F1 {fmtNumber(data.drift_summary.latest_event.new_metrics?.f1 ?? 0)}
                  </div>
                </div>
              ) : null}
            </div>
          )}
        </CardContent>
      </Card>

      {/* Disclaimer — repeated for emphasis */}
      <Card className="border-destructive/30 bg-destructive/5">
        <CardHeader>
          <CardTitle className="text-base text-destructive">Research prototype disclaimer</CardTitle>
        </CardHeader>
        <CardContent className="text-sm text-foreground">
          <p className="mb-2">
            This is an academic research prototype and decision-support tool. It
            does not replace bank, UPI provider, or law-enforcement fraud
            prevention systems. No causal transaction–message relationship is
            claimed.
          </p>
          <ul className="ml-4 list-disc space-y-1 text-xs text-muted-foreground">
            <li>PaySim is a public mobile-money simulator — NOT real UPI banking data.</li>
            <li>Hindi and Hinglish datasets are <span className="font-medium">synthetic</span> (marked source=Synthetic).</li>
            <li>English SMS Spam Collection is the public UCI dataset, auto-downloaded by train.py at training time.</li>
            <li>SHAP / LIME / PSI / adaptive-retrain outputs all come from real algorithms on real data — none are hardcoded.</li>
            <li>
              Per-language model metrics disclosed honestly: nlp_hi F1=1.000
              (4-template test set memorisation), nlp_hinglish F1=0.65
              (template-scarcity limited), nlp_en F1=0.91 (UCI SMS Spam),
              nlp_combined F1=0.33 (Hindi/Hinglish scarcity drags it down).
            </li>
          </ul>
        </CardContent>
      </Card>
    </div>
  );
}

interface DatasetSummary {
  available?: boolean;
  rows?: number;
  train_rows?: number;
  test_rows?: number;
  validation_rows?: number;
  fraud_rate_train?: number;
  provenance?: {
    source?: string;
    disclaimer?: string;
    url?: string;
    local_file?: string;
    preprocessing?: Record<string, unknown>;
  };
}

function DatasetCard({ name, ds }: { name: string; ds: DatasetSummary | undefined }) {
  if (!ds) {
    return (
      <div className="rounded-md border border-dashed border-border p-3 text-sm text-muted-foreground">
        <span className="font-medium">{name}:</span> not available.
      </div>
    );
  }
  const rowCount = ds.rows ?? ds.train_rows ?? 0;
  return (
    <div className="rounded-md border border-border bg-muted/30 p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <h4 className="text-sm font-semibold text-foreground">{name}</h4>
        <Badge variant="outline" className="text-xs">
          {ds.available === false ? "not available" : `${fmtNumber(rowCount)} rows`}
        </Badge>
      </div>
      <div className="mt-2 grid grid-cols-2 gap-3 text-xs sm:grid-cols-4">
        {ds.train_rows ? <Stat label="Train" value={fmtNumber(ds.train_rows)} /> : null}
        {ds.validation_rows ? <Stat label="Validation" value={fmtNumber(ds.validation_rows)} /> : null}
        {ds.test_rows ? <Stat label="Test" value={fmtNumber(ds.test_rows)} /> : null}
        {ds.fraud_rate_train !== undefined ? (
          <Stat label="Train fraud rate" value={fmtPct(ds.fraud_rate_train, 3)} />
        ) : null}
      </div>
      {ds.provenance ? (
        <div className="mt-3 space-y-1 text-xs text-muted-foreground">
          {ds.provenance.source ? (
            <div>
              <span className="font-medium text-foreground">Source:</span> {ds.provenance.source}
            </div>
          ) : null}
          {ds.provenance.disclaimer ? (
            <div className="rounded bg-background p-2 italic">{ds.provenance.disclaimer}</div>
          ) : null}
          {ds.provenance.url ? (
            <div>
              <span className="font-medium text-foreground">URL:</span>{" "}
              <a
                href={ds.provenance.url}
                target="_blank"
                rel="noopener noreferrer"
                className="text-primary underline"
              >
                {ds.provenance.url}
              </a>
            </div>
          ) : null}
          {ds.provenance.local_file ? (
            <div>
              <span className="font-medium text-foreground">Local file:</span>{" "}
              <code className="font-mono text-[11px]">{ds.provenance.local_file}</code>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function Stat({ label, value }: { label: string; value: string }) {
  return (
    <div className="rounded bg-background p-2">
      <div className="text-muted-foreground">{label}</div>
      <div className="font-semibold tabular-nums">{value}</div>
    </div>
  );
}

export default AboutDataset;
