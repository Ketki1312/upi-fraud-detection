import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDriftHistory, MLServiceError } from "@/lib/mlClient";
import type { DriftHistoryResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/drift/history
 * Returns the ML service's drift history (append-only JSON of all past retrain
 * and drift events). Also syncs new events into Prisma's DriftEvent table so
 * they're queryable for historical analysis. Idempotent by event id.
 */
export async function GET(): Promise<NextResponse<DriftHistoryResponse>> {
  try {
    const remote = await getDriftHistory();
    // Persist any events that don't yet exist in Prisma
    for (const ev of remote.events) {
      if (!ev.id) continue;
      try {
        await db.driftEvent.upsert({
          where: { id: ev.id },
          create: {
            id: ev.id,
            feature: ev.feature || ev.model_name || "global",
            referencePeriod: ev.reference_period || "training reference",
            currentPeriod:
              ev.current_period ||
              (ev.drift_window
                ? `step ${ev.drift_window.min_step ?? "?"}–${ev.drift_window.max_step ?? "?"}`
                : "current"),
            driftMetric: ev.drift_metric ?? 0,
            status: ev.status || "NO_DRIFT",
            actionTaken: ev.action_taken || ev.outcome || null,
          },
          update: {
            actionTaken: ev.action_taken || ev.outcome || null,
          },
        });
      } catch (e) {
        console.warn("[drift/history] could not upsert drift event", ev.id, e);
      }
    }
    return NextResponse.json(remote);
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
}

