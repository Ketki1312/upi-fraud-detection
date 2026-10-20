"""
xai_engine.py — Real SHAP (transactions) and LIME (messages) explanations.

Transactions:
    Use shap.TreeExplainer on the XGBoost model (fast, exact for trees).
    Fall back to shap.KernelExplainer for LR/RF.
    Return top 5 positive + top 5 negative feature contributors with
    human-readable labels.

Messages:
    Use lime.lime_text.LimeTextExplainer.
    Return tokens with weights, top 5 positive (scam-indicating),
    top 5 negative (legitimate-indicating).

    Also include `detected_keywords` — regex-detected linguistic signals
    (OTP, URL, currency, urgency) — these are linguistic signals, NOT causal.

Wording rule:
    Human-readable summaries MUST say "contributed to the model's prediction".
    Never imply causality.
"""
from __future__ import annotations
import re
from typing import Dict, Any, List, Optional, Tuple

import numpy as np
import pandas as pd

import shap
from lime.lime_text import LimeTextExplainer


# ---------------------------------------------------------------------------
# Feature-name mapping (technical -> human-readable)
# ---------------------------------------------------------------------------
FEATURE_LABELS: Dict[str, str] = {
    "amount": "Transaction amount",
    "oldbalanceOrg": "Sender's balance before",
    "newbalanceOrig": "Sender's balance after",
    "oldbalanceDest": "Receiver's balance before",
    "newbalanceDest": "Receiver's balance after",
    "orig_balance_change": "Change in sender's balance",
    "dest_balance_change": "Change in receiver's balance",
    "amount_to_orig_balance": "Amount as fraction of sender's balance",
    "amount_to_dest_balance": "Amount as fraction of receiver's balance",
    "type_CASH_IN": "Transaction type: CASH_IN",
    "type_CASH_OUT": "Transaction type: CASH_OUT",
    "type_DEBIT": "Transaction type: DEBIT",
    "type_PAYMENT": "Transaction type: PAYMENT",
    "type_TRANSFER": "Transaction type: TRANSFER",
}


def human_label(feature: str) -> str:
    return FEATURE_LABELS.get(feature, feature)


# ---------------------------------------------------------------------------
# Transaction SHAP explanation
# ---------------------------------------------------------------------------
class TransactionExplainer:
    """Wraps a TreeExplainer (XGBoost) or KernelExplainer (LR/RF) on a
    trained sklearn Pipeline. The pipeline is expected to expose
    `.predict_proba` and a `.named_steps` dict where the final estimator is
    the model and an optional scaler exists.
    """

    def __init__(self, pipeline, feature_names: List[str],
                 background: Optional[pd.DataFrame] = None,
                 method: str = "auto"):
        self.pipeline = pipeline
        self.feature_names = list(feature_names)
        self.method = method
        self._explainer = None
        self._background = background
        self._init_explainer()

    def _final_model(self):
        # The pipeline's last step is the classifier.
        last_name, last_step = list(self.pipeline.named_steps.items())[-1]
        return last_step

    def _preprocess(self, X: pd.DataFrame) -> Any:
        """Run all pipeline steps EXCEPT the final classifier to get
        the transformed feature space (e.g. scaled)."""
        steps = list(self.pipeline.named_steps.values())
        X_t = X
        for step in steps[:-1]:
            X_t = step.transform(X_t)
        return X_t

    def _init_explainer(self):
        model = self._final_model()
        # Try TreeExplainer for XGBoost / RF / tree-based.
        is_tree = (
            hasattr(model, "estimators_") or  # RF
            type(model).__name__.startswith("XGB") or
            "XGB" in type(model).__name__
        )
        if (self.method in ("auto", "tree")) and is_tree:
            try:
                self._explainer = shap.TreeExplainer(model)
                self.method = "tree"
                return
            except Exception:
                pass
        # Fall back to KernelExplainer using a small background.
        if self.method in ("auto", "kernel"):
            bg = self._background
            if bg is None:
                bg = pd.DataFrame(
                    np.zeros((1, len(self.feature_names))),
                    columns=self.feature_names,
                )
            bg_t = self._preprocess(bg)
            try:
                self._explainer = shap.KernelExplainer(
                    model.predict_proba, bg_t
                )
                self.method = "kernel"
                return
            except Exception:
                pass
        # If everything fails, fallback to a simple linear-approx explanation
        self.method = "none"
        self._explainer = None

    def explain(self, X: pd.DataFrame) -> Dict[str, Any]:
        """Return SHAP-based explanation for the rows in X (typically 1 row)."""
        # Transform through preprocessing steps (scaler, etc.)
        X_t = self._preprocess(X)
        model = self._final_model()

        if self._explainer is not None and self.method == "tree":
            shap_values = self._explainer.shap_values(X_t)
            shap_values = np.asarray(shap_values)
            # TreeExplainer on binary classifiers returns either:
            #   (n_samples, n_features)   (newer API)
            #   list of two arrays         (older API)
            if isinstance(shap_values, list):
                # take the fraud class (index 1)
                shap_arr = shap_values[1]
            else:
                shap_arr = shap_values
                if shap_arr.ndim == 3:
                    shap_arr = shap_arr[:, :, 1]
            baseline = float(self._explainer.expected_value[1]
                             if isinstance(self._explainer.expected_value,
                                           (list, np.ndarray))
                             else self._explainer.expected_value)
        elif self._explainer is not None and self.method == "kernel":
            # KernelExplainer returns probabilities for both classes; take
            # the scam/fraud class (index 1) contributions.
            try:
                sv = self._explainer.shap_values(X_t, silent=True)
                if isinstance(sv, list):
                    shap_arr = np.asarray(sv[1])
                else:
                    shap_arr = np.asarray(sv)
                    if shap_arr.ndim == 3:
                        shap_arr = shap_arr[:, :, 1]
                ev = self._explainer.expected_value
                baseline = float(ev[1] if isinstance(ev, (list, np.ndarray)) else ev)
            except Exception:
                shap_arr = np.zeros(X_t.shape)
                baseline = 0.0
        else:
            # Linear fallback: use model coefficients if available
            shap_arr = np.zeros(X_t.shape)
            baseline = 0.0
            if hasattr(model, "coef_"):
                coef = model.coef_[0]
                shap_arr = (X_t * coef).astype(float)
                # rough baseline so that sum+baseline ~ 0
                baseline = float(-np.mean(shap_arr))

        # Take the first (and typically only) row.
        shap_row = shap_arr[0] if shap_arr.ndim > 1 else shap_arr
        feat_values = X.iloc[0].to_dict() if hasattr(X, "iloc") else {}
        contributions: List[Dict[str, Any]] = []
        for i, feat in enumerate(self.feature_names):
            contributions.append({
                "feature": feat,
                "human_label": human_label(feat),
                "value": float(feat_values.get(feat, 0.0))
                         if isinstance(feat_values.get(feat, 0.0), (int, float, np.floating, np.integer))
                         else float(X_t[0, i] if hasattr(X_t, "__getitem__") else 0.0),
                "contribution": float(shap_row[i]) if i < len(shap_row) else 0.0,
            })

        # Sort by contribution descending.
        sorted_pos = sorted(
            [c for c in contributions if c["contribution"] > 0],
            key=lambda c: c["contribution"], reverse=True
        )[:5]
        sorted_neg = sorted(
            [c for c in contributions if c["contribution"] < 0],
            key=lambda c: c["contribution"]
        )[:5]

        # Human-readable summary wording (NO causality)
        top_pos_phrase = (
            ", ".join(f"'{c['human_label']}'" for c in sorted_pos[:3])
            if sorted_pos else "no single feature"
        )
        summary = (
            f"The following features contributed to the model's prediction: "
            f"{top_pos_phrase}. These values pushed the model toward a higher "
            f"fraud probability. Note: SHAP values describe model contributions, "
            f"not causal effects."
        )

        return {
            "method": self.method,
            "baseline": round(baseline, 6),
            "contributions": contributions,
            "top_positive": sorted_pos,
            "top_negative": sorted_neg,
            "human_summary": summary,
        }


# ---------------------------------------------------------------------------
# Message LIME explanation
# ---------------------------------------------------------------------------
# Regex-detected linguistic signals. These are signals, NOT causal.
OTP_RE = re.compile(r"\b\d{4,8}\b")
URL_RE = re.compile(r"https?://|www\.|\.in|\.com", re.IGNORECASE)
CURRENCY_RE = re.compile(r"₹|Rs\.?|rupee|INR", re.IGNORECASE)
URGENCY_WORDS = re.compile(
    r"\b(urgent|immediately|now|verify|account|blocked|suspend|"
    r"otp|kyc|deadline|expire|warn|alert|failed|verify|"
    # Hindi/Hinglish equivalents
    r"turant|abhi|jaldi|avashyak|verify|account|block|"
    r"otp|kyc|expir|deadline|verify|alert)\b",
    re.IGNORECASE,
)


def detect_keywords(text: str) -> Dict[str, List[str]]:
    """Return linguistic signals detected in the text. Signals, NOT causal."""
    if not isinstance(text, str):
        text = str(text)
    found_otp = OTP_RE.findall(text)
    found_url = URL_RE.findall(text)
    found_currency = CURRENCY_RE.findall(text)
    found_urgency = URGENCY_WORDS.findall(text)
    return {
        "otp_patterns": list(dict.fromkeys(found_otp))[:5],
        "urls": list(dict.fromkeys(found_url))[:5],
        "currency": list(dict.fromkeys(found_currency))[:5],
        "urgency_words": list(dict.fromkeys([w.lower() for w in found_urgency]))[:10],
    }


class MessageExplainer:
    """Wraps a LIME LimeTextExplainer around a sklearn Pipeline that maps
    raw text -> probability. The pipeline is expected to be
    `TfidfVectorizer` -> `LogisticRegression`.
    """

    def __init__(self, pipeline, class_names=("legitimate", "scam")):
        self.pipeline = pipeline
        self.class_names = class_names
        self.explainer = LimeTextExplainer(
            class_names=list(class_names), split_expression=r"\W+"
        )

    def _predict_proba_text(self, texts: List[str]) -> np.ndarray:
        # Pipeline handles raw text -> vectorize -> predict_proba
        proba = self.pipeline.predict_proba(texts)
        return np.asarray(proba)

    def explain(self, text: str, num_features: int = 10) -> Dict[str, Any]:
        if not isinstance(text, str):
            text = str(text)
        # LIME crashes on empty/whitespace-only text (it samples random token
        # positions and randint(1, 1) fails). Return a safe, honest default.
        stripped = (text or "").strip()
        if not stripped:
            return {
                "method": "lime",
                "tokens": [],
                "top_positive": [],
                "top_negative": [],
                "detected_keywords": detect_keywords(text),
                "human_summary": (
                    "The input text is empty, so the model had no tokens to "
                    "evaluate. LIME weights describe model contributions, not "
                    "causal effects."
                ),
            }
        exp = self.explainer.explain_instance(
            text,
            classifier_fn=self._predict_proba_text,
            num_features=num_features,
            num_samples=1000,  # default 5000 is too memory-heavy for sandbox
        )
        # exp.as_list() returns [(token, weight), ...] where weight is for
        # the *second* class (scam, index 1) by default in LIME.
        token_weights = [
            {"token": tok, "weight": float(w)} for tok, w in exp.as_list()
        ]
        pos = sorted(
            [t for t in token_weights if t["weight"] > 0],
            key=lambda t: t["weight"], reverse=True
        )[:5]
        neg = sorted(
            [t for t in token_weights if t["weight"] < 0],
            key=lambda t: t["weight"]
        )[:5]

        top_pos_phrase = (
            ", ".join(f"'{t['token']}'" for t in pos[:3]) if pos else "no specific token"
        )
        summary = (
            f"The following tokens contributed to the model's prediction: "
            f"{top_pos_phrase}. These tokens pushed the model toward a higher "
            f"scam probability. LIME weights describe model contributions, "
            f"not causal effects."
        )

        return {
            "method": "lime",
            "tokens": token_weights,
            "top_positive": pos,
            "top_negative": neg,
            "detected_keywords": detect_keywords(text),
            "human_summary": summary,
        }
