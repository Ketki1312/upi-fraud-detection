"use client";

import {
  LayoutDashboard,
  ArrowLeftRight,
  MessageSquareWarning,
  ShieldAlert,
  FileSearch,
  Activity,
  BarChart3,
  History,
  Info,
} from "lucide-react";

import { cn } from "@/lib/utils";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetTrigger, SheetTitle, SheetDescription } from "@/components/ui/sheet";
import { Menu } from "lucide-react";
import { useState } from "react";

export type TabId =
  | "dashboard"
  | "transaction"
  | "message"
  | "unified"
  | "explanation"
  | "drift"
  | "models"
  | "history"
  | "about";

export interface TabDef {
  id: TabId;
  label: string;
  shortLabel?: string;
  description: string;
  icon: typeof LayoutDashboard;
}

export const TABS: TabDef[] = [
  {
    id: "dashboard",
    label: "Dashboard",
    description: "Live KPIs, risk distribution, language distribution, fraud-rate trends.",
    icon: LayoutDashboard,
  },
  {
    id: "transaction",
    label: "Transaction Analyzer",
    description: "Run XGBoost fraud prediction + real SHAP TreeExplainer on a single transaction.",
    icon: ArrowLeftRight,
  },
  {
    id: "message",
    label: "Scam Message Analyzer",
    description: "Run TF-IDF + LogisticRegression scam prediction + real LIME on a single message.",
    icon: MessageSquareWarning,
  },
  {
    id: "unified",
    label: "Unified Risk",
    description: "Fuse transaction + message risks into a single 0–100 score.",
    icon: ShieldAlert,
  },
  {
    id: "explanation",
    label: "Explanation View",
    description: "Inspect SHAP/LIME explanations for any past prediction.",
    icon: FileSearch,
  },
  {
    id: "drift",
    label: "Drift Monitoring",
    description: "Real PSI per feature; retrain a candidate model on demand.",
    icon: Activity,
  },
  {
    id: "models",
    label: "Model Performance",
    description: "Per-model metrics + static-vs-adaptive comparison.",
    icon: BarChart3,
  },
  {
    id: "history",
    label: "Prediction History",
    description: "All persisted predictions, filterable and paginated.",
    icon: History,
  },
  {
    id: "about",
    label: "About / Dataset",
    description: "Dataset provenance, audit summary, architecture diagram, disclaimer.",
    icon: Info,
  },
];

interface SidebarProps {
  active: TabId;
  onChange: (tab: TabId) => void;
}

/** Sidebar logo — rotated square with "Z" in primary color, per reference image. */
function Logo() {
  return (
    <div className="flex items-center gap-2.5">
      <div
        className="grid size-9 place-items-center"
        aria-hidden="true"
        style={{ transform: "rotate(45deg)" }}
      >
        <div className="grid size-7 place-items-center rounded-[6px] bg-primary text-primary-foreground">
          <span
            className="text-sm font-bold leading-none"
            style={{ transform: "rotate(-45deg)" }}
          >
            Z
          </span>
        </div>
      </div>
      <div className="leading-tight">
        <div className="text-sm font-semibold text-foreground">UPI Fraud Detection</div>
        <div className="text-[10px] uppercase tracking-wider text-muted-foreground">
          Research Prototype
        </div>
      </div>
    </div>
  );
}

function NavList({ active, onChange }: SidebarProps) {
  return (
    <nav aria-label="Main" className="flex flex-col gap-1">
      {TABS.map((tab) => {
        const Icon = tab.icon;
        const isActive = tab.id === active;
        return (
          <button
            key={tab.id}
            type="button"
            onClick={() => onChange(tab.id)}
            aria-current={isActive ? "page" : undefined}
            aria-label={tab.label}
            title={tab.description}
            className={cn(
              "group flex items-center gap-3 rounded-md border-l-2 px-3 py-2 text-sm font-medium transition-colors",
              "hover:bg-sidebar-accent hover:text-sidebar-accent-foreground",
              isActive
                ? "border-primary bg-primary/10 text-primary"
                : "border-transparent text-sidebar-foreground"
            )}
          >
            <Icon className="size-4 shrink-0" aria-hidden="true" />
            <span className="truncate">{tab.label}</span>
          </button>
        );
      })}
    </nav>
  );
}

export function Sidebar({ active, onChange }: SidebarProps) {
  const [mobileOpen, setMobileOpen] = useState(false);

  return (
    <>
      {/* Desktop sidebar — 256px */}
      <aside
        aria-label="Sidebar"
        className="hidden w-64 shrink-0 border-r border-border bg-sidebar text-sidebar-foreground md:block"
      >
        <div className="flex h-full flex-col gap-4 p-4">
          <div className="border-b border-sidebar-border pb-4">
            <Logo />
          </div>
          <NavList active={active} onChange={onChange} />
          <div className="mt-auto rounded-md bg-secondary/60 p-3 text-[11px] leading-snug text-muted-foreground">
            ML service: Python FastAPI on port 4000. All numbers on this page
            come from real model inference — none are hardcoded.
          </div>
        </div>
      </aside>

      {/* Mobile sidebar — Sheet with icon-only trigger */}
      <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
        <SheetTrigger asChild>
          <Button
            variant="outline"
            size="icon"
            className="fixed left-3 top-3 z-40 md:hidden"
            aria-label="Open navigation menu"
          >
            <Menu className="size-5" aria-hidden="true" />
          </Button>
        </SheetTrigger>
        <SheetContent side="left" className="w-72 bg-sidebar text-sidebar-foreground">
          <SheetTitle className="sr-only">Navigation</SheetTitle>
          <SheetDescription className="sr-only">
            Choose a section of the UPI Fraud Detection prototype.
          </SheetDescription>
          <div className="flex h-full flex-col gap-4 p-4">
            <div className="border-b border-sidebar-border pb-4">
              <Logo />
            </div>
            <NavList
              active={active}
              onChange={(t) => {
                onChange(t);
                setMobileOpen(false);
              }}
            />
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}

export default Sidebar;
