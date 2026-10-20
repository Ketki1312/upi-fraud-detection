"""
adaptive.py — Adaptive model retraining & promotion logic.

Pipeline:
    prepare_candidate_retraining(model_name, drift_window)
        -> trains a candidate model version `2.0.0-candidate` on
           (training data + recent drift-window data), saves to
           models/{model_name}_candidate.joblib.

    evaluate_candidate(model_name)
        -> evaluates the candidate vs the active model on the test split.
           Promotion rule:
               new_f1   >= old_f1   AND
               new_recall >= old_recall AND
               new_precision >= 0.95 * old_precision
           On promotion:
               archive old model (rename to _v{old_version}.joblib)
               rename candidate to active, bump version (1.0.0 -> 2.0.0)
               update metadata JSON
           On rejection:
               archive candidate as _rejected.joblib and log to drift_history.

Supported model_names:
    "transaction_xgboost" | "transaction_lr" | "transaction_rf"
    "nlp_hi" | "nlp_hinglish" | "nlp_combined" | "nlp_en"
"""
from __future__ import annotations
import json
import os
import shutil
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, Optional, List

import joblib
import numpy as np
import pandas as pd

# train.py lives in the same directory — use lazy imports inside functions to
# avoid circular import at module import time.
BASE_DIR = Path(__file__).resolve().parent
MODELS_DIR = BASE_DIR / "models"
METADATA_DIR = BASE_DIR / "metadata"

# Map endpoint model_name -> filename stem
MODEL_FILENAMES = {
    "transaction_xgboost": "transaction_xgboost",
    "transaction_lr": "transaction_lr",
    "transaction_rf": "transaction_rf",
    "nlp_en": "nlp_tfidf_lr_en",
    "nlp_hi": "nlp_tfidf_lr_hi",
    "nlp_hinglish": "nlp_tfidf_lr_hinglish",
    "nlp_combined": "nlp_tfidf_lr_combined",
}


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _load_json(p: Path) -> dict:
    if not p.exists():
        return {}
    return json.loads(p.read_text())


def _save_json(p: Path, data: dict) -> None:
    p.write_text(json.dumps(data, indent=2))


# ---------------------------------------------------------------------------
# Prepare candidate retraining
# ---------------------------------------------------------------------------
def prepare_candidate_retraining(
    model_name: str,
    drift_window: Optional[Dict[str, Any]] = None,
) -> Dict[str, Any]:
    """Retrain a candidate model.

    drift_window: optional dict like
        {"source": "validation" | "test", "min_step": int, "max_step": int}
    For transaction models, rows from the validation/test split whose `step`
    falls inside the window are concatenated to the training set. For NLP
    models, drift_window is ignored (we simply retrain on the union of the
    language split's train + validation).
    """
    import train  # local import to avoid circular dependency
    stem = MODEL_FILENAMES.get(model_name)
    if stem is None:
        raise ValueError(f"Unknown model_name: {model_name}")

    print(f"[adaptive] preparing candidate retraining for {model_name}")

    if model_name.startswith("transaction_"):
        return _prepare_transaction_candidate(model_name, stem, drift_window, train)
    elif model_name.startswith("nlp_"):
        return _prepare_nlp_candidate(model_name, stem, train)
    else:
        raise ValueError(f"Unsupported model_name: {model_name}")


def _prepare_transaction_candidate(model_name: str, stem: str,
                                    drift_window: Optional[Dict[str, Any]],
                                    train_module) -> Dict[str, Any]:
    train_df = train_module.load_paysim_split("train")
    test_df = train_module.load_paysim_split("test")
    feature_names = train_module.TX_FEATURES

    # Append drift-window data from validation/test (later time windows)
    extra = None
    if drift_window:
        src = drift_window.get("source", "validation")
        win_df = train_module.load_paysim_split(src)
        if "min_step" in drift_window and "max_step" in drift_window:
            mn, mx = drift_window["min_step"], drift_window["max_step"]
            win_df = win_df[(win_df["step"] >= mn) & (win_df["step"] <= mx)]
        extra = win_df
        combined = pd.concat([train_df, extra], ignore_index=True)
        print(f"[adaptive] drift window added {len(extra):,} rows "
              f"(now {len(combined):,} total)")
    else:
        combined = train_df

    X_train = combined[feature_names]
    y_train = combined["isFraud"].astype(int)
    X_test = test_df[feature_names]
    y_test = test_df["isFraud"].astype(int)

    # Choose which model type to retrain based on model_name
    if model_name == "transaction_xgboost":
        model = train_module.train_xgboost_model(X_train, y_train)
    elif model_name == "transaction_lr":
        model = train_module.train_logreg_model(X_train, y_train)
    elif model_name == "transaction_rf":
        model = train_module.train_rf_model(X_train, y_train)
    else:
        raise ValueError(f"Unknown transaction model: {model_name}")

    # Build pipeline + save as candidate
    pipeline = train_module.build_transaction_pipeline(model, model_name)
    candidate_path = MODELS_DIR / f"{stem}_candidate.joblib"
    joblib.dump(pipeline, candidate_path)

    # Evaluate candidate on test split
    new_metrics = train_module.compute_classification_metrics(
        pipeline, X_test, y_test
    )
    print(f"[adaptive] candidate metrics: F1={new_metrics['f1']:.4f} "
          f"recall={new_metrics['recall']:.4f} "
          f"precision={new_metrics['precision']:.4f}")

    return {
        "model_name": model_name,
        "candidate_version": "2.0.0-candidate",
        "candidate_path": str(candidate_path),
        "new_metrics": new_metrics,
        "training_rows": int(len(combined)),
        "drift_window": drift_window,
    }


def _prepare_nlp_candidate(model_name: str, stem: str, train_module) -> Dict[str, Any]:
    """Retrain the NLP model on the union of train + validation for that language.
    Note: NLP drift detection here is conceptual — we retrain using more data
    as if recent messages were appended.
    """
    lang_map = {
        "nlp_en": "en",
        "nlp_hi": "hi",
        "nlp_hinglish": "hinglish",
        "nlp_combined": "combined",
    }
    lang_code = lang_map[model_name]
    train_df, test_df, val_df, info = train_module.load_nlp_data_for_language(lang_code)
    if train_df is None:
        return {
            "model_name": model_name,
            "candidate_version": "2.0.0-candidate",
            "error": info or "language data not available",
        }
    # Train + validation combined
    combined = pd.concat([train_df, val_df], ignore_index=True) if len(val_df) else train_df
    pipeline = train_module.train_nlp_pipeline(combined["text"], combined["label"])
    new_metrics = train_module.compute_classification_metrics_text(
        pipeline, test_df["text"], test_df["label"]
    )
    candidate_path = MODELS_DIR / f"{stem}_candidate.joblib"
    joblib.dump(pipeline, candidate_path)
    print(f"[adaptive] nlp candidate metrics: F1={new_metrics['f1']:.4f}")
    return {
        "model_name": model_name,
        "candidate_version": "2.0.0-candidate",
        "candidate_path": str(candidate_path),
        "new_metrics": new_metrics,
        "training_rows": int(len(combined)),
        "drift_window": None,
    }


# ---------------------------------------------------------------------------
# Evaluate candidate vs active
# ---------------------------------------------------------------------------
def evaluate_candidate(model_name: str) -> Dict[str, Any]:
    import train
    stem = MODEL_FILENAMES.get(model_name)
    if stem is None:
        raise ValueError(f"Unknown model_name: {model_name}")

    active_path = MODELS_DIR / f"{stem}.joblib"
    candidate_path = MODELS_DIR / f"{stem}_candidate.joblib"
    if not candidate_path.exists():
        raise FileNotFoundError(
            f"No candidate model found for {model_name}. "
            f"Run prepare_candidate_retraining first."
        )

    # Load active + candidate pipelines
    active_pipeline = joblib.load(active_path) if active_path.exists() else None
    candidate_pipeline = joblib.load(candidate_path)

    # Determine metrics for the test split
    if model_name.startswith("transaction_"):
        test_df = train.load_paysim_split("test")
        X_test = test_df[train.TX_FEATURES]
        y_test = test_df["isFraud"].astype(int)
        old_metrics = (
            train.compute_classification_metrics(active_pipeline, X_test, y_test)
            if active_pipeline is not None else {"f1": 0.0, "recall": 0.0, "precision": 0.0}
        )
        new_metrics = train.compute_classification_metrics(candidate_pipeline, X_test, y_test)
    else:
        lang_map = {
            "nlp_en": "en",
            "nlp_hi": "hi",
            "nlp_hinglish": "hinglish",
            "nlp_combined": "combined",
        }
        lang_code = lang_map[model_name]
        _, test_df, _, info = train.load_nlp_data_for_language(lang_code)
        if test_df is None:
            raise RuntimeError(f"No test data for {model_name}")
        old_metrics = (
            train.compute_classification_metrics_text(
                active_pipeline, test_df["text"], test_df["label"]
            ) if active_pipeline is not None else
            {"f1": 0.0, "recall": 0.0, "precision": 0.0}
        )
        new_metrics = train.compute_classification_metrics_text(
            candidate_pipeline, test_df["text"], test_df["label"]
        )

    # Promotion rule
    promoted = (
        new_metrics.get("f1", 0) >= old_metrics.get("f1", 0)
        and new_metrics.get("recall", 0) >= old_metrics.get("recall", 0)
        and new_metrics.get("precision", 0) >= 0.95 * old_metrics.get("precision", 0)
    )

    comparison = {
        "f1_delta": new_metrics.get("f1", 0) - old_metrics.get("f1", 0),
        "recall_delta": new_metrics.get("recall", 0) - old_metrics.get("recall", 0),
        "precision_delta": new_metrics.get("precision", 0) - old_metrics.get("precision", 0),
        "precision_ratio": (
            (new_metrics.get("precision", 0) / old_metrics.get("precision", 0))
            if old_metrics.get("precision", 0) else 0.0
        ),
    }

    outcome = _apply_promotion_decision(
        model_name, stem, promoted, old_metrics, new_metrics
    )

    return {
        "model_name": model_name,
        "candidate_version": "2.0.0-candidate",
        "old_metrics": old_metrics,
        "new_metrics": new_metrics,
        "comparison": comparison,
        "promoted": promoted,
        "outcome": outcome,
        "evaluated_at": iso_now(),
    }


def _apply_promotion_decision(model_name: str, stem: str, promoted: bool,
                              old_metrics: dict, new_metrics: dict) -> str:
    """Apply the promotion decision to disk and metadata. Returns a string:
    'promoted' | 'rejected'.
    """
    active_path = MODELS_DIR / f"{stem}.joblib"
    candidate_path = MODELS_DIR / f"{stem}_candidate.joblib"

    # Read metadata file
    if model_name.startswith("transaction_"):
        meta_path = METADATA_DIR / "transaction_models.json"
    else:
        meta_path = METADATA_DIR / "nlp_models.json"
    meta = _load_json(meta_path)

    # Find the model's metadata record
    models_dict = meta.get("models", {})
    record = models_dict.get(model_name, {})
    old_version = record.get("version", "1.0.0")

    if promoted:
        # Archive the old model
        archive_path = MODELS_DIR / f"{stem}_v{old_version}.joblib"
        if active_path.exists():
            shutil.copy2(active_path, archive_path)
        # Move candidate to active
        shutil.move(str(candidate_path), str(active_path))
        # Update metadata
        new_version = _bump_version(old_version)
        record.update({
            "version": new_version,
            "previous_version": old_version,
            "metrics": new_metrics,
            "previous_metrics": old_metrics,
            "training_timestamp": iso_now(),
            "active": True,
            "promotion_history": (record.get("promotion_history", []) + [
                {
                    "from": old_version,
                    "to": new_version,
                    "old_metrics": old_metrics,
                    "new_metrics": new_metrics,
                    "promoted": True,
                    "at": iso_now(),
                }
            ]),
        })
        models_dict[model_name] = record
        meta["models"] = models_dict
        meta["last_updated"] = iso_now()
        _save_json(meta_path, meta)
        print(f"[adaptive] PROMOTED {model_name}: {old_version} -> {new_version}")
        return "promoted"
    else:
        # Archive candidate as rejected
        rejected_path = MODELS_DIR / f"{stem}_rejected_{iso_now().replace(':', '')}.joblib"
        shutil.move(str(candidate_path), rejected_path)
        record.update({
            "last_candidate_rejected": {
                "candidate_metrics": new_metrics,
                "active_metrics": old_metrics,
                "at": iso_now(),
            }
        })
        models_dict[model_name] = record
        meta["models"] = models_dict
        meta["last_updated"] = iso_now()
        _save_json(meta_path, meta)
        print(f"[adaptive] REJECTED {model_name} candidate")
        return "rejected"


def _bump_version(v: str) -> str:
    """Bump a semver major: 1.0.0 -> 2.0.0."""
    try:
        parts = v.split(".")
        return f"{int(parts[0]) + 1}.0.0"
    except Exception:
        return "2.0.0"


# ---------------------------------------------------------------------------
# Drift history persistence
# ---------------------------------------------------------------------------
def append_drift_event(event: Dict[str, Any]) -> None:
    """Append to metadata/drift_history.json (append-only)."""
    path = METADATA_DIR / "drift_history.json"
    history: List[Dict[str, Any]] = []
    if path.exists():
        try:
            history = json.loads(path.read_text())
            if not isinstance(history, list):
                history = []
        except Exception:
            history = []
    history.append(event)
    _save_json(path, history)
