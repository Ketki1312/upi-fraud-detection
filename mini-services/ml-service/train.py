"""
train.py — Main training entry point for the UPI Fraud Detection ML service.

Run:
    python3 train.py

Trains:
  - 3 transaction models (LR / RF / XGBoost) on PaySim, saves sklearn Pipelines.
  - 4 NLP models (Hindi / Hinglish / English / combined) TF-IDF + LogReg.
  - Drift reference distribution for PaySim numeric features.

For adaptive retraining, this module also exposes reusable helpers used by
adaptive.py:
    TX_FEATURES, load_paysim_split,
    train_logreg_model, train_rf_model, train_xgboost_model,
    build_transaction_pipeline,
    compute_classification_metrics,
    load_nlp_data_for_language, train_nlp_pipeline,
    compute_classification_metrics_text
"""
from __future__ import annotations
import json
import os
import random
import sys
import time
import urllib.request
import urllib.error
import zipfile
import io
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path
from typing import Dict, Any, List, Tuple, Optional

import numpy as np
import pandas as pd

import joblib

from sklearn.pipeline import Pipeline
from sklearn.preprocessing import StandardScaler
from sklearn.feature_extraction.text import TfidfVectorizer
from sklearn.linear_model import LogisticRegression
from sklearn.ensemble import RandomForestClassifier
from sklearn.metrics import (
    precision_score, recall_score, f1_score, roc_auc_score,
    average_precision_score, confusion_matrix,
)
from sklearn.model_selection import GroupShuffleSplit

import xgboost

# Local drift_engine import for the reference distribution
from drift_engine import build_reference_distribution


# ---------------------------------------------------------------------------
# Paths & constants
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "raw"
PAYSIM_DIR = DATA_DIR / "paysim"
MESSAGES_DIR = DATA_DIR / "messages"
MODELS_DIR = BASE_DIR / "models"
METADATA_DIR = BASE_DIR / "metadata"
ENGLISH_DIR = DATA_DIR / "english"

PAYSIM_FILES = {
    "train": PAYSIM_DIR / "paysim_train_processed.csv",
    "validation": PAYSIM_DIR / "paysim_validation_processed.csv",
    "test": PAYSIM_DIR / "paysim_test_processed.csv",
}

# Transaction features (drop `step` and `isFraud`)
TX_FEATURES: List[str] = [
    "amount", "oldbalanceOrg", "newbalanceOrig",
    "oldbalanceDest", "newbalanceDest",
    "orig_balance_change", "dest_balance_change",
    "amount_to_orig_balance", "amount_to_dest_balance",
    "type_CASH_IN", "type_CASH_OUT", "type_DEBIT",
    "type_PAYMENT", "type_TRANSFER",
]

RANDOM_SEED = 42
DATASET_VERSION = "paysim_v1"
NLP_VERSION = "1.0.0"
TRANSACTION_VERSION = "1.0.0"
ENGLISH_DOWNLOAD_URL = (
    "https://archive.ics.uci.edu/ml/machine-learning-databases/"
    "00228/smsspamcollection.zip"
)


def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


# ---------------------------------------------------------------------------
# Random seeds
# ---------------------------------------------------------------------------
def set_seeds(seed: int = RANDOM_SEED) -> None:
    random.seed(seed)
    np.random.seed(seed)
    # sklearn uses numpy RNG globally for many operations
    os.environ["PYTHONHASHSEED"] = str(seed)
    # XGBoost uses its own RNG; we pass random_state explicitly to each model.
    # For older xgboost versions, set the global seed too:
    try:
        from xgboost import set_config
        set_config(verbosity=0)
    except Exception:
        pass


# ---------------------------------------------------------------------------
# Data loaders
# ---------------------------------------------------------------------------
def load_paysim_split(name: str) -> pd.DataFrame:
    return pd.read_csv(PAYSIM_FILES[name])


def _normalize_text(s: str) -> str:
    """Lowercase, strip ASCII punctuation, but PRESERVE Unicode letters,
    marks (incl. Devanagari matras) and numbers. Replacing `\\W+` would
    strip Devanagari vowel signs (Unicode category Mc) — a real bug for Hindi.
    """
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.lower()
    out_chars = []
    for ch in s:
        cat = unicodedata.category(ch)
        if cat[0] in ("L", "M", "N"):  # letter, mark, number
            out_chars.append(ch)
        else:
            out_chars.append(" ")
    s = "".join(out_chars)
    s = re.sub(r"\s+", " ", s).strip()
    return s


def load_messages_csv(path: Path) -> pd.DataFrame:
    df = pd.read_csv(path)
    df["text"] = df["text"].astype(str).str.strip()
    df["label"] = df["label"].astype(int)
    df["_norm"] = df["text"].map(_normalize_text)
    df["_group"] = df["_norm"]
    # Group IDs by unique normalized text — duplicates share a group id
    unique = df["_group"].unique()
    group_id = {v: i for i, v in enumerate(unique)}
    df["_group_id"] = df["_group"].map(group_id)
    return df


# ---------------------------------------------------------------------------
# English SMS Spam — attempt public UCI download (no fabrication)
# ---------------------------------------------------------------------------
def attempt_download_english_sms() -> Tuple[Optional[pd.DataFrame], Dict[str, Any]]:
    """Attempt to download UCI SMS Spam Collection v1.
    Returns (df or None, info dict). NEVER fabricates data on failure."""
    ENGLISH_DIR.mkdir(parents=True, exist_ok=True)
    info = {
        "url": ENGLISH_DOWNLOAD_URL,
        "attempted_at": iso_now(),
        "success": False,
        "error": None,
    }
    try:
        print(f"[train] attempting English SMS Spam download: {ENGLISH_DOWNLOAD_URL}")
        req = urllib.request.Request(
            ENGLISH_DOWNLOAD_URL,
            headers={"User-Agent": "UPI-Fraud-Research-Prototype/1.0"},
        )
        with urllib.request.urlopen(req, timeout=20) as resp:
            data = resp.read()
        info["bytes_received"] = len(data)
        z = zipfile.ZipFile(io.BytesIO(data))
        # The archive contains a single file: SMSSpamCollection
        names = z.namelist()
        target = None
        for n in names:
            if n.lower().endswith("smsspamcollection") or n == "SMSSpamCollection":
                target = n
                break
        if target is None and len(names) == 1:
            target = names[0]
        if target is None:
            info["error"] = f"could not locate SMSSpamCollection in archive: {names}"
            return None, info
        with z.open(target) as f:
            raw = f.read().decode("latin-1")
        rows = []
        for line in raw.splitlines():
            line = line.strip()
            if not line:
                continue
            if line.startswith(("ham\t", "spam\t")):
                lab, txt = line.split("\t", 1)
                rows.append((lab, txt))
        if not rows:
            info["error"] = "no rows parsed from SMSSpamCollection"
            return None, info
        df = pd.DataFrame(rows, columns=["raw_label", "text"])
        df["label"] = (df["raw_label"] == "spam").astype(int)
        df["language"] = "English"
        df["category"] = df["raw_label"]
        df["source"] = "UCI_SMS_Spam_v1"
        df = df[["text", "language", "category", "label", "source"]]
        info["success"] = True
        info["rows"] = int(len(df))
        info["label_distribution"] = {
            str(k): int(v) for k, v in df["label"].value_counts().items()
        }
        df.to_csv(ENGLISH_DIR / "english_sms_spam.csv", index=False)
        print(f"[train] English SMS Spam downloaded: {len(df):,} rows")
        return df, info
    except urllib.error.URLError as e:
        info["error"] = f"URLError: {e}"
        print(f"[train] English download FAILED (URLError): {e}")
        return _use_cached_english_if_available(info)
    except Exception as e:
        info["error"] = f"{type(e).__name__}: {e}"
        print(f"[train] English download FAILED: {e}")
        return _use_cached_english_if_available(info)


def _use_cached_english_if_available(info: Dict[str, Any]) -> Tuple[Optional[pd.DataFrame], Dict[str, Any]]:
    """If a previous training run downloaded & cached `english_sms_spam.csv`,
    reuse it instead of failing — but DISCLOSE in `info` that we used the cache.
    NEVER fabricates data: if the cache is missing, returns (None, info).
    """
    cached_path = ENGLISH_DIR / "english_sms_spam.csv"
    if not cached_path.exists():
        return None, info
    try:
        df = pd.read_csv(cached_path)
        df["text"] = df["text"].astype(str)
        df["label"] = df["label"].astype(int)
        info["used_cached_file"] = True
        info["cached_path"] = str(cached_path.relative_to(BASE_DIR))
        info["rows"] = int(len(df))
        info["success"] = True
        print(f"[train] using CACHED English SMS Spam file: {cached_path} "
              f"({len(df):,} rows). Download failed; reusing prior cache.")
        return df, info
    except Exception as e:
        info["cache_load_error"] = f"{type(e).__name__}: {e}"
        return None, info


# ---------------------------------------------------------------------------
# Transaction model training
# ---------------------------------------------------------------------------
def train_logreg_model(X: pd.DataFrame, y: pd.Series) -> Pipeline:
    """LogisticRegression with StandardScaler + class_weight='balanced'."""
    pipe = Pipeline([
        ("scaler", StandardScaler()),
        ("clf", LogisticRegression(
            class_weight="balanced", C=1.0, max_iter=1000,
            random_state=RANDOM_SEED, n_jobs=-1,
        )),
    ])
    pipe.fit(X, y)
    return pipe


def train_rf_model(X: pd.DataFrame, y: pd.Series) -> Pipeline:
    """RandomForestClassifier (no scaling needed for trees)."""
    pipe = Pipeline([
        ("clf", RandomForestClassifier(
            n_estimators=200, max_depth=12,
            class_weight="balanced_subsample",
            n_jobs=-1, random_state=RANDOM_SEED,
        )),
    ])
    pipe.fit(X, y)
    return pipe


def train_xgboost_model(X: pd.DataFrame, y: pd.Series) -> Pipeline:
    """XGBoostClassifier with scale_pos_weight = neg/pos."""
    y = y.astype(int)
    pos = int((y == 1).sum())
    neg = int((y == 0).sum())
    spw = max(neg / max(pos, 1), 1.0)
    pipe = Pipeline([
        ("clf", xgboost.XGBClassifier(
            n_estimators=200, max_depth=6, learning_rate=0.1,
            scale_pos_weight=spw, eval_metric="aucpr",
            random_state=RANDOM_SEED, n_jobs=-1,
            tree_method="hist",
            use_label_encoder=False,
        )),
    ])
    pipe.fit(X, y)
    return pipe


def build_transaction_pipeline(fitted_pipeline: Pipeline,
                                model_name: str) -> Pipeline:
    """Wrap a fitted pipeline into the saved artifact. The fitted pipeline
    already includes preprocessing + classifier, so we just return it."""
    return fitted_pipeline


def compute_classification_metrics(pipeline: Pipeline,
                                   X_test: pd.DataFrame,
                                   y_test: pd.Series) -> Dict[str, Any]:
    y_test = y_test.astype(int)
    proba = pipeline.predict_proba(X_test)[:, 1]
    pred = (proba >= 0.5).astype(int)
    metrics: Dict[str, Any] = {
        "precision": float(precision_score(y_test, pred, zero_division=0)),
        "recall": float(recall_score(y_test, pred, zero_division=0)),
        "f1": float(f1_score(y_test, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y_test, proba)) if len(np.unique(y_test)) > 1 else 0.0,
        "pr_auc": float(average_precision_score(y_test, proba)) if len(np.unique(y_test)) > 1 else 0.0,
        "confusion_matrix": confusion_matrix(y_test, pred).tolist(),
        "threshold": 0.5,
    }
    return metrics


# ---------------------------------------------------------------------------
# NLP model training
# ---------------------------------------------------------------------------
def train_nlp_pipeline(texts: pd.Series, labels: pd.Series) -> Pipeline:
    """TF-IDF + LogisticRegression. The vectorizer and classifier are wrapped
    in a single sklearn Pipeline that accepts raw text strings."""
    pipe = Pipeline([
        ("tfidf", TfidfVectorizer(
            lowercase=True, ngram_range=(1, 2), max_features=5000,
            min_df=2, sublinear_tf=True, strip_accents="unicode",
        )),
        ("clf", LogisticRegression(
            class_weight="balanced", C=1.0, max_iter=1000,
            random_state=RANDOM_SEED, n_jobs=-1,
        )),
    ])
    pipe.fit(texts.astype(str), labels.astype(int))
    return pipe


def compute_classification_metrics_text(pipeline: Pipeline,
                                        X_text: pd.Series,
                                        y: pd.Series) -> Dict[str, Any]:
    y = y.astype(int)
    proba = pipeline.predict_proba(X_text.astype(str))[:, 1]
    pred = (proba >= 0.5).astype(int)
    metrics: Dict[str, Any] = {
        "precision": float(precision_score(y, pred, zero_division=0)),
        "recall": float(recall_score(y, pred, zero_division=0)),
        "f1": float(f1_score(y, pred, zero_division=0)),
        "roc_auc": float(roc_auc_score(y, proba)) if len(np.unique(y)) > 1 else 0.0,
        "pr_auc": float(average_precision_score(y, proba)) if len(np.unique(y)) > 1 else 0.0,
        "confusion_matrix": confusion_matrix(y, pred).tolist(),
        "threshold": 0.5,
    }
    return metrics


def group_aware_split(df: pd.DataFrame,
                       train_frac: float = 0.70,
                       val_frac: float = 0.15,
                       seed: int = RANDOM_SEED) -> Tuple[pd.DataFrame, pd.DataFrame, pd.DataFrame]:
    """70/15/15 group-aware split that is ALSO stratified by label.

    All rows of a duplicate group go to the same split (prevents exact &
    near-duplicate leakage). Stratification by label ensures each split
    contains a representative proportion of legitimate and scam templates —
    critical for the Hindi/Hinglish datasets where only ~20 unique templates
    exist (5 legit + 15-16 scam). Without stratification, random shuffling can
    place all 5 legitimate templates in the test set, causing the model to
    predict everything as scam (F1 ~0.39, as observed in initial runs).
    """
    # Each unique normalized text shares a single label (duplicates share
    # label by construction). Use first() to get the group->label mapping.
    group_label = df.groupby("_group_id")["label"].first()

    rng = np.random.RandomState(seed)
    train_g: set = set()
    val_g: set = set()
    test_g: set = set()
    for label_value in sorted(group_label.unique()):
        groups_with_label = group_label[group_label == label_value].index.tolist()
        rng.shuffle(groups_with_label)
        n = len(groups_with_label)
        n_train = int(round(n * train_frac))
        n_val = int(round(n * val_frac))
        # Guarantee at least 1 group in test if there are >=3 groups for this label
        if n >= 3 and (n - n_train - n_val) < 1:
            n_val = max(n - n_train - 1, 0)
        train_g.update(groups_with_label[:n_train])
        val_g.update(groups_with_label[n_train:n_train + n_val])
        test_g.update(groups_with_label[n_train + n_val:])

    train_df = df[df["_group_id"].isin(train_g)].copy()
    val_df = df[df["_group_id"].isin(val_g)].copy()
    test_df = df[df["_group_id"].isin(test_g)].copy()
    return train_df, val_df, test_df


def load_nlp_data_for_language(lang_code: str) -> Tuple[
        Optional[pd.DataFrame], Optional[pd.DataFrame], Optional[pd.DataFrame], Optional[str]]:
    """Return (train_df, test_df, val_df, info_or_None) for a given language.
    Splits are group-aware (duplicate-group aware)."""
    lang_code = (lang_code or "").lower()
    sources: List[Path] = []
    if lang_code == "hi":
        sources = [MESSAGES_DIR / "hindi_messages.csv"]
    elif lang_code == "hinglish":
        sources = [MESSAGES_DIR / "hinglish_messages.csv"]
    elif lang_code == "en":
        p = ENGLISH_DIR / "english_sms_spam.csv"
        if p.exists():
            sources = [p]
        else:
            return None, None, None, "English dataset not available (download failed)"
    elif lang_code == "combined":
        sources = [
            MESSAGES_DIR / "hindi_messages.csv",
            MESSAGES_DIR / "hinglish_messages.csv",
        ]
        p = ENGLISH_DIR / "english_sms_spam.csv"
        if p.exists():
            sources.append(p)
    else:
        return None, None, None, f"unknown language: {lang_code}"

    frames = []
    for p in sources:
        if not p.exists():
            continue
        df = load_messages_csv(p)
        frames.append(df)
    if not frames:
        return None, None, None, f"no source files for {lang_code}"
    full = pd.concat(frames, ignore_index=True) if len(frames) > 1 else frames[0]
    # Rebuild group ids across the combined frame
    unique = full["_norm"].unique()
    gid = {v: i for i, v in enumerate(unique)}
    full["_group_id"] = full["_norm"].map(gid)
    # Group-aware 70/15/15 split (also label-stratified — see group_aware_split)
    train_df, val_df, test_df = group_aware_split(full)
    # For the combined model only: cap heavily-repeated templates to 50 reps
    # in the TRAINING split so that Hindi/Hinglish (only ~20 unique templates
    # each, repeated 1000+ times) do not drown out English's ~3500 unique
    # templates. Without this cap, the combined model degenerates into
    # "predict every Hindi/Hinglish-looking message as scam" (F1 ~ 0.33).
    # The test/val splits are NOT capped — evaluation stays honest.
    if lang_code == "combined":
        train_df = train_df.groupby("_group_id", group_keys=False, sort=False).apply(
            lambda g: g.sample(n=min(50, len(g)), random_state=RANDOM_SEED),
            include_groups=False,
        ).reset_index(drop=True)
    return train_df, test_df, val_df, None


# ---------------------------------------------------------------------------
# Drift reference
# ---------------------------------------------------------------------------
def build_and_save_drift_reference(train_df: pd.DataFrame) -> Dict[str, Any]:
    ref = build_reference_distribution(train_df, TX_FEATURES, bins=10)
    out = {
        "generated_at": iso_now(),
        "source": "PaySim training split",
        "dataset_version": DATASET_VERSION,
        "features": TX_FEATURES,
        "bins_default": 10,
        **ref,
    }
    (METADATA_DIR / "drift_reference.json").write_text(json.dumps(out, indent=2))
    print(f"[train] saved drift_reference.json ({len(ref)} features)")

    # Also save a small SHAP background sample (100 legitimate rows) so the
    # FastAPI service does not need to load the full 613k-row train_df for
    # every SHAP request. The KernelExplainer fallback uses this; the
    # TreeExplainer used for XGBoost does not need a background.
    bg = train_df[train_df["isFraud"] == 0][TX_FEATURES].sample(
        n=min(100, len(train_df[train_df["isFraud"] == 0])),
        random_state=RANDOM_SEED,
    )
    joblib.dump(bg, MODELS_DIR / "shap_background.joblib")
    print(f"[train] saved shap_background.joblib ({len(bg)} rows)")
    return out


# ---------------------------------------------------------------------------
# Main training orchestration
# ---------------------------------------------------------------------------
def train_transaction_models() -> Dict[str, Any]:
    """Train LR / RF / XGBoost on PaySim. XGBoost is the active model."""
    print("[train] === Transaction models ===")
    train_df = load_paysim_split("train")
    test_df = load_paysim_split("test")
    X_full = train_df[TX_FEATURES]
    y_full = train_df["isFraud"].astype(int)
    X_test = test_df[TX_FEATURES]
    y_test = test_df["isFraud"].astype(int)

    pos = int((y_full == 1).sum())
    neg = int((y_full == 0).sum())
    spw = max(neg / max(pos, 1), 1.0)
    print(f"[train] train rows={len(train_df):,} fraud={pos:,} legit={neg:,} "
          f"scale_pos_weight={spw:.2f}")
    print(f"[train] test rows={len(test_df):,} fraud={int((y_test==1).sum()):,}")

    # ---- LR & RF on a 100k subsample for efficiency (document this) ----
    rng = np.random.RandomState(RANDOM_SEED)
    # Stratified subsample: keep all fraud + 100k legit
    legit_idx = np.where(y_full == 0)[0]
    fraud_idx = np.where(y_full == 1)[0]
    chosen_legit = rng.choice(legit_idx, size=min(100_000, len(legit_idx)),
                              replace=False)
    sub_idx = np.concatenate([chosen_legit, fraud_idx])
    rng.shuffle(sub_idx)
    X_sub = X_full.iloc[sub_idx].reset_index(drop=True)
    y_sub = y_full.iloc[sub_idx].reset_index(drop=True)
    print(f"[train] LR/RF subsample: {len(X_sub):,} rows "
          f"({int((y_sub==1).sum()):,} fraud)")

    models_meta: Dict[str, Any] = {}

    # --- Logistic Regression ---
    print("[train] training LogisticRegression (subsampled)...")
    t0 = time.time()
    lr_pipe = train_logreg_model(X_sub, y_sub)
    lr_metrics = compute_classification_metrics(lr_pipe, X_test, y_test)
    joblib.dump(lr_pipe, MODELS_DIR / "transaction_lr.joblib")
    print(f"[train] LR done in {time.time()-t0:.1f}s "
          f"F1={lr_metrics['f1']:.4f} recall={lr_metrics['recall']:.4f} "
          f"prec={lr_metrics['precision']:.4f} roc_auc={lr_metrics['roc_auc']:.4f} "
          f"pr_auc={lr_metrics['pr_auc']:.4f}")
    models_meta["transaction_lr"] = {
        "name": "transaction_lr",
        "type": "logistic_regression",
        "version": "1.0.0",
        "active": False,
        "dataset_version": DATASET_VERSION,
        "training_timestamp": iso_now(),
        "features": TX_FEATURES,
        "hyperparameters": {
            "model": "LogisticRegression",
            "scaler": "StandardScaler",
            "class_weight": "balanced",
            "C": 1.0, "max_iter": 1000,
            "random_state": RANDOM_SEED,
            "subsample_legit_rows": 100_000,
            "subsample_keep_all_fraud": True,
        },
        "metrics": lr_metrics,
        "artifact": "models/transaction_lr.joblib",
    }

    # --- Random Forest ---
    print("[train] training RandomForest (subsampled)...")
    t0 = time.time()
    rf_pipe = train_rf_model(X_sub, y_sub)
    rf_metrics = compute_classification_metrics(rf_pipe, X_test, y_test)
    joblib.dump(rf_pipe, MODELS_DIR / "transaction_rf.joblib")
    print(f"[train] RF done in {time.time()-t0:.1f}s "
          f"F1={rf_metrics['f1']:.4f} recall={rf_metrics['recall']:.4f} "
          f"prec={rf_metrics['precision']:.4f} roc_auc={rf_metrics['roc_auc']:.4f} "
          f"pr_auc={rf_metrics['pr_auc']:.4f}")
    models_meta["transaction_rf"] = {
        "name": "transaction_rf",
        "type": "random_forest",
        "version": "1.0.0",
        "active": False,
        "dataset_version": DATASET_VERSION,
        "training_timestamp": iso_now(),
        "features": TX_FEATURES,
        "hyperparameters": {
            "model": "RandomForestClassifier",
            "n_estimators": 200, "max_depth": 12,
            "class_weight": "balanced_subsample",
            "n_jobs": -1, "random_state": RANDOM_SEED,
            "subsample_legit_rows": 100_000,
            "subsample_keep_all_fraud": True,
        },
        "metrics": rf_metrics,
        "artifact": "models/transaction_rf.joblib",
    }

    # --- XGBoost (PRIMARY / ACTIVE) on full training set ---
    print("[train] training XGBoost (full training set)...")
    t0 = time.time()
    xgb_pipe = train_xgboost_model(X_full, y_full)
    xgb_metrics = compute_classification_metrics(xgb_pipe, X_test, y_test)
    joblib.dump(xgb_pipe, MODELS_DIR / "transaction_xgboost.joblib")
    print(f"[train] XGBoost done in {time.time()-t0:.1f}s "
          f"F1={xgb_metrics['f1']:.4f} recall={xgb_metrics['recall']:.4f} "
          f"prec={xgb_metrics['precision']:.4f} roc_auc={xgb_metrics['roc_auc']:.4f} "
          f"pr_auc={xgb_metrics['pr_auc']:.4f}")
    models_meta["transaction_xgboost"] = {
        "name": "transaction_xgboost",
        "type": "xgboost",
        "version": TRANSACTION_VERSION,
        "active": True,
        "dataset_version": DATASET_VERSION,
        "training_timestamp": iso_now(),
        "features": TX_FEATURES,
        "hyperparameters": {
            "model": "XGBClassifier",
            "n_estimators": 200, "max_depth": 6, "learning_rate": 0.1,
            "scale_pos_weight": round(spw, 4),
            "eval_metric": "aucpr",
            "tree_method": "hist",
            "random_state": RANDOM_SEED,
            "subsample_legit_rows": None,
            "subsample_keep_all_fraud": True,
        },
        "metrics": xgb_metrics,
        "artifact": "models/transaction_xgboost.joblib",
    }

    meta = {
        "generated_at": iso_now(),
        "service": "ml-service",
        "model_family": "transaction",
        "dataset_version": DATASET_VERSION,
        "random_seed": RANDOM_SEED,
        "active_model": "transaction_xgboost",
        "active_version": TRANSACTION_VERSION,
        "models": models_meta,
        "last_updated": iso_now(),
    }
    (METADATA_DIR / "transaction_models.json").write_text(json.dumps(meta, indent=2))
    print(f"[train] saved metadata/transaction_models.json")
    return meta


def train_nlp_models(english_df: Optional[pd.DataFrame]) -> Dict[str, Any]:
    """Train per-language + combined NLP models."""
    print("[train] === NLP models ===")
    out_models: Dict[str, Any] = {}

    langs = [
        ("nlp_hi", "hi"),
        ("nlp_hinglish", "hinglish"),
        ("nlp_en", "en"),
        ("nlp_combined", "combined"),
    ]
    english_status = "not_trained"  # default
    for model_name, lang_code in langs:
        print(f"[train] --- {model_name} ({lang_code}) ---")
        if lang_code == "en" and english_df is None:
            print(f"[train] English data not available -> marking not_trained")
            out_models[model_name] = {
                "name": model_name,
                "type": "tfidf_lr",
                "language": "English",
                "version": NLP_VERSION,
                "active": False,
                "trained": False,
                "status": "not_trained",
                "dataset_version": "UCI_SMS_Spam_v1",
                "training_timestamp": iso_now(),
                "error": "English SMS Spam dataset download failed (sandbox blocked).",
                "metrics": {},
                "artifact": None,
            }
            continue

        train_df, test_df, val_df, info = load_nlp_data_for_language(lang_code)
        if train_df is None:
            print(f"[train] {model_name} data unavailable: {info}")
            out_models[model_name] = {
                "name": model_name,
                "type": "tfidf_lr",
                "language": lang_code,
                "version": NLP_VERSION,
                "active": False,
                "trained": False,
                "status": "not_trained",
                "error": info,
                "training_timestamp": iso_now(),
                "metrics": {},
                "artifact": None,
            }
            continue

        print(f"[train] rows: train={len(train_df):,} val={len(val_df):,} "
              f"test={len(test_df):,}")
        print(f"[train] label dist (train): "
              f"{dict(train_df['label'].value_counts().to_dict())}")
        print(f"[train] unique duplicate groups: {train_df['_group_id'].nunique()}")

        pipe = train_nlp_pipeline(train_df["text"], train_df["label"])
        metrics = compute_classification_metrics_text(pipe, test_df["text"], test_df["label"])
        print(f"[train] {model_name} F1={metrics['f1']:.4f} "
              f"recall={metrics['recall']:.4f} prec={metrics['precision']:.4f} "
              f"roc_auc={metrics['roc_auc']:.4f}")

        artifact_stem = {
            "nlp_hi": "nlp_tfidf_lr_hi",
            "nlp_hinglish": "nlp_tfidf_lr_hinglish",
            "nlp_en": "nlp_tfidf_lr_en",
            "nlp_combined": "nlp_tfidf_lr_combined",
        }[model_name]
        artifact_path = MODELS_DIR / f"{artifact_stem}.joblib"
        joblib.dump(pipe, artifact_path)
        out_models[model_name] = {
            "name": model_name,
            "type": "tfidf_lr",
            "language": lang_code,
            "version": NLP_VERSION,
            "active": True,
            "trained": True,
            "status": "trained",
            "dataset_version": DATASET_VERSION if lang_code != "en" else "UCI_SMS_Spam_v1",
            "training_timestamp": iso_now(),
            "features": "tfidf(1,2) + logistic_regression",
            "hyperparameters": {
                "vectorizer": "TfidfVectorizer",
                "lowercase": True, "ngram_range": [1, 2],
                "max_features": 5000, "min_df": 2,
                "sublinear_tf": True, "strip_accents": "unicode",
                "classifier": "LogisticRegression",
                "class_weight": "balanced", "C": 1.0, "max_iter": 1000,
                "random_state": RANDOM_SEED,
                "split": "group-aware 70/15/15 (duplicate-group aware)",
            },
            "metrics": metrics,
            "rows": {
                "train": int(len(train_df)),
                "val": int(len(val_df)),
                "test": int(len(test_df)),
            },
            "artifact": f"models/{artifact_path.name}",
        }
        if lang_code == "en":
            english_status = "trained"

    meta = {
        "generated_at": iso_now(),
        "service": "ml-service",
        "model_family": "nlp",
        "random_seed": RANDOM_SEED,
        "english_status": english_status,
        "models": out_models,
        "last_updated": iso_now(),
    }
    (METADATA_DIR / "nlp_models.json").write_text(json.dumps(meta, indent=2))
    print(f"[train] saved metadata/nlp_models.json")
    return meta


# ---------------------------------------------------------------------------
# main()
# ---------------------------------------------------------------------------
def main() -> None:
    t_start = time.time()
    print("=" * 70)
    print("UPI Fraud Detection ML service — training pipeline")
    print(f"started at {iso_now()}")
    print("=" * 70)

    set_seeds(RANDOM_SEED)
    MODELS_DIR.mkdir(parents=True, exist_ok=True)
    METADATA_DIR.mkdir(parents=True, exist_ok=True)

    # 1. English SMS Spam download attempt
    english_df, en_info = attempt_download_english_sms()
    print(f"[train] English download success: {en_info.get('success')}")

    # 2. Transaction models
    tx_meta = train_transaction_models()

    # 3. NLP models
    nlp_meta = train_nlp_models(english_df)

    # 4. Drift reference distribution from PaySim training data
    train_df = load_paysim_split("train")
    drift_ref = build_and_save_drift_reference(train_df)

    elapsed = time.time() - t_start
    print("=" * 70)
    print("TRAINING SUMMARY")
    print("=" * 70)
    print(f"Random seed: {RANDOM_SEED}")
    print(f"Transaction models:")
    for name, info in tx_meta["models"].items():
        m = info["metrics"]
        print(f"  {name:25s} F1={m['f1']:.4f} recall={m['recall']:.4f} "
              f"prec={m['precision']:.4f} roc_auc={m['roc_auc']:.4f} "
              f"pr_auc={m['pr_auc']:.4f}  active={info['active']}")
    print(f"NLP models:")
    for name, info in nlp_meta["models"].items():
        if not info.get("trained"):
            print(f"  {name:25s} NOT TRAINED ({info.get('error', '')})")
            continue
        m = info["metrics"]
        print(f"  {name:25s} F1={m['f1']:.4f} recall={m['recall']:.4f} "
              f"prec={m['precision']:.4f} roc_auc={m['roc_auc']:.4f}")
    print(f"Drift reference features: {len(drift_ref) - 4}")  # minus meta keys
    print(f"Total training time: {elapsed:.1f}s")
    print(f"Active transaction model: {tx_meta['active_model']} "
          f"v{tx_meta['active_version']}")
    print("=" * 70)


if __name__ == "__main__":
    main()
