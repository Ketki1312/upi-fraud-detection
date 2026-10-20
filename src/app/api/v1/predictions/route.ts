import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParseJson } from "@/lib/serverHelpers";
import type { PredictionRow, InputType, RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ListResponse {
  predictions: PredictionRow[];
  count: number;
  total: number;
}

/**
 * GET /api/v1/predictions
 * Query params:
 *   - limit (default 50, max 200)
 *   - input_type (transaction | message)
 *   - risk_level (LOW | MEDIUM | HIGH | CRITICAL)
 */
export async function GET(req: Request): Promise<NextResponse<ListResponse>> {
  const url = new URL(req.url);
  const limitParam = url.searchParams.get("limit") || "50";
  const limit = Math.min(Math.max(parseInt(limitParam, 10) || 50, 1), 200);
  const inputType = url.searchParams.get("input_type") as InputType | null;
  const riskLevel = url.searchParams.get("risk_level");

  const where: Record<string, unknown> = {};
  if (inputType === "transaction" || inputType === "message") where.inputType = inputType;
  if (riskLevel && ["LOW", "MEDIUM", "HIGH", "CRITICAL"].includes(riskLevel)) {
    where.riskLevel = riskLevel;
  }

  const [total, rows] = await Promise.all([
    db.prediction.count({ where }),
    db.prediction.findMany({
      where,
      orderBy: { createdAt: "desc" },
      take: limit,
      include: {
        explanation: true,
        riskAssessment: true,
      },
    }),
  ]);

  const predictions: PredictionRow[] = rows.map((r) => ({
    id: r.id,
    input_type: r.inputType as InputType,
    model_version: r.modelVersion,
    predicted_label: r.predictedLabel as 0 | 1,
    probability: r.probability,
    risk_score: r.riskScore,
    risk_level: r.riskLevel as RiskLevel,
    language_detected: r.languageDetected,
    input_summary: r.inputSummary,
    created_at: r.createdAt.toISOString(),
    explanation: r.explanation
      ? (safeParseJson(r.explanation.payload) as PredictionRow["explanation"])
      : null,
    risk_assessment: r.riskAssessment
      ? {
          transaction_risk: r.riskAssessment.transactionRisk,
          message_risk: r.riskAssessment.messageRisk,
          unified_risk: r.riskAssessment.unifiedRisk,
          risk_level: r.riskAssessment.riskLevel as RiskLevel,
          fusion_method: r.riskAssessment.fusionMethod,
          disclaimer: r.riskAssessment.disclaimer,
        }
      : null,
  }));

  return NextResponse.json({
    predictions,
    count: predictions.length,
    total,
  });
}

