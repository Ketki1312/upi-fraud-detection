# Testing Strategy

> Companion to the top-level [README](../README.md). This document
> describes how the prototype was verified. The short version:
> **there is no automated `pytest` suite** — this is an academic
> prototype, and verification was end-to-end browser-based using
> the Agent Browser tool, supplemented by `curl` smoke tests on every
> API endpoint and direct inspection of the trained-model metadata.

## Verification approach

The prototype was verified in three layers:

1. **Backend — real model training.** `python3 audit.py && python3
   train.py` runs end-to-end and produces real model artifacts
   (`models/*.joblib`) and real metadata
   (`metadata/*.json`). All metrics in the dashboard come from these
   files — nothing is hardcoded.
2. **Backend — `curl` smoke tests on every API endpoint.** Every one
   of the 13 endpoints was hit with a real payload and the response
   was inspected for shape, status code, and content. See the per-
   endpoint notes below.
3. **Frontend — end-to-end browser verification.** The Agent Browser
   tool drove the Next.js single-page app through every tab in both
   light and dark mode, on both desktop and mobile widths. See the
   per-tab checklist below.

---

## Backend — real model training

The verification run trained **7 real models** on the supplied data:

| Model family | Models trained | Total training time |
|---|---|---|
| Transaction | LogisticRegression, RandomForest, XGBoost | ~30s |
| NLP | TF-IDF + LR (Hindi, Hinglish, English, combined) | ~8s |
| **Total** | **7 models** | **~38s end-to-end** |

The XGBoost model was trained on the **full 613,340-row PaySim training
split** (no subsampling). The LR and RF models were trained on a
100,000-legitimate + all-fraud subsample (documented per-model in
`metadata/transaction_models.json`). All metrics were computed on
the unchanged 10,099-row PaySim test split.

The drift reference distribution
(`metadata/drift_reference.json`) was built from the training split:
10-quantile-bin edges + reference percentages for all 14 numeric
PaySim features.

A SHAP background sample of 100 legitimate PaySim rows was saved to
`models/shap_background.joblib` for the `KernelExplainer` fallback
(used only by the LR / RF fallback models; the active XGBoost model
uses `TreeExplainer` directly).

---

## Backend — real SHAP, LIME, PSI, adaptive retrain

| Capability | Real algorithm used | Verified by |
|---|---|---|
| Transaction XAI | `shap.TreeExplainer` on XGBoost (exact Tree SHAP, polynomial-time for tree ensembles) | `curl POST /api/v1/transactions/analyze` → top 5 positive + top 5 negative SHAP contributions with human labels, baseline, method="tree" |
| Message XAI | `lime.lime_text.LimeTextExplainer` (1000 perturbations, local linear model on TF-IDF features) | `curl POST /api/v1/messages/analyze` → top 10 LIME tokens with weights + detected linguistic signals (OTP, URL, currency, urgency) |
| Drift detection | `drift_engine.compute_psi` — quantile-binned PSI over 14 PaySim features | `curl GET /api/v1/drift/status` → all 14 features `NO_DRIFT` on the validation split, PSI < 0.10 |
| Adaptive retrain | `adaptive.prepare_candidate_retraining` + `evaluate_candidate` with the promotion rule (`new_f1 ≥ old_f1 AND new_recall ≥ old_recall AND new_precision ≥ 0.95 × old_precision`) | `curl POST /api/v1/models/retrain` → candidate correctly **REJECTED** when drift window added (F1 dropped 0.9976 → 0.9968) |

---

## NLP duplicate-leakage test

A real bug was caught and fixed during verification: the original
group-aware split assigned all 5 legitimate Hindi templates to the
test set, causing the model to predict everything as scam (F1 ≈ 0.39
/ 0.30).

The fix: `group_aware_split` was rewritten to be **label-stratified**
— within each label, split the groups 70 / 15 / 15 with a min-1-in-test
guard. After the fix:

- `nlp_hi` F1 = 1.000 — honest, but **memorization** of the 4-template
  test set (not a generalization claim).
- `nlp_hinglish` F1 = 0.65 — the model cannot generalize from 4
  training legitimate templates to the 5th unseen one in the test set.
- `nlp_combined` F1 = 0.334 — Hindi/Hinglish scarcity drags the
  combined model down even after the 50-rows-per-template cap.

This is disclosed honestly in `/api/v1/models`, in the dashboard,
and in [dataset.md](dataset.md) and [ml.md](ml.md).

---

## Manual end-to-end verification (Agent Browser)

The Next.js single-page app was driven through every tab in both
light and dark mode, on desktop (1280×800) and mobile (390×844)
widths. The full checklist:

### Theme & layout

- [x] **Light mode** — design tokens (burnt-orange primary
  `#C2410C`, green accent `#16A34A`, red destructive `#DC2626`)
  render correctly.
- [x] **Dark mode** — design tokens (`#F97316` primary, `#22C55E`
  accent, `#EF4444` destructive, `#0F172A` bg, `#1E293B` card)
  render correctly.
- [x] **Theme toggle** (Sun / Moon icon in the sticky header)
  switches themes without a flash of unstyled content.
- [x] **Sticky footer** with the research-prototype disclaimer
  visible on every tab.
- [x] **Sticky header** with the active-tab title + ML service
  status pill (green when `models.transaction` loaded, red when ML
  service offline).
- [x] **Sidebar** — 256px on desktop, collapses to a Sheet on
  mobile (hamburger button visible).

### Tabs (9 tabs covering the 13 required views)

- [x] **Dashboard** — KPI cards (Total / Fraud / Scam / High-Risk /
  Drift Status), Risk Distribution pie, Language Distribution pie,
  Fraud-Rate Trend line (PaySim benchmark, 53 step windows), Model F1
  comparison bar, Recent Predictions table (top 10). All numbers
  from `/api/v1/dashboard/summary` + `/api/v1/dashboard/trends`.
- [x] **Transaction Analyzer** — form with step / type / amount /
  balance fields, real XGBoost prediction, RiskGauge (SVG circular
  gauge with 4 color bands), prediction badge, probability, risk
  level, model version, top SHAP contributions chart
  (`ContributionsChart` — horizontal bar, red for positive
  contributors, green for negative), prediction_id displayed.
- [x] **Scam Message Analyzer** — textarea + language select + 4
  sample messages (Hinglish scam, English KYC scam, legitimate bank
  OTP, Hindi refund scam), real LIME prediction, RiskGauge,
  prediction, language detected, detected linguistic signals as
  badges (OTP / URL / currency / urgency), top LIME tokens chart,
  human summary, prediction_id.
- [x] **Unified Risk Analysis** — two toggleable sub-forms
  (transaction + message), submits to `/api/v1/risk/analyze`,
  unified RiskGauge, risk level, fusion method (max / weighted),
  per-input risk breakdown (score + level + probability each), no-
  causal-relationship disclaimer prominent.
- [x] **Explanation View** — Select a prediction from
  `/api/v1/predictions?limit=100` (auto-selects the first one),
  fetches `/api/v1/explanations/{id}`, renders prediction summary +
  input summary + contributions chart (handles SHAP vs LIME via
  "tokens" field detection) + human-readable text. Accepts an
  `initialPredictionId` prop — clicking a History row sets this and
  jumps to this tab.
- [x] **Drift Monitoring** — PSI thresholds card + per-feature PSI
  table with status badges (NO_DRIFT=green / WATCH=amber /
  DRIFT_DETECTED=red) + drift history timeline (renders each event
  with old vs new F1, delta F1 colored) + Retrain action (model
  selector + Dialog confirm + outcome card showing old/new
  F1/precision/recall deltas). Real PSI on 14 features all
  NO_DRIFT.
- [x] **Model Performance** — service status card (active TX model
  + English status) + F1 comparison horizontal bar + per-model
  table (name, version, status, precision/recall/F1/ROC-AUC/PR-AUC,
  training timestamp) + static-vs-adaptive comparison card (reads
  from `/api/v1/drift/history`, shows latest retrain event's old vs
  candidate F1/recall + promotion rule).
- [x] **Prediction History** — filter by input_type + risk_level,
  50 per page pagination (Prev/Next), click a row to open it in the
  Explanation tab via the onOpenPrediction callback. Page resets to
  1 on filter change.
- [x] **About / Dataset** — Disclaimer prominently at top + ASCII
  architecture diagram (Browser → Next.js API routes → Python ML
  service + Prisma SQLite) + dataset audit summary cards (PaySim
  with train/val/test row counts + fraud rate + provenance, Hindi /
  Hinglish / English with rows + provenance + URL + local file) +
  trained-models overview list + drift summary card + final
  research-prototype disclaimer card with bullet list of honest
  limitations (PaySim simulator, synthetic Hindi/Hinglish, UCI SMS
  Spam for English, SHAP/LIME/PSI/adaptive all real, per-language
  F1 disclosed honestly).

### Mobile responsive

- [x] Sidebar collapses to a Sheet (hamburger button visible, opens
  the same 9 nav items in a drawer).
- [x] All 9 tabs render at 390px width — KPI cards stack 2-per-row,
  tables become horizontally scrollable, charts resize.
- [x] Sheet nav opens and closes; active tab highlighted.

### Cross-cutting

- [x] **ML service down** — Header pill turns red, Dashboard shows
  a banner "ML service offline — some metrics may be stale", but
  the rest of the app remains navigable.
- [x] **Empty message input** — returns 200 with an honest
  "input is empty" LIME explanation (not 500).
- [x] **Unknown transaction type** — graceful prediction (all
  type one-hots 0).
- [x] **Missing required field** — 422 with a clear error message.
- [x] **History deep-link** — clicking a History row switches to
  the Explanation tab and loads the right prediction id (via the
  `initialPredictionId` prop and React 19's "adjust state when a
  prop changes" pattern).

---

## Per-endpoint curl smoke tests

Every one of the 13 endpoints was hit with a real payload via
`curl` during verification:

| # | Endpoint | Method | Status | Notes |
|---:|---|:-:|:-:|---|
| 1 | `/api/v1/health` | GET | 200 | All 5 model-load flags = true; English status "trained"; disclaimer included. |
| 2 | `/api/v1/transactions/analyze` | POST | 200 | XGBoost prediction + real SHAP TreeExplainer contributions with human labels (top 5 pos + top 5 neg). |
| 3 | `/api/v1/messages/analyze` | POST | 200 | TF-IDF + LR prediction + real LIME tokens with weights; auto language detection (Devanagari → hi, Hinglish tokens → hinglish, default → en); regex keyword detection (OTP, URLs, currency, urgency). |
| 4 | `/api/v1/risk/analyze` | POST | 200 | max / weighted fusion of tx_prob + msg_prob; supports raw inputs (computes probs via loaded models) and direct probabilities. |
| 5 | `/api/v1/dashboard/summary` | GET | 200 | Real model metrics + dataset audit summary + drift summary from metadata/*.json. |
| 6 | `/api/v1/dashboard/trends` | GET | 200 | 53 PaySim step-windows with fraud_rate_trend, fraud_count_trend, risk_trend (mean amount per window). |
| 7 | `/api/v1/drift/status` | GET | 200 | Real PSI per feature on PaySim validation split vs training reference (all 14 features NO_DRIFT, PSI < 0.10). |
| 8 | `/api/v1/drift/history` | GET | 200 | Append-only JSON array from metadata/drift_history.json (5 events: 2 rejected, 2 promoted, 1 rejected). |
| 9 | `/api/v1/models` | GET | 200 | All 7 models with versions, hyperparameters, metrics, active flags. |
| 10 | `/api/v1/models/retrain` | POST | 200 | Real candidate retrain on training + drift-window (validation steps 521–631) → evaluate vs active on test split → promotion rule → REJECTED (F1 dropped 0.9976 → 0.9968), archived as `transaction_xgboost_rejected_<ts>.joblib`, event appended to drift_history.json. |
| 11 | `/api/v1/predictions` | GET | 200 | Predictions from Prisma with Explanation + RiskAssessment attached. |
| 12 | `/api/v1/predictions/{id}` | GET | 200 | Single prediction with input data + explanation + risk assessment. |
| 13 | `/api/v1/explanations/{predictionId}` | GET | 200 | Explanation payload + human-readable text + prediction summary. |

Edge cases verified:

- Missing required field → HTTP 422 (Pydantic).
- Unknown transaction type → graceful prediction (all type one-hots 0).
- Empty / whitespace message → HTTP 200 with honest "empty input"
  explanation (no 500).

---

## Limitations of the test suite

This is an **academic prototype**, and the verification was performed
end-to-end via browser + curl rather than via an automated `pytest`
suite. Concretely:

1. **No `pytest` suite.** Backend correctness is verified by
   inspection of the trained-model metadata files
   (`metadata/transaction_models.json`, `metadata/nlp_models.json`,
   `metadata/drift_reference.json`, `metadata/drift_history.json`)
   and by `curl` smoke tests on every endpoint, not by unit tests.
2. **No automated frontend tests.** No Jest / React Testing Library
   / Playwright / Cypress suite. Every tab was verified manually via
   the Agent Browser tool across light/dark + desktop/mobile.
3. **No load / performance test.** Single-user, single-request
   verification only.
4. **No security test.** Authentication is not implemented (the API is
   open); no penetration testing was performed.
5. **No cross-browser test.** Verified in the Agent Browser's
   headless Chromium only.
6. **Reproducibility depends on the supplied data.** Re-running
   `python3 audit.py && python3 train.py` will reproduce the metrics
   in this document **if and only if** the input CSVs in
   `mini-services/ml-service/data/raw/` are unchanged. The UCI SMS
   Spam download for English is network-dependent — if the sandbox
   blocks it, English falls back to `not_trained`.

These limitations are honestly disclosed in the README, in the
About / Dataset tab, and in this document. For a production-grade
version of this prototype, the minimum recommended additions are:
a `pytest` suite covering the ML service, a Playwright suite
covering the dashboard, JWT/OAuth authentication on every route,
rate limiting, structured logging, and a canary / shadow-traffic
deployment strategy for the adaptive retrain promotion rule.

---

_Research prototype — not for production use._
