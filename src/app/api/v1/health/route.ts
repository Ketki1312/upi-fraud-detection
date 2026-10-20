import { NextResponse } from "next/server";
import { getHealth } from "@/lib/mlClient";
import { MLServiceError } from "@/lib/mlClient";
import type { HealthCheckResponse } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/health
 * Returns the Next.js side health plus the upstream Python ML service health.
 */
export async function GET(): Promise<NextResponse<HealthCheckResponse>> {
  const timestamp = new Date().toISOString();
  try {
    const mlService = await getHealth();
    return NextResponse.json({
      nextjs: "ok",
      mlService,
      timestamp,
    } satisfies HealthCheckResponse);
  } catch (err) {
    const message =
      err instanceof MLServiceError
        ? `ML service responded ${err.status}`
        : err instanceof Error
          ? err.message
          : "Unknown error";
    return NextResponse.json(
      {
        nextjs: "ok",
        mlService: { status: "down", error: message },
        timestamp,
      } satisfies HealthCheckResponse,
      { status: 200 }
    );
  }
}
