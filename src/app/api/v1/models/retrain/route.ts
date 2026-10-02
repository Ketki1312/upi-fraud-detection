import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { retrainModel, MLServiceError } from "@/lib/mlClient";
import type { RetrainResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface RetrainBody {
  model_name: string;
  drift_window?: Record<string, unknown> | null;
}

/**
 * POST /api/v1/models/retrain
 * Body: { model_name, drift_window? }
 * Triggers a candidate retrain on the ML service, persists a SystemEvent row
 * recording the attempt + outcome, and returns the comparison dict.
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
  const b = body as RetrainBody;
  if (typeof b.model_name !== "string" || !b.model_name.trim()) {
    return NextResponse.json({ error: "model_name required" }, { status: 400 });
  }

  let outcome: RetrainResponse;
  try {
    outcome = await retrainModel({
      model_name: b.model_name,
      drift_window: b.drift_window || null,
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

  // Persist a SystemEvent row recording the retrain attempt + outcome.
  try {
    await db.systemEvent.create({
      data: {
        eventType: outcome.promoted ? "promote" : "retrain",
        message: `Retrain of '${b.model_name}' ${outcome.outcome} (candidate ${outcome.candidate_version}, promoted=${outcome.promoted})`,
        detail: JSON.stringify({
          model_name: b.model_name,
          drift_window: b.drift_window || null,
          candidate_version: outcome.candidate_version,
          old_metrics: outcome.old_metrics,
          new_metrics: outcome.new_metrics,
          comparison: outcome.comparison,
          promoted: outcome.promoted,
          outcome: outcome.outcome,
          event_id: outcome.event_id,
        }),
      },
    });

    // Also persist a DriftEvent row to record this adaptive action.
    await db.driftEvent.create({
      data: {
        id: outcome.event_id,
        feature: b.model_name,
        referencePeriod: "training reference",
        currentPeriod: b.drift_window
          ? `step ${b.drift_window.min_step ?? "?"}–${b.drift_window.max_step ?? "?"}`
          : "validation window",
        driftMetric:
          typeof outcome.comparison?.f1_delta === "number"
            ? outcome.comparison.f1_delta
            : 0,
        status: outcome.promoted ? "DRIFT_DETECTED" : "NO_DRIFT",
        actionTaken: `candidate retrain ${outcome.outcome} (promoted=${outcome.promoted})`,
      },
    });
  } catch (e) {
    console.warn("[models/retrain] could not persist system event / drift event", e);
  }

  return NextResponse.json(outcome);
}
