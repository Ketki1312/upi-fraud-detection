import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { safeParseJson } from "@/lib/serverHelpers";
import type { RiskLevel } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/explanations/[predictionId]
 * Returns the explanation payload for a prediction (parsed JSON + human-readable text).
 */
export async function GET(
  _req: Request,
  { params }: { params: Promise<{ predictionId: string }> }
): Promise<NextResponse> {
  const { predictionId } = await params;
  if (!predictionId) {
    return NextResponse.json({ error: "predictionId required" }, { status: 400 });
  }
  const row = await db.explanation.findUnique({
    where: { predictionId },
    include: { prediction: true },
  });
  if (!row) {
    return NextResponse.json({ error: "Explanation not found" }, { status: 404 });
  }
  const payload = safeParseJson(row.payload);
  return NextResponse.json({
    prediction_id: row.predictionId,
    method: row.method,
    payload,
    human_readable: row.humanReadable,
    prediction: {
      id: row.prediction.id,
      input_type: row.prediction.inputType,
      predicted_label: row.prediction.predictedLabel,
      probability: row.prediction.probability,
      risk_score: row.prediction.riskScore,
      risk_level: row.prediction.riskLevel as RiskLevel,
      input_summary: row.prediction.inputSummary,
      model_version: row.prediction.modelVersion,
      language_detected: row.prediction.languageDetected,
      created_at: row.prediction.createdAt.toISOString(),
    },
  });
}
