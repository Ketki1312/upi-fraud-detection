# Explainable AI (XAI) Methodology

> Companion to the top-level [README](../README.md). This document
> describes how SHAP and LIME are used in this prototype, the wording
> rule for human-readable summaries, and example outputs. The
> implementation lives in `mini-services/ml-service/xai_engine.py`.

## Why XAI

A fraud-detection system that only outputs a probability is not
useful for a human analyst (or for the end user) because it gives no
way to validate the prediction. A false positive that blocks a
legitimate transaction needs a justification the analyst can read and
either accept or override; a true positive that flags a real scam
needs a justification the user can understand ("why is this message a
scam?") so they can recognise similar scams in the future.

The XAI layer in this prototype serves two purposes:

1. **Decision support, not black-box automation.** Every prediction
   is paired with the top features (for transactions) or top tokens
   (for messages) that contributed to the model's output, with a
   human-readable label. The analyst should treat the model's
   probability as one input among several.
2. **Auditability.** The explanation payload (SHAP values or LIME
   weights) is persisted alongside every `Prediction` row in the
   `Explanation` table, so the dashboard's History tab can re-render
   any past explanation exactly as it was produced at inference time.

The XAI layer **does not** establish causation. The wording rule
below makes this explicit in every human-readable summary.

---

## SHAP for transactions

### Method

The transaction explainer (`TransactionExplainer` in `xai_engine.py`)
uses **`shap.TreeExplainer`** on the active XGBoost model. Tree SHAP is
an exact polynomial-time algorithm for tree ensembles; it returns
per-feature SHAP values for a single input row such that
`sum(SHAP_values) + baseline == model_output`.

For the LR and RF fallback models (used only in the Model Performance
tab for comparison, not for live inference), the explainer falls back
to `shap.KernelExplainer` with a small precomputed background sample
(`models/shap_background.joblib` — 100 legitimate PaySim rows).

### Output shape

For a single transaction input, `TransactionExplainer.explain(X)`
returns:

```json
{
  "method": "tree",
  "baseline": <float>,                 // expected value of the fraud class
  "contributions": [                   // all 14 features, in feature order
    {"feature": "amount", "human_label": "Transaction amount",
     "value": 12345.0, "contribution": 0.42},
    ...
  ],
  "top_positive": [...],               // top 5 features with contribution > 0
                                        // (pushed the prediction toward FRAUD)
  "top_negative": [...],               // top 5 features with contribution < 0
                                        // (pushed the prediction toward LEGITIMATE)
  "human_summary": "The following features contributed to the model's
                   prediction: 'Change in sender's balance', ...
                   These values pushed the model toward a higher fraud
                   probability. Note: SHAP values describe model
                   contributions, not causal effects."
}
```

The dashboard's `ContributionsChart` renders positive contributors as
red bars to the right (push toward fraud) and negative contributors as
green bars to the left (push toward legitimate), sorted by absolute
contribution.

### Feature → human-label mapping

The full mapping (used by both `TransactionExplainer` and the dashboard)
is:

| Technical feature | Human-readable label |
|---|---|
| `amount` | Transaction amount |
| `oldbalanceOrg` | Sender's balance before |
| `newbalanceOrig` | Sender's balance after |
| `oldbalanceDest` | Receiver's balance before |
| `newbalanceDest` | Receiver's balance after |
| `orig_balance_change` | Change in sender's balance |
| `dest_balance_change` | Change in receiver's balance |
| `amount_to_orig_balance` | Amount as fraction of sender's balance |
| `amount_to_dest_balance` | Amount as fraction of receiver's balance |
| `type_CASH_IN` | Transaction type: CASH_IN |
| `type_CASH_OUT` | Transaction type: CASH_OUT |
| `type_DEBIT` | Transaction type: DEBIT |
| `type_PAYMENT` | Transaction type: PAYMENT |
| `type_TRANSFER` | Transaction type: TRANSFER |

### Example — transaction SHAP

Input (a PaySim-style fraudulent transfer):

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

XGBoost prediction: `prediction = 1 (fraud)`, `probability = 0.9998`.

Top 5 positive contributors (push toward fraud):

| Feature | Human label | Value | Contribution |
|---|---|---:|---:|
| `type_TRANSFER` | Transaction type: TRANSFER | 1.0 | +1.92 |
| `amount_to_orig_balance` | Amount as fraction of sender's balance | 1.0 | +1.45 |
| `orig_balance_change` | Change in sender's balance | −4,800,000 | +0.88 |
| `dest_balance_change` | Change in receiver's balance | +4,800,000 | +0.71 |
| `amount` | Transaction amount | 4,800,000 | +0.32 |

Top 5 negative contributors (push toward legitimate):

| Feature | Human label | Value | Contribution |
|---|---|---:|---:|
| `type_CASH_IN` | Transaction type: CASH_IN | 0.0 | −0.04 |
| `type_PAYMENT` | Transaction type: PAYMENT | 0.0 | −0.03 |
| `type_DEBIT` | Transaction type: DEBIT | 0.0 | −0.01 |
| `oldbalanceDest` | Receiver's balance before | 0.0 | ~0.00 |
| `newbalanceOrig` | Sender's balance after | 0.0 | ~0.00 |

Human-readable summary (exact wording from `xai_engine.py`):

> The following features contributed to the model's prediction:
> 'Transaction type: TRANSFER', 'Amount as fraction of sender's
> balance', 'Change in sender's balance'. These values pushed the
> model toward a higher fraud probability. Note: SHAP values describe
> model contributions, not causal effects.

---

## LIME for messages

### Method

The message explainer (`MessageExplainer` in `xai_engine.py`) uses
**`lime.lime_text.LimeTextExplainer`**. LIME works by:

1. **Perturbing** the input text — generating `num_samples=1000`
   variations by randomly removing tokens.
2. **Scoring** each perturbation with the underlying TF-IDF + LR
   pipeline (`pipeline.predict_proba(perturbations)`).
3. **Fitting a local linear model** on the TF-IDF features of the
   perturbations, weighted by proximity to the original input.
4. **Returning the top `num_features=10` tokens with their LIME
   weights**, where the weight is for the scam class (index 1).

### Output shape

For a single message input, `MessageExplainer.explain(text,
num_features=10)` returns:

```json
{
  "method": "lime",
  "tokens": [                          // top 10 tokens by |weight|
    {"token": "otp",   "weight": 0.34},
    {"token": "verify", "weight": 0.21},
    ...
  ],
  "top_positive": [...],               // top 5 tokens with weight > 0
                                        // (pushed the prediction toward SCAM)
  "top_negative": [...],               // top 5 tokens with weight < 0
                                        // (pushed the prediction toward LEGITIMATE)
  "detected_keywords": {               // linguistic signals, NOT model contributions
    "otp_patterns": ["4521"],
    "urls": ["http://"],
    "currency": ["Rs"],
    "urgency_words": ["verify", "blocked", "otp"]
  },
  "human_summary": "The following tokens contributed to the model's
                   prediction: 'otp', 'verify', 'blocked'. These tokens
                   pushed the model toward a higher scam probability.
                   LIME weights describe model contributions, not causal
                   effects."
}
```

### Detected linguistic signals — additional context, not model contributions

`xai_engine.py::detect_keywords` runs four regexes over the input
text and returns the matches:

| Signal | Regex | Example matches |
|---|---|---|
| OTP patterns | `\b\d{4,8}\b` | `4521`, `987654` |
| URLs | `https?:// | www\. | \.in | \.com` (case-insensitive) | `http://upi-verify.in` |
| Currency | `₹ | Rs\.? | rupee | INR` (case-insensitive) | `Rs`, `₹5000` |
| Urgency words | `urgent | immediately | now | verify | account | blocked | suspend | otp | kyc | deadline | expire | warn | alert | failed` and Hindi/Hinglish equivalents `turant | abhi | jaldi | avashyak | block | expir` (case-insensitive) | `verify`, `blocked`, `otp` |

These signals are reported in the dashboard as **additional context
badges** alongside the LIME chart. They are **not** LIME weights — they
do not represent model contributions, and they should not be read as
"these tokens caused the model to predict scam". They are a separate
heuristic layer for the analyst to use alongside the model-based LIME
explanation.

### Empty / whitespace-only input

LIME's `lime_text.LimeTextExplainer.explain_instance` crashes on
empty or whitespace-only input (`randint(1, 1)` fails because there
are no token positions to perturb). The prototype's `MessageExplainer`
handles this with an early return:

```json
{
  "method": "lime",
  "tokens": [],
  "top_positive": [],
  "top_negative": [],
  "detected_keywords": {"otp_patterns": [], "urls": [], "currency": [], "urgency_words": []},
  "human_summary": "The input text is empty, so the model had no tokens
                   to evaluate. LIME weights describe model contributions,
                   not causal effects."
}
```

This returns HTTP 200 (not 500) and is disclosed honestly in the UI.

### Example — message LIME

Input (a Hinglish KYC scam):

> "Aapka account block ho jayega! OTP 4521 verify karein turant -
> http://upi-verify.in"

Auto-detected language: `hinglish`. Model: `nlp_hinglish`. Prediction:
`prediction = 1 (scam)`, `probability = 0.86`.

Top LIME tokens by absolute weight:

| Token | Weight | Direction |
|---|---:|---|
| `otp` | +0.34 | scam |
| `verify` | +0.21 | scam |
| `blocked` | +0.18 | scam |
| `http` | +0.14 | scam |
| `turant` | +0.11 | scam |
| `account` | +0.08 | scam |
| `karein` | −0.04 | legitimate |
| `aapka` | −0.03 | legitimate |
| `upi-verify` | +0.02 | scam |
| `4521` | +0.02 | scam |

Detected linguistic signals (separate heuristic layer):

- `otp_patterns`: `["4521"]`
- `urls`: `["http://", ".in"]`
- `currency`: `[]`
- `urgency_words`: `["verify", "blocked", "otp", "turant"]`

Human-readable summary (exact wording from `xai_engine.py`):

> The following tokens contributed to the model's prediction: 'otp',
> 'verify', 'blocked'. These tokens pushed the model toward a higher
> scam probability. LIME weights describe model contributions, not
> causal effects.

---

## Wording rule — never causal

The XAI layer enforces a strict wording rule for human-readable
summaries:

- ✅ "The following features/tokens **contributed to the model's
  prediction** …"
- ✅ "These values/tokens **pushed the model toward** a higher
  fraud/scam probability."
- ✅ "Note: SHAP/LIME values **describe model contributions, not
  causal effects**."
- ❌ Never "caused".
- ❌ Never "is the reason for".
- ❌ Never "explains why this is fraud" (implies causation).

This wording is enforced in code in `xai_engine.py` for both the
`TransactionExplainer` and `MessageExplainer` summaries. The
disclaimer "SHAP/LIME values describe model contributions, not causal
effects" is included in every explanation payload and rendered
prominently in the dashboard's Explanation tab.

### Disclaimer displayed in the UI

The dashboard displays the no-causal-interpretation disclaimer:

- In the footer of every page (along with the research-prototype
  disclaimer).
- In the Explanation View tab, directly under the contributions chart.
- In the About / Dataset tab, in the limitations card.

---

_Research prototype — not for production use. SHAP and LIME
explanations describe model contributions, not causal effects._
