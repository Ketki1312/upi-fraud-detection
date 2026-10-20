import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { analyzeRisk, analyzeTransaction, analyzeMessage, MLServiceError } from "@/lib/mlClient";
import {
  deriveTransactionFeatures,
  summarizeTransaction,
  summarizeMessage,
  buildHumanReadable,
  DISCLAIMER,
} from "@/lib/serverHelpers";
import type {
  RiskAnalysisResponse,
  TransactionInput,
  MessageInput,
  TransactionAnalysisResponse,
  MessageAnalysisResponse,
} from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

const ALLOWED_TX_TYPES = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"];
const ALLOWED_MSG_LANGS = ["English", "Hindi", "Hinglish"];

function parseTx(body: unknown): TransactionInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  for (const k of ["step", "type", "amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest"]) {
    if (b[k] === undefined || b[k] === null) return null;
  }
  if (typeof b.type !== "string" || !ALLOWED_TX_TYPES.includes(b.type.toUpperCase())) return null;
  for (const k of ["step", "amount", "oldbalanceOrg", "newbalanceOrig", "oldbalanceDest", "newbalanceDest"]) {
    if (typeof b[k] !== "number") return null;
  }
  if (!Number.isInteger(b.step)) return null;
  return {
    step: b.step as number,
    type: (b.type as string).toUpperCase() as TransactionInput["type"],
    amount: b.amount as number,
    oldbalanceOrg: b.oldbalanceOrg as number,
    newbalanceOrig: b.newbalanceOrig as number,
    oldbalanceDest: b.oldbalanceDest as number,
    newbalanceDest: b.newbalanceDest as number,
  };
}

function parseMsg(body: unknown): MessageInput | null {
  if (!body || typeof body !== "object") return null;
  const b = body as Record<string, unknown>;
  if (typeof b.text !== "string" || b.text.length === 0) return null;
  if (b.language !== undefined && b.language !== null) {
    if (typeof b.language !== "string" || !ALLOWED_MSG_LANGS.includes(b.language)) return null;
  }
  const m: MessageInput = { text: b.text };
  if (typeof b.language === "string") m.language = b.language as MessageInput["language"];
  return m;
}

/**
 * POST /api/v1/risk/analyze
 * Body: { transaction?: TransactionInput, message?: MessageInput }.
 * Calls ML service. If both provided, persists two predictions + one RiskAssessment.
 * If only one input, persists that prediction + RiskAssessment.
 */
export async function POST(req: Request): Promise<NextResponse> {
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }
  if (!body || typeof body !== "object") {
    return NextResponse.json({ error: "Body must be a JSON object" }, { status: 400 });
  }
  const b = body as Record<string, unknown>;
  const transaction = b.transaction ? parseTx(b.transaction) : null;
  const message = b.message ? parseMsg(b.message) : null;
  if (!transaction && !message) {
    return NextResponse.json(
      { error: "At least one of `transaction` or `message` must be provided." },
      { status: 400 }
    );
  }

  // Call the ML service unified risk endpoint
  let risk: RiskAnalysisResponse;
  try {
    risk = await analyzeRisk({
      transaction: transaction || null,
      message: message || null,
    });
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

  // We also need the per-input risk scores to persist meaningful per-prediction rows.
  // We'll issue individual analyze calls so we get explanations + per-input risk scores.
  try {
    let txPredictionId: string | null = null;
    let msgPredictionId: string | null = null;
    let txAnalysis: TransactionAnalysisResponse | null = null;
    let msgAnalysis: MessageAnalysisResponse | null = null;

    if (transaction) {
      try {
        txAnalysis = await analyzeTransaction(transaction);
      } catch (err) {
        // Continue without it — risk endpoint already succeeded.
        console.warn("[risk/analyze] could not fetch transaction analysis", err);
      }
    }
    if (message) {
      try {
        msgAnalysis = await analyzeMessage(message);
      } catch (err) {
        console.warn("[risk/analyze] could not fetch message analysis", err);
      }
    }

    // Persist transactions / messages and predictions
    if (transaction && txAnalysis) {
      const derived = deriveTransactionFeatures(transaction);
      const summary = summarizeTransaction(transaction);
      const t = await db.transaction.create({
        data: {
          step: transaction.step,
          type: transaction.type,
          amount: transaction.amount,
          oldBalanceOrg: transaction.oldbalanceOrg,
          newBalanceOrig: transaction.newbalanceOrig,
          oldBalanceDest: transaction.oldbalanceDest,
          newBalanceDest: transaction.newbalanceDest,
          derivedFeatures: JSON.stringify(derived),
        },
      });
      const p = await db.prediction.create({
        data: {
          inputType: "transaction",
          transactionId: t.id,
          modelVersion: txAnalysis.model_version,
          predictedLabel: txAnalysis.prediction,
          probability: txAnalysis.probability,
          riskScore: Math.round(txAnalysis.risk_score),
          riskLevel: txAnalysis.risk_level,
          inputSummary: summary,
        },
      });
      txPredictionId = p.id;
      await db.explanation.create({
        data: {
          predictionId: p.id,
          method: txAnalysis.explanation.method || "SHAP",
          payload: JSON.stringify(txAnalysis.explanation),
          humanReadable: buildHumanReadable(txAnalysis.explanation, "transaction"),
        },
      });
    }
    if (message && msgAnalysis) {
      const langStored =
        msgAnalysis.language_detected === "hi"
          ? "Hindi"
          : msgAnalysis.language_detected === "hinglish"
            ? "Hinglish"
            : "English";
      const summary = summarizeMessage(message);
      const m = await db.message.create({
        data: { text: message.text, language: langStored },
      });
      const p = await db.prediction.create({
        data: {
          inputType: "message",
          messageId: m.id,
          modelVersion: msgAnalysis.model_version,
          predictedLabel: msgAnalysis.prediction,
          probability: msgAnalysis.probability,
          riskScore: Math.round(msgAnalysis.risk_score),
          riskLevel: msgAnalysis.risk_level,
          languageDetected: langStored,
          inputSummary: summary,
        },
      });
      msgPredictionId = p.id;
      await db.explanation.create({
        data: {
          predictionId: p.id,
          method: msgAnalysis.explanation.method || "LIME",
          payload: JSON.stringify(msgAnalysis.explanation),
          humanReadable: buildHumanReadable(msgAnalysis.explanation, "message"),
        },
      });
    }

    // Persist a single RiskAssessment linked to whichever prediction we have.
    // Prefer message prediction if both (matches the "fusion" semantics — a message
    // + transaction pair is most informative for scam + transactional correlation).
    const ownerPredictionId = msgPredictionId || txPredictionId;
    if (ownerPredictionId) {
      await db.riskAssessment.create({
        data: {
          predictionId: ownerPredictionId,
          transactionRisk:
            risk.transaction_risk && typeof risk.transaction_risk === "object"
              ? Math.round(risk.transaction_risk.score)
              : null,
          messageRisk:
            risk.message_risk && typeof risk.message_risk === "object"
              ? Math.round(risk.message_risk.score)
              : null,
          unifiedRisk: Math.round(risk.unified_risk_score),
          riskLevel: risk.risk_level,
          fusionMethod: risk.fusion_method,
          disclaimer: risk.disclaimer || DISCLAIMER,
        },
      });
    }

    // Also log a SystemEvent for the unified risk assessment.
    await db.systemEvent.create({
      data: {
        eventType: "info",
        message: `Unified risk assessment performed (fusion=${risk.fusion_method}, score=${Math.round(risk.unified_risk_score)}, level=${risk.risk_level})`,
        detail: JSON.stringify({
          transaction_risk: risk.transaction_risk,
          message_risk: risk.message_risk,
          unified_risk_score: risk.unified_risk_score,
          fusion_method: risk.fusion_method,
        }),
      },
    });

    return NextResponse.json({
      ...risk,
      prediction_id: ownerPredictionId,
    });
  } catch (err) {
    console.error("[/api/v1/risk/analyze] persistence error", err);
    const msg = err instanceof Error ? err.message : "Unknown DB error";
    return NextResponse.json(
      { error: "Persistence failed", detail: msg, risk },
      { status: 500 }
    );
  }
}
