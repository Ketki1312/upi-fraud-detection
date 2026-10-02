import { NextResponse } from "next/server";
import { getDriftStatus, MLServiceError } from "@/lib/mlClient";
import type { DriftStatusResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/drift/status
 * Pass-through to the ML service drift/status endpoint.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const status = await getDriftStatus();
    return NextResponse.json(status satisfies DriftStatusResponse);
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
