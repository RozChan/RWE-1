import type { EditableSummary, ChatMessage } from "@/lib/store";
import type {
  AgentExecution,
  AgentMessage,
  AnalysisDimensionConfig,
  DocumentChunk,
  DocumentMetadata,
} from "@/lib/types";
import type { DimensionKey } from "@/lib/mock-data";

export const WORKSPACE_SNAPSHOT_APP = "reading-without-effort";
export const WORKSPACE_SNAPSHOT_SCHEMA_VERSION = 1;

export type WorkspaceSnapshotUiState = {
  activeSummaryId: string;
  activeDimension: DimensionKey;
  activeEvidence: string;
  dimensionConfigConfirmed: boolean;
  outputStale: boolean;
  outputGeneratedAt: string;
};

export type WorkspaceSnapshot = {
  app: typeof WORKSPACE_SNAPSHOT_APP;
  schemaVersion: typeof WORKSPACE_SNAPSHOT_SCHEMA_VERSION;
  exportedAt: string;
  workspace: {
    document: DocumentMetadata;
    rawChunks: DocumentChunk[];
    dimensions: AnalysisDimensionConfig[];
    summaries: EditableSummary[];
    deletedSummaries: EditableSummary[];
    outputDraft: string;
    chat: ChatMessage[];
    agentMessages: AgentMessage[];
    agentExecutions: AgentExecution[];
    uiState: WorkspaceSnapshotUiState;
  };
};

export type WorkspaceSnapshotInput = WorkspaceSnapshot["workspace"];

export function createWorkspaceSnapshot(workspace: WorkspaceSnapshotInput): WorkspaceSnapshot {
  return {
    app: WORKSPACE_SNAPSHOT_APP,
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: new Date().toISOString(),
    workspace: cloneJson(workspace),
  };
}

export function workspaceSnapshotFileName(date = new Date()) {
  const pad = (value: number) => String(value).padStart(2, "0");
  const yyyy = date.getFullYear();
  const mm = pad(date.getMonth() + 1);
  const dd = pad(date.getDate());
  const hh = pad(date.getHours());
  const min = pad(date.getMinutes());
  return `reading-workspace-${yyyy}${mm}${dd}-${hh}${min}.rwe.json`;
}

export function downloadWorkspaceSnapshot(snapshot: WorkspaceSnapshot) {
  const blob = new Blob([JSON.stringify(snapshot, null, 2)], {
    type: "application/json;charset=utf-8",
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = workspaceSnapshotFileName();
  document.body.appendChild(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

export async function readWorkspaceSnapshotFile(file: File) {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new Error("文件格式不正确，请选择合法的进度 JSON 文件。");
  }
  return validateWorkspaceSnapshot(parsed);
}

export function validateWorkspaceSnapshot(input: unknown): WorkspaceSnapshot {
  const root = asRecord(input, "文件格式不正确：缺少根对象。");
  const app = root.app;
  if (app !== WORKSPACE_SNAPSHOT_APP) {
    throw new Error("文件格式不正确：不是 Reading Without Effort 进度文件。");
  }
  const schemaVersion = root.schemaVersion;
  if (schemaVersion !== WORKSPACE_SNAPSHOT_SCHEMA_VERSION) {
    throw new Error("不支持的进度文件版本。");
  }
  const workspace = asRecord(root.workspace, "文件格式不正确：缺少 workspace。");
  const document = normalizeDocument(workspace.document);
  const rawChunks = normalizeArray<DocumentChunk>(workspace.rawChunks);
  const dimensions = normalizeArray<AnalysisDimensionConfig>(workspace.dimensions);
  const summaries = normalizeArray<EditableSummary>(workspace.summaries);
  const deletedSummaries = normalizeArray<EditableSummary>(workspace.deletedSummaries);
  if (!document || !Array.isArray(rawChunks) || !Array.isArray(dimensions) || !Array.isArray(summaries)) {
    throw new Error("文件格式不正确：document / dimensions / summaries 无法解析。");
  }
  const uiState = normalizeUiState(workspace.uiState);
  return {
    app: WORKSPACE_SNAPSHOT_APP,
    schemaVersion: WORKSPACE_SNAPSHOT_SCHEMA_VERSION,
    exportedAt: typeof root.exportedAt === "string" ? root.exportedAt : new Date().toISOString(),
    workspace: {
      document,
      rawChunks,
      dimensions,
      summaries,
      deletedSummaries,
      outputDraft: typeof workspace.outputDraft === "string" ? workspace.outputDraft : "",
      chat: normalizeArray<ChatMessage>(workspace.chat),
      agentMessages: normalizeArray<AgentMessage>(workspace.agentMessages),
      agentExecutions: normalizeArray<AgentExecution>(workspace.agentExecutions),
      uiState,
    },
  };
}

function normalizeDocument(value: unknown): DocumentMetadata | null {
  const record = asOptionalRecord(value);
  if (!record) return null;
  return {
    filename: typeof record.filename === "string" ? record.filename : "restored-document.txt",
    document_type: isDocumentType(record.document_type) ? record.document_type : "generic_text",
    title: typeof record.title === "string" ? record.title : null,
    char_count: numberOrZero(record.char_count),
    chunk_count: numberOrZero(record.chunk_count),
    meeting_time: typeof record.meeting_time === "string" ? record.meeting_time : null,
    duration_seconds: typeof record.duration_seconds === "number" ? record.duration_seconds : null,
    duration_text: typeof record.duration_text === "string" ? record.duration_text : null,
    keywords: normalizeArray<string>(record.keywords).filter((item) => typeof item === "string"),
    metadata: asOptionalRecord(record.metadata) ?? {},
  };
}

function normalizeUiState(value: unknown): WorkspaceSnapshotUiState {
  const record = asOptionalRecord(value) ?? {};
  return {
    activeSummaryId: typeof record.activeSummaryId === "string" ? record.activeSummaryId : "",
    activeDimension: typeof record.activeDimension === "string" ? record.activeDimension as DimensionKey : "topic",
    activeEvidence: typeof record.activeEvidence === "string" ? record.activeEvidence : "",
    dimensionConfigConfirmed: typeof record.dimensionConfigConfirmed === "boolean" ? record.dimensionConfigConfirmed : true,
    outputStale: typeof record.outputStale === "boolean" ? record.outputStale : true,
    outputGeneratedAt: typeof record.outputGeneratedAt === "string" ? record.outputGeneratedAt : "尚未生成",
  };
}

function normalizeArray<T>(value: unknown): T[] {
  return Array.isArray(value) ? cloneJson(value) : [];
}

function cloneJson<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function asRecord(value: unknown, message: string): Record<string, unknown> {
  const record = asOptionalRecord(value);
  if (!record) throw new Error(message);
  return record;
}

function asOptionalRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
}

function numberOrZero(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function isDocumentType(value: unknown): value is DocumentMetadata["document_type"] {
  return value === "meeting" || value === "generic_text" || value === "policy" || value === "contract" || value === "report" || value === "paper" || value === "requirement" || value === "other";
}
