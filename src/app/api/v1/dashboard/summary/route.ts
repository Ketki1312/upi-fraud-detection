import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDashboardSummary, getDriftStatus, MLServiceError } from "@/lib/mlClient";
import { DISCLAIMER } from "@/lib/serverHelpers";
import type {
  DashboardSummary as EnrichedDashboardSummary,
  InputType,
  RiskLevel,
  ModelInfo,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/dashboard/summary
 * Queries Prisma for prediction aggregates + drift status + recent predictions,
 * merges with model_metrics + datasets_summary from the ML service, and returns
 * a single DashboardSummary payload for the Dashboard tab.
 */
export async function GET(): Promise<NextResponse<EnrichedDashboardSummary>> {
  // Parallel Prisma aggregates
  const [
    totalPredictions,
    fraudCount,
    scamCount,
    highRiskCount,
    riskDistRows,
    langDistRows,
    recentRows,
  ] = await Promise.all([
    db.prediction.count(),
    db.prediction.count({ where: { inputType: "transaction", predictedLabel: 1 } }),
    db.prediction.count({ where: { inputType: "message", predictedLabel: 1 } }),
    db.prediction.count({ where: { riskLevel: { in: ["HIGH", "CRITICAL"] } } }),
    db.prediction.groupBy({ by: ["riskLevel"], _count: { _all: true } }),
    db.prediction.groupBy({ by: ["languageDetected"], _count: { _all: true } }),
    db.prediction.findMany({
      orderBy: { createdAt: "desc" },
      take: 20,
      select: {
        id: true,
        inputType: true,
        inputSummary: true,
        predictedLabel: true,
        riskScore: true,
        riskLevel: true,
        createdAt: true,
      },
    }),
  ]);

  // Shape the distribution maps
  const risk_distribution = { low: 0, medium: 0, high: 0, critical: 0 };
  for (const r of riskDistRows) {
    const key = r.riskLevel.toLowerCase() as keyof typeof risk_distribution;
    if (key in risk_distribution) risk_distribution[key] = r._count._all;
  }
  const language_distribution = langDistRows
    .filter((r) => r.languageDetected)
    .map((r) => ({ language: r.languageDetected as string, count: r._count._all }))
    .sort((a, b) => b.count - a.count);

  // Recent predictions
  const recent_predictions = recentRows.map((r) => ({
    id: r.id,
    input_type: r.inputType as InputType,
    input_summary: r.inputSummary,
    predicted_label: r.predictedLabel as 0 | 1,
    risk_score: r.riskScore,
    risk_level: r.riskLevel as RiskLevel,
    created_at: r.createdAt.toISOString(),
  }));

  // ML service side
  let model_metrics: ModelInfo[] = [];
  let datasets_summary: EnrichedDashboardSummary["datasets_summary"] = {};
  let drift_summary: EnrichedDashboardSummary["drift_summary"] = {
    total_events: 0,
    latest_event: null,
    reference_features_count: 0,
  };
  let mlServiceOnline = true;
  let generated_at = new Date().toISOString();
  let driftStatusSummary: EnrichedDashboardSummary["drift_status_summary"] = {
    no_drift: 0,
    watch: 0,
    drift_detected: 0,
    last_updated: null,
  };

  try {
    const ml = await getDashboardSummary();
    model_metrics = ml.model_metrics || [];
    datasets_summary = ml.datasets_summary || {};
    drift_summary = ml.drift_summary || drift_summary;
    generated_at = ml.generated_at || generated_at;
  } catch (err) {
    mlServiceOnline = false;
    if (err instanceof MLServiceError) {
      console.warn("[dashboard/summary] ML service responded", err.status);
    } else {
      console.warn("[dashboard/summary] ML service unreachable", err);
    }
  }

  // Drift status — fetch separately so we get per-feature counts
  try {
    const drift = await getDriftStatus();
    const counts = { no_drift: 0, watch: 0, drift_detected: 0 };
    for (const f of drift.features) {
      if (f.status === "NO_DRIFT") counts.no_drift += 1;
      else if (f.status === "WATCH") counts.watch += 1;
      else if (f.status === "DRIFT_DETECTED") counts.drift_detected += 1;
    }
    driftStatusSummary = {
      no_drift: counts.no_drift,
      watch: counts.watch,
      drift_detected: counts.drift_detected,
      last_updated: drift.generated_at || null,
    };
    mlServiceOnline = true;
  } catch (err) {
    mlServiceOnline = false;
    if (err instanceof MLServiceError) {
      console.warn("[dashboard/summary] drift/status responded", err.status);
    } else {
      console.warn("[dashboard/summary] drift/status unreachable", err);
    }
  }

  const body: EnrichedDashboardSummary = {
    total_predictions: totalPredictions,
    fraud_count: fraudCount,
    scam_count: scamCount,
    high_risk_count: highRiskCount,
    risk_distribution,
    language_distribution,
    model_metrics,
    recent_predictions,
    drift_status_summary: driftStatusSummary,
    datasets_summary,
    drift_summary,
    disclaimer: DISCLAIMER,
    generated_at,
    ml_service_online: mlServiceOnline,
  };

  return NextResponse.json(body);
}
