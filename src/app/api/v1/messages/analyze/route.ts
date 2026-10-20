import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeMessage, MLServiceError } from "@/lib/mlClient";
import {
  summarizeMessage,
  buildHumanReadable,
  DISCLAIMER,
} from "@/lib/serverHelpers";
import type { MessageAnalysisResponse, MessageInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ValidationError {
  error: string;
  field?: string;
}

function validateMessageInput(body: unknown): MessageInput | ValidationError {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string") {
    return { error: "text must be a string", field: "text" };
  }
  if (b.text.length === 0) {
    return { error: "text must not be empty", field: "text" };
  }
  if (b.language !== undefined && b.language !== null) {
    const allowed = ["English", "Hindi", "Hinglish"];
    if (typeof b.language !== "string" || !allowed.includes(b.language)) {
      return { error: `language must be one of ${allowed.join(", ")} or omitted`, field: "language" };
    }
  }
  const input: MessageInput = { text: b.text };
  if (typeof b.language === "string") input.language = b.language as MessageInput["language"];
  return input;
}

/**
 * POST /api/v1/messages/analyze
 * Body: MessageInput. Persists Message + Prediction + Explanation + RiskAssessment.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validated = validateMessageInput(body);
  if ("error" in validated) {
    return NextResponse.json(validated, { status: 400 });
  }
  const input = validated;

  // Call the ML service
  let analysis: MessageAnalysisResponse;
  try {
    analysis = await analyzeMessage(input);
  } catch (err) {
    if (err instanceof MLServiceError) {
      return NextResponse.json(
        { error: "ML service error", detail: err.body, status: err.status },
        { status: 502 }
      );
    }
    const msg = err instanceof Error ? err.message : "Unknown error";
    return NextResponse.json({ error: "ML service unreachable", detail: msg }, { status: 502 });
  }

  // Persist
  try {
    const langStored =
      analysis.language_detected === "hi"
        ? "Hindi"
        : analysis.language_detected === "hinglish"
          ? "Hinglish"
          : "English";
    const summary = summarizeMessage(input);
    const message = await db.message.create({
      data: {
        text: input.text,
        language: langStored,
      },
    });
    const prediction = await db.prediction.create({
      data: {
        inputType: "message",
        messageId: message.id,
        modelVersion: analysis.model_version,
        predictedLabel: analysis.prediction,
        probability: analysis.probability,
        riskScore: Math.round(analysis.risk_score),
        riskLevel: analysis.risk_level,
        languageDetected: langStored,
        inputSummary: summary,
      },
    });
    const humanReadable = buildHumanReadable(analysis.explanation, "message");
    await db.explanation.create({
      data: {
        predictionId: prediction.id,
        method: analysis.explanation.method || "LIME",
        payload: JSON.stringify(analysis.explanation),
        humanReadable,
      },
    });
    await db.riskAssessment.create({
      data: {
        predictionId: prediction.id,
        transactionRisk: null,
        messageRisk: Math.round(analysis.risk_score),
        unifiedRisk: Math.round(analysis.risk_score),
        riskLevel: analysis.risk_level,
        fusionMethod: "single_input",
        disclaimer: DISCLAIMER,
      },
    });
    return NextResponse.json({ ...analysis, prediction_id: prediction.id });
  } catch (err) {
    console.error("[/api/v1/messages/analyze] persistence error", err);
    const msg = err instanceof Error ? err.message : "Unknown DB error";
    return NextResponse.json(
      { error: "Persistence failed", detail: msg, analysis },
      { status: 500 }
    );
  }
}
