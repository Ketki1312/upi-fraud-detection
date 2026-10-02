"use client";

import { useState } from "react";
import { Loader2, ShieldAlert, Sparkles } from "lucide-react";
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
import { Textarea } from "@/components/ui/textarea";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { Badge } from "@/components/ui/badge";

import type { RiskAnalysisResponse, TransactionInput, MessageInput } from "@/lib/types";
import { Disclaimer, ErrorState, riskClass } from "@/components/fraud/shared";
import { RiskGauge } from "@/components/charts/RiskGauge";
import { cn } from "@/lib/utils";

const TYPES: TransactionInput["type"][] = ["CASH_IN", "CASH_OUT", "DEBIT", "PAYMENT", "TRANSFER"];

export function UnifiedRiskAnalysis() {
  const [useTx, setUseTx] = useState(true);
  const [useMsg, setUseMsg] = useState(true);

  const [tx, setTx] = useState<TransactionInput>({
    step: 1,
    type: "TRANSFER",
    amount: 100000,
    oldbalanceOrg: 100000,
    newbalanceOrig: 0,
    oldbalanceDest: 0,
    newbalanceDest: 100000,
  });
  const [msg, setMsg] = useState<MessageInput>({
    text: "Dear customer, your UPI account will be blocked. Verify OTP 123456 immediately or lose access.",
  });

  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<RiskAnalysisResponse | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!useTx && !useMsg) {
      toast.error("Include at least one input (transaction or message).");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const body: Record<string, unknown> = {};
      if (useTx) body.transaction = tx;
      if (useMsg) body.message = msg;
      const res = await fetch("/api/v1/risk/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const data = await res.json();
      if (!res.ok) {
        const m = data?.error || `HTTP ${res.status}`;
        const d = data?.detail ? ` — ${JSON.stringify(data.detail)}` : "";
        throw new Error(`${m}${d}`);
      }
      setResult(data as RiskAnalysisResponse);
      toast.success("Unified risk computed", {
        description: `Score: ${Math.round(data.unified_risk_score)} · ${data.risk_level} (${data.fusion_method})`,
      });
    } catch (e2) {
      const m = e2 instanceof Error ? e2.message : "Unknown error";
      setError(m);
      toast.error("Risk analysis failed", { description: m });
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Unified Risk Analysis</h2>
        <p className="text-sm text-muted-foreground">
          Fuse a transaction and a message into a single 0–100 risk score using
          the ML service's risk engine. Toggle either input on or off.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base flex items-center justify-between">
              <span>Inputs</span>
              <span className="text-xs font-normal text-muted-foreground">
                Toggle each input below
              </span>
            </CardTitle>
            <CardDescription>
              The fusion engine uses max or weighted fusion of per-input
              probabilities. Method is decided by the ML service.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-5">
              {/* Transaction sub-form */}
              <div className="rounded-md border border-border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-sm font-semibold">Transaction input</Label>
                  <Button
                    type="button"
                    variant={useTx ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseTx(!useTx)}
                  >
                    {useTx ? "Enabled" : "Disabled"}
                  </Button>
                </div>
                <div className={cn("space-y-3", !useTx && "pointer-events-none opacity-50")}>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="u-step">Step</Label>
                      <Input
                        id="u-step"
                        type="number"
                        min={0}
                        value={tx.step}
                        onChange={(e) => setTx({ ...tx, step: parseInt(e.target.value || "0", 10) || 0 })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-type">Type</Label>
                      <Select
                        value={tx.type}
                        onValueChange={(v) => setTx({ ...tx, type: v as TransactionInput["type"] })}
                      >
                        <SelectTrigger id="u-type">
                          <SelectValue />
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
                    <Label htmlFor="u-amount">Amount</Label>
                    <Input
                      id="u-amount"
                      type="number"
                      min={0}
                      step="0.01"
                      value={tx.amount}
                      onChange={(e) => setTx({ ...tx, amount: parseFloat(e.target.value) || 0 })}
                    />
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <Label htmlFor="u-oldOrg">Sender before</Label>
                      <Input
                        id="u-oldOrg"
                        type="number"
                        step="0.01"
                        value={tx.oldbalanceOrg}
                        onChange={(e) => setTx({ ...tx, oldbalanceOrg: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-newOrig">Sender after</Label>
                      <Input
                        id="u-newOrig"
                        type="number"
                        step="0.01"
                        value={tx.newbalanceOrig}
                        onChange={(e) => setTx({ ...tx, newbalanceOrig: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-oldDest">Receiver before</Label>
                      <Input
                        id="u-oldDest"
                        type="number"
                        step="0.01"
                        value={tx.oldbalanceDest}
                        onChange={(e) => setTx({ ...tx, oldbalanceDest: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                    <div className="space-y-1.5">
                      <Label htmlFor="u-newDest">Receiver after</Label>
                      <Input
                        id="u-newDest"
                        type="number"
                        step="0.01"
                        value={tx.newbalanceDest}
                        onChange={(e) => setTx({ ...tx, newbalanceDest: parseFloat(e.target.value) || 0 })}
                      />
                    </div>
                  </div>
                </div>
              </div>

              {/* Message sub-form */}
              <div className="rounded-md border border-border p-3">
                <div className="mb-3 flex items-center justify-between">
                  <Label className="text-sm font-semibold">Message input</Label>
                  <Button
                    type="button"
                    variant={useMsg ? "default" : "outline"}
                    size="sm"
                    onClick={() => setUseMsg(!useMsg)}
                  >
                    {useMsg ? "Enabled" : "Disabled"}
                  </Button>
                </div>
                <div className={cn("space-y-1.5", !useMsg && "pointer-events-none opacity-50")}>
                  <Label htmlFor="u-msg">Message text</Label>
                  <Textarea
                    id="u-msg"
                    rows={4}
                    value={msg.text}
                    onChange={(e) => setMsg({ ...msg, text: e.target.value })}
                    className="resize-y"
                  />
                </div>
              </div>

              <Button type="submit" disabled={loading} className="w-full sm:w-auto">
                {loading ? (
                  <>
                    <Loader2 className="size-4 animate-spin" aria-hidden="true" />
                    Fusing…
                  </>
                ) : (
                  <>
                    <Sparkles className="size-4" aria-hidden="true" />
                    Compute unified risk
                  </>
                )}
              </Button>
            </form>
            {error ? <ErrorState className="mt-4" message={error} /> : null}
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Unified risk score</CardTitle>
            <CardDescription>
              The ML service fuses the per-input probabilities using max or weighted fusion.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                <div className="text-center">
                  <ShieldAlert className="mx-auto mb-2 size-6 text-primary" aria-hidden="true" />
                  Submit inputs to compute a unified 0–100 risk score.
                </div>
              </div>
            ) : (
              <div className="space-y-5">
                <div className="flex flex-col items-center gap-4 sm:flex-row sm:items-center sm:justify-between">
                  <RiskGauge value={result.unified_risk_score} level={result.risk_level} size={170} />
                  <div className="grid flex-1 grid-cols-2 gap-3 text-sm sm:ml-6">
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Risk level</div>
                      <Badge variant="outline" className={cn("mt-1 text-sm", riskClass(result.risk_level))}>
                        {result.risk_level}
                      </Badge>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Fusion method</div>
                      <div className="mt-1 font-mono text-xs">{result.fusion_method}</div>
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Transaction risk</div>
                      {result.transaction_risk ? (
                        <div className="mt-1 space-y-0.5">
                          <div className="font-semibold tabular-nums">{Math.round(result.transaction_risk.score)}</div>
                          <Badge variant="outline" className={cn("text-xs", riskClass(result.transaction_risk.level))}>
                            {result.transaction_risk.level}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground">
                            P(fraud) = {(result.transaction_risk.probability * 100).toFixed(2)}%
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 text-muted-foreground">—</div>
                      )}
                    </div>
                    <div>
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Message risk</div>
                      {result.message_risk ? (
                        <div className="mt-1 space-y-0.5">
                          <div className="font-semibold tabular-nums">{Math.round(result.message_risk.score)}</div>
                          <Badge variant="outline" className={cn("text-xs", riskClass(result.message_risk.level))}>
                            {result.message_risk.level}
                          </Badge>
                          <div className="text-[10px] text-muted-foreground">
                            P(scam) = {(result.message_risk.probability * 100).toFixed(2)}%
                          </div>
                        </div>
                      ) : (
                        <div className="mt-1 text-muted-foreground">—</div>
                      )}
                    </div>
                  </div>
                </div>

                <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                  {result.disclaimer}
                </div>

                {result.prediction_id ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <span className="font-medium">Linked prediction:</span>{" "}
                    <code className="font-mono">{result.prediction_id}</code>
                    <span className="ml-2">
                      (Saved to Prisma — view full explanation in the Explanation tab.)
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

export default UnifiedRiskAnalysis;
