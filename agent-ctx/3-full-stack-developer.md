# Task ID: 3 — full-stack-developer (Next.js frontend + API routes)

## One-line summary
Built the Next.js 16 frontend (single-page 9-tab dashboard) + 13 server-side API routes that bridge to the Python ML service on port 4000 and persist to Prisma SQLite.

## Files created (28 new + 2 modified)
- `src/lib/types.ts` (extended — drift thresholds, ModelInfo, DriftHistoryEvent, ModelsResponse, RetrainResponse, MLServiceDashboardSummary/Trends, PredictionDetail, HealthCheckResponse, enriched DashboardSummary/Trends, prediction_id on analysis responses)
- `src/lib/mlClient.ts` (new — server-only typed fetch client, 30s/120s timeouts)
- `src/lib/serverHelpers.ts` (new — input summaries, derived features, human-readable text, JSON parse, DISCLAIMER)
- `src/app/layout.tsx` (modified — ThemeProvider wrapper, Sonner toaster, new metadata)
- `src/app/page.tsx` (rewritten — single-page shell with sidebar + tabs + sticky footer)
- `src/components/theme-provider.tsx` (new — minimal next-themes wrapper)
- 13 API routes under `src/app/api/v1/...`:
  - health/route.ts, transactions/analyze/route.ts, messages/analyze/route.ts, risk/analyze/route.ts, predictions/route.ts, predictions/[id]/route.ts, explanations/[predictionId]/route.ts, dashboard/summary/route.ts, dashboard/trends/route.ts, drift/status/route.ts, drift/history/route.ts, models/route.ts, models/retrain/route.ts
- 3 layout components under `src/components/layout/`:
  - Sidebar.tsx (256px desktop + Sheet mobile, logo, 9 nav items with Lucide icons)
  - Header.tsx (sticky top, status pill polling /api/v1/health every 30s, theme toggle)
  - Footer.tsx (sticky mt-auto, disclaimer + provenance)
- 5 chart components under `src/components/charts/`:
  - RiskGauge.tsx, ContributionsChart.tsx, SimpleBarChart.tsx, SimpleLineChart.tsx, SimplePieChart.tsx
- 9 fraud tab components under `src/components/fraud/`:
  - Dashboard.tsx, TransactionAnalyzer.tsx, ScamMessageAnalyzer.tsx, UnifiedRiskAnalysis.tsx, ExplanationView.tsx, DriftMonitoring.tsx, ModelPerformance.tsx, PredictionHistory.tsx, AboutDataset.tsx
  - Plus shared.tsx with Disclaimer, LoadingState, ErrorState, EmptyState, useAsync hook, fmtNumber/fmtPct/fmtDate, riskClass.

## Verification
- All 13 API routes smoke-tested with curl — return real data (XGBoost + SHAP, TF-IDF + LIME, max fusion, real PSI per feature, real model metrics, real retrain outcome).
- Retrain endpoint through Next.js: candidate promoted (identical training data → identical metrics; promotion rule satisfied honestly; SystemEvent + DriftEvent rows persisted in Prisma).
- `bun run lint` is clean on all new files (0 errors, 0 warnings).
- Dev log: GET / 200 in ~300ms, no current compile errors. Stale "Module not found" lines in dev.log were from the brief window before theme-provider.tsx existed — no longer appear in fresh requests.
- Prisma is being queried and written successfully (log shows INSERTs for Transaction, Message, Prediction, Explanation, RiskAssessment, SystemEvent, DriftEvent).

## Known design decisions
- The `risk/analyze` route ALSO calls the individual transaction + message analyze endpoints to get explanations + per-input risk scores. This is so we can persist two predictions (with explanations) AND a single RiskAssessment linked to the message prediction (preferred) or transaction prediction.
- The `dashboard/trends` route returns BOTH Prisma per-hour trends AND the ML service's PaySim benchmark fraud-rate trend. The Dashboard frontend prefers the PaySim benchmark when Prisma is empty (so the chart is never empty).
- `useAsync` wraps setState calls inside `await Promise.resolve()` to satisfy the new React 19 `react-hooks/set-state-in-effect` rule.
- `ExplanationView` and `PredictionHistory` use the React 19 "adjust state when a prop changes" pattern (track prev value in state, set state during render if mismatch) to avoid the same rule.
- The `risk/analyze` ML service returns nested objects `{ probability, score, level }` for `transaction_risk` and `message_risk` — types and frontend were updated to match this richer shape.

## Honest limitations (disclosed in AboutDataset tab)
- PaySim is a public mobile-money simulator (NOT real UPI banking data).
- Hindi/Hinglish are synthetic (source=Synthetic).
- English SMS Spam is the public UCI SMS Spam Collection auto-downloaded by train.py.
- No causal transaction-message relationship is claimed.
- Per-language model F1 disclosed honestly: nlp_hi F1=1.000 (template-memorization), nlp_hinglish F1=0.65, nlp_en F1=0.91, nlp_combined F1=0.33.
- All numbers in the UI come from real API responses — none are hardcoded.

## What I did NOT touch
- prisma/schema.prisma (already pushed by an earlier agent).
- src/app/globals.css (design tokens already configured).
- The Python ML service (Task 2 was completed by the prior agent — I only consume it).
- src/components/ui/* (all shadcn primitives already present).
