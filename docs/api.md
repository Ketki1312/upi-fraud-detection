# API Documentation

> Companion to the top-level [README](../README.md). This document
> lists all 13 endpoints (12 under `/api/v1/*` plus `/health`). The
> Python ML service also exposes its own interactive OpenAPI
> documentation at `http://localhost:4000/docs`.

## Endpoint overview

| # | Method | Path | Purpose |
|---:|:-:|---|---|
| 1 | GET | `/api/v1/health` | Service health + ML service status |
| 2 | POST | `/api/v1/transactions/analyze` | XGBoost fraud prediction + SHAP |
| 3 | POST | `/api/v1/messages/analyze` | NLP scam prediction + LIME |
| 4 | POST | `/api/v1/risk/analyze` | Unified risk fusion |
| 5 | GET | `/api/v1/dashboard/summary` | KPIs + model metrics + dataset summary |
| 6 | GET | `/api/v1/dashboard/trends` | PaySim fraud-rate trend by step window |
| 7 | GET | `/api/v1/drift/status` | Per-feature PSI on validation split |
| 8 | GET | `/api/v1/drift/history` | Past drift / retrain events |
| 9 | GET | `/api/v1/models` | All models + active flags + metrics |
| 10 | POST | `/api/v1/models/retrain` | Candidate retrain + promote-on-criteria |
| 11 | GET | `/api/v1/predictions` | List predictions (filter + paginate) |
| 12 | GET | `/api/v1/predictions/{id}` | Single prediction detail |
| 13 | GET | `/api/v1/explanations/{predictionId}` | Explanation payload + human-readable text |

All endpoints are served by Next.js on port 3000. The Next.js API
routes proxy to the Python FastAPI ML service on port 4000
(server-side, no browser-side CORS exposure). The proxying uses the
sandbox's `?XTransformPort=4000` query parameter.

## Authentication

**None.** This is a research prototype. Do not deploy it to production
unchanged — at minimum, add JWT / OAuth bearer-token authentication on
every `/api/v1/*` route.

## Error format

All non-2xx responses use a consistent JSON shape:

```json
{
  "error": "string — short error category (e.g. 'validation_error')",
  "detail": "string — human-readable explanation",
  "status": 422
}
```

The Python ML service raises `HTTPException` (FastAPI), which the
Next.js `mlClient.ts` re-wraps as an `MLServiceError` with the upstream
status code and body, then the Next.js route re-serializes into the
shape above.

Common error codes:

| Status | Meaning |
|---:|---|
| 200 | Success |
| 400 | Bad request (e.g. unknown model_name on retrain) |
| 404 | Prediction / explanation / candidate not found |
| 422 | Validation error (Pydantic schema or Next.js hand-rolled check) |
| 500 | Internal error (server logs) |
| 503 | ML service down or required model not loaded |

## Persistence

Every analyze call writes the following Prisma rows:

| Endpoint | Rows written |
|---|---|
| `POST /api/v1/transactions/analyze` | `Transaction` + `Prediction` + `Explanation` + `RiskAssessment` |
| `POST /api/v1/messages/analyze` | `Message` + `Prediction` + `Explanation` + `RiskAssessment` |
| `POST /api/v1/risk/analyze` | (if `transaction` provided) `Transaction` + `Prediction` + `Explanation`; (if `message` provided) `Message` + `Prediction` + `Explanation`; one `RiskAssessment` linked to the message prediction (preferred) or transaction prediction; one `SystemEvent` recording the unified assessment |
| `POST /api/v1/models/retrain` | `SystemEvent` (retrain outcome) + `DriftEvent` (action_taken = `promoted` or `rejected`) |
| `GET /api/v1/drift/history` | Upserts each event from `metadata/drift_history.json` into `DriftEvent` (idempotent by event id) |

The `Prediction` row carries the canonical Prisma prediction id, which
is returned to the client as `prediction_id`. The dashboard's History
tab uses this id to deep-link into the Explanation tab.

`GET /api/v1/predictions`, `GET /api/v1/predictions/{id}` and
`GET /api/v1/explanations/{predictionId}` are answered **directly from
Prisma** — they do not proxy to the Python ML service.

---

## Endpoint reference

### 1. `GET /api/v1/health`

Returns the Next.js health + the ML service's health + provenance
disclosure. Always returns 200, even when the ML service is down (so
the frontend can show a banner rather than crash).

**Response 200**:

```json
{
  "nextjs": "ok",
  "mlService": {
    "status": "ok",
    "models_loaded": {
      "transaction": true,
      "nlp_english": true,
      "nlp_hindi": true,
      "nlp_hinglish": true,
      "nlp_combined": true
    },
    "model_versions": {
      "transaction_xgboost": "3.0.0",
      "transaction_lr": "1.0.0",
      "transaction_rf": "1.0.0",
      "nlp_hi": "1.0.0",
      "nlp_hinglish": "1.0.0",
      "nlp_en": "1.0.0",
      "nlp_combined": "1.0.0"
    },
    "provenance_disclosure": {
      "PaySim": "public mobile-money simulator (NOT real UPI banking data)",
      "Hindi": "synthetic (source=Synthetic)",
      "Hinglish": "synthetic (source=Synthetic)",
      "English": "trained"
    },
    "disclaimer": "Research prototype — not for production use. ..."
  },
  "timestamp": "2026-10-02T13:42:00+00:00"
}
```

---

### 2. `POST /api/v1/transactions/analyze`

Run the XGBoost fraud classifier + SHAP TreeExplainer on a single
transaction.

**Request body**:

```json
{
  "step": 600,
  "type": "TRANSFER",
  "amount": 4800000,
  "oldbalanceOrg": 4800000,
  "newbalanceOrig": 0,
  "oldbalanceDest": 0,
  "newbalanceDest": 4800000
}
```

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `step` | int | ✅ | PaySim time-step (1 hour window) |
| `type` | string | ✅ | one of `CASH_IN`, `CASH_OUT`, `DEBIT`, `PAYMENT`, `TRANSFER` |
| `amount` | float | ✅ | ≥ 0 |
| `oldbalanceOrg` | float | ✅ | sender balance before |
| `newbalanceOrig` | float | ✅ | sender balance after |
| `oldbalanceDest` | float | ✅ | receiver balance before |
| `newbalanceDest` | float | ✅ | receiver balance after |

**Response 200**:

```json
{
  "prediction": 1,
  "probability": 0.999812,
  "risk_score": 99.9812,
  "risk_level": "CRITICAL",
  "model_version": "3.0.0",
  "model_name": "transaction_xgboost",
  "explanation": {
    "method": "tree",
    "baseline": -3.456789,
    "contributions": [
      {"feature": "amount", "human_label": "Transaction amount",
       "value": 4800000.0, "contribution": 0.32},
      ...
    ],
    "top_positive": [...],
    "top_negative": [...],
    "human_summary": "The following features contributed to the model's
                      prediction: ... SHAP values describe model
                      contributions, not causal effects."
  },
  "input_features": { ... },
  "disclaimer": "Research prototype — not for production use. ...",
  "prediction_id": "cm2abc...",
  "human_readable": "Predicted FRAUD with probability 99.98% (risk level
                     CRITICAL). Top contributing features: Transaction
                     type: TRANSFER, Amount as fraction of sender's
                     balance, Change in sender's balance. ..."
}
```

**Error 422** — missing or invalid field. **Error 503** — transaction
model not loaded (run `train.py`).

---

### 3. `POST /api/v1/messages/analyze`

Run the per-language NLP scam classifier (with auto language detection)
+ LIME on a single message.

**Request body**:

```json
{
  "text": "Aapka account block ho jayega! OTP 4521 verify karein turant - http://upi-verify.in",
  "language": null
}
```

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `text` | string | ✅ | the message body |
| `language` | string | ❌ | one of `hi`, `hinglish`, `en`. If omitted, auto-detected (Devanagari → `hi`; Hinglish token regex → `hinglish`; default → `en`). |

**Response 200**:

```json
{
  "prediction": 1,
  "probability": 0.86,
  "risk_score": 86.0,
  "risk_level": "HIGH",
  "model_version": "1.0.0",
  "model_name": "nlp_hinglish",
  "language_detected": "hinglish",
  "explanation": {
    "method": "lime",
    "tokens": [
      {"token": "otp", "weight": 0.34},
      {"token": "verify", "weight": 0.21},
      ...
    ],
    "top_positive": [...],
    "top_negative": [...],
    "detected_keywords": {
      "otp_patterns": ["4521"],
      "urls": ["http://", ".in"],
      "currency": [],
      "urgency_words": ["verify", "blocked", "otp", "turant"]
    },
    "human_summary": "The following tokens contributed to the model's
                      prediction: 'otp', 'verify', 'blocked'. ...
                      LIME weights describe model contributions, not
                      causal effects."
  },
  "disclaimer": "Research prototype — not for production use. ...",
  "prediction_id": "cm2def..."
}
```

**Empty / whitespace-only text**: returns 200 with an honest
`human_summary` saying "the input text is empty, so the model had no
tokens to evaluate".

---

### 4. `POST /api/v1/risk/analyze`

Fuse transaction + message probabilities into a unified 0–100 risk
score.

**Request body** (either `transaction` or `message` may be omitted;
pre-computed probabilities may be supplied directly):

```json
{
  "transaction": {
    "step": 600, "type": "TRANSFER",
    "amount": 4800000, "oldbalanceOrg": 4800000, "newbalanceOrig": 0,
    "oldbalanceDest": 0, "newbalanceDest": 4800000
  },
  "message": {
    "text": "Aapka account block ho jayega! OTP 4521 ...",
    "language": null
  },
  "transaction_probability": null,
  "message_probability": null,
  "fusion_method": "max"
}
```

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `transaction` | object | ❌ | a `TransactionInput` |
| `message` | object | ❌ | a `MessageInput` |
| `transaction_probability` | float [0,1] | ❌ | if provided, the transaction model is not re-run |
| `message_probability` | float [0,1] | ❌ | if provided, the message model is not re-run |
| `fusion_method` | string | ❌ | `max` (default) or `weighted` |

**Response 200**:

```json
{
  "unified_risk_score": 99,
  "risk_level": "CRITICAL",
  "transaction_risk": 99,
  "message_risk": 86,
  "fusion_method": "max",
  "disclaimer": "Research prototype — not for production use. ...",
  "prediction_id": "cm2ghi..."
}
```

The Next.js route additionally calls `/api/v1/transactions/analyze` and
`/api/v1/messages/analyze` to fetch explanations + per-input risk
scores for the dashboard's per-input breakdown view. Both
predictions are persisted; a single `RiskAssessment` is linked to
the message prediction (preferred) or the transaction prediction.

---

### 5. `GET /api/v1/dashboard/summary`

Returns KPIs (from Prisma), model metrics + dataset audit summary +
drift summary (from ML service metadata).

**Response 200**:

```json
{
  "total_predictions": 42,
  "fraud_count": 18,
  "scam_count": 14,
  "high_risk_count": 22,
  "risk_distribution": {"low": 8, "medium": 12, "high": 15, "critical": 7},
  "language_distribution": {"en": 12, "hi": 8, "hinglish": 22},
  "recent_predictions": [ ... ],
  "model_metrics": [
    {"name": "transaction_xgboost", "version": "3.0.0", "active": true,
     "metrics": {"precision": 0.9992, "recall": 0.9960, "f1": 0.9976,
                 "roc_auc": 1.0, "pr_auc": 1.0}, ...},
    ...
  ],
  "datasets_summary": {
    "PaySim": {"train_rows": 613340, "test_rows": 10099,
               "validation_rows": 20214, "fraud_rate_train": 0.009425,
               "provenance": "PaySim public mobile-money simulator"},
    "Hindi": {"available": true, "rows": 10000, "provenance": "Synthetic"},
    "Hinglish": {"available": true, "rows": 10000, "provenance": "Synthetic"},
    "English": {"available": true, "rows": 5574,
                "provenance": "UCI SMS Spam Collection v1 (public)"}
  },
  "drift_summary": {
    "total_events": 5,
    "latest_event": { ... },
    "reference_features_count": 14,
    "drift_status_counts": {"NO_DRIFT": 14, "WATCH": 0, "DRIFT_DETECTED": 0}
  },
  "ml_service_online": true
}
```

---

### 6. `GET /api/v1/dashboard/trends`

Returns the PaySim fraud-rate trend by step window (53 windows of 10
steps each) plus, if Prisma has enough recent predictions, a per-hour
or per-day prediction-count trend.

**Response 200**:

```json
{
  "timestamps": [0, 10, 20, 30, ...],
  "risk_trend": [174678.23, 172042.31, 400432.27, 324634.19, ...],
  "fraud_rate_trend": [0.0149, 0.0029, 0.0100, 0.0066, ...],
  "fraud_count_trend": [109, 122, 86, 141, ...],
  "source": "PaySim training split (public mobile-money simulator)",
  "disclaimer": "Research prototype — not for production use. ..."
}
```

---

### 7. `GET /api/v1/drift/status`

Returns per-feature PSI computed from the PaySim validation split
versus the training reference distribution.

**Response 200**:

```json
{
  "generated_at": "2026-10-02T13:42:00+00:00",
  "source": "PSI on PaySim validation split vs training reference",
  "features": [
    {"feature": "amount", "psi": 0.034, "status": "NO_DRIFT", "threshold": 0.10},
    {"feature": "oldbalanceOrg", "psi": 0.012, "status": "NO_DRIFT", "threshold": 0.10},
    {"feature": "newbalanceOrig", "psi": 0.008, "status": "NO_DRIFT", "threshold": 0.10},
    ... (14 features total)
  ],
  "thresholds": {"watch": 0.10, "drift": 0.25},
  "disclaimer": "Research prototype — not for production use. ..."
}
```

---

### 8. `GET /api/v1/drift/history`

Returns the append-only drift / retrain event log from
`metadata/drift_history.json`. The Next.js route upserts each event
into Prisma `DriftEvent` (idempotent by event id).

**Response 200**:

```json
{
  "events": [
    {
      "id": "retrain-1790948182",
      "type": "retrain",
      "model_name": "transaction_xgboost",
      "drift_window": {"start": 521, "end": 631},
      "candidate_version": "2.0.0-candidate",
      "old_metrics": {"precision": 0.9992, "recall": 0.9960, "f1": 0.9976, ...},
      "new_metrics": {"precision": 0.9944, "recall": 0.9992, "f1": 0.9968, ...},
      "comparison": {
        "f1_delta": -0.000787,
        "recall_delta": 0.003195,
        "precision_delta": -0.004763,
        "precision_ratio": 0.995233
      },
      "promoted": false,
      "outcome": "rejected",
      "created_at": "2026-10-02T13:42:29+00:00"
    },
    ...
  ],
  "count": 5,
  "disclaimer": "Research prototype — not for production use. ..."
}
```

---

### 9. `GET /api/v1/models`

Returns all 7 models with versions, hyperparameters, metrics, and
active flags. Pass-through to the ML service.

**Response 200**:

```json
{
  "models": [
    {
      "name": "transaction_xgboost",
      "version": "3.0.0",
      "type": "xgboost",
      "active": true,
      "trained": true,
      "dataset_version": "paysim_v1",
      "training_timestamp": "2026-10-02T13:43:07+00:00",
      "hyperparameters": { ... },
      "metrics": {"precision": 0.9992, "recall": 0.9960, "f1": 0.9976,
                  "roc_auc": 1.0, "pr_auc": 1.0},
      "artifact": "models/transaction_xgboost.joblib"
    },
    ... (7 models total)
  ],
  "active_transaction_model": "transaction_xgboost",
  "english_status": "trained",
  "generated_at": "2026-10-02T13:42:00+00:00",
  "disclaimer": "Research prototype — not for production use. ..."
}
```

---

### 10. `POST /api/v1/models/retrain`

Trigger candidate retraining + evaluation. The Next.js route uses a
120-second timeout (vs the default 30s) because retraining XGBoost can
take ~1 minute.

**Request body**:

```json
{
  "model_name": "transaction_xgboost",
  "drift_window": {"source": "validation", "min_step": 521, "max_step": 631}
}
```

| Field | Type | Required | Notes |
|---|---|:-:|---|
| `model_name` | string | ✅ | one of `transaction_xgboost`, `transaction_lr`, `transaction_rf`, `nlp_hi`, `nlp_hinglish`, `nlp_en`, `nlp_combined` |
| `drift_window` | object | ❌ | for transaction models: `{"source": "validation"\|"test", "min_step": int, "max_step": int}`. For NLP models: ignored. |

**Response 200**:

```json
{
  "candidate_version": "2.0.0-candidate",
  "old_metrics": {"precision": 0.9992, "recall": 0.9960, "f1": 0.9976, ...},
  "new_metrics": {"precision": 0.9944, "recall": 0.9992, "f1": 0.9968, ...},
  "promoted": false,
  "outcome": "rejected",
  "comparison": {
    "f1_delta": -0.000787,
    "recall_delta": 0.003195,
    "precision_delta": -0.004763,
    "precision_ratio": 0.995233
  },
  "event_id": "retrain-1790948182",
  "created_at": "2026-10-02T13:42:29+00:00",
  "disclaimer": "Research prototype — not for production use. ..."
}
```

**Error 400** — `prepare_candidate_retraining` failed (e.g. unknown
model_name). **Error 404** — no candidate model found. **Error 500** —
`evaluate_candidate` failed.

---

### 11. `GET /api/v1/predictions`

List predictions from Prisma, with optional filters. Answered
directly from Prisma (no proxy to ML service).

**Query parameters**:

| Param | Default | Notes |
|---|---|---|
| `limit` | 50 | max 100 |
| `input_type` | — | filter by `transaction` or `message` |
| `risk_level` | — | filter by `LOW`, `MEDIUM`, `HIGH`, `CRITICAL` |

**Response 200**:

```json
{
  "predictions": [
    {
      "id": "cm2abc...",
      "inputType": "transaction",
      "predictedLabel": 1,
      "probability": 0.9998,
      "riskScore": 99,
      "riskLevel": "CRITICAL",
      "modelVersion": "3.0.0",
      "inputSummary": "TRANSFER ₹4,800,000 step=600",
      "createdAt": "2026-10-02T13:42:00+00:00",
      "explanation": { ... },
      "riskAssessment": { ... }
    },
    ...
  ],
  "count": 42,
  "limit": 50
}
```

---

### 12. `GET /api/v1/predictions/{id}`

Return a single prediction (with input data + explanation + risk
assessment). Answered directly from Prisma.

**Path parameter**: `id` — Prisma `Prediction.id`.

**Response 200**:

```json
{
  "prediction": {
    "id": "cm2abc...",
    "inputType": "transaction",
    "predictedLabel": 1,
    "probability": 0.9998,
    "riskScore": 99,
    "riskLevel": "CRITICAL",
    "modelVersion": "3.0.0",
    "inputSummary": "TRANSFER ₹4,800,000 step=600",
    "createdAt": "2026-10-02T13:42:00+00:00",
    "transaction": { ... },     // or "message": { ... }
    "explanation": {
      "method": "shap",
      "payload": "{...JSON string...}",
      "humanReadable": "Predicted FRAUD with probability 99.98% ..."
    },
    "riskAssessment": {
      "transactionRisk": 99,
      "messageRisk": null,
      "unifiedRisk": 99,
      "riskLevel": "CRITICAL",
      "fusionMethod": "max"
    }
  }
}
```

**Error 404** — prediction not found.

---

### 13. `GET /api/v1/explanations/{predictionId}`

Return the explanation payload + human-readable text + prediction
summary for a prediction. Answered directly from Prisma.

**Path parameter**: `predictionId` — Prisma `Prediction.id`.

**Response 200**:

```json
{
  "prediction_id": "cm2abc...",
  "method": "shap",
  "payload": {
    "method": "tree",
    "baseline": -3.456789,
    "contributions": [ ... ],
    "top_positive": [ ... ],
    "top_negative": [ ... ],
    "human_summary": "The following features contributed to the
                      model's prediction: ... SHAP values describe
                      model contributions, not causal effects."
  },
  "human_readable": "Predicted FRAUD with probability 99.98% (risk
                     level CRITICAL). Top contributing features:
                     Transaction type: TRANSFER, ...",
  "prediction_summary": {
    "inputType": "transaction",
    "predictedLabel": 1,
    "probability": 0.9998,
    "riskScore": 99,
    "riskLevel": "CRITICAL",
    "modelVersion": "3.0.0",
    "inputSummary": "TRANSFER ₹4,800,000 step=600"
  }
}
```

**Error 404** — prediction / explanation not found.

---

## OpenAPI

The Python ML service exposes its own interactive OpenAPI / Swagger
documentation at `http://localhost:4000/docs` and the raw OpenAPI JSON
at `http://localhost:4000/openapi.json`. Use this for testing
individual ML-service endpoints directly during development.

---

_Research prototype — not for production use._
