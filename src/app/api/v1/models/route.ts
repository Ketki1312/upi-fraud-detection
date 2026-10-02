import { NextResponse } from "next/server";
import { getModels, MLServiceError } from "@/lib/mlClient";
import type { ModelsResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/models
 * Pass-through to the ML service models endpoint.
 */
export async function GET(): Promise<NextResponse> {
  try {
    const models = await getModels();
    return NextResponse.json(models satisfies ModelsResponse);
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
