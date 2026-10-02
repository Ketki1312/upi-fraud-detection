"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { AlertTriangle, RefreshCw } from "lucide-react";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { cn } from "@/lib/utils";

export function Disclaimer({ className }: { className?: string }) {
  return (
    <Alert
      className={cn("border-primary/30 bg-primary/5 text-xs", className)}
      role="note"
    >
      <AlertTriangle className="size-4 text-primary" aria-hidden="true" />
      <AlertTitle className="text-sm font-semibold text-primary">
        Research prototype disclaimer
      </AlertTitle>
      <AlertDescription className="text-muted-foreground">
        This is an academic research prototype and decision-support tool. It
        does not replace bank, UPI provider, or law-enforcement fraud prevention
        systems. PaySim is a public mobile-money simulator (NOT real UPI banking
        data); Hindi/Hinglish datasets are synthetic; English SMS is the public
        UCI SMS Spam Collection. SHAP/LIME describe model contributions, not
        causal effects. No causal transaction–message relationship is claimed.
      </AlertDescription>
    </Alert>
  );
}

export function LoadingState({
  rows = 3,
  className,
}: {
  rows?: number;
  className?: string;
}) {
  return (
    <div className={cn("space-y-3", className)} aria-hidden="true">
      {Array.from({ length: rows }).map((_, i) => (
        <Skeleton key={i} className="h-12 w-full" />
      ))}
    </div>
  );
}

export function ErrorState({
  message,
  onRetry,
  className,
}: {
  message: string;
  onRetry?: () => void;
  className?: string;
}) {
  return (
    <Alert
      variant="destructive"
      className={cn(className)}
      role="alert"
      aria-live="assertive"
    >
      <AlertTriangle className="size-4" aria-hidden="true" />
      <AlertTitle>Something went wrong</AlertTitle>
      <AlertDescription className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
        <span className="text-sm">{message}</span>
        {onRetry ? (
          <Button
            variant="outline"
            size="sm"
            onClick={onRetry}
            className="shrink-0"
          >
            <RefreshCw className="size-3.5" aria-hidden="true" />
            Retry
          </Button>
        ) : null}
      </AlertDescription>
    </Alert>
  );
}

export function EmptyState({
  message = "No data yet — make a prediction to populate the dashboard.",
  className,
}: {
  message?: string;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "rounded-lg border border-dashed border-border bg-muted/30 p-8 text-center text-sm text-muted-foreground",
        className
      )}
    >
      {message}
    </div>
  );
}

/**
 * useAsync — minimal async fetch hook with loading / error / data / retry.
 * `deps` is the dependency array for refetching.
 */
export function useAsync<T>(
  fetcher: () => Promise<T>,
  deps: unknown[]
): {
  data: T | null;
  loading: boolean;
  error: string | null;
  refetch: () => void;
} {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  // Keep the latest fetcher in a ref so the effect doesn't re-run when
  // the parent passes a new function identity each render.
  const fetcherRef = useRef(fetcher);
  useEffect(() => {
    fetcherRef.current = fetcher;
  });
  useEffect(() => {
    let cancelled = false;
    // Wrap the work in an async function so setState calls happen inside
    // promise callbacks (not synchronously in the effect body — that's the
    // rule `react-hooks/set-state-in-effect`).
    const run = async () => {
      // Yield to the microtask queue so setState calls below are not
      // synchronous within the effect body.
      await Promise.resolve();
      if (cancelled) return;
      setLoading(true);
      setError(null);
      try {
        const d = await fetcherRef.current();
        if (!cancelled) setData(d);
      } catch (e) {
        if (!cancelled) setError(e instanceof Error ? e.message : "Unknown error");
      } finally {
        if (!cancelled) setLoading(false);
      }
    };
    void run();
    return () => {
      cancelled = true;
    };
  }, [...deps, tick]);

  const refetch = useCallback(() => setTick((t) => t + 1), []);
  return { data, loading, error, refetch };
}

/** Format numbers nicely (e.g. 0.9976 → "0.9976"; 1234.5 → "1,234.5"). */
export function fmtNumber(n: number | null | undefined, digits = 4): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  if (Number.isInteger(n)) return n.toLocaleString("en-IN");
  return n.toLocaleString("en-IN", {
    maximumFractionDigits: digits,
    minimumFractionDigits: 0,
  });
}

export function fmtPct(n: number | null | undefined, digits = 2): string {
  if (n === null || n === undefined || Number.isNaN(n)) return "—";
  return `${(n * 100).toFixed(digits)}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return "—";
  try {
    const d = new Date(iso);
    return d.toLocaleString("en-IN", {
      dateStyle: "medium",
      timeStyle: "short",
    });
  } catch {
    return iso;
  }
}

/** Risk-level → Tailwind classes for the risk-low/medium/high/critical tokens. */
export function riskClass(level: string): string {
  switch ((level || "").toUpperCase()) {
    case "LOW":
      return "risk-low";
    case "MEDIUM":
      return "risk-medium";
    case "HIGH":
      return "risk-high";
    case "CRITICAL":
      return "risk-critical";
    default:
      return "";
  }
}
