"""
drift_engine.py — Population Stability Index (PSI) for concept drift detection.

PSI = sum( (current_pct - ref_pct) * ln(current_pct / ref_pct) )

Standard thresholds (configurable via env):
    PSI < 0.10         -> NO_DRIFT
    0.10 <= PSI < 0.25 -> WATCH
    PSI >= 0.25        -> DRIFT_DETECTED

Bin the reference distribution into `bins` quantile buckets, apply the same
bin edges to the current distribution, then compute PSI.
"""
from __future__ import annotations
import os
import math
from typing import List, Dict, Any, Optional, Sequence

import numpy as np
import pandas as pd


def _thresholds() -> tuple[float, float]:
    watch = float(os.environ.get("DRIFT_WATCH_THRESHOLD", "0.10"))
    drift = float(os.environ.get("DRIFT_DRIFT_THRESHOLD", "0.25"))
    return watch, drift


def _status_for_psi(psi: float) -> tuple[str, float]:
    watch, drift = _thresholds()
    if psi < watch:
        return "NO_DRIFT", watch
    if psi < drift:
        return "WATCH", drift
    return "DRIFT_DETECTED", drift


def compute_psi(reference_values: Sequence[float],
                current_values: Sequence[float],
                bins: int = 10) -> float:
    """Compute Population Stability Index.

    Bins the reference distribution into `bins` quantile buckets and applies
    the same bin edges to the current distribution. Small epsilon added to
    percentages to avoid divide-by-zero and log(0).
    """
    ref = np.asarray(reference_values, dtype=float)
    cur = np.asarray(current_values, dtype=float)
    ref = ref[~np.isnan(ref)]
    cur = cur[~np.isnan(cur)]
    if ref.size == 0 or cur.size == 0:
        return 0.0

    # Quantile bin edges from the reference distribution.
    # Use duplicates='drop' so we never get duplicate edges from highly
    # concentrated distributions; fall back to fewer bins if needed.
    quantiles = np.linspace(0, 1, bins + 1)
    edges = np.quantile(ref, quantiles)
    edges = np.unique(edges)
    if edges.size < 2:
        return 0.0
    # Ensure left/right boundaries capture all values
    edges[0] = -np.inf
    edges[-1] = np.inf

    ref_counts, _ = np.histogram(ref, bins=edges)
    cur_counts, _ = np.histogram(cur, bins=edges)

    ref_pct = ref_counts / max(ref_counts.sum(), 1)
    cur_pct = cur_counts / max(cur_counts.sum(), 1)

    eps = 1e-6
    ref_pct = ref_pct.astype(float) + eps
    cur_pct = cur_pct.astype(float) + eps
    ref_pct /= ref_pct.sum()
    cur_pct /= cur_pct.sum()

    psi = float(np.sum((cur_pct - ref_pct) * np.log(cur_pct / ref_pct)))
    if math.isnan(psi):
        return 0.0
    return psi


def evaluate_drift(current_df: pd.DataFrame,
                   reference_distribution: Dict[str, Any],
                   features: Optional[List[str]] = None) -> List[Dict[str, Any]]:
    """Evaluate PSI per feature against the saved reference distribution.

    `reference_distribution` is the dict saved by train.py:
        {
            "<feature>": {
                "bins": int,
                "edges": [float, ...],
                "reference_pct": [float, ...]
            },
            ...
        }
    Returns a list of {feature, psi, status, threshold} dicts.
    """
    if features is None:
        features = [
            f for f in reference_distribution.keys()
            if f not in ("generated_at", "source", "bins_default")
        ]
    out: List[Dict[str, Any]] = []
    for feat in features:
        if feat not in reference_distribution or feat not in current_df.columns:
            continue
        ref_meta = reference_distribution[feat]
        edges = ref_meta.get("edges")
        if edges is None or len(edges) < 2:
            continue
        cur_vals = current_df[feat].astype(float).to_numpy()
        cur_vals = cur_vals[~np.isnan(cur_vals)]
        if cur_vals.size == 0:
            continue
        # Apply same edges to current
        e = list(edges)
        e[0] = -math.inf
        e[-1] = math.inf
        cur_counts, _ = np.histogram(cur_vals, bins=e)
        ref_pct = np.asarray(ref_meta.get("reference_pct"), dtype=float)
        if ref_pct.size == 0:
            continue
        cur_pct = cur_counts / max(cur_counts.sum(), 1)
        eps = 1e-6
        rp = ref_pct.astype(float) + eps
        cp = cur_pct.astype(float) + eps
        rp /= rp.sum()
        cp /= cp.sum()
        psi = float(np.sum((cp - rp) * np.log(cp / rp)))
        if math.isnan(psi):
            psi = 0.0
        status, threshold = _status_for_psi(psi)
        out.append({
            "feature": feat,
            "psi": round(psi, 6),
            "status": status,
            "threshold": threshold,
        })
    return out


def build_reference_distribution(df: pd.DataFrame,
                                numeric_features: List[str],
                                bins: int = 10) -> Dict[str, Any]:
    """From a reference dataframe, build per-feature quantile bins + percentages.

    Saved as metadata/drift_reference.json by train.py.
    """
    ref: Dict[str, Any] = {}
    for feat in numeric_features:
        if feat not in df.columns:
            continue
        vals = df[feat].astype(float).to_numpy()
        vals = vals[~np.isnan(vals)]
        if vals.size == 0:
            continue
        quantiles = np.linspace(0, 1, bins + 1)
        edges = np.quantile(vals, quantiles)
        edges = np.unique(edges)
        if edges.size < 2:
            continue
        # Set boundaries to +/-inf so future values outside the historical
        # range are still assigned to the extreme bins rather than dropped.
        edges[0] = -math.inf
        edges[-1] = math.inf
        counts, _ = np.histogram(vals, bins=edges)
        pct = counts / max(counts.sum(), 1)
        ref[feat] = {
            "bins": int(edges.size - 1),
            "edges": [float(x) if math.isfinite(x) else (
                -1e18 if x == -math.inf else 1e18
            ) for x in edges],
            "reference_pct": [float(x) for x in pct],
        }
    return ref
