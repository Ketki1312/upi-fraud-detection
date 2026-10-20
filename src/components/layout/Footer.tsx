"use client";

import { AlertTriangle } from "lucide-react";

/**
 * Footer — sticky bottom of the page.
 *
 * - Contains the mandatory research-prototype disclaimer.
 * - Sticks to the bottom of the viewport on short pages (mt-auto on the
 *   flex-column wrapper in page.tsx).
 * - Pushed down naturally on long pages (no overlap).
 * - Uses orange/red small print per the design spec.
 */
export function Footer() {
  return (
    <footer
      role="contentinfo"
      className="mt-auto border-t border-border bg-secondary/40 px-4 py-3 text-xs text-primary/80 dark:text-primary/90"
    >
      <div className="mx-auto flex max-w-7xl flex-col items-start gap-1 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-2">
          <AlertTriangle className="mt-0.5 size-3.5 shrink-0 text-primary" aria-hidden="true" />
          <p className="leading-snug">
            <span className="font-semibold text-primary">
              Research prototype — not a production system.
            </span>{" "}
            This does not replace bank, UPI provider, or law-enforcement fraud
            prevention. PaySim is a public mobile-money simulator (NOT real UPI
            banking data); Hindi/Hinglish datasets are synthetic; English SMS
            is the public UCI SMS Spam Collection. No causal
            transaction–message relationship is claimed.
          </p>
        </div>
        <p className="shrink-0 text-muted-foreground sm:ml-4 sm:text-right">
          © {new Date().getFullYear()} UPI Fraud Detection — academic prototype.
        </p>
      </div>
    </footer>
  );
}

export default Footer;
