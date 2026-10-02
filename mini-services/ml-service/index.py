"""
index.py — FastAPI service for the UPI Fraud Detection ML prototype.

Exposes 13 endpoints on port 4000 (run with `python3 -m uvicorn index:app --port 4000`).

Endpoints:
    GET  /health
    POST /api/v1/transactions/analyze
    POST /api/v1/messages/analyze
    POST /api/v1/risk/analyze
    GET  /api/v1/dashboard/summary
    GET  /api/v1/dashboard/trends
    GET  /api/v1/drift/status
    GET  /api/v1/drift/history
    GET  /api/v1/models
    POST /api/v1/models/retrain

CORS is enabled for all origins (dev environment).
"""
from __future__ import annotations
import json
import os
import re
import time
import math
import threading
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Optional, Union

import joblib
import numpy as np
import pandas as pd

from fastapi import FastAPI, HTTPException, Body
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel, Field

# Local modules
from risk_engine import build_risk_response, transaction_risk_score, message_risk_score, DISCLAIMER
from drift_engine import evaluate_drift
from xai_engine import TransactionExplainer, MessageExplainer

# Reuse constants from train.py
from train import (
    TX_FEATURES, load_paysim_split, compute_classification_metrics,
    MODELS_DIR, METADATA_DIR,
)

# ---------------------------------------------------------------------------
# Config
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "raw"
PAYSIM_DIR = DATA_DIR / "paysim"

app = FastAPI(
    title="UPI Fraud Detection ML Service",
    description="Academic research prototype — FastAPI service exposing "
                "transaction fraud detection, multilingual message scam detection, "
                "risk fusion, SHAP/LIME XAI, PSI drift detection, and adaptive "
                "model retraining. Built on public/synthetic datasets.",
    version="1.0.0",
)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Model loading (lazy + cached)
# ---------------------------------------------------------------------------
_MODELS: Dict[str, Any] = {}
_MODELS_LOCK = threading.Lock()
_SHAP_BACKGROUND = None


def _load_json(p: Path) -> dict:
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def get_transaction_metadata() -> dict:
    return _load_json(METADATA_DIR / "transaction_models.json")


def get_nlp_metadata() -> dict:
    return _load_json(METADATA_DIR / "nlp_models.json")


def get_dataset_audit() -> dict:
    return _load_json(METADATA_DIR / "dataset_audit.json")


def get_drift_reference() -> dict:
    return _load_json(METADATA_DIR / "drift_reference.json")


def get_drift_history() -> List[dict]:
    p = METADATA_DIR / "drift_history.json"
    if not p.exists():
        return []
    try:
        return json.loads(p.read_text())
    except Exception:
        return []


def load_all_models() -> Dict[str, Any]:
    """Load all trained model pipelines into memory (cached)."""
    global _SHAP_BACKGROUND
    with _MODELS_LOCK:
        if _MODELS.get("_loaded"):
            return _MODELS
        # Transaction models
        for name in ("transaction_xgboost", "transaction_lr", "transaction_rf"):
            p = MODELS_DIR / f"{name}.joblib"
            if p.exists():
                _MODELS[name] = joblib.load(p)
        # NLP models
        nlp_files = {
            "nlp_hi": "nlp_tfidf_lr_hi.joblib",
            "nlp_hinglish": "nlp_tfidf_lr_hinglish.joblib",
            "nlp_en": "nlp_tfidf_lr_en.joblib",
            "nlp_combined": "nlp_tfidf_lr_combined.joblib",
        }
        for name, fname in nlp_files.items():
            p = MODELS_DIR / fname
            if p.exists():
                _MODELS[name] = joblib.load(p)
        # Precomputed SHAP background (small, 100 rows)
        bg_path = MODELS_DIR / "shap_background.joblib"
        if bg_path.exists():
            try:
                _SHAP_BACKGROUND = joblib.load(bg_path)
            except Exception:
                _SHAP_BACKGROUND = None
        _MODELS["_loaded"] = True
    return _MODELS


# Load models eagerly at startup
load_all_models()


# ---------------------------------------------------------------------------
# Pydantic schemas
# ---------------------------------------------------------------------------
class TransactionInput(BaseModel):
    step: int = Field(0, description="Time step (1 hour window in PaySim)")
    type: str = Field(..., description="Transaction type: CASH_IN, CASH_OUT, DEBIT, PAYMENT, TRANSFER")
    amount: float = Field(..., ge=0)
    oldbalanceOrg: float = Field(0.0)
    newbalanceOrig: float = Field(0.0)
    oldbalanceDest: float = Field(0.0)
    newbalanceDest: float = Field(0.0)


class MessageInput(BaseModel):
    text: str
    language: Optional[str] = Field(None, description="Optional: hi | hinglish | en. If omitted, auto-detected.")


class RiskInput(BaseModel):
    transaction: Optional[TransactionInput] = None
    message: Optional[MessageInput] = None
    transaction_probability: Optional[float] = Field(None, ge=0, le=1)
    message_probability: Optional[float] = Field(None, ge=0, le=1)
    fusion_method: Optional[str] = Field(None, description="max | weighted")


class RetrainInput(BaseModel):
    model_name: str
    drift_window: Optional[Dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Feature engineering for transactions
# ---------------------------------------------------------------------------
def derive_transaction_features(tx: TransactionInput) -> pd.DataFrame:
    """Build the 14-feature PaySim row from raw input."""
    type_ = (tx.type or "").upper()
    type_map = {
        "CASH_IN": "type_CASH_IN",
        "CASH_OUT": "type_CASH_OUT",
        "DEBIT": "type_DEBIT",
        "PAYMENT": "type_PAYMENT",
        "TRANSFER": "type_TRANSFER",
    }
    feat = {
        "amount": float(tx.amount),
        "oldbalanceOrg": float(tx.oldbalanceOrg),
        "newbalanceOrig": float(tx.newbalanceOrig),
        "oldbalanceDest": float(tx.oldbalanceDest),
        "newbalanceDest": float(tx.newbalanceDest),
    }
    # Derived balance-change features
    feat["orig_balance_change"] = feat["newbalanceOrig"] - feat["oldbalanceOrg"]
    feat["dest_balance_change"] = feat["newbalanceDest"] - feat["oldbalanceDest"]
    feat["amount_to_orig_balance"] = (
        feat["amount"] / feat["oldbalanceOrg"]
        if feat["oldbalanceOrg"] else 0.0
    )
    feat["amount_to_dest_balance"] = (
        feat["amount"] / feat["oldbalanceDest"]
        if feat["oldbalanceDest"] else 0.0
    )
    # Type one-hot
    for col_suffix in ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"]:
        feat[f"type_{col_suffix}"] = 1.0 if type_ == col_suffix else 0.0
    # Build dataframe with feature order
    row = {f: feat[f] for f in TX_FEATURES}
    return pd.DataFrame([row], columns=TX_FEATURES)


# ---------------------------------------------------------------------------
# Language detection
# ---------------------------------------------------------------------------
DEVANAGARI_RE = re.compile(r"[\u0900-\u097F]")
HINGLISH_TOKENS = re.compile(
    r"\b(aap|aapka|aapke|karo|kar|hai|hain|nahi|nahin|se|ko|ki|ka|ke|liye|"
    r"rupaye|rupee|paisa|otp|kyc|turant|abhi|jaldi|verify|account|block|"
    r"warning|kaise|kyu|kya|ho|raha|rahe|chahiye|dena|deni|leva|liya|"
    r"payment|refund|bhej|bheji|samjh|smjh|madad|help|"
    r"aapko|mera|meri|tum|tumhara)\b",
    re.IGNORECASE,
)


def detect_language(text: str) -> str:
    if not text:
        return "en"
    if DEVANAGARI_RE.search(text):
        return "hi"
    if HINGLISH_TOKENS.search(text):
        return "hinglish"
    return "en"


# ---------------------------------------------------------------------------
# Endpoints
# ---------------------------------------------------------------------------
@app.get("/health")
def health() -> Dict[str, Any]:
    """Service health + model loading status + provenance disclosure."""
    tx_meta = get_transaction_metadata()
    nlp_meta = get_nlp_metadata()
    audit = get_dataset_audit()
    tx_models = tx_meta.get("models", {})
    nlp_models = nlp_meta.get("models", {})

    def _loaded(model_name: str) -> bool:
        return (model_name in _MODELS) or (
            model_name in tx_models and tx_models[model_name].get("artifact")
            and (MODELS_DIR / Path(tx_models[model_name]["artifact"]).name).exists()
        )

    return {
        "status": "ok",
        "models_loaded": {
            "transaction": _loaded("transaction_xgboost"),
            "nlp_english": "nlp_en" in _MODELS,
            "nlp_hindi": "nlp_hi" in _MODELS,
            "nlp_hinglish": "nlp_hinglish" in _MODELS,
            "nlp_combined": "nlp_combined" in _MODELS,
        },
        "model_versions": {
            "transaction_xgboost": tx_models.get("transaction_xgboost", {}).get("version"),
            "transaction_lr": tx_models.get("transaction_lr", {}).get("version"),
            "transaction_rf": tx_models.get("transaction_rf", {}).get("version"),
            "nlp_hi": nlp_models.get("nlp_hi", {}).get("version"),
            "nlp_hinglish": nlp_models.get("nlp_hinglish", {}).get("version"),
            "nlp_en": nlp_models.get("nlp_en", {}).get("version"),
            "nlp_combined": nlp_models.get("nlp_combined", {}).get("version"),
        },
        "provenance_disclosure": {
            "PaySim": "public mobile-money simulator (NOT real UPI banking data)",
            "Hindi": "synthetic (source=Synthetic)",
            "Hinglish": "synthetic (source=Synthetic)",
            "English": nlp_meta.get("english_status", "not_trained"),
        },
        "disclaimer": DISCLAIMER,
        "service": "ml-service",
        "timestamp": iso_now(),
    }


@app.post("/api/v1/transactions/analyze")
def analyze_transaction(tx: TransactionInput) -> Dict[str, Any]:
    """Run XGBoost fraud prediction + SHAP explanation on a single transaction."""
    if "transaction_xgboost" not in _MODELS:
        raise HTTPException(status_code=503,
                            detail="Transaction model not loaded. Run train.py first.")
    pipeline = _MODELS["transaction_xgboost"]
    X = derive_transaction_features(tx)
    proba = float(pipeline.predict_proba(X)[0, 1])
    pred = int(proba >= 0.5)
    score, level = transaction_risk_score(proba)

    # SHAP explanation
    tx_meta = get_transaction_metadata()
    # Use precomputed SHAP background (100 legitimate rows saved by train.py)
    background = _SHAP_BACKGROUND
    explainer = TransactionExplainer(
        pipeline, feature_names=TX_FEATURES,
        background=background, method="auto"
    )
    explanation = explainer.explain(X)

    return {
        "prediction": pred,
        "probability": round(proba, 6),
        "risk_score": round(score, 4),
        "risk_level": level,
        "model_version": tx_meta.get("active_version", "1.0.0"),
        "model_name": "transaction_xgboost",
        "explanation": explanation,
        "input_features": X.iloc[0].to_dict(),
        "disclaimer": DISCLAIMER,
    }


@app.post("/api/v1/messages/analyze")
def analyze_message(msg: MessageInput) -> Dict[str, Any]:
    """Run NLP scam prediction + LIME explanation on a single message."""
    # Auto-detect language if not provided
    language = (msg.language or "").lower()
    if language not in ("hi", "hinglish", "en"):
        language = detect_language(msg.text)

    model_name_map = {"hi": "nlp_hi", "hinglish": "nlp_hinglish", "en": "nlp_en"}
    model_name = model_name_map.get(language, "nlp_en")
    if model_name not in _MODELS:
        # Fall back to combined
        if "nlp_combined" in _MODELS:
            model_name = "nlp_combined"
        else:
            raise HTTPException(
                status_code=503,
                detail=f"No NLP model available for language={language}; "
                       f"train models first."
            )
    pipeline = _MODELS[model_name]
    text = msg.text
    proba = float(pipeline.predict_proba([text])[0, 1])
    pred = int(proba >= 0.5)
    score, level = message_risk_score(proba)

    # LIME explanation
    explainer = MessageExplainer(pipeline, class_names=("legitimate", "scam"))
    explanation = explainer.explain(text, num_features=10)

    nlp_meta = get_nlp_metadata()
    version = nlp_meta.get("models", {}).get(model_name, {}).get("version", "1.0.0")
    return {
        "prediction": pred,
        "probability": round(proba, 6),
        "risk_score": round(score, 4),
        "risk_level": level,
        "model_version": version,
        "model_name": model_name,
        "language_detected": language,
        "explanation": explanation,
        "disclaimer": DISCLAIMER,
    }


@app.post("/api/v1/risk/analyze")
def analyze_risk(req: RiskInput) -> Dict[str, Any]:
    """Fuse transaction + message risks into a unified score."""
    tx_prob = req.transaction_probability
    msg_prob = req.message_probability
    # If pre-computed probabilities are not provided but raw inputs are, compute them
    if tx_prob is None and req.transaction is not None:
        if "transaction_xgboost" in _MODELS:
            X = derive_transaction_features(req.transaction)
            tx_prob = float(_MODELS["transaction_xgboost"].predict_proba(X)[0, 1])
    if msg_prob is None and req.message is not None:
        # Auto-detect language
        lang = (req.message.language or "").lower()
        if lang not in ("hi", "hinglish", "en"):
            lang = detect_language(req.message.text)
        model_name = {"hi": "nlp_hi", "hinglish": "nlp_hinglish",
                      "en": "nlp_en"}.get(lang, "nlp_en")
        if model_name not in _MODELS and "nlp_combined" in _MODELS:
            model_name = "nlp_combined"
        if model_name in _MODELS:
            msg_prob = float(_MODELS[model_name].predict_proba([req.message.text])[0, 1])
    return build_risk_response(tx_prob, msg_prob, method=req.fusion_method)


@app.get("/api/v1/dashboard/summary")
def dashboard_summary() -> Dict[str, Any]:
    """Service-side aggregates from metadata/*.json.

    Note: actual prediction history is persisted by the Next.js side via Prisma.
    This endpoint returns reference data: model metrics, drift summary,
    and dataset audit summary.
    """
    tx_meta = get_transaction_metadata()
    nlp_meta = get_nlp_metadata()
    audit = get_dataset_audit()
    drift_ref = get_drift_reference()
    drift_history = get_drift_history()

    # Build model_metrics list
    model_metrics: List[Dict[str, Any]] = []
    for name, info in tx_meta.get("models", {}).items():
        m = info.get("metrics", {})
        model_metrics.append({
            "name": name, "version": info.get("version"),
            "type": info.get("type"),
            "active": info.get("active", False),
            "dataset_version": info.get("dataset_version"),
            "metrics": {
                "precision": m.get("precision"),
                "recall": m.get("recall"),
                "f1": m.get("f1"),
                "roc_auc": m.get("roc_auc"),
                "pr_auc": m.get("pr_auc"),
            },
            "training_timestamp": info.get("training_timestamp"),
        })
    for name, info in nlp_meta.get("models", {}).items():
        m = info.get("metrics", {}) if info.get("trained") else {}
        model_metrics.append({
            "name": name, "version": info.get("version"),
            "type": info.get("type"),
            "active": info.get("active", False),
            "trained": info.get("trained", False),
            "language": info.get("language"),
            "status": info.get("status"),
            "metrics": {
                "precision": m.get("precision"),
                "recall": m.get("recall"),
                "f1": m.get("f1"),
                "roc_auc": m.get("roc_auc"),
                "pr_auc": m.get("pr_auc"),
            },
            "training_timestamp": info.get("training_timestamp"),
        })

    # Dataset audit summary (counts only)
    datasets_summary = {}
    p = audit.get("datasets", {})
    if "PaySim" in p:
        ps = p["PaySim"]["splits"]
        datasets_summary["PaySim"] = {
            "train_rows": ps.get("train", {}).get("row_count"),
            "test_rows": ps.get("test", {}).get("row_count"),
            "validation_rows": ps.get("validation", {}).get("row_count"),
            "fraud_rate_train": ps.get("train", {}).get("fraud_rate"),
            "provenance": p["PaySim"]["provenance"],
        }
    for ds in ("Hindi", "Hinglish", "English"):
        if ds in p:
            d = p[ds]
            datasets_summary[ds] = {
                "available": d.get("available", False),
                "rows": d.get("stats", {}).get("row_count") if d.get("available") else 0,
                "provenance": d.get("provenance"),
            }

    # Drift summary from the latest drift_history events
    drift_summary = {
        "total_events": len(drift_history),
        "latest_event": drift_history[-1] if drift_history else None,
        "reference_features_count": len(
            [k for k in drift_ref.keys() if k not in
             ("generated_at", "source", "dataset_version", "features", "bins_default")]
        ),
    }

    return {
        "service": "ml-service",
        "generated_at": iso_now(),
        "disclaimer": DISCLAIMER,
        "model_metrics": model_metrics,
        "datasets_summary": datasets_summary,
        "drift_summary": drift_summary,
    }


@app.get("/api/v1/dashboard/trends")
def dashboard_trends() -> Dict[str, Any]:
    """Return fraud-rate trend by PaySim step-window (real data, not hardcoded)."""
    audit = get_dataset_audit()
    p = audit.get("datasets", {}).get("PaySim", {})
    splits = p.get("splits", {})
    train_trend = splits.get("train", {}).get("temporal_per_step_window", [])
    test_trend = splits.get("test", {}).get("temporal_per_step_window", [])
    val_trend = splits.get("validation", {}).get("temporal_per_step_window", [])

    # Combined timestamps (step_windows) + risk/fraud-rate trends
    step_windows = [r["step_window"] for r in train_trend]
    fraud_rate_train = [r["fraud_rate"] for r in train_trend]
    fraud_count_train = [r["fraud_count"] for r in train_trend]
    mean_amount_train = [r["mean_amount"] for r in train_trend]

    return {
        "service": "ml-service",
        "generated_at": iso_now(),
        "disclaimer": DISCLAIMER,
        "source": "PaySim training split (public mobile-money simulator)",
        "timestamps": step_windows,
        "fraud_rate_trend": fraud_rate_train,
        "fraud_count_trend": fraud_count_train,
        "risk_trend": mean_amount_train,  # mean transaction amount per window as proxy
        "validation_trend": [
            {"step_window": r["step_window"], "fraud_rate": r["fraud_rate"]}
            for r in val_trend
        ],
        "test_trend": [
            {"step_window": r["step_window"], "fraud_rate": r["fraud_rate"]}
            for r in test_trend
        ],
    }


@app.get("/api/v1/drift/status")
def drift_status() -> Dict[str, Any]:
    """Compute PSI on the validation split as 'current' vs the training
    reference distribution. Real PSI, real distributions."""
    drift_ref = get_drift_reference()
    if not drift_ref:
        raise HTTPException(status_code=503,
                            detail="Drift reference not found. Run train.py first.")
    try:
        val_df = load_paysim_split("validation")
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"Validation split load failed: {e}")

    # Restrict to features in the reference
    features_in_ref = [k for k in drift_ref.keys() if k not in
                       ("generated_at", "source", "dataset_version",
                        "features", "bins_default")]
    available = [f for f in features_in_ref if f in val_df.columns]
    statuses = evaluate_drift(val_df, drift_ref, features=available)
    return {
        "generated_at": iso_now(),
        "source": "PSI on PaySim validation split vs training reference",
        "features": statuses,
        "thresholds": {
            "watch": float(os.environ.get("DRIFT_WATCH_THRESHOLD", "0.10")),
            "drift": float(os.environ.get("DRIFT_DRIFT_THRESHOLD", "0.25")),
        },
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/v1/drift/history")
def drift_history_endpoint() -> Dict[str, Any]:
    """Return all previously persisted drift/retrain events."""
    events = get_drift_history()
    return {
        "events": events,
        "count": len(events),
        "disclaimer": DISCLAIMER,
    }


@app.get("/api/v1/models")
def models_endpoint() -> Dict[str, Any]:
    """Return all model info with active flags."""
    tx_meta = get_transaction_metadata()
    nlp_meta = get_nlp_metadata()
    models: List[Dict[str, Any]] = []
    for name, info in tx_meta.get("models", {}).items():
        m = info.get("metrics", {})
        models.append({
            "name": name,
            "version": info.get("version"),
            "type": info.get("type"),
            "active": info.get("active", False),
            "trained": True,
            "dataset_version": info.get("dataset_version"),
            "training_timestamp": info.get("training_timestamp"),
            "hyperparameters": info.get("hyperparameters"),
            "metrics": {
                "precision": m.get("precision"),
                "recall": m.get("recall"),
                "f1": m.get("f1"),
                "roc_auc": m.get("roc_auc"),
                "pr_auc": m.get("pr_auc"),
            },
            "artifact": info.get("artifact"),
        })
    for name, info in nlp_meta.get("models", {}).items():
        m = info.get("metrics", {}) if info.get("trained") else {}
        models.append({
            "name": name,
            "version": info.get("version"),
            "type": info.get("type"),
            "active": info.get("active", False),
            "trained": info.get("trained", False),
            "status": info.get("status"),
            "language": info.get("language"),
            "dataset_version": info.get("dataset_version"),
            "training_timestamp": info.get("training_timestamp"),
            "hyperparameters": info.get("hyperparameters"),
            "metrics": {
                "precision": m.get("precision"),
                "recall": m.get("recall"),
                "f1": m.get("f1"),
                "roc_auc": m.get("roc_auc"),
                "pr_auc": m.get("pr_auc"),
            },
            "artifact": info.get("artifact"),
        })
    return {
        "models": models,
        "active_transaction_model": tx_meta.get("active_model"),
        "english_status": nlp_meta.get("english_status"),
        "generated_at": iso_now(),
        "disclaimer": DISCLAIMER,
    }


@app.post("/api/v1/models/retrain")
def retrain_endpoint(req: RetrainInput) -> Dict[str, Any]:
    """Trigger candidate retraining + evaluation. Writes outcome to
    metadata/drift_history.json as a retrain event."""
    # Lazy import to avoid circular deps at module load time
    import adaptive
    try:
        prep = adaptive.prepare_candidate_retraining(
            req.model_name, drift_window=req.drift_window
        )
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"prepare_candidate_retraining failed: {e}")
    try:
        outcome = adaptive.evaluate_candidate(req.model_name)
    except FileNotFoundError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        raise HTTPException(status_code=500, detail=f"evaluate_candidate failed: {e}")

    # Persist to drift_history.json (append-only)
    event = {
        "id": f"retrain-{int(time.time())}",
        "type": "retrain",
        "model_name": req.model_name,
        "drift_window": req.drift_window,
        "candidate_version": prep.get("candidate_version"),
        "old_metrics": outcome["old_metrics"],
        "new_metrics": outcome["new_metrics"],
        "comparison": outcome["comparison"],
        "promoted": outcome["promoted"],
        "outcome": outcome["outcome"],
        "created_at": iso_now(),
    }
    adaptive.append_drift_event(event)

    # Reload models in memory if promoted
    if outcome["promoted"]:
        # Force reload of models from disk
        with _MODELS_LOCK:
            _MODELS.clear()
        load_all_models()

    return {
        "candidate_version": prep.get("candidate_version"),
        "old_metrics": outcome["old_metrics"],
        "new_metrics": outcome["new_metrics"],
        "promoted": outcome["promoted"],
        "comparison": outcome["comparison"],
        "outcome": outcome["outcome"],
        "event_id": event["id"],
        "created_at": event["created_at"],
        "disclaimer": DISCLAIMER,
    }


# ---------------------------------------------------------------------------
# Startup event (in case load_all_models didn't fire at import time)
# ---------------------------------------------------------------------------
@app.on_event("startup")
def _startup() -> None:
    load_all_models()
    print(f"[index] models loaded: {list(k for k in _MODELS if k != '_loaded')}")


# ---------------------------------------------------------------------------
# Run as script
# ---------------------------------------------------------------------------
if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host="0.0.0.0", port=4000)
