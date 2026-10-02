"use client";

import { useEffect, useState } from "react";
import { Moon, Sun, Activity } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import type { TabId, TabDef } from "@/components/layout/Sidebar";

interface HeaderProps {
  active: TabId;
  tabs: TabDef[];
}

interface HealthState {
  online: boolean;
  loading: boolean;
  error: string | null;
}

export function Header({ active, tabs }: HeaderProps) {
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [health, setHealth] = useState<HealthState>({
    online: false,
    loading: true,
    error: null,
  });

  useEffect(() => setMounted(true), []);

  // Poll the ML service health endpoint every 30s (and on mount).
  useEffect(() => {
    let cancelled = false;
    const check = async () => {
      try {
        const res = await fetch("/api/v1/health", { cache: "no-store" });
        if (!res.ok) throw new Error(`HTTP ${res.status}`);
        const data = (await res.json()) as {
          mlService:
            | { status: string; error?: string; models_loaded?: Record<string, boolean> }
            | { status: "down"; error: string };
        };
        if (cancelled) return;
        const online =
          "models_loaded" in (data.mlService || {})
            ? (data.mlService as { models_loaded: Record<string, boolean> }).models_loaded
                ?.transaction === true
            : false;
        setHealth({
          online,
          loading: false,
          error:
            data.mlService && data.mlService.status === "down"
              ? (data.mlService as { error: string }).error
              : null,
        });
      } catch (e) {
        if (cancelled) return;
        setHealth({
          online: false,
          loading: false,
          error: e instanceof Error ? e.message : "Unknown error",
        });
      }
    };
    void check();
    const t = setInterval(() => void check(), 30_000);
    return () => {
      cancelled = true;
      clearInterval(t);
    };
  }, []);

  const activeTab = tabs.find((t) => t.id === active);

  return (
    <header
      role="banner"
      className="sticky top-0 z-30 flex h-16 items-center justify-between gap-3 border-b border-border bg-background/95 px-4 pl-16 backdrop-blur md:pl-6"
    >
      <div className="min-w-0 flex-1">
        <h1 className="truncate text-base font-semibold text-foreground sm:text-lg">
          {activeTab?.label ?? "Dashboard"}
        </h1>
        <p className="hidden truncate text-xs text-muted-foreground sm:block">
          {activeTab?.description}
        </p>
      </div>

      <div className="flex items-center gap-2">
        {/* ML service status pill */}
        <div
          className={cn(
            "inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-medium",
            health.loading
              ? "border-border bg-muted text-muted-foreground"
              : health.online
                ? "border-accent/30 bg-accent/10 text-accent"
                : "border-destructive/30 bg-destructive/10 text-destructive"
          )}
          role="status"
          aria-live="polite"
          title={
            health.error
              ? `ML service: ${health.error}`
              : health.online
                ? "ML service: online"
                : "ML service: offline"
          }
        >
          <Activity
            className={cn(
              "size-3.5",
              health.loading && "animate-pulse",
              health.online && "text-accent",
              !health.online && !health.loading && "text-destructive"
            )}
            aria-hidden="true"
          />
          <span className="hidden sm:inline">
            ML service: {health.loading ? "checking…" : health.online ? "online" : "offline"}
          </span>
          <span className="sm:hidden" aria-hidden="true">
            {health.loading ? "…" : health.online ? "✓" : "✗"}
          </span>
        </div>

        {/* Theme toggle */}
        <Button
          variant="outline"
          size="icon"
          onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
          aria-label="Toggle colour theme"
          title="Toggle light/dark"
        >
          {mounted ? (
            theme === "dark" ? (
              <Sun className="size-4" aria-hidden="true" />
            ) : (
              <Moon className="size-4" aria-hidden="true" />
            )
          ) : (
            <Sun className="size-4 opacity-0" aria-hidden="true" />
          )}
        </Button>
      </div>
    </header>
  );
}

export default Header;
