# Adaptive, Explainable and Multilingual AI System for Detecting UPI Fraud and Financial Scams

> **Research prototype.** This is an academic demonstration of an end-to-end
> fraud-detection pipeline. It is **not** banking-grade software and must not
> be used to make live decisions about real UPI transactions. See
> [Limitations](#limitations) and [Disclaimer](#disclaimer).

## Overview

This project implements a complete, end-to-end research prototype for
detecting fraudulent UPI-style financial transactions and multilingual
scam/phishing messages (English, Hindi, Hinglish). It combines three
machine-learning model families — gradient-boosted trees for transaction
fraud, TF-IDF + logistic regression for message scam classification, and a
unified risk-fusion layer — with two complementary explainability techniques
(SHAP for transactions, LIME for messages), a Population Stability Index
(PSI) based concept-drift detector, and an adaptive-retraining loop that
promotes candidate models only when they pass a non-regression promotion
rule.

The prototype is built on three intentionally public/synthetic datasets so
that every claim can be reproduced and audited: the **PaySim** public
mobile-money simulator for transactions (a public, simulator-derived
dataset — **not** real UPI banking data), a small set of **synthetic
Hindi and Hinglish** SMS templates, and the public **UCI SMS Spam
Collection** for English. All provenance is disclosed in the UI footer and
on the About / Dataset tab. Every prediction, risk score, SHAP value, LIME
weight, PSI value and model metric shown in the dashboard comes from a
real model inference on real data — nothing is hardcoded.

## Problem Statement

UPI (Unified Payments Interface) has become the dominant retail-payment
rail in India. The same frictionless design that benefits legitimate users
also benefits fraudsters: social-engineering scams (fake KYC, OTP, refund,
customer-care, electricity-bill, UPI-request fraud) are typically delivered
as multilingual SMS / WhatsApp messages that lure the victim into
initiating or authorising a fraudulent transaction. A bank, fintech or
regulator needs three capabilities to defend against this:

1. **Detect** suspicious transactions **and** suspicious messages, in the
   languages the victim actually speaks.
2. **Explain** every prediction in human-readable terms so an analyst (or
   the user) can decide whether to block, hold or allow.
3. **Adapt** as fraud patterns drift over time, without silently
   regressing on previously handled cases.

## Objectives

| # | Objective | Implemented In |
|---|---|---|
| 1 | Detect fraudulent UPI-style financial transactions | `mini-services/ml-service/` XGBoost + SHAP + `/api/v1/transactions/analyze` |
| 2 | Detect scam / phishing messages | `mini-services/ml-service/` TF-IDF + LR + LIME + `/api/v1/messages/analyze` |
| 3 | Multilingual support (English, Hindi, Hinglish) | Per-language TF-IDF + LR + combined multilingual model with auto language detection |
| 4 | Standardised 0–100 risk score + risk level | `risk_engine.py` + `/api/v1/risk/analyze` (max / weighted fusion) |
| 5 | Human-readable explanations | `xai_engine.py` (SHAP TreeExplainer + LIME LimeTextExplainer) |
| 6 | Concept-drift detection | `drift_engine.py` (real PSI) + `/api/v1/drift/status` and `/api/v1/drift/history` |
| 7 | Adaptive model updating / retraining | `adaptive.py` + `/api/v1/models/retrain` (candidate vs active, promote-on-criteria only) |
| 8 | Web dashboard | Next.js single-page app (9 tabs, 13 required views) at `/` |
| 9 | Persist predictions, analyses, risk scores, drift events | Prisma SQLite — `Prediction`, `Transaction`, `Message`, `Explanation`, `RiskAssessment`, `DriftEvent`, `ModelVersion`, `ModelMetric`, `SystemEvent`, `User` |
| 10 | Compare static vs adaptive models | `ModelVersion` table + Model Performance tab + drift history timeline |
| 11 | Trained models, pipelines, evaluation results, documentation | `mini-services/ml-service/models/`, `mini-services/ml-service/metadata/`, `docs/*.md`, this README |
| 12 | Research-prototype disclaimer | Footer of every page + About tab |
| 13 | No hardcoded predictions / dashboard stats | All numbers come from real model inference or Prisma queries |
| 14 | Real SHAP / LIME, not dummy | `shap.TreeExplainer` for XGBoost, `lime.lime_text.LimeTextExplainer` for messages |
| 15 | Real PSI, not dummy | Quantile-binned PSI from `drift_engine.py` |
| 16 | Light / dark mode + orange/green/red palette | `src/app/globals.css` with `next-themes` |
| 17 | Dataset provenance disclosed | About tab + [docs/dataset.md](docs/dataset.md) |

## System Architecture

```
┌────────────────────────────────────────────────────────────────────────┐
│  Browser  ── Next.js 16 single-page app  (port 3000)                    │
│   • 9 tabbed views, shadcn/ui + Tailwind 4                              │
│   • Recharts + custom SVG (Plotly-equivalent)                           │
└──────────────┬─────────────────────────────────────────────────────────┘
               │  fetch  /api/v1/*   (server-side Next.js API routes)
               │
┌──────────────▼─────────────────────────────────────────────────────────┐
│  Next.js API routes  (port 3000)                                       │
│   • Input validation, persistence (Prisma), proxy to ML service       │
│   • 12 endpoints under /api/v1 + /api/v1/health                         │
└──────────┬───────────────────────────────────┬─────────────────────────┘
           │                                   │
           │ HTTP (server-side,                │ Prisma client
           │  ?XTransformPort=4000)             │
           ▼                                   ▼
┌──────────────────────────────┐    ┌────────────────────────────────────┐
│  Python FastAPI ML service   │    │  Prisma SQLite                      │
│   (port 4000)                │    │   db/custom.db                      │
│   • XGBoost / LR / RF        │    │   10 core tables:                   │
│   • TF-IDF + LR (per-lang)   │    │   User, Transaction, Message,       │
│   • SHAP TreeExplainer       │    │   Prediction, Explanation,          │
│   • LIME LimeTextExplainer   │    │   RiskAssessment, DriftEvent,       │
│   • PSI drift engine         │    │   ModelVersion, ModelMetric,        │
│   • Adaptive retrain +      │    │   SystemEvent                        │
│     promotion rule           │    │   (plus DatasetAudit informational) │
└──────────────────────────────┘    └────────────────────────────────────┘
```

A full component-by-component breakdown is in [docs/architecture.md](docs/architecture.md).

## Datasets

| Dataset | Provenance | Disclosure |
|---|---|---|
| **PaySim** | Public mobile-money **simulator** dataset by Edgar Lopez-Rojas; provided preprocessed (one-hot type, derived balance-change features, chronological 70/15/15 split). | **PaySim is a SIMULATOR — it is NOT real UPI banking data.** It does not establish any causal transaction↔message relationship. |
| **Hindi** | `hindi_messages.csv`, 10,000 rows, balanced 5,000/5,000, `source=Synthetic`. Categories: Legitimate + 6 scam types (Electricity, Fake Customer Care, KYC, OTP, Refund, UPI). | Synthetic. Only **~20 unique text templates** (5 legitimate + 15–16 scam) repeated ~500–1,000× each. Per-language NLP metrics reflect memorization of this small template set, not generalization. |
| **Hinglish** | `hinglish_messages.csv`, same schema as Hindi, transliterated. | Same template-scarcity limitation as Hindi. |
| **English** | Public **UCI SMS Spam Collection v1**, auto-downloaded at training time from the UCI archive (the original `sms spam collection.zip` was not in the user upload). | Public dataset, not collected by us. If the sandbox blocks the download, English falls back to `not_trained` — no English data is fabricated. |

Full per-split row counts, fraud counts, label distributions, duplicates,
missing-value counts and the audit methodology are in
[docs/dataset.md](docs/dataset.md).

## Limitations

This is a **research prototype**, not banking-grade software. Concretely:

1. **PaySim is a simulator**, not real UPI banking data. High fraud-detection
   F1 scores on PaySim (XGBoost F1 ≈ 0.998) reflect the simulator's clean
   synthetic fraud patterns, not real-world generalization.
2. **Hindi and Hinglish are synthetic** and contain only ~20 unique text
   templates each. The per-language NLP models reflect this:
   - `nlp_hi` F1 = 1.000 — perfect on a 4-template test set; effectively
     memorization, not generalization.
   - `nlp_hinglish` F1 = 0.65 — the model cannot generalize from 4 training
     legitimate templates to the 5th unseen one.
   - `nlp_combined` F1 = 0.33 — Hindi/Hinglish scarcity drags the combined
     model down even after a 50-rows-per-template cap.
3. **English uses the public UCI SMS Spam Collection**, which is general
   spam/ham — not India-specific UPI scam vocabulary. F1 = 0.907 is an
   honest real-world result on that dataset.
4. **No causal transaction↔message relationship is claimed.** The unified
   risk score is a fusion of two independently-trained models' probabilities;
   it is decision-support, not evidence.
5. **No automated test suite (pytest).** Verification was end-to-end
   browser-based (light/dark, all 9 tabs, real SHAP/LIME/PSI, mobile
   responsive). See [docs/testing.md](docs/testing.md).
6. **No authentication.** All API endpoints are open. Do not deploy this
   unchanged to production.
7. **SQLite is used in place of PostgreSQL** because of the sandbox
   constraint. The Prisma schema is PostgreSQL-equivalent.

## Installation & Setup

Prerequisites: Python 3.10+ (with `pip`), Node.js 18+ / Bun, and ~2 GB free
disk for the PaySim XGBoost training run.

```bash
# 1. Clone
git clone <your-repo-url> my-project
cd my-project

# 2. Install Python ML-service dependencies
python3 -m pip install -r mini-services/ml-service/requirements.txt

# 3. Audit datasets + train all models (transaction LR/RF/XGBoost + 4 NLP models)
cd mini-services/ml-service
python3 audit.py    # writes metadata/dataset_audit.{json,md}
python3 train.py    # writes models/*.joblib + metadata/*.json (~1–3 min for XGBoost)
cd ../..

# 4. Push the Prisma SQLite schema (creates db/custom.db tables)
bun run db:push

# 5. Start the Python ML service (port 4000) — keep this running
cd mini-services/ml-service
python3 -m uvicorn index:app --port 4000
#   … in a separate terminal …

# 6. Start the Next.js dev server (port 3000)
cd /home/z/my-project
bun run dev

# 7. Open http://localhost:3000
```

If the UCI SMS Spam download fails at training time, `train.py` falls back
to a cached `english_sms_spam.csv` from a prior run (disclosed in the
training metadata). If neither is available, English is reported as
`not_trained` — no English data is fabricated.

## API Documentation

The full API contract for all 13 endpoints (12 under `/api/v1/*` plus
`/health`) is in [docs/api.md](docs/api.md). The Python ML service also
exposes its own interactive OpenAPI documentation at
`http://localhost:4000/docs`.

## Evaluation Results

Full evaluation tables, hyperparameters, confusion matrices, per-language
NLP metrics and reproducibility details are in [docs/ml.md](docs/ml.md).

Summary (latest training run, real numbers from
`mini-services/ml-service/metadata/*.json`):

| Model | F1 | Recall | Precision | ROC-AUC | PR-AUC | Active |
|---|---|---|---|---|---|---|
| transaction_xgboost (PaySim test, 10,099 rows) | 0.998 | 0.996 | 0.999 | 1.000 | 1.000 | ✅ |
| transaction_random_forest (subsampled) | 0.9996 | 0.999 | 1.000 | 1.000 | 1.000 | ❌ |
| transaction_logistic_regression (subsampled) | 0.813 | 0.947 | 0.713 | 0.990 | 0.944 | ❌ |
| nlp_en (UCI SMS Spam test) | 0.907 | 0.920 | 0.896 | 0.991 | 0.971 | ✅ |
| nlp_hi (4-template test, memorization) | 1.000 | 1.000 | 1.000 | 1.000 | 1.000 | ✅ |
| nlp_hinglish (template scarcity) | 0.650 | 1.000 | 0.481 | 1.000 | 1.000 | ✅ |
| nlp_combined (50-rows-per-template cap) | 0.334 | 0.977 | 0.202 | 0.949 | 0.936 | ✅ |

The XGBoost transaction score is high because PaySim has clean synthetic
fraud patterns. The Hindi/Hinglish scores reflect template scarcity, not
real-world generalization. These limitations are disclosed honestly
throughout the UI and the documentation.

## XAI Methodology

SHAP (TreeExplainer for XGBoost) explains transaction predictions with
per-feature contribution values and a baseline. LIME
(LimeTextExplainer) explains message predictions with per-token weights
from a locally-fit linear model. Both are reported using the wording
"contributed to the model's prediction" — never "caused" or "is the
reason for". Detected linguistic signals (OTP regex, URLs, currency,
urgency words) are reported as additional context, **not** as model
contributions. Full methodology, the feature→human-label mapping and
example outputs are in [docs/xai.md](docs/xai.md).

## Drift & Adaptive Methodology

Concept drift is detected using the Population Stability Index (PSI)
computed over 10 quantile bins per numeric PaySim feature, saved as a
reference distribution in `metadata/drift_reference.json`. Status
thresholds (env-configurable): `DRIFT_WATCH_THRESHOLD=0.10`,
`DRIFT_DRIFT_THRESHOLD=0.25`. Adaptive retraining trains a
`2.0.0-candidate` model on training + drift-window data and promotes it
only if `new_f1 ≥ old_f1 AND new_recall ≥ old_recall AND new_precision ≥
0.95 × old_precision`; otherwise it is archived as `rejected`. Full
methodology, formulas and verification results are in
[docs/drift.md](docs/drift.md).

## Testing

Verification was end-to-end browser-based using the Agent Browser tool:
light and dark mode, all 9 tabs, real SHAP for a transaction, real LIME
for a scam message, unified risk fusion, explanation drill-down, real
PSI drift on 14 PaySim features, adaptive retrain with the promotion
rule (correctly rejected when F1 dropped), model performance, prediction
history, about/dataset, mobile responsive with sheet nav, sticky
footer. Backend verified: real model training (3 transaction + 4 NLP
models), real SHAP TreeExplainer, real LIME, real PSI, real adaptive
retrain with promotion rule. See [docs/testing.md](docs/testing.md).

## Future Scope

- **Additional regional languages** — Tamil, Telugu, Bengali, Marathi,
  Malayalam, Kannada — with native-script corpora and transliteration-aware
  TF-IDF / subword tokenizers.
- **Graph Neural Networks** over the transaction graph (sender↔receiver
  subgraph features) to capture mule-account clusters that tabular
  features miss.
- **Production-grade real-time serving** — replace the lazy in-memory
  model cache with a model registry + Triton / ONNX runtime, batch
  inference, autoscaling, request-level authentication and rate limiting.
- **Federated learning** across banks / UPI PSPs so fraud patterns can
  be learned without sharing raw transaction data.
- **Voice / call scam detection** — extend the message pipeline to ASR
  transcripts of voice phishing calls (Vishing).
- **Direct UPI-app integration** — a SDK / API for UPI apps to call this
  pipeline at transaction-authorization time with a sub-second latency
  budget.

## Disclaimer

This system is an **academic research prototype**. It is **not**
banking-grade software, is **not** a substitute for the fraud-prevention
systems operated by banks, UPI providers, NPCI, RBI or law enforcement,
and must **not** be used to make live decisions about real UPI
transactions or real customers. The datasets used are public or
synthetic: **PaySim is a public mobile-money simulator and is NOT real
UPI banking data**; Hindi and Hinglish are synthetic; English uses the
public UCI SMS Spam Collection. SHAP and LIME explanations describe
**model contributions, not causal effects**. PSI drift detection
describes **distributional change, not the underlying cause**. All
metrics shown are reproducible from the supplied datasets and code; they
do not generalise to real-world UPI fraud unless the models are retrained
on real, labelled, India-specific data under proper regulatory and
privacy constraints.

## Project Structure

```
/home/z/my-project
├── README.md                          # this file
├── worklog.md                         # master worklog (full requirements matrix,
│                                      #   provenance, API contract, palette)
├── prisma/schema.prisma               # SQLite schema (PostgreSQL-equivalent)
├── docs/                              # ★ this documentation set
│   ├── architecture.md
│   ├── dataset.md
│   ├── ml.md
│   ├── xai.md
│   ├── drift.md
│   ├── api.md
│   └── testing.md
├── src/
│   ├── app/
│   │   ├── page.tsx                    # single-page dashboard shell with tabs
│   │   ├── layout.tsx                  # root layout with theme + footer
│   │   └── api/v1/                     # 12 API routes + /health
│   │       ├── health/route.ts
│   │       ├── transactions/analyze/route.ts
│   │       ├── messages/analyze/route.ts
│   │       ├── risk/analyze/route.ts
│   │       ├── predictions/route.ts
│   │       ├── predictions/[id]/route.ts
│   │       ├── explanations/[predictionId]/route.ts
│   │       ├── dashboard/summary/route.ts
│   │       ├── dashboard/trends/route.ts
│   │       ├── drift/status/route.ts
│   │       ├── drift/history/route.ts
│   │       ├── models/route.ts
│   │       └── models/retrain/route.ts
│   ├── components/
│   │   ├── ui/                         # shadcn primitives
│   │   ├── layout/                     # Sidebar, Header, Footer
│   │   ├── fraud/                      # 9 feature tab components
│   │   └── charts/                     # Recharts + SVG wrappers
│   └── lib/
│       ├── db.ts                       # Prisma client
│       ├── mlClient.ts                 # typed HTTP client to ML service
│       ├── types.ts                    # shared API types
│       └── serverHelpers.ts            # risk level, feature derivation, disclaimer
└── mini-services/
    └── ml-service/                     # Python FastAPI service (port 4000)
        ├── index.py                     # FastAPI app, all 13 endpoints
        ├── train.py                     # train all models, save artifacts
        ├── audit.py                     # dataset audit
        ├── risk_engine.py               # 0–100 risk score + fusion
        ├── xai_engine.py                # SHAP (transactions) + LIME (messages)
        ├── drift_engine.py              # PSI computation + reference builder
        ├── adaptive.py                  # candidate retraining + promotion rule
        ├── requirements.txt
        ├── data/raw/                    # input datasets (read-only)
        │   ├── paysim/                  # train / validation / test CSV + metadata
        │   ├── messages/                # hindi / hinglish CSVs
        │   └── english/                 # UCI SMS Spam (downloaded by train.py)
        ├── models/                      # trained .joblib pipelines
        └── metadata/                    # audit + model metrics + drift reference
                                         #   + drift history JSON
```
