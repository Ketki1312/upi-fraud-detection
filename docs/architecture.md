# Architecture

> Companion to the top-level [README](../README.md). This document covers the
> system's layering, component responsibilities, data flow for each major
> operation, and the rationale for the stack adaptation.

## High-Level Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser  ── Next.js 16 single-page app  (port 3000)                    │
│   • 9 tabbed views, shadcn/ui + Tailwind 4                            │
│   • Recharts + custom SVG (Plotly-equivalent, SSR-safe)               │
│   • next-themes light/dark                                            │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  fetch /api/v1/*        (client → server, same origin)
               │
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Next.js API routes  (port 3000)                                       │
│   • Input validation (TypeScript + Zod-style hand-rolled checks)       │
│   • Prisma persistence to SQLite (db/custom.db)                       │
│   • Server-side fetch to Python ML service (port 4000)                │
│   • 12 endpoints under /api/v1 + /api/v1/health                        │
└──────────┬───────────────────────────────────────────┬─────────────────┘
            │                                           │
            │ HTTP localhost:4000                       │ Prisma client
            │  (server-side, no CORS exposure           │
            │   to the browser)                          │
            ▼                                           ▼
┌──────────────────────────────────────┐   ┌────────────────────────────┐
│  Python FastAPI ML service  :4000    │   │  Prisma SQLite              │
│                                       │   │   db/custom.db              │
│   • XGBoost / LR / RF                 │   │                             │
│   • TF-IDF + LR (hi / hinglish /      │   │   10 core tables:           │
│     en / combined)                    │   │    User, Transaction,       │
│   • SHAP TreeExplainer (XGBoost),     │   │    Message, Prediction,    │
│     KernelExplainer fallback (LR/RF)  │   │    Explanation,             │
│   • LIME LimeTextExplainer            │   │    RiskAssessment,         │
│   • PSI drift_engine                  │   │    DriftEvent, ModelVersion,│
│   • adaptive retrain +               │   │    ModelMetric, SystemEvent │
│     promotion rule                    │   │   (+ DatasetAudit           │
│   • Lazy in-memory model cache        │   │      informational table)   │
│     with threading.Lock               │   │                             │
└──────────────────────────────────────┘   └────────────────────────────┘
```

The browser never talks to the Python ML service directly — the Next.js
API routes act as the single integration boundary, which keeps the
explanation, prediction and drift-event payloads in a consistent shape
and lets the persistence layer own the canonical prediction IDs.

## Layer Responsibilities

### 1. Frontend — Next.js 16 + TypeScript + Tailwind 4 + shadcn/ui

- **Single-page application** mounted at `/` (a sandbox constraint).
- Nine tabs cover the 13 required views (some views share a tab; e.g. the
  Explanation tab covers both the dropdown selection and the per-prediction
  drill-down from History).
- **Tab components** live in `src/components/fraud/`:
  `Dashboard`, `TransactionAnalyzer`, `ScamMessageAnalyzer`,
  `UnifiedRiskAnalysis`, `ExplanationView`, `DriftMonitoring`,
  `ModelPerformance`, `PredictionHistory`, `AboutDataset`.
- **Charts**: `RiskGauge` (SVG circular gauge), `ContributionsChart`
  (horizontal SHAP/LIME bar), `SimpleBarChart` / `SimpleLineChart` /
  `SimplePieChart` (Recharts wrappers using CSS design tokens).
- **Layout**: `Sidebar` (256px desktop, Sheet on mobile), `Header`
  (sticky, with ML-service status pill that polls `/api/v1/health` every
  30s, theme toggle), `Footer` (sticky, with the research-prototype
  disclaimer).
- **Theme**: `next-themes` `attribute="class"`, default `system`,
  `enableSystem`, `disableTransitionOnChange`. Light + dark palettes match
  the docx design palette (burnt-orange primary, green accent, red
  destructive).

### 2. API bridge — Next.js API routes

- 13 route handlers under `src/app/api/v1/` plus `/health`, all declared
  `export const dynamic = "force-dynamic"` and `revalidate = 0` so
  dashboard numbers never cache.
- All routes are server-only (no `'use client'`). They:
  1. validate the request body with hand-rolled TypeScript validators that
     match the Pydantic schemas in the ML service;
  2. proxy to `http://localhost:4000/api/v1/...` through `src/lib/mlClient.ts`
     (typed fetch with `cache: "no-store"` and a 30s `AbortController`
     timeout — 120s for `retrain`);
  3. persist to Prisma SQLite (Prediction, Transaction, Message,
     Explanation, RiskAssessment, DriftEvent, SystemEvent) using the
     shared `db` client from `src/lib/db.ts`;
  4. return the analysis result enriched with the canonical Prisma
     `prediction_id` so the UI can deep-link into the Explanation tab.
- The proxying uses the sandbox's `?XTransformPort=4000` query parameter
  on the server side. The browser never sees this — it talks only to
  Next.js, which keeps the Python service off the public origin.

### 3. ML service — Python FastAPI on port 4000

Located in `mini-services/ml-service/`. Python 3.10+ with scikit-learn
1.5.2, XGBoost 2.1.3, SHAP 0.52.0, LIME, pandas, numpy, joblib, scipy,
fastapi, uvicorn.

Files and their roles:

| File | Responsibility |
|---|---|
| `index.py` | FastAPI app. 13 endpoints. Loads all trained pipelines into an in-memory cache (with a `threading.Lock`) at startup. |
| `train.py` | Trains 3 transaction models (LR / RF / XGBoost) and 4 NLP models (hi / hinglish / en / combined) on the supplied data; saves `models/*.joblib` pipelines and `metadata/{transaction_models,nlp_models,drift_reference,dataset_audit}.json`. Exposes helpers (`load_paysim_split`, `compute_classification_metrics`, `TX_FEATURES`) reused by `adaptive.py` and `index.py`. |
| `audit.py` | Reads every input dataset, computes row counts, duplicates (exact + normalized), missing values, label/category distributions per dataset; writes `metadata/dataset_audit.{json,md}`. |
| `risk_engine.py` | Maps a fraud probability to a 0–100 risk score and a `LOW / MEDIUM / HIGH / CRITICAL` level; fuses transaction + message probabilities via `max` or `weighted` method. Exposes the `DISCLAIMER` constant. |
| `xai_engine.py` | `TransactionExplainer` uses `shap.TreeExplainer` for XGBoost (falls back to `KernelExplainer` for LR/RF). `MessageExplainer` uses `lime.lime_text.LimeTextExplainer`. Wording rule: "contributed to the model's prediction" — never causal. |
| `drift_engine.py` | Quantile-binned Population Stability Index. `build_reference_distribution` saves 10-quantile-bin edges + reference percentages per numeric feature. `evaluate_drift` applies the same edges to a current dataframe and returns per-feature PSI + status (`NO_DRIFT` / `WATCH` / `DRIFT_DETECTED`). |
| `adaptive.py` | `prepare_candidate_retraining` retrains a `2.0.0-candidate` model on training + drift-window data; `evaluate_candidate` compares it against the active model on the test split and applies the promotion rule (`new_f1 ≥ old_f1 AND new_recall ≥ old_recall AND new_precision ≥ 0.95 × old_precision`). Promotes, archives old as `_v{old}.joblib`, or rejects and archives as `_rejected_<ts>.joblib`. |
| `data/raw/` | Input datasets (read-only). `paysim/` (train/val/test CSV + `preprocessing_metadata.json`), `messages/` (hindi / hinglish CSV), `english/` (UCI SMS Spam CSV written by `train.py`). |
| `models/` | Trained `.joblib` pipelines. The active transaction model is `transaction_xgboost.joblib`; rejected candidates are archived with a timestamp suffix. |
| `metadata/` | Audit + model metrics + drift reference + drift history (append-only JSON). |

The service loads all model pipelines eagerly at startup. The in-memory
cache is keyed by model name (`transaction_xgboost`, `transaction_lr`,
`transaction_rf`, `nlp_hi`, `nlp_hinglish`, `nlp_en`, `nlp_combined`)
plus a `shap_background.joblib` of 100 legitimate PaySim rows used by the
`KernelExplainer` fallback.

### 4. Database — Prisma SQLite

- File: `db/custom.db`. Schema in `prisma/schema.prisma` (SQLite provider,
  but PostgreSQL-equivalent logical model so the project can be lifted to
  Postgres unchanged by editing only the `datasource` block).
- **10 core tables**:
  - `User` — analyst identity (not wired to authentication in the
    prototype; placeholder for future auth).
  - `Transaction` — raw transaction input + derived features stored as
    JSON.
  - `Message` — raw message input + detected language + label-known
    (for evaluation rows).
  - `Prediction` — canonical prediction row, links to Transaction /
    Message / User, with model version, predicted label, probability,
    risk score (0–100), risk level, input summary.
  - `Explanation` — one row per prediction; JSON payload (SHAP
    contributions or LIME tokens) + pre-rendered human-readable text.
  - `RiskAssessment` — unified-risk row linked to a prediction (used by
    the `/api/v1/risk/analyze` flow).
  - `DriftEvent` — per-retrain-event row written when
    `/api/v1/drift/history` is fetched and when `/api/v1/models/retrain`
    is invoked. Idempotent by event id.
  - `ModelVersion` — every model's current version + active flag +
    status (`active | candidate | previous | archived`) + metrics JSON
    + hyperparameters JSON + feature-list JSON.
  - `ModelMetric` — historical metric rows per ModelVersion (one row
    per retrain so the dashboard can plot a metric timeline).
  - `SystemEvent` — system log (info / warning / error / drift / retrain
    / promote) used for the retrain action audit trail.
- An additional **`DatasetAudit`** table is defined in the schema for
  informational snapshots of dataset stats; it is not actively written
  by the current API routes.

## Data Flow — Major Operations

### A. Transaction analyze (`POST /api/v1/transactions/analyze`)

```
Browser (TransactionAnalyzer form)
   │  POST {step, type, amount, oldbalanceOrg, newbalanceOrig,
   │        oldbalanceDest, newbalanceDest}
   ▼
Next.js route  src/app/api/v1/transactions/analyze/route.ts
   │  1. Validate input (7 required fields; type ∈ {CASH_IN,CASH_OUT,
   │      DEBIT,PAYMENT,TRANSFER})
   │  2. deriveTransactionFeatures() — compute 4 derived features locally
   │      so the DB stores them
   │  3. summarizeTransaction() + buildHumanReadable() for the DB row
   │  4. mlClient.analyzeTransaction()  →  POST localhost:4000/api/v1/transactions/analyze
   ▼
FastAPI  index.py::analyze_transaction
   │  1. derive_transaction_features(tx)  →  14-feature PaySim row
   │  2. pipeline.predict_proba()  →  P(fraud)
   │  3. risk_engine.transaction_risk_score(prob)  →  (score, level)
   │  4. TransactionExplainer(pipeline).explain(X)  →  SHAP contributions
   │     (TreeExplainer on XGBoost; KernelExplainer fallback for LR/RF)
   │     →  top 5 positive + top 5 negative contributions + human_summary
   ▼
Next.js route (continuation)
   │  5. Persist to Prisma:
   │      • Transaction row (raw + derived features JSON)
   │      • Prediction row (model_version, label, prob, risk_score, level,
   │        input_summary)
   │      • Explanation row (method="shap", payload=JSON, humanReadable=text)
   │      • RiskAssessment row (transaction_risk=score, unified_risk=score)
   │  6. Return analysis + prediction_id
   ▼
Browser — RiskGauge, prediction badge, model version, top SHAP contributions chart
```

### B. Message analyze (`POST /api/v1/messages/analyze`)

```
Browser (ScamMessageAnalyzer form)
   │  POST {text, language?}
   ▼
Next.js route  src/app/api/v1/messages/analyze/route.ts
   │  1. Validate (text non-empty string; language optional)
   │  2. mlClient.analyzeMessage()  →  POST localhost:4000/api/v1/messages/analyze
   ▼
FastAPI  index.py::analyze_message
   │  1. If language not provided → detect_language(text)
   │     (Devanagari → hi; Hinglish token regex → hinglish; default → en)
   │  2. Pick model: nlp_hi / nlp_hinglish / nlp_en; fallback nlp_combined
   │  3. pipeline.predict_proba([text])  →  P(scam)
   │  4. risk_engine.message_risk_score(prob)  →  (score, level)
   │  5. MessageExplainer(pipeline).explain(text, num_features=10)
   │     (LIME perturbs the input, fits a local linear model on TF-IDF
   │      features, returns top 10 tokens with weights + detected
   │      linguistic signals — OTP, URL, currency, urgency)
   ▼
Next.js route (continuation)
   │  6. Persist:
   │      • Message row (text, language, source)
   │      • Prediction row
   │      • Explanation row (method="lime", payload=JSON, humanReadable)
   │      • RiskAssessment row (message_risk=score, unified_risk=score)
   │  7. Return analysis + prediction_id
   ▼
Browser — RiskGauge, prediction, language detected, signal badges,
            top LIME tokens chart
```

### C. Risk analyze (`POST /api/v1/risk/analyze`)

```
Browser (UnifiedRiskAnalysis — toggles between transaction + message sub-forms)
   │  POST {transaction?, message?, transaction_probability?,
   │        message_probability?, fusion_method?}
   ▼
Next.js route  src/app/api/v1/risk/analyze/route.ts
   │  1. Validate
   │  2. mlClient.analyzeRisk()  →  POST localhost:4000/api/v1/risk/analyze
   │     Also fires analyzeTransaction + analyzeMessage to fetch explanations
   │     and per-input risk scores (so the UI can show the breakdown)
   ▼
FastAPI  index.py::analyze_risk
   │  1. If pre-computed probabilities absent, run the corresponding
   │     transaction / message model on the raw input
   │  2. build_risk_response(tx_prob, msg_prob, method)
   │     • max fusion → max(tx_prob, msg_prob) × 100
   │     • weighted fusion → w_tx · tx_prob + w_msg · msg_prob (weights
   │       derived from risk_level)
   │  3. Returns unified_risk_score, risk_level, transaction_risk,
   │     message_risk, fusion_method, disclaimer
   ▼
Next.js route (continuation)
   │  3. Persist:
   │     • Transaction row + Prediction row + Explanation (if transaction provided)
   │     • Message row + Prediction row + Explanation (if message provided)
   │     • A single RiskAssessment row linked to the message prediction
   │       (preferred) or the transaction prediction
   │     • SystemEvent row recording the unified assessment
   │  4. Return unified response + prediction_id
   ▼
Browser — unified RiskGauge, risk_level, fusion_method,
            per-input risk breakdown (score + level + probability each)
```

### D. Retrain (`POST /api/v1/models/retrain`)

```
Browser (DriftMonitoring — model selector + confirm Dialog → Retrain)
   │  POST {model_name, drift_window?}
   ▼
Next.js route  src/app/api/v1/models/retrain/route.ts
   │  1. Validate model_name ∈ supported set
   │  2. mlClient.retrainModel() with a 120s timeout budget
   ▼
FastAPI  index.py::retrain_endpoint
   │  1. adaptive.prepare_candidate_retraining(model_name, drift_window)
   │     • For transaction models: load train + (drift_window rows from
   │       validation/test, e.g. steps 521–631) → retrain XGBoost/LR/RF
   │       → save models/{stem}_candidate.joblib
   │     • For NLP models: retrain on train+validation combined
   │  2. adaptive.evaluate_candidate(model_name)
   │     • Load active + candidate pipelines, evaluate both on test split
   │     • Promotion rule:
   │         new_f1   ≥ old_f1   AND
   │         new_recall ≥ old_recall AND
   │         new_precision ≥ 0.95 × old_precision
   │     • Promote: archive old as _v{old}.joblib, rename candidate to
   │       active, bump version (1.0.0 → 2.0.0), update metadata JSON,
   │       reload in-memory model cache
   │     • Reject: archive candidate as _rejected_<ts>.joblib
   │  3. Append event to metadata/drift_history.json
   ▼
Next.js route (continuation)
   │  3. Persist:
   │     • SystemEvent row (event_type="retrain" or "promote",
   │       message with old/new F1 deltas)
   │     • DriftEvent row (action_taken="promoted" or "rejected")
   │  4. Return outcome + comparison deltas
   ▼
Browser — outcome card showing old vs new F1/precision/recall, delta
            colored green/red, "promoted" or "rejected" badge
```

## Why This Stack

The original reference specification called for **FastAPI + PostgreSQL +
React (Vite)**. The sandbox in which this prototype runs is locked to
**Next.js 16 + Prisma SQLite + a single user-visible `/` route**, with a
Python mini-service allowed as a side process. The adaptation is:

| Original spec | Sandbox adaptation | Justification |
|---|---|---|
| FastAPI (port 8000, monolith) | FastAPI mini-service on port 4000 behind the Next.js API routes | Keeps the FastAPI service — and therefore all the Python ML libraries (sklearn / xgboost / shap / lime) — in a process where they can be installed via `pip`, while the Next.js side owns the user-facing HTTP surface. The browser never talks to FastAPI directly. |
| PostgreSQL | Prisma SQLite (`db/custom.db`) | The Prisma schema is PostgreSQL-equivalent (same model definitions, same relation cardinalities). Only the `datasource` block differs. Switching back to PostgreSQL is a one-line change once outside the sandbox. |
| React (Vite) | Next.js 16 App Router single page | Sandbox constraint: only one user-visible route (`/`) is allowed. The 13 required views are collapsed into 9 tabbed sections on a single page. Server-side rendering + API routes in the same project let us keep the persistence layer TypeScript-only and avoid a separate Node server. |
| Plotly | Recharts + custom SVG | Plotly does not play well with Next.js SSR (window/document globals). Recharts is SSR-safe, and the custom `RiskGauge` (SVG) and `ContributionsChart` give the same visual quality for the dashboard widgets we need. |

Everything else in the spec — SHAP, LIME, PSI, candidate-vs-active
promotion, drift-event persistence, model versioning — is implemented
exactly as specified; only the HTTP container, the SQL dialect and the
charting library were adapted to the sandbox.
