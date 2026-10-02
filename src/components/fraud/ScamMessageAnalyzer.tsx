"use client";

import { useState } from "react";
import { ArrowRight, Loader2, Languages, Sparkles } from "lucide-react";
import { toast } from "sonner";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
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

import type { MessageAnalysisResponse, MessageInput } from "@/lib/types";
import { Disclaimer, ErrorState, fmtPct, riskClass } from "@/components/fraud/shared";
import { RiskGauge } from "@/components/charts/RiskGauge";
import { ContributionsChart } from "@/components/charts/ContributionsChart";
import { cn } from "@/lib/utils";

const LANGS: { value: "auto" | "English" | "Hindi" | "Hinglish"; label: string }[] = [
  { value: "auto", label: "Auto-detect" },
  { value: "English", label: "English" },
  { value: "Hindi", label: "Hindi (Devanagari)" },
  { value: "Hinglish", label: "Hinglish" },
];

const SAMPLE_MESSAGES: { label: string; text: string }[] = [
  {
    label: "Scam (Hinglish) — OTP",
    text: "Dear customer, aapka UPI account block ho jayega. Verify karo OTP 482913 turant, nahi to bank account suspend.",
  },
  {
    label: "Scam (English) — KYC",
    text: "URGENT: Your KYC is pending. Your bank account will be blocked within 24 hours. Click https://bit.ly/kyc-update now to verify.",
  },
  {
    label: "Legitimate — bank OTP",
    text: "Dear Customer, 123456 is the OTP for your transaction of Rs 1500. Do not share it with anyone. From SBI.",
  },
  {
    label: "Scam (Hindi) — refund",
    text: "बधाई हो! आपने रिफंड जीता है ₹15,000. अपने UPI पिन को इस लिंक पर डालें और तुरंत पैसे पाएं।",
  },
];

export function ScamMessageAnalyzer() {
  const [text, setText] = useState("");
  const [lang, setLang] = useState<"auto" | MessageInput["language"]>("auto");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<MessageAnalysisResponse | null>(null);

  const onSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!text.trim()) {
      toast.error("Please enter a message first.");
      return;
    }
    setLoading(true);
    setError(null);
    try {
      const payload: MessageInput = { text };
      if (lang !== "auto") payload.language = lang as MessageInput["language"];
      const res = await fetch("/api/v1/messages/analyze", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
      const data = await res.json();
      if (!res.ok) {
        const msg = data?.error || `HTTP ${res.status}`;
        const detail = data?.detail ? ` — ${JSON.stringify(data.detail)}` : "";
        throw new Error(`${msg}${detail}`);
      }
      setResult(data as MessageAnalysisResponse);
      toast.success("Message analyzed", {
        description: `Predicted: ${data.prediction === 1 ? "Scam" : "Legitimate"} · ${data.language_detected}`,
      });
    } catch (e2) {
      const msg = e2 instanceof Error ? e2.message : "Unknown error";
      setError(msg);
      toast.error("Analysis failed", { description: msg });
    } finally {
      setLoading(false);
    }
  };

  const detected = result?.explanation.detected_keywords || {};
  const signals: { label: string; items?: string[] }[] = [
    { label: "OTP patterns", items: detected.otp_patterns },
    { label: "URLs", items: detected.urls },
    { label: "Currency", items: detected.currency },
    { label: "Urgency words", items: detected.urgency_words },
  ];

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Scam Message Analyzer</h2>
        <p className="text-sm text-muted-foreground">
          Submit a UPI / financial message (English, Hindi, or Hinglish) and get a
          real TF-IDF + LogisticRegression scam prediction plus a real LIME
          explanation. Persisted to Prisma SQLite.
        </p>
      </div>

      <div className="grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Message input</CardTitle>
            <CardDescription>
              Auto-detected language uses Devanagari + Hinglish token heuristics;
              override if you wish.
            </CardDescription>
          </CardHeader>
          <CardContent>
            <form onSubmit={onSubmit} className="space-y-4">
              <div className="space-y-1.5">
                <Label htmlFor="msg">Message text</Label>
                <Textarea
                  id="msg"
                  rows={6}
                  placeholder="Type or paste a message…"
                  value={text}
                  onChange={(e) => setText(e.target.value)}
                  required
                  className="resize-y"
                />
              </div>
              <div className="space-y-1.5">
                <Label htmlFor="lang">Language</Label>
                <Select value={lang} onValueChange={(v) => setLang(v as typeof lang)}>
                  <SelectTrigger id="lang" className="w-full sm:w-64">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {LANGS.map((l) => (
                      <SelectItem key={l.value} value={l.value}>{l.label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>

              <div className="flex flex-wrap gap-2">
                {SAMPLE_MESSAGES.map((s) => (
                  <Button
                    key={s.label}
                    type="button"
                    variant="outline"
                    size="sm"
                    onClick={() => setText(s.text)}
                  >
                    {s.label}
                  </Button>
                ))}
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
                    Analyze message
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
              Real TF-IDF + LogisticRegression prediction + LIME tokens.
            </CardDescription>
          </CardHeader>
          <CardContent>
            {!result ? (
              <div className="grid h-full place-items-center text-sm text-muted-foreground">
                <div className="text-center">
                  <ArrowRight className="mx-auto mb-2 size-6 text-primary" aria-hidden="true" />
                  Submit a message to see the prediction and LIME tokens.
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
                        {result.prediction === 1 ? "Scam" : "Legitimate"}
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
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Language</div>
                      <div className="mt-1 flex items-center gap-1.5">
                        <Languages className="size-3.5 text-primary" aria-hidden="true" />
                        <span className="font-medium">{result.language_detected}</span>
                      </div>
                    </div>
                    <div className="col-span-2">
                      <div className="text-xs uppercase tracking-wider text-muted-foreground">Model</div>
                      <div className="mt-1 font-mono text-xs">
                        {result.model_name} v{result.model_version}
                      </div>
                    </div>
                  </div>
                </div>

                {/* Detected signals */}
                <div>
                  <h3 className="text-sm font-semibold text-foreground">Detected linguistic signals</h3>
                  <div className="mt-2 flex flex-wrap gap-2">
                    {signals.flatMap((s) =>
                      (s.items || []).map((item) => (
                        <Badge key={`${s.label}-${item}`} variant="outline" className="text-xs">
                          {s.label}: <span className="ml-1 font-mono">{item}</span>
                        </Badge>
                      ))
                    )}
                    {signals.every((s) => !s.items || s.items.length === 0) ? (
                      <span className="text-xs text-muted-foreground">No OTP / URL / currency / urgency signals detected.</span>
                    ) : null}
                  </div>
                </div>

                <div>
                  <h3 className="text-sm font-semibold text-foreground">Top LIME tokens</h3>
                  <p className="text-xs text-muted-foreground">
                    Red tokens push toward scam; green tokens push toward legitimate.
                    LIME weights describe model contributions, not causal effects.
                  </p>
                  <ContributionsChart
                    items={(result.explanation.tokens || []).map((t) => ({
                      label: t.token,
                      value: Number(t.weight),
                    }))}
                    kind="message"
                    height={300}
                  />
                </div>

                {result.explanation.human_summary ? (
                  <div className="rounded-md border border-border bg-muted/30 p-3 text-xs text-muted-foreground">
                    <span className="font-medium text-foreground">Summary:</span>{" "}
                    {result.explanation.human_summary}
                  </div>
                ) : null}

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

export default ScamMessageAnalyzer;
