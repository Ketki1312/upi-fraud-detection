"use client";

import { useState } from "react";
import { ChevronLeft, ChevronRight } from "lucide-react";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "@/components/ui/table";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";

import type { PredictionRow, InputType, RiskLevel } from "@/lib/types";
import {
  Disclaimer,
  EmptyState,
  ErrorState,
  LoadingState,
  fmtDate,
  fmtPct,
  riskClass,
  useAsync,
} from "@/components/fraud/shared";
import { cn } from "@/lib/utils";

interface PredictionsResponse {
  predictions: PredictionRow[];
  count: number;
  total: number;
}

const PAGE_SIZE = 50;

interface Props {
  onOpenPrediction?: (id: string) => void;
}

export function PredictionHistory({ onOpenPrediction }: Props) {
  const [page, setPage] = useState(1);
  const [inputType, setInputType] = useState<"all" | InputType>("all");
  const [riskLevel, setRiskLevel] = useState<"all" | RiskLevel>("all");
  // Track which filters the page refers to — if filters change, reset page to 1.
  const [prevFilters, setPrevFilters] = useState<{ inputType: typeof inputType; riskLevel: typeof riskLevel }>({
    inputType,
    riskLevel,
  });
  if (inputType !== prevFilters.inputType || riskLevel !== prevFilters.riskLevel) {
    setPrevFilters({ inputType, riskLevel });
    setPage(1);
  }

  // Build query string from filters + page.
  const queryParts = [`limit=${PAGE_SIZE}`];
  if (inputType !== "all") queryParts.push(`input_type=${inputType}`);
  if (riskLevel !== "all") queryParts.push(`risk_level=${riskLevel}`);
  const query = queryParts.join("&");

  const async_ = useAsync<PredictionsResponse>(
    async () => {
      const res = await fetch(`/api/v1/predictions?${query}`, { cache: "no-store" });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      return (await res.json()) as PredictionsResponse;
    },
    [query]
  );

  const predictions = async_.data?.predictions || [];
  const total = async_.data?.total || 0;
  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const safePage = Math.min(page, totalPages);
  const startIdx = (safePage - 1) * PAGE_SIZE;
  const endIdx = startIdx + predictions.length;

  return (
    <div className="space-y-6">
      <div>
        <h2 className="text-xl font-semibold text-foreground">Prediction History</h2>
        <p className="text-sm text-muted-foreground">
          Every persisted prediction is stored in Prisma SQLite. Filter, paginate,
          and click any row to open it in the Explanation tab.
        </p>
      </div>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Filters</CardTitle>
          <CardDescription>Filter by input type and risk level.</CardDescription>
        </CardHeader>
        <CardContent>
          <div className="flex flex-wrap gap-3">
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Input type</label>
              <Select value={inputType} onValueChange={(v) => setInputType(v as typeof inputType)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="transaction">Transaction</SelectItem>
                  <SelectItem value="message">Message</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-1">
              <label className="text-xs font-medium text-foreground">Risk level</label>
              <Select value={riskLevel} onValueChange={(v) => setRiskLevel(v as typeof riskLevel)}>
                <SelectTrigger className="w-40">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="all">All</SelectItem>
                  <SelectItem value="LOW">Low</SelectItem>
                  <SelectItem value="MEDIUM">Medium</SelectItem>
                  <SelectItem value="HIGH">High</SelectItem>
                  <SelectItem value="CRITICAL">Critical</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="ml-auto self-end text-xs text-muted-foreground">
              {async_.loading
                ? "Loading…"
                : `Showing ${startIdx + 1}–${endIdx} of ${total}`}
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle className="text-base">Predictions</CardTitle>
          <CardDescription>50 per page, newest first.</CardDescription>
        </CardHeader>
        <CardContent>
          {async_.loading ? (
            <LoadingState rows={6} />
          ) : async_.error ? (
            <ErrorState message={async_.error} onRetry={async_.refetch} />
          ) : predictions.length === 0 ? (
            <EmptyState message="No predictions match these filters yet." />
          ) : (
            <>
              <div className="max-h-[36rem] overflow-y-auto scroll-area-thin">
                <Table>
                  <TableHeader>
                    <TableRow>
                      <TableHead className="w-24">ID</TableHead>
                      <TableHead className="w-20">Type</TableHead>
                      <TableHead>Summary</TableHead>
                      <TableHead className="w-24">Label</TableHead>
                      <TableHead className="w-20 text-right">Prob.</TableHead>
                      <TableHead className="w-20 text-right">Score</TableHead>
                      <TableHead className="w-20">Risk</TableHead>
                      <TableHead className="w-32 text-right">Created</TableHead>
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {predictions.map((p) => (
                      <TableRow
                        key={p.id}
                        className={cn(
                          "cursor-pointer",
                          "hover:bg-muted/50"
                        )}
                        onClick={() => onOpenPrediction?.(p.id)}
                      >
                        <TableCell className="font-mono text-xs">{p.id.slice(0, 8)}</TableCell>
                        <TableCell>
                          <Badge variant="outline" className="text-xs">
                            {p.input_type === "transaction" ? "TX" : "MSG"}
                          </Badge>
                        </TableCell>
                        <TableCell className="max-w-[300px] truncate text-xs text-muted-foreground">
                          {p.input_summary}
                        </TableCell>
                        <TableCell>
                          <Badge
                            variant={p.predicted_label === 1 ? "destructive" : "secondary"}
                            className="text-xs"
                          >
                            {p.predicted_label === 1 ? "Fraud/Scam" : "Legit"}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {fmtPct(p.probability, 1)}
                        </TableCell>
                        <TableCell className="text-right tabular-nums text-xs">
                          {p.risk_score}
                        </TableCell>
                        <TableCell>
                          <Badge variant="outline" className={cn("text-xs", riskClass(p.risk_level))}>
                            {p.risk_level}
                          </Badge>
                        </TableCell>
                        <TableCell className="text-right text-xs text-muted-foreground">
                          {fmtDate(p.created_at)}
                        </TableCell>
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>

              {/* Pagination */}
              <div className="mt-4 flex items-center justify-between">
                <span className="text-xs text-muted-foreground">
                  Page {safePage} of {totalPages}
                </span>
                <div className="flex gap-2">
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage <= 1}
                    onClick={() => setPage(safePage - 1)}
                  >
                    <ChevronLeft className="size-4" aria-hidden="true" />
                    Prev
                  </Button>
                  <Button
                    variant="outline"
                    size="sm"
                    disabled={safePage >= totalPages}
                    onClick={() => setPage(safePage + 1)}
                  >
                    Next
                    <ChevronRight className="size-4" aria-hidden="true" />
                  </Button>
                </div>
              </div>
            </>
          )}
        </CardContent>
      </Card>

      <Disclaimer />
    </div>
  );
}

export default PredictionHistory;
