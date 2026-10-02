/**
 * mlClient.ts — server-only HTTP client for the Python ML service at
 * http://localhost:4000. Used by Next.js API routes (server-side, no 'use client').
 *
 * Next.js API route handlers run on the server, so direct localhost access is
 * fine. No XTransformPort is needed here — that's only for browser→backend calls
 * that have to traverse the Caddy gateway.
 */
import "server-only";

import type {
  HealthResponse,
  TransactionAnalysisResponse,
  MessageAnalysisResponse,
  RiskAnalysisResponse,
  TransactionInput,
  MessageInput,
  ModelInfo,
  ModelsResponse,
  RetrainResponse,
  DriftStatusResponse,
  DriftHistoryResponse,
  MLServiceDashboardSummary,
  MLServiceDashboardTrends,
} from "@/lib/types";

const ML_SERVICE_URL = process.env.ML_SERVICE_URL || "http://localhost:4000";

/** How long to wait for the ML service before giving up (ms). */
const DEFAULT_TIMEOUT_MS = 30_000;

/** Retrain can take >30s on the sandbox, so give it a longer budget. */
const RETRAIN_TIMEOUT_MS = 120_000;

export class MLServiceError extends Error {
  status: number;
  body: unknown;
  constructor(message: string, status: number, body: unknown) {
    super(message);
    this.name = "MLServiceError";
    this.status = status;
    this.body = body;
  }
}

async function callML<T>(
  path: string,
  init?: RequestInit,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  const url = `${ML_SERVICE_URL}${path}`;
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
  try {
    const res = await fetch(url, {
      ...init,
      cache: "no-store",
      signal: controller.signal,
      headers: {
        "Content-Type": "application/json",
        ...(init?.headers || {}),
      },
    });
    const text = await res.text();
    let body: unknown;
    try {
      body = text ? JSON.parse(text) : null;
    } catch {
      body = text;
    }
    if (!res.ok) {
      throw new MLServiceError(
        `ML service ${path} returned ${res.status}`,
        res.status,
        body
      );
    }
    return body as T;
  } finally {
    clearTimeout(timeout);
  }
}

// ---- Health ----
export function getHealth(): Promise<HealthResponse> {
  return callML<HealthResponse>("/health");
}

// ---- Analyzers ----
export function analyzeTransaction(
  input: TransactionInput
): Promise<TransactionAnalysisResponse> {
  return callML<TransactionAnalysisResponse>(
    "/api/v1/transactions/analyze",
    { method: "POST", body: JSON.stringify(input) }
  );
}

export function analyzeMessage(
  input: MessageInput
): Promise<MessageAnalysisResponse> {
  return callML<MessageAnalysisResponse>("/api/v1/messages/analyze", {
    method: "POST",
    body: JSON.stringify(input),
  });
}

export function analyzeRisk(body: {
  transaction?: TransactionInput | null;
  message?: MessageInput | null;
  transaction_probability?: number | null;
  message_probability?: number | null;
  fusion_method?: string | null;
}): Promise<RiskAnalysisResponse> {
  // Strip nulls so we don't send `"key": null` keys that confuse Pydantic.
  const payload: Record<string, unknown> = {};
  if (body.transaction) payload.transaction = body.transaction;
  if (body.message) payload.message = body.message;
  if (body.transaction_probability !== undefined && body.transaction_probability !== null)
    payload.transaction_probability = body.transaction_probability;
  if (body.message_probability !== undefined && body.message_probability !== null)
    payload.message_probability = body.message_probability;
  if (body.fusion_method) payload.fusion_method = body.fusion_method;

  return callML<RiskAnalysisResponse>("/api/v1/risk/analyze", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ---- Dashboard (service-side aggregates) ----
export function getDashboardSummary(): Promise<MLServiceDashboardSummary> {
  return callML<MLServiceDashboardSummary>("/api/v1/dashboard/summary");
}

export function getDashboardTrends(): Promise<MLServiceDashboardTrends> {
  return callML<MLServiceDashboardTrends>("/api/v1/dashboard/trends");
}

// ---- Drift ----
export function getDriftStatus(): Promise<DriftStatusResponse> {
  return callML<DriftStatusResponse>("/api/v1/drift/status");
}

export function getDriftHistory(): Promise<DriftHistoryResponse> {
  return callML<DriftHistoryResponse>("/api/v1/drift/history");
}

// ---- Models ----
export function getModels(): Promise<ModelsResponse> {
  return callML<ModelsResponse>("/api/v1/models");
}

export function retrainModel(body: {
  model_name: string;
  drift_window?: Record<string, unknown> | null;
}): Promise<RetrainResponse> {
  const payload: Record<string, unknown> = { model_name: body.model_name };
  if (body.drift_window) payload.drift_window = body.drift_window;
  return callML<RetrainResponse>("/api/v1/models/retrain", {
    method: "POST",
    body: JSON.stringify(payload),
  }, RETRAIN_TIMEOUT_MS);
}

/** Convenience: get model list as a flat ModelInfo[]. */
export async function getModelList(): Promise<ModelInfo[]> {
  const res = await getModels();
  return res.models;
}
