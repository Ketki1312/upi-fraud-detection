import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getDashboardTrends, MLServiceError } from "@/lib/mlClient";
import { DISCLAIMER } from "@/lib/serverHelpers";
import type { DashboardTrends } from "@/lib/types";

export const dynamic = "force-dynamic";
export const revalidate = 0;

interface PrismaBucket {
  bucket: string; // ISO date-hour label
  risk_low: number;
  risk_medium: number;
  risk_high: number;
  risk_critical: number;
  fraud_count: number;
  total: number;
  fraud_rate: number;
}

/**
 * GET /api/v1/dashboard/trends
 * Returns BOTH:
 *   1. Prisma-backed per-hour prediction trends for the last 24h (or per-day if few rows).
 *   2. The ML service's PaySim benchmark fraud-rate trend (public dataset).
 *
 * Frontend chooses which to render — Prisma trends are the live session; PaySim
 * trends are the historical benchmark.
 */
export async function GET(): Promise<NextResponse> {
  // 1. Prisma-backed per-hour trends
  const since = new Date(Date.now() - 24 * 60 * 60 * 1000);
  const recentRows = await db.prediction.findMany({
    where: { createdAt: { gte: since } },
    select: { createdAt: true, riskLevel: true, predictedLabel: true, inputType: true },
  });

  const buckets = new Map<string, PrismaBucket>();
  for (const r of recentRows) {
    const iso = r.createdAt.toISOString();
    const bucketKey = iso.slice(0, 13); // YYYY-MM-DDTHH
    const label = `${bucketKey}:00`;
    let b = buckets.get(bucketKey);
    if (!b) {
      b = {
        bucket: label,
        risk_low: 0,
        risk_medium: 0,
        risk_high: 0,
        risk_critical: 0,
        fraud_count: 0,
        total: 0,
        fraud_rate: 0,
      };
      buckets.set(bucketKey, b);
    }
    b.total += 1;
    if (r.predictedLabel === 1) b.fraud_count += 1;
    const lvl = r.riskLevel.toUpperCase();
    if (lvl === "LOW") b.risk_low += 1;
    else if (lvl === "MEDIUM") b.risk_medium += 1;
    else if (lvl === "HIGH") b.risk_high += 1;
    else if (lvl === "CRITICAL") b.risk_critical += 1;
  }
  const prismaBuckets = Array.from(buckets.values()).sort((a, b) =>
    a.bucket.localeCompare(b.bucket)
  );
  for (const b of prismaBuckets) {
    b.fraud_rate = b.total > 0 ? b.fraud_count / b.total : 0;
  }

  // If fewer than 4 buckets in last 24h, expand to last 7 days (per-day buckets)
  let bucketMode: "hour" | "day" = "hour";
  let prismaTrends = prismaBuckets;
  if (prismaBuckets.length < 4) {
    const since7 = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const allRows = await db.prediction.findMany({
      where: { createdAt: { gte: since7 } },
      select: { createdAt: true, riskLevel: true, predictedLabel: true },
    });
    const dayBuckets = new Map<string, PrismaBucket>();
    for (const r of allRows) {
      const day = r.createdAt.toISOString().slice(0, 10);
      let b = dayBuckets.get(day);
      if (!b) {
        b = {
          bucket: day,
          risk_low: 0,
          risk_medium: 0,
          risk_high: 0,
          risk_critical: 0,
          fraud_count: 0,
          total: 0,
          fraud_rate: 0,
        };
        dayBuckets.set(day, b);
      }
      b.total += 1;
      if (r.predictedLabel === 1) b.fraud_count += 1;
      const lvl = r.riskLevel.toUpperCase();
      if (lvl === "LOW") b.risk_low += 1;
      else if (lvl === "MEDIUM") b.risk_medium += 1;
      else if (lvl === "HIGH") b.risk_high += 1;
      else if (lvl === "CRITICAL") b.risk_critical += 1;
    }
    prismaTrends = Array.from(dayBuckets.values()).sort((a, b) =>
      a.bucket.localeCompare(b.bucket)
    );
    for (const b of prismaTrends) {
      b.fraud_rate = b.total > 0 ? b.fraud_count / b.total : 0;
    }
    bucketMode = "day";
  }

  // 2. PaySim benchmark trends from ML service
  let paysimTrends: DashboardTrends | null = null;
  let mlOnline = true;
  try {
    const ml = await getDashboardTrends();
    paysimTrends = {
      timestamps: ml.timestamps,
      fraud_rate_trend: ml.fraud_rate_trend,
      fraud_count_trend: ml.fraud_count_trend,
      risk_trend: ml.risk_trend,
      validation_trend: ml.validation_trend,
      test_trend: ml.test_trend,
      source: ml.source,
      disclaimer: ml.disclaimer,
    };
  } catch (err) {
    mlOnline = false;
    if (err instanceof MLServiceError) {
      console.warn("[dashboard/trends] ML service responded", err.status);
    } else {
      console.warn("[dashboard/trends] ML service unreachable", err);
    }
  }

  return NextResponse.json({
    prisma_trends: prismaTrends,
    bucket_mode: bucketMode,
    prisma_total: recentRows.length,
    paysim_benchmark: paysimTrends,
    ml_service_online: mlOnline,
    disclaimer: DISCLAIMER,
  });
}
