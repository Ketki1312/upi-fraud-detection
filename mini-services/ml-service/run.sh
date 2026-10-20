#!/usr/bin/env bash
# Self-healing launcher for the UPI Fraud Detection ML service.
#
# The sandbox can reset the Python venv between sessions, wiping pip packages
# (shap, lime, etc.). This wrapper ensures all required packages are present
# before starting uvicorn, so the service survives sandbox resets without
# manual intervention. It is invoked by Next.js's instrumentation hook
# (src/instrumentation.ts) on every Next.js startup.
#
# Idempotent: `pip install` skips already-installed packages quickly, so this
# adds only ~1-2s to a normal startup.

set -e
cd "$(dirname "$0")"

PY="/home/z/.venv/bin/python3"

# Ensure required packages are present (fast if already installed).
echo "[$(date '+%H:%M:%S')] ensuring python packages..."
"$PY" -m pip install --quiet --disable-pip-version-check \
  shap lime scikit-learn xgboost fastapi "uvicorn[standard]" \
  pandas numpy joblib scipy pydantic 2>&1 || {
    echo "[$(date '+%H:%M:%S')] WARNING: pip install had an error, attempting to start anyway..."
}

echo "[$(date '+%H:%M:%S')] starting uvicorn on 0.0.0.0:4000..."
exec "$PY" -m uvicorn index:app --host 0.0.0.0 --port 4000
