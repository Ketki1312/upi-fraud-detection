// Shared TypeScript types for UPI Fraud Detection — these mirror the Python ML
// service contract documented in worklog.md.

export type RiskLevel = "LOW" | "MEDIUM" | "HIGH" | "CRITICAL";
export type InputType = "transaction" | "message";

export interface TransactionInput {
  step: number;
  type: "CASH_IN" | "CASH_OUT" | "DEBIT" | "PAYMENT" | "TRANSFER";
  amount: number;
  oldbalanceOrg: number;
  newbalanceOrig: number;
  oldbalanceDest: number;
  newbalanceDest: number;
}

export interface MessageInput {
  text: string;
  language?: "English" | "Hindi" | "Hinglish";
}

export interface Contribution {
  feature: string;
  human_label: string;
  value: number | string;
  contribution: number; // SHAP value (signed); LIME weight (signed)
}

export interface TransactionExplanation {
  method: string; // ML service returns "tree" for TreeExplainer
  baseline: number; // expected probability
  contributions: Contribution[];
  top_positive: Contribution[];
  top_negative: Contribution[];
}

export interface MessageExplanation {
  method: string; // ML service returns "lime"
  tokens: { token: string; weight: number }[];
  top_positive: { token: string; weight: number }[];
  top_negative: { token: string; weight: number }[];
  detected_keywords: {
    otp_patterns?: string[];
    urls?: string[];
    currency?: string[];
    urgency_words?: string[];
  };
  human_summary?: string;
}

export interface TransactionAnalysisResponse {
  prediction: 0 | 1;
  probability: number; // fraud probability
  risk_score: number; // 0–100
  risk_level: RiskLevel;
  model_version: string;
  model_name?: string;
  derived_features?: Record<string, number>;
  input_features?: Record<string, number>;
  explanation: TransactionExplanation;
  disclaimer: string;
  prediction_id?: string; // added by Next.js after persisting
}

export interface MessageAnalysisResponse {
  prediction: 0 | 1;
  probability: number;
  risk_score: number;
  risk_level: RiskLevel;
  model_version: string;
  model_name?: string;
  language_detected: string;
  explanation: MessageExplanation;
  disclaimer: string;
  prediction_id?: string;
}

export interface RiskAnalysisResponse {
  unified_risk_score: number;
  risk_level: RiskLevel;
  transaction_risk: {
    probability: number;
    score: number;
    level: RiskLevel;
  } | null;
  message_risk: {
    probability: number;
    score: number;
    level: RiskLevel;
  } | null;
  fusion_method: string;
  disclaimer: string;
  prediction_id?: string;
}

export interface ModelMetric {
  precision: number;
  recall: number;
  f1: number;
  roc_auc: number | null;
  pr_auc: number | null;
}

export interface ModelInfo {
  name: string;
  version: string;
  dataset_version?: string;
  training_timestamp?: string;
  active: boolean;
  status?: "active" | "candidate" | "previous" | "archived" | "trained" | "not_trained";
  trained?: boolean;
  type?: string;
  language?: string;
  hyperparameters?: Record<string, unknown>;
  artifact?: string;
  metrics: ModelMetric;
  feature_list?: string[];
}

export interface DriftFeatureStatus {
  feature: string;
  psi: number;
  status: "NO_DRIFT" | "WATCH" | "DRIFT_DETECTED";
  threshold: number; // watch threshold (single number from ML service)
}

export interface DriftStatusResponse {
  generated_at: string;
  source: string;
  features: DriftFeatureStatus[];
  thresholds: { watch: number; drift: number };
  disclaimer: string;
}

export interface DriftHistoryResponse {
  events: DriftHistoryEvent[];
  count: number;
  disclaimer: string;
}

export interface DriftHistoryEvent {
  id: string;
  type?: string;
  feature?: string;
  model_name?: string;
  drift_window?: { source?: string; min_step?: number; max_step?: number } | null;
  candidate_version?: string;
  old_metrics?: Record<string, number>;
  new_metrics?: Record<string, number>;
  comparison?: {
    f1_delta?: number;
    recall_delta?: number;
    precision_delta?: number;
    precision_ratio?: number;
  };
  promoted?: boolean;
  outcome?: string;
  reference_period?: string;
  current_period?: string;
  drift_metric?: number;
  status?: "NO_DRIFT" | "WATCH" | "DRIFT_DETECTED";
  action_taken?: string | null;
  created_at: string;
}

export interface ModelsResponse {
  models: ModelInfo[];
  active_transaction_model?: string;
  english_status?: string;
  generated_at: string;
  disclaimer: string;
}

export interface RetrainResponse {
  candidate_version: string;
  old_metrics: Record<string, number>;
  new_metrics: Record<string, number>;
  promoted: boolean;
  comparison: {
    f1_delta: number;
    recall_delta: number;
    precision_delta: number;
    precision_ratio: number;
  };
  outcome: string;
  event_id: string;
  created_at: string;
  disclaimer: string;
}

// ML service's dashboard/summary response (different from our enriched DashboardSummary)
export interface MLServiceDashboardSummary {
  service: string;
  generated_at: string;
  disclaimer: string;
  model_metrics: ModelInfo[];
  datasets_summary: Record<string, {
    available?: boolean;
    rows?: number;
    train_rows?: number;
    test_rows?: number;
    validation_rows?: number;
    fraud_rate_train?: number;
    provenance?: {
      source?: string;
      disclaimer?: string;
      url?: string;
      local_file?: string;
      preprocessing?: Record<string, unknown>;
    };
  }>;
  drift_summary: {
    total_events: number;
    latest_event: DriftHistoryEvent | null;
    reference_features_count: number;
  };
}

export interface MLServiceDashboardTrends {
  service: string;
  generated_at: string;
  disclaimer: string;
  source: string;
  timestamps: (number | string)[];
  fraud_rate_trend: number[];
  fraud_count_trend: number[];
  risk_trend: number[];
  validation_trend: { step_window: number; fraud_rate: number }[];
  test_trend: { step_window: number; fraud_rate: number }[];
}

export interface DashboardSummary {
  total_predictions: number;
  fraud_count: number;
  scam_count: number;
  high_risk_count: number;
  risk_distribution: { low: number; medium: number; high: number; critical: number };
  language_distribution: { language: string; count: number }[];
  model_metrics: ModelInfo[];
  recent_predictions: {
    id: string;
    input_type: InputType;
    input_summary: string;
    predicted_label: 0 | 1;
    risk_score: number;
    risk_level: RiskLevel;
    created_at: string;
  }[];
  drift_status_summary: {
    no_drift: number;
    watch: number;
    drift_detected: number;
    last_updated: string | null;
  };
  datasets_summary: MLServiceDashboardSummary["datasets_summary"];
  drift_summary: MLServiceDashboardSummary["drift_summary"];
  disclaimer: string;
  generated_at: string;
  ml_service_online: boolean;
}

export interface DashboardTrends {
  timestamps: (number | string)[];
  fraud_rate_trend: number[];
  fraud_count_trend: number[];
  risk_trend: number[];
  validation_trend: { step_window: number; fraud_rate: number }[];
  test_trend: { step_window: number; fraud_rate: number }[];
  source: string;
  disclaimer: string;
}

export interface PredictionRow {
  id: string;
  input_type: InputType;
  model_version: string;
  predicted_label: 0 | 1;
  probability: number;
  risk_score: number;
  risk_level: RiskLevel;
  language_detected: string | null;
  input_summary: string;
  created_at: string;
  explanation?: TransactionExplanation | MessageExplanation | null;
  risk_assessment?: {
    transaction_risk: number | null;
    message_risk: number | null;
    unified_risk: number;
    risk_level: RiskLevel;
    fusion_method: string;
    disclaimer: string;
  } | null;
  input?: {
    type: "transaction" | "message";
    data: Record<string, unknown>;
  } | null;
}

export interface PredictionDetail extends PredictionRow {
  explanation_payload: TransactionExplanation | MessageExplanation | null;
  human_readable: string | null;
}

export interface HealthResponse {
  status: "ok" | "degraded" | "down";
  models_loaded: {
    transaction: boolean;
    nlp_english: boolean;
    nlp_hindi: boolean;
    nlp_hinglish: boolean;
    nlp_combined: boolean;
  };
  model_versions: Record<string, string>;
  provenance_disclosure?: Record<string, string>;
  disclaimer?: string;
  service?: string;
  timestamp?: string;
}

export interface HealthCheckResponse {
  nextjs: "ok" | "degraded" | "down";
  mlService: HealthResponse | { status: "down"; error: string };
  timestamp: string;
}
