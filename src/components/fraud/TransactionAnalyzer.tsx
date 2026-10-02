"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import type { TransactionAnalysisResponse, TransactionInput } from "@/lib/types";
import { Disclaimer, ErrorState, fmtNumber, fmtPct, riskClass } from "@/components/fraud/shared";
import { RiskGauge } from "@/components/charts/RiskGauge";
import { ContributionsChart } from "@/components/charts/ContributionsChart";
import { cn } from "@/lib/utils";

const TYPES: TransactionInput["type"][] = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"];

export function TransactionAnalyzer() {
  const [form, setForm] = useState<TransactionInput>({
    step: 1,
    type: "TRANSFER",
    amount: 100000,
    oldbalanceOrg: 100000,
    newbalanceOrig: 0,
    oldbalanceDest: 0,
    newbalanceDest: 100000,
  });
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<TransactionAnalysisResponse | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/v1/transactions/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(form),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        const detail = data?.detail ? ` — ${JSON.stringify(data.detail)}` : "";
        throw new Error(`${msg}${detail}`);
      }
      setResult(data as TransactionAnalysisResponse);
      toast.success("Analysis complete", { description: `Predicted: ${data.prediction === 1 ? "Fraud" : "Legitimate"} · risk ${data.risk_level}` });
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "Unknown error";
      setError(msg);
      toast.error("Analysis failed", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Transaction Analyzer</h2>
        <p className="text-sm text-muted-foreground">
          Submit a single UPI-style transaction and get a real XGBoost fraud
          prediction plus a real SHAP TreeExplainer explanation. Persisted to
          Prisma SQLite for history.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Transaction input</CardTitle>
            <CardDescription>
              PaySim-style fields (synthetic mobile-money). All values are numeric.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="step">Step (hour window)</Label>
                  <Input
                    id="step"
                    type="number"
                    min={0}
                    value={form.step}
                    onChange={(e) => setForm({ ...form, step: parseInt(e.target.value || "0", 10) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="type">Type</Label>
                  <Select
                    value={form.type}
                    onValueChange={(v) => setForm({ ...form, type: v as TransactionInput["type"] })}
                  >
                    <SelectTrigger id="type">
                      <SelectValue placeholder="Type" />
                    </SelectTrigger>
                    <SelectContent>
                      {TYPES.map((t) => (
                        <SelectItem key={t} value={t}>{t}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-1.5">
                <Label htmlFor="amount">Amount</Label>
                <Input
                  id="amount"
                  type="number"
                  min={0}
                  step="0.01"
                  value={form.amount}
                  onChange={(e) => setForm({ ...form, amount: parseFloat(e.target.value) || 0 })}
                  required
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div className="space-y-1.5">
                  <Label htmlFor="oldOrg">Sender's balance before</Label>
                  <Input
                    id="oldOrg"
                    type="number"
                    step="0.01"
                    value={form.oldbalanceOrg}
                    onChange={(e) => setForm({ ...form, oldbalanceOrg: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newOrig">Sender's balance after</Label>
                  <Input
                    id="newOrig"
                    type="number"
                    step="0.01"
                    value={form.newbalanceOrig}
                    onChange={(e) => setForm({ ...form, newbalanceOrig: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="oldDest">Receiver's balance before</Label>
                  <Input
                    id="oldDest"
                    type="number"
                    step="0.01"
                    value={form.oldbalanceDest}
                    onChange={(e) => setForm({ ...form, oldbalanceDest: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
                <div className="space-y-1.5">
                  <Label htmlFor="newDest">Receiver's balance after</Label>
                  <Input
                    id="newDest"
                    type="number"
                    step="0.01"
                    value={form.newbalanceDest}
                    onChange={(e) => setForm({ ...form, newbalanceDest: parseFloat(e.target.value) || 0 })}
                    required
                  />
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Analyzing…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" aria-hidden="true" />
                    Analyze transaction
                  </>
                )}
              </Button>
            </form>
            {error ? <ErrorState className="mt-4" message={error} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Prediction & explanation</CardTitle>
            <CardDescription>
              Real XGBoost prediction + SHAP TreeExplainer contributions.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                <div className="text-center">
                  <ArrowRight className="mx-auto mb-2 size-6 text-primary" aria-hidden="true" />
                  Submit a transaction to see the prediction and SHAP contributions.
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <div className="flex flex-col items-center">
                    <RiskGauge value={result.risk_score} level={result.risk_level} size={150} />
                  </div>
                  <div className="grid flex-1 grid-cols-2 gap-3 text-sm sm:ml-6">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Prediction</div>
                      <Badge
                        variant={result.prediction === 1 ? "destructive" : "secondary"}
                        className="mt-1 text-sm"
                      >
                        {result.prediction === 1 ? "Fraud" : "Legitimate"}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Probability</div>
                      <div className="mt-1 font-semibold tabular-nums">
                        {fmtPct(result.probability)}
                      </div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk level</div>
                      <Badge variant="outline" className={cn("mt-1 text-sm", riskClass(result.risk_level))}>
                        {result.risk_level}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Model version</div>
                      <div className="mt-1 font-mono text-xs">{result.model_version}</div>
                    </div>
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">
                    Top SHAP contributions
                  </h3>
                  <p className="text-xs text-muted-foreground">
                    Red bars push toward fraud; green bars push toward legitimate.
                    Values are SHAP TreeExplainer outputs (model contributions,
                    <span className="italic"> not</span> causal effects).
                  </p>
                  <ContributionsChart
                    items={(result.explanation.contributions || []).map((c) => ({
                      label: c.human_label || c.feature,
                      value: Number(c.contribution),
                      rawValue: c.value,
                    }))}
                    kind="transaction"
                    height={320}
                  />
                </div>

                {result.prediction_id ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <span className="font-medium">Prediction ID:</span>{" "}
                    <code className="font-mono">{result.prediction_id}</code>
                    <span className="ml-2">
                      (Saved to Prisma — view it in the Explanation tab.)
                    </span>
                  </div>
                ) : null}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Disclaimer />
    </div>
  );
}

export default TransactionAnalyzer;
