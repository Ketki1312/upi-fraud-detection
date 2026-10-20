"use client";

import { useState } from "react";
import { Sidebar, TABS, type TabId } from "@/components/layout/Sidebar";
import { Header } from "@/components/layout/Header";
import { Footer } from "@/components/layout/Footer";

import { Dashboard } from "@/components/fraud/Dashboard";
import { TransactionAnalyzer } from "@/components/fraud/TransactionAnalyzer";
import { ScamMessageAnalyzer } from "@/components/fraud/ScamMessageAnalyzer";
import { UnifiedRiskAnalysis } from "@/components/fraud/UnifiedRiskAnalysis";
import { ExplanationView } from "@/components/fraud/ExplanationView";
import { DriftMonitoring } from "@/components/fraud/DriftMonitoring";
import { ModelPerformance } from "@/components/fraud/ModelPerformance";
import { PredictionHistory } from "@/components/fraud/PredictionHistory";
import { AboutDataset } from "@/components/fraud/AboutDataset";

export default function Home() {
  const [tab, setTab] = useState<TabId>("dashboard");
  const [explanationPredictionId, setExplanationPredictionId] = useState<string | undefined>(undefined);

  const handleOpenPrediction = (id: string) => {
    setExplanationPredictionId(id);
    setTab("explanation");
  };

  const renderTab = () => {
    switch (tab) {
      case "dashboard":
        return <Dashboard />;
      case "transaction":
        return <TransactionAnalyzer />;
      case "message":
        return <ScamMessageAnalyzer />;
      case "unified":
        return <UnifiedRiskAnalysis />;
      case "explanation":
        return <ExplanationView initialPredictionId={explanationPredictionId} />;
      case "drift":
        return <DriftMonitoring />;
      case "models":
        return <ModelPerformance />;
      case "history":
        return <PredictionHistory onOpenPrediction={handleOpenPrediction} />;
      case "about":
        return <AboutDataset />;
      default:
        return <Dashboard />;
    }
  };

  return (
    <div className="flex min-h-screen flex-col bg-background text-foreground">
      <Header active={tab} tabs={TABS} />
      <div className="flex flex-1">
        <Sidebar active={tab} onChange={setTab} />
        <main className="flex-1 overflow-y-auto p-4 sm:p-6">
          <div className="mx-auto max-w-7xl">{renderTab()}</div>
        </main>
      </div>
      <Footer />
    </div>
  );
}
