import type { DimensionKey } from "@/lib/mock-data";

export type AnalysisDimension = {
  key: string;
  label: string;
  description: string;
};

export type AnalysisDimensionConfig = AnalysisDimension & {
  enabled: boolean;
};

export type DocumentMetadata = {
  filename: string;
  document_type: "meeting" | "generic_text" | "policy" | "contract" | "report" | "paper" | "requirement" | "other";
  title?: string | null;
  char_count: number;
  chunk_count: number;
  meeting_time?: string | null;
  duration_seconds?: number | null;
  duration_text?: string | null;
  keywords: string[];
  metadata?: Record<string, unknown>;
};

export type MeetingMetadata = DocumentMetadata;

export type DocumentChunk = {
  id: string;
  text: string;
  originalText?: string | null;
  currentText?: string | null;
  isEdited?: boolean;
  isDeleted?: boolean;
  updatedAt?: string | null;
  kind: "utterance" | "paragraph" | "heading" | "list_item" | "table" | "quote";
  speaker?: string | null;
  timestamp?: string | null;
  start_seconds?: number | null;
  heading_path?: string[] | null;
  page_number?: number | null;
  start_offset?: number | null;
  end_offset?: number | null;
  metadata?: Record<string, unknown>;
};

export type TranscriptSegment = DocumentChunk;

export type Evidence = {
  id: string;
  segment_id: string;
  quote: string;
  start_offset: number;
  end_offset: number;
  verified: boolean;
};

export type ApiSummary = {
  id: string;
  dimension: DimensionKey;
  title: string;
  summary: string;
  evidences: Evidence[];
  review_status: "draft" | "confirmed" | "excluded";
  model_confidence?: number | null;
  source?: "ai" | "selection_ai" | "manual" | null;
  linked_dimension_key?: DimensionKey | null;
  linked_dimension_label?: string | null;
};

export type AnalysisNoResult = {
  dimension: DimensionKey;
  title: string;
  reason: string;
};

export type ParseDocumentResponse = {
  document: DocumentMetadata;
  chunks: DocumentChunk[];
};

export type ParseMeetingResponse = {
  meeting: MeetingMetadata;
  segments: TranscriptSegment[];
};

export type AnalyzeDocumentResponse = {
  summaries: ApiSummary[];
  no_results?: AnalysisNoResult[];
};
export type AnalyzeMeetingResponse = AnalyzeDocumentResponse;


export type ChatMessage = {
  role: "user" | "assistant";
  content: string;
};

export type ChatContext = {
  document: DocumentMetadata | null;
  chunks: DocumentChunk[];
  output_draft?: string | null;
  summaries: ApiSummary[];
};

export type ChatResponse = { message: ChatMessage };

export type ConfigOperation = {
  type:
    | "add_dimension"
    | "remove_dimension"
    | "update_dimension"
    | "enable_dimension"
    | "disable_dimension";
  dimension_key?: string | null;
  label?: string | null;
  description?: string | null;
};

export type ConfigAssistantResponse = {
  reply: string;
  operations: ConfigOperation[];
  warnings: string[];
  requires_confirmation: boolean;
};

export type ApplyConfigResponse = {
  dimensions: AnalysisDimensionConfig[];
  affected_dimension_keys: string[];
  analysis_required: boolean;
};

export type AgentMessage = {
  id: string;
  role: "user" | "assistant" | "system";
  content: string;
  createdAt: string;
  messageKind:
    | "plain_answer"
    | "plan_preview"
    | "execution_update"
    | "error"
    | "clarification_question";
  planId?: string | null;
  executionId?: string | null;
};

export type AgentOperationType =
  | "answer_question"
  | "add_dimension"
  | "update_dimension"
  | "enable_dimension"
  | "disable_dimension"
  | "delete_dimension"
  | "run_selection_analysis"
  | "run_analysis"
  | "generate_output"
  | "export_word"
  | "export_txt";

export type AgentCapability = {
  operationType: AgentOperationType;
  enabled: boolean;
  disabledReason?: string | null;
  requiresConfirmation: boolean;
};

export type AgentSurface = "global_panel" | "selection_popover";

export type AgentContext = {
  agentSurface?: AgentSurface;
  document?: {
    id: string;
    title: string;
    type: DocumentMetadata["document_type"];
    chunkCount: number;
  } | null;
  dimensions: Array<{
    key: string;
    label: string;
    description: string;
    enabled: boolean;
  }>;
  summaries: Array<{
    id: string;
    title: string;
    dimension: string;
    status: "draft" | "confirmed" | "excluded";
    source: "ai" | "selection_ai" | "manual";
    flagged: boolean;
    editedByUser: boolean;
    preview: string;
  }>;
  outputDraft: {
    exists: boolean;
    length: number;
    preview?: string | null;
  };
  selection?: {
    chunkId: string;
    quote: string;
    startOffset: number;
    endOffset: number;
  } | null;
  capabilities: AgentCapability[];
};

export type AnalysisScope =
  | { type: "all_enabled_dimensions" }
  | { type: "selected_dimensions"; dimensionKeys?: string[] | null; dimensionLabels?: string[] | null }
  | { type: "new_dimension_only"; tempDimensionRef?: string | null; dependsOnOperationId?: string | null; dimensionLabel?: string | null }
  | { type: "current_dimension_only"; dimensionKey?: string | null };

export type AnalysisMergeMode =
  | "append_results"
  | "replace_ai_results"
  | "replace_same_dimensions"
  | "new_version";

export type PreserveRules = {
  manualAnnotations: "always";
  translationCards: "always";
  selectionAiSummaries: "keep" | "replace" | "ask";
  confirmedSummaries: "keep" | "replace" | "ask";
  editedSummaries: "keep" | "replace" | "ask";
  excludedSummaries: "keep" | "drop" | "ask";
};

export type AgentOperation = {
  id: string;
  type: AgentOperationType;
  title: string;
  description: string;
  riskLevel: "low" | "medium" | "high";
  requiresConfirmation: boolean;
  params: {
    dimensionKey?: string | null;
    label?: string | null;
    description?: string | null;
    target?: "current_selection" | null;
    dimensionLabel?: string | null;
    dependsOnOperationId?: string | null;
    analysisScope?: AnalysisScope | null;
    mergeMode?: AnalysisMergeMode | null;
    preserveRules?: PreserveRules | null;
    answer?: string | null;
  };
};

export type AgentPlan = {
  id: string;
  userIntent: string;
  assistantReply: string;
  operations: AgentOperation[];
  warnings: string[];
  assumptions: string[];
  requiresConfirmation: boolean;
  confirmationText: string;
  createdAt: string;
  expiresAt?: string | null;
};

export type AgentOperationResult = {
  operationId: string;
  type: AgentOperationType;
  status: "pending" | "running" | "succeeded" | "failed" | "skipped";
  message: string;
  details?: string[];
};

export type AgentExecution = {
  id: string;
  planId: string;
  status: "pending" | "running" | "succeeded" | "failed" | "partially_succeeded" | "cancelled";
  startedAt?: string;
  finishedAt?: string;
  operationResults: AgentOperationResult[];
};

export type ClarificationRequest = {
  id: string;
  question: string;
  options: Array<{
    id: string;
    label: string;
    description: string;
  }>;
};

export type AgentPlanRequest = {
  message: string;
  context: AgentContext;
  recentMessages: AgentMessage[];
};

export type AgentPlanResponse =
  | { plan: AgentPlan; message?: never }
  | { message: AgentMessage; plan?: never };
