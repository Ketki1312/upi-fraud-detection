import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeTransaction, MLServiceError } from "@/lib/mlClient";
import {
  deriveTransactionFeatures,
  summarizeTransaction,
  buildHumanReadable,
  DISCLAIMER,
} from "@/lib/serverHelpers";
import type { TransactionAnalysisResponse, TransactionInput } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface ValidationError {
  error: string;
  field?: string;
}

function validateTransactionInput(body: unknown): TransactionInput | ValidationError {
  if (!body || typeof body !== "object") {
    return { error: "Request body must be a JSON object." };
  }
  const b = body as Record<string, unknown>;
  const required: (keyof TransactionInput)[] = [
    "step",
    "type",
    "amount",
    "oldbalanceOrg",
    "newbalanceOrig",
    "oldbalanceDest",
    "newbalanceDest",
  ];
  for (const key of required) {
    if (b[key] === undefined || b[key] === null) {
      return { error: `Missing required field: ${key}`, field: String(key) };
    }
  }
  const allowedTypes = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"];
  if (typeof b.type !== "string" || !allowedTypes.includes(b.type.toUpperCase())) {
    return { error: `type must be one of ${allowedTypes.join(", ")}`, field: "type" };
  }
  const num = (v: unknown, field: string): number | ValidationError => {
    if (typeof v !== "number" || Number.isNaN(v)) {
      return { error: `${field} must be a number`, field };
    }
    return v;
  };
  const stepCheck = num(b.step, "step");
  if (typeof stepCheck !== "number") return stepCheck;
  if (!Number.isInteger(stepCheck)) {
    return { error: "step must be an integer", field: "step" };
  }
  const fields: (keyof TransactionInput)[] = [
    "amount",
    "oldbalanceOrg",
    "newbalanceOrig",
    "oldbalanceDest",
    "newbalanceDest",
  ];
  for (const f of fields) {
    const c = num(b[f], f as string);
    if (typeof c !== "number") return c;
  }
  return {
    step: stepCheck,
    type: (b.type as string).toUpperCase() as TransactionInput["type"],
    amount: b.amount as number,
    oldbalanceOrg: b.oldbalanceOrg as number,
    newbalanceOrig: b.newbalanceOrig as number,
    oldbalanceDest: b.oldbalanceDest as number,
    newbalanceDest: b.newbalanceDest as number,
  };
}

/**
 * POST /api/v1/transactions/analyze
 * Body: TransactionInput. Calls ML service, persists to Prisma, returns
 * the analysis response with a `prediction_id` for downstream explanation lookup.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  const validated = validateTransactionInput(body);
  if ("error" in validated) {
    return NextResponse.json(validated, { status: 400 });
  }
  const input = validated;

  // Call the ML service
  let analysis: TransactionAnalysisResponse;
  try {
    analysis = await analyzeTransaction(input);
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
    const derived = deriveTransactionFeatures(input);
    const summary = summarizeTransaction(input);
    const transaction = await db.transaction.create({
      data: {
        step: input.step,
        type: input.type,
        amount: input.amount,
        oldBalanceOrg: input.oldbalanceOrg,
        newBalanceOrig: input.newbalanceOrig,
        oldBalanceDest: input.oldbalanceDest,
        newBalanceDest: input.newbalanceDest,
        derivedFeatures: JSON.stringify(derived),
      },
    });
    const prediction = await db.prediction.create({
      data: {
        inputType: "transaction",
        transactionId: transaction.id,
        modelVersion: analysis.model_version,
        predictedLabel: analysis.prediction,
        probability: analysis.probability,
        riskScore: Math.round(analysis.risk_score),
        riskLevel: analysis.risk_level,
        inputSummary: summary,
      },
    });
    const humanReadable = buildHumanReadable(analysis.explanation, "transaction");
    await db.explanation.create({
      data: {
        predictionId: prediction.id,
        method: analysis.explanation.method || "SHAP",
        payload: JSON.stringify(analysis.explanation),
        humanReadable,
      },
    });
    await db.riskAssessment.create({
      data: {
        predictionId: prediction.id,
        transactionRisk: Math.round(analysis.risk_score),
        messageRisk: null,
        unifiedRisk: Math.round(analysis.risk_score),
        riskLevel: analysis.risk_level,
        fusionMethod: "single_input",
        disclaimer: DISCLAIMER,
      },
    });
    return NextResponse.json({ ...analysis, prediction_id: prediction.id });
  } catch (err) {
    console.error("[/api/v1/transactions/analyze] persistence error", err);
    const msg = err instanceof Error ? err.message : "Unknown DB error";
    return NextResponse.json(
      { error: "Persistence failed", detail: msg, analysis },
      { status: 500 }
    );
  }
}
