"""
risk_engine.py — Unified risk scoring for the UPI Fraud Detection ML service.

Maps a model probability into a standardized 0-100 risk score and a discrete
risk level. Fuses transaction and message probabilities into a single
unified_risk_score per a configurable fusion method.

Levels:
    LOW       score < 25
    MEDIUM    25 <= score < 50
    HIGH      50 <= score < 75
    CRITICAL  score >= 75
"""
from __future__ import annotations
import os
from typing import Tuple, Dict, Any, Optional

DISCLAIMER = (
    "This system is an academic research prototype and decision-support tool. "
    "It does not replace bank, UPI provider, or law-enforcement fraud prevention "
    "systems. Public datasets (PaySim, UCI SMS Spam, synthetic Hindi/Hinglish) do "
    "not establish a causal transaction-message relationship."
)


def _level(score: float) -> str:
    if score < 25.0:
        return "LOW"
    if score < 50.0:
        return "MEDIUM"
    if score < 75.0:
        return "HIGH"
    return "CRITICAL"


def transaction_risk_score(probability: float) -> Tuple[float, str]:
    """Map a transaction fraud probability in [0,1] to a (score 0-100, level)."""
    p = float(probability)
    if p < 0.0:
        p = 0.0
    if p > 1.0:
        p = 1.0
    score = p * 100.0
    return score, _level(score)


def message_risk_score(probability: float) -> Tuple[float, str]:
    """Map a message scam probability in [0,1] to a (score 0-100, level)."""
    return transaction_risk_score(probability)  # same scaling


def _resolve_fusion_method(method: Optional[str]) -> str:
    if method:
        return method.lower()
    env_method = os.environ.get("RISK_FUSION_METHOD", "max").lower()
    return env_method


def unified_risk(
    transaction_prob: Optional[float],
    message_prob: Optional[float],
    method: Optional[str] = None,
) -> Tuple[float, str, str]:
    """Fuse transaction and message probabilities into a unified score.

    Methods:
        "max"     — max(transaction_score, message_score)  (default)
        "weighted" — 0.6*tx_score + 0.4*msg_score

    If only one probability is provided, the other is treated as 0 (so the
    unified score equals the provided one). Returns (score, level, method).
    """
    m = _resolve_fusion_method(method)
    tx_p = float(transaction_prob) if transaction_prob is not None else None
    msg_p = float(message_prob) if message_prob is not None else None

    if tx_p is None and msg_p is None:
        return 0.0, "LOW", m

    tx_score, _ = transaction_risk_score(tx_p) if tx_p is not None else (0.0, "LOW")
    msg_score, _ = message_risk_score(msg_p) if msg_p is not None else (0.0, "LOW")

    if m == "weighted":
        # If only one source present, give it full weight
        if tx_p is None:
            unified = msg_score
        elif msg_p is None:
            unified = tx_score
        else:
            unified = 0.6 * tx_score + 0.4 * msg_score
    else:  # "max"
        unified = max(tx_score, msg_score)
    return unified, _level(unified), m


def build_risk_response(
    transaction_prob: Optional[float],
    message_prob: Optional[float],
    method: Optional[str] = None,
) -> Dict[str, Any]:
    """Build the full risk response dict (used by /api/v1/risk/analyze)."""
    unified, level, m = unified_risk(transaction_prob, message_prob, method)
    tx_score, tx_level = (
        transaction_risk_score(transaction_prob)
        if transaction_prob is not None
        else (None, None)
    )
    msg_score, msg_level = (
        message_risk_score(message_prob)
        if message_prob is not None
        else (None, None)
    )
    return {
        "unified_risk_score": round(unified, 4),
        "risk_level": level,
        "transaction_risk": {
            "probability": transaction_prob,
            "score": round(tx_score, 4) if tx_score is not None else None,
            "level": tx_level,
        },
        "message_risk": {
            "probability": message_prob,
            "score": round(msg_score, 4) if msg_score is not None else None,
            "level": msg_level,
        },
        "fusion_method": m,
        "disclaimer": DISCLAIMER,
    }
