import type {
  AnalysisDimension,
  AnalysisDimensionConfig,
  AgentContext,
  AgentMessage,
  AgentPlanResponse,
  AnalyzeDocumentResponse,
  ApplyConfigResponse,
  ApiSummary,
  ChatContext,
  ChatMessage,
  ChatResponse,
  ConfigAssistantResponse,
  ConfigOperation,
  DocumentMetadata,
  ParseDocumentResponse,
  DocumentChunk,
} from "@/lib/types";
async function request<T>(path: string, init: RequestInit): Promise<T> {
  let response: Response;
  try {
    response = await fetch(path, init);
  } catch {
    throw new Error("无法连接服务，请联系工作站管理员检查运行状态。");
  }
  if (!response.ok) {
    const payload = await response.json().catch(() => null);
    throw new Error(
      payload?.detail?.message ?? `请求失败（${response.status}）`,
    );
  }
  return response.json() as Promise<T>;
}

export function parseDocument(file: File) {
  const form = new FormData();
  form.append("file", file);
  return request<ParseDocumentResponse>("/api/documents/parse", {
    method: "POST",
    body: form,
  });
}

export function analyzeDocument(
  document: DocumentMetadata,
  chunks: DocumentChunk[],
  dimensions: AnalysisDimension[],
) {
  return request<AnalyzeDocumentResponse>("/api/documents/analyze", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      document,
      chunks,
      dimensions,
    }),
  });
}

export function generateReadingOutput(
  document: DocumentMetadata,
  summaries: ApiSummary[],
) {
  return request<{ output: string }>("/api/documents/generate-output", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ document, summaries, output_type: document.document_type === "meeting" ? "meeting_minutes" : "reading_summary" }),
  });
}

export function chatWithAssistant(
  messages: ChatMessage[],
  context: ChatContext,
) {
  return request<ChatResponse>("/api/chat", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, context }),
  });
}

export function interpretAnalysisConfig(
  messages: ChatMessage[],
  dimensions: AnalysisDimensionConfig[],
) {
  return request<ConfigAssistantResponse>("/api/analysis-config/interpret", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ messages, dimensions }),
  });
}

export function applyAnalysisConfig(
  dimensions: AnalysisDimensionConfig[],
  operations: ConfigOperation[],
) {
  return request<ApplyConfigResponse>("/api/analysis-config/apply", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ dimensions, operations }),
  });
}

export function planWithAgent(
  message: string,
  context: AgentContext,
  recentMessages: AgentMessage[],
) {
  return request<AgentPlanResponse>("/api/agent/plan", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ message, context, recentMessages }),
  });
}
