import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParseJson } from "@/lib/serverHelpers";
import type { PredictionDetail, InputType, RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/predictions/[id]
 * Returns a single prediction with all related data (transaction/message input,
 * explanation, risk assessment).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ id: string }> }
): Promise<NextResponse> {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }
  const row = await db.prediction.findUnique({
    where: { id },
    include: {
      transaction: true,
      message: true,
      explanation: true,
      riskAssessment: true,
    },
  });
  if (!row) {
    return NextResponse.json({ error: "Prediction not found" }, { status: 404 });
  }

  let input: PredictionDetail["input"] = null;
  if (row.inputType === "transaction" && row.transaction) {
    const t = row.transaction;
    input = {
      type: "transaction",
      data: {
        step: t.step,
        type: t.type,
        amount: t.amount,
        oldbalanceOrg: t.oldBalanceOrg,
        newbalanceOrig: t.newBalanceOrig,
        oldbalanceDest: t.oldBalanceDest,
        newbalanceDest: t.newBalanceDest,
        derived_features: safeParseJson(t.derivedFeatures),
        is_fraud_known: t.isFraudKnown,
      },
    };
  } else if (row.inputType === "message" && row.message) {
    const m = row.message;
    input = {
      type: "message",
      data: {
        text: m.text,
        language: m.language,
        category: m.category,
        label_known: m.labelKnown,
        source: m.source,
      },
    };
  }

  const detail: PredictionDetail = {
    id: row.id,
    input_type: row.inputType as InputType,
    model_version: row.modelVersion,
    predicted_label: row.predictedLabel as 0 | 1,
    probability: row.probability,
    risk_score: row.riskScore,
    risk_level: row.riskLevel as RiskLevel,
    language_detected: row.languageDetected,
    input_summary: row.inputSummary,
    created_at: row.createdAt.toISOString(),
    explanation: row.explanation
      ? (safeParseJson(row.explanation.payload) as PredictionDetail["explanation"])
      : null,
    risk_assessment: row.riskAssessment
      ? {
          transaction_risk: row.riskAssessment.transactionRisk,
          message_risk: row.riskAssessment.messageRisk,
          unified_risk: row.riskAssessment.unifiedRisk,
          risk_level: row.riskAssessment.riskLevel as RiskLevel,
          fusion_method: row.riskAssessment.fusionMethod,
          disclaimer: row.riskAssessment.disclaimer,
        }
      : null,
    input,
    explanation_payload: row.explanation
      ? (safeParseJson(row.explanation.payload) as PredictionDetail["explanation_payload"])
      : null,
    human_readable: row.explanation?.humanReadable || null,
  };

  return NextResponse.json(detail);
}
