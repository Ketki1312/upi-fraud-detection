"""
audit.py — Dataset audit for the UPI Fraud Detection ML service.

Computes provenance, row counts, columns, dtypes, missing values, duplicates
(exact and normalized), label/category/language distributions, amount statistics
(PaySim) and temporal patterns (per-step fraud rate, PaySim).

Outputs:
    metadata/dataset_audit.json   — full machine-readable audit
    metadata/dataset_audit.md     — human-readable Markdown summary

Provenance disclosure:
    PaySim       — public mobile-money simulator (NOT real UPI banking data)
    Hindi/Hinglish — synthetic datasets (source=Synthetic in CSV)
    English      — public UCI SMS Spam Collection v1 (auto-download at training time)
"""

from __future__ import annotations
import json
import os
import re
import unicodedata
from datetime import datetime, timezone
from pathlib import Path

import pandas as pd
import numpy as np

# ---------------------------------------------------------------------------
# Paths
# ---------------------------------------------------------------------------
BASE_DIR = Path(__file__).resolve().parent
DATA_DIR = BASE_DIR / "data" / "raw"
PAYSIM_DIR = DATA_DIR / "paysim"
MESSAGES_DIR = DATA_DIR / "messages"
META_DIR = BASE_DIR / "metadata"
META_DIR.mkdir(parents=True, exist_ok=True)

PAYSIM_FILES = {
    "train": PAYSIM_DIR / "paysim_train_processed.csv",
    "validation": PAYSIM_DIR / "paysim_validation_processed.csv",
    "test": PAYSIM_DIR / "paysim_test_processed.csv",
}
PAYSIM_PREPROC_META = PAYSIM_DIR / "preprocessing_metadata.json"
HINDI_CSV = MESSAGES_DIR / "hindi_messages.csv"
HINGLISH_CSV = MESSAGES_DIR / "hinglish_messages.csv"
ENGLISH_CSV = DATA_DIR / "english" / "english_sms_spam.csv"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def iso_now() -> str:
    return datetime.now(timezone.utc).isoformat(timespec="seconds")


def _normalize_text(s: str) -> str:
    """Lowercase, strip ASCII punctuation, but PRESERVE Unicode letters,
    marks (incl. Devanagari matras) and numbers. Replacing `\\W+` would
    strip Devanagari vowel signs (Unicode category Mc) — a real bug for Hindi.
    """
    if not isinstance(s, str):
        return ""
    s = unicodedata.normalize("NFKC", s)
    s = s.lower()
    # Keep Unicode letter / mark / number characters. Replace anything else
    # (punctuation, symbols, ASCII punctuation) with a space.
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


def _basic_df_stats(df: pd.DataFrame) -> dict:
    return {
        "row_count": int(len(df)),
        "column_count": int(df.shape[1]),
        "columns": list(df.columns),
        "dtypes": {c: str(df[c].dtype) for c in df.columns},
        "missing_values_total": int(df.isnull().sum().sum()),
        "missing_per_column": {c: int(df[c].isnull().sum()) for c in df.columns},
        "duplicate_rows_exact": int(df.duplicated().sum()),
    }


# ---------------------------------------------------------------------------
# PaySim audit
# ---------------------------------------------------------------------------
def audit_paysim_split(name: str, path: Path) -> dict:
    df = pd.read_csv(path)
    stats = _basic_df_stats(df)
    stats["label_distribution"] = {
        str(k): int(v) for k, v in df["isFraud"].value_counts().items()
    }
    stats["fraud_rate"] = float(df["isFraud"].mean()) if len(df) else 0.0
    stats["step_range"] = {"min": int(df["step"].min()), "max": int(df["step"].max())}
    # amount statistics
    if "amount" in df.columns:
        amt = df["amount"].astype(float)
        stats["amount_stats"] = {
            "count": int(amt.count()),
            "mean": float(amt.mean()),
            "std": float(amt.std()),
            "min": float(amt.min()),
            "q25": float(amt.quantile(0.25)),
            "median": float(amt.median()),
            "q75": float(amt.quantile(0.75)),
            "max": float(amt.max()),
        }
        stats["amount_stats_by_label"] = {
            "fraud": df.loc[df["isFraud"] == 1, "amount"].astype(float)
            .describe().to_dict(),
            "legitimate": df.loc[df["isFraud"] == 0, "amount"].astype(float)
            .describe().to_dict(),
        }
    # type distribution (one-hot) — reconstruct
    type_cols = [c for c in df.columns if c.startswith("type_")]
    type_counts = {c.replace("type_", ""): int(df[c].sum()) for c in type_cols}
    stats["type_distribution"] = type_counts
    # per-step fraud rate — temporal pattern
    step_agg = (
        df.groupby("step")
        .agg(
            transactions=("isFraud", "count"),
            fraud_count=("isFraud", "sum"),
            fraud_rate=("isFraud", "mean"),
            mean_amount=("amount", "mean"),
        )
        .reset_index()
    )
    # bucket step into windows of 10 to keep payload reasonable
    step_agg["step_window"] = (step_agg["step"] // 10) * 10
    window_agg = (
        step_agg.groupby("step_window")
        .agg(
            transactions=("transactions", "sum"),
            fraud_count=("fraud_count", "sum"),
            mean_amount=("mean_amount", "mean"),
        )
        .reset_index()
    )
    window_agg["fraud_rate"] = (
        window_agg["fraud_count"] / window_agg["transactions"].clip(lower=1)
    )
    stats["temporal_per_step_window"] = [
        {
            "step_window": int(row.step_window),
            "transactions": int(row.transactions),
            "fraud_count": int(row.fraud_count),
            "fraud_rate": float(row.fraud_rate),
            "mean_amount": float(row.mean_amount),
        }
        for row in window_agg.itertuples(index=False)
    ]
    return stats


def audit_paysim() -> dict:
    preproc = json.loads(PAYSIM_PREPROC_META.read_text())
    return {
        "name": "PaySim",
        "provenance": {
            "source": "PaySim public mobile-money transaction simulator",
            "disclaimer": (
                "PaySim is a PUBLIC MOBILE-MONEY SIMULATOR dataset. "
                "It is NOT real UPI banking data and does not establish a causal "
                "transaction-message relationship."
            ),
            "preprocessing": preproc,
        },
        "splits": {name: audit_paysim_split(name, p) for name, p in PAYSIM_FILES.items()},
    }


# ---------------------------------------------------------------------------
# Message audit (Hindi / Hinglish / English-if-available)
# ---------------------------------------------------------------------------
def audit_messages(name: str, path: Path, provenance: dict) -> dict:
    out: dict = {"name": name, "provenance": provenance}
    if not path.exists():
        out["available"] = False
        out["note"] = "File not found on disk; flagged for download at training time."
        return out
    df = pd.read_csv(path)
    stats = _basic_df_stats(df)
    stats["label_distribution"] = {
        str(k): int(v) for k, v in df["label"].value_counts().items()
    }
    stats["category_distribution"] = {
        str(k): int(v) for k, v in df["category"].value_counts().items()
    }
    if "language" in df.columns:
        stats["language_distribution"] = {
            str(k): int(v) for k, v in df["language"].value_counts().items()
        }
    if "source" in df.columns:
        stats["source_distribution"] = {
            str(k): int(v) for k, v in df["source"].value_counts().items()
        }
    # Normalized (near) duplicates
    norm = df["text"].astype(str).map(_normalize_text)
    n_exact = int(df["text"].astype(str).duplicated().sum())
    n_norm = int(norm.duplicated().sum())
    stats["duplicate_rows_exact"] = n_exact
    stats["duplicate_rows_normalized"] = n_norm
    # Text length stats
    text_len = df["text"].astype(str).str.len()
    stats["text_length_stats"] = {
        "mean": float(text_len.mean()),
        "std": float(text_len.std()),
        "min": int(text_len.min()),
        "max": int(text_len.max()),
    }
    out["available"] = True
    out["stats"] = stats
    return out


def audit_english_status() -> dict:
    """English SMS Spam dataset.

    Per project instructions, the original `sms spam collection.zip` is not
    on disk. train.py attempts to download the public UCI SMS Spam Collection
    at training time. If a previous training run succeeded, the parsed CSV
    is saved at `data/raw/english/english_sms_spam.csv` — in that case we audit
    it directly. Otherwise, we honestly report NOT_AVAILABLE.
    """
    not_available = {
        "name": "English",
        "provenance": {
            "source": "UCI SMS Spam Collection v1 (public)",
            "url": "https://archive.ics.uci.edu/ml/machine-learning-databases/00228/smsspamcollection.zip",
            "disclaimer": (
                "English SMS Spam file was listed in the upload manifest but is "
                "not present on disk. train.py will attempt to download the public "
                "UCI SMS Spam Collection at training time. If download is blocked, "
                "the English model is honestly reported as 'not_trained'."
            ),
        },
        "available": False,
        "note": "Not present on disk at audit time. Will be downloaded in train.py.",
    }
    if not ENGLISH_CSV.exists():
        return not_available

    # A previous training run downloaded & parsed the file. Audit it now.
    provenance = {
        "source": "UCI SMS Spam Collection v1 (public) — downloaded by train.py",
        "url": "https://archive.ics.uci.edu/ml/machine-learning-databases/00228/smsspamcollection.zip",
        "local_file": str(ENGLISH_CSV.relative_to(BASE_DIR)),
        "disclaimer": (
            "Public dataset, not collected by us. The original "
            "`sms spam collection.zip` was not in the user upload; "
            "train.py downloads it from the UCI archive at training time. "
            "If download is blocked by the sandbox, English falls back to "
            "'not_trained' and no English data is fabricated."
        ),
    }
    audit = audit_messages("English", ENGLISH_CSV, provenance)
    return audit


# ---------------------------------------------------------------------------
# Markdown rendering
# ---------------------------------------------------------------------------
def to_markdown(audit: dict) -> str:
    md = []
    md.append("# UPI Fraud Detection — Dataset Audit\n")
    md.append(f"_Generated: {audit['generated_at']}_\n")

    # PaySim
    p = audit["datasets"]["PaySim"]
    md.append("## PaySim (Transaction Dataset)\n")
    md.append(f"- **Provenance**: {p['provenance']['source']}")
    md.append(f"- **Disclaimer**: {p['provenance']['disclaimer']}\n")
    md.append("| Split | Rows | Fraud | Legitimate | Fraud Rate | Step Range |")
    md.append("|---|---|---|---|---|---|")
    for split_name, s in p["splits"].items():
        ld = s.get("label_distribution", {})
        md.append(
            f"| {split_name} | {s['row_count']} | {ld.get('1', 0)} | "
            f"{ld.get('0', 0)} | {s.get('fraud_rate', 0):.4%} | "
            f"{s['step_range']['min']}-{s['step_range']['max']} |"
        )
    md.append("")
    md.append("### Amount statistics (train split)\n")
    a = p["splits"]["train"]["amount_stats"]
    md.append(
        f"count={a['count']:,}  mean={a['mean']:.2f}  median={a['median']:.2f}  "
        f"std={a['std']:.2f}  min={a['min']:.2f}  max={a['max']:.2f}\n"
    )
    md.append("### Type distribution (train split)\n")
    for k, v in p["splits"]["train"]["type_distribution"].items():
        md.append(f"- `{k}`: {v:,}")
    md.append("")
    md.append("### Temporal pattern — fraud rate per 10-step window (train)\n")
    md.append("| step_window | transactions | fraud_count | fraud_rate | mean_amount |")
    md.append("|---|---|---|---|---|")
    for row in p["splits"]["train"]["temporal_per_step_window"][:25]:
        md.append(
            f"| {row['step_window']} | {row['transactions']:,} | "
            f"{row['fraud_count']} | {row['fraud_rate']:.4%} | "
            f"{row['mean_amount']:.2f} |"
        )
    md.append("_(truncated to first 25 windows for readability)_\n")

    # Messages
    for ds_name in ["Hindi", "Hinglish", "English"]:
        d = audit["datasets"][ds_name]
        md.append(f"## {ds_name} (Message Dataset)\n")
        md.append(f"- **Provenance**: {d['provenance']['source']}")
        if "disclaimer" in d["provenance"]:
            md.append(f"- **Disclaimer**: {d['provenance']['disclaimer']}")
        if not d.get("available"):
            md.append(f"- **Status**: NOT AVAILABLE — {d.get('note', '')}\n")
            continue
        s = d["stats"]
        md.append(f"- **Rows**: {s['row_count']:,}")
        md.append(f"- **Columns**: {', '.join(s['columns'])}")
        md.append(f"- **Missing values**: {s['missing_values_total']}")
        md.append(f"- **Exact duplicates**: {s['duplicate_rows_exact']}")
        md.append(f"- **Normalized duplicates**: {s['duplicate_rows_normalized']}")
        ld = s["label_distribution"]
        md.append(
            f"- **Label distribution**: 0 (legit)={ld.get('0', 0)}, "
            f"1 (scam)={ld.get('1', 0)}"
        )
        md.append("- **Category distribution**:")
        for k, v in s["category_distribution"].items():
            md.append(f"  - `{k}`: {v}")
        if "language_distribution" in s:
            md.append("- **Language distribution**:")
            for k, v in s["language_distribution"].items():
                md.append(f"  - `{k}`: {v}")
        md.append("")
    md.append("---\n")
    md.append("_Research prototype — not for production use._")
    return "\n".join(md)


# ---------------------------------------------------------------------------
# Main
# ---------------------------------------------------------------------------
def main() -> dict:
    audit = {
        "generated_at": iso_now(),
        "service": "ml-service",
        "datasets": {
            "PaySim": audit_paysim(),
            "Hindi": audit_messages(
                "Hindi",
                HINDI_CSV,
                {
                    "source": "Synthetic Hindi SMS dataset (Hinglish-transliterated counterpart exists)",
                    "disclaimer": (
                        "Hindi/Hinglish CSVs are marked source=Synthetic. They are "
                        "NOT real-world collected banking messages."
                    ),
                },
            ),
            "Hinglish": audit_messages(
                "Hinglish",
                HINGLISH_CSV,
                {
                    "source": "Synthetic Hinglish SMS dataset (transliterated)",
                    "disclaimer": "Marked source=Synthetic — not real-world collected data.",
                },
            ),
            "English": audit_english_status(),
        },
    }
    (META_DIR / "dataset_audit.json").write_text(json.dumps(audit, indent=2))
    (META_DIR / "dataset_audit.md").write_text(to_markdown(audit))
    print(f"[audit] wrote {META_DIR / 'dataset_audit.json'}")
    print(f"[audit] wrote {META_DIR / 'dataset_audit.md'}")
    # brief stdout summary
    print(f"[audit] PaySim train rows: {audit['datasets']['PaySim']['splits']['train']['row_count']}")
    for name in ("Hindi", "Hinglish", "English"):
        d = audit["datasets"][name]
        print(f"[audit] {name}: available={d.get('available')}")
    return audit


if __name__ == "__main__":
    main()
