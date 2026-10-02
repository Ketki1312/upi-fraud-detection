/**
 * Shared helpers for API routes — input summaries, JSON parsing, risk levels.
 */
import type {
  TransactionInput,
  MessageInput,
  RiskLevel,
} from "@/lib/types";

export function riskLevelFromScore(score: number): RiskLevel {
  if (score < 25) return "LOW";
  if (score < 50) return "MEDIUM";
  if (score < 75) return "HIGH";
  return "CRITICAL";
}

/** Short human-readable summary of a transaction (for the prediction row). */
export function summarizeTransaction(tx: TransactionInput): string {
  const fmt = (n: number) =>
    Number.isInteger(n) ? n.toLocaleString("en-IN") : n.toLocaleString("en-IN", { maximumFractionDigits: 2 });
  const type = (tx.type || "").toUpperCase();
  return `${type} ${fmt(tx.amount)} — sender ${fmt(tx.oldbalanceOrg)} → ${fmt(tx.newbalanceOrig)} | receiver ${fmt(tx.oldbalanceDest)} → ${fmt(tx.newbalanceDest)} (step ${tx.step})`;
}

/** Short human-readable summary of a message (for the prediction row). */
export function summarizeMessage(msg: MessageInput): string {
  const t = (msg.text || "").trim();
  if (!t) return "(empty message)";
  return t.length > 140 ? `${t.slice(0, 140)}…` : t;
}

/** Build the persisted `derivedFeatures` JSON string for a Transaction row. */
export function deriveTransactionFeatures(tx: TransactionInput): Record<string, number> {
  const amount = Number(tx.amount) || 0;
  const oldOrg = Number(tx.oldbalanceOrg) || 0;
  const newOrg = Number(tx.newbalanceOrig) || 0;
  const oldDest = Number(tx.oldbalanceDest) || 0;
  const newDest = Number(tx.newbalanceDest) || 0;
  return {
    orig_balance_change: newOrg - oldOrg,
    dest_balance_change: newDest - oldDest,
    amount_to_orig_balance: oldOrg ? amount / oldOrg : 0,
    amount_to_dest_balance: oldDest ? amount / oldDest : 0,
  };
}

/** Build a human-readable string from a SHAP/LIME explanation payload. */
export function buildHumanReadable(payload: unknown, kind: "transaction" | "message"): string {
  if (!payload || typeof payload !== "object") return "";
  const p = payload as Record<string, unknown>;
  if (kind === "message") {
    return (p.human_summary as string) || "LIME token weights describe model contributions, not causal effects.";
  }
  // transaction — SHAP
  const contributions = (p.contributions as { feature: string; human_label: string; contribution: number }[]) || [];
  const top = contributions
    .slice()
    .sort((a, b) => Math.abs(b.contribution) - Math.abs(a.contribution))
    .slice(0, 5);
  if (top.length === 0) {
    return "No SHAP contributions were returned.";
  }
  const positive = top.filter((c) => c.contribution > 0).map((c) => `'${c.human_label}'`);
  const negative = top.filter((c) => c.contribution < 0).map((c) => `'${c.human_label}'`);
  const parts: string[] = [];
  if (positive.length) parts.push(`Pushed toward fraud: ${positive.join(", ")}.`);
  if (negative.length) parts.push(`Pushed toward legitimate: ${negative.join(", ")}.`);
  parts.push("SHAP values describe model contributions, not causal effects.");
  return parts.join(" ");
}

/** Safe JSON parse for persisted payloads. */
export function safeParseJson<T = unknown>(s: string | null | undefined): T | null {
  if (!s) return null;
  try {
    return JSON.parse(s) as T;
  } catch {
    return null;
  }
}

export const DISCLAIMER =
  "This system is an academic research prototype and decision-support tool. It does not replace bank, UPI provider, or law-enforcement fraud prevention systems. Public datasets (PaySim, UCI SMS Spam, synthetic Hindi/Hinglish) do not establish a causal transaction-message relationship.";
