import { create } from "zustand";
import {
  type DimensionKey,
  type Summary,
  type Transcript,
} from "@/lib/mock-data";
import type {
  ApiSummary,
  DocumentMetadata,
  ParseDocumentResponse,
  DocumentChunk,
} from "@/lib/types";

export type ChatMessage = { id: number; role: "assistant" | "user"; content: string };
export type SummaryStatus = "draft" | "confirmed" | "excluded";
export type SummarySource = "ai" | "selection_ai" | "manual";
export type EditableSummary = Summary & {
  originalSummary: string;
  status: SummaryStatus;
  editedByUser: boolean;
  evidences: ApiSummary["evidences"];
  flagged: boolean;
  source: SummarySource;
  linkedDimensionKey?: DimensionKey | null;
  linkedDimensionLabel?: string | null;
};

type RequestStatus = "idle" | "loading" | "success" | "error";

type PrototypeState = {
  document: DocumentMetadata;
  rawChunks: DocumentChunk[];
  transcripts: Transcript[];
  activeSummaryId: string;
  activeDimension: DimensionKey;
  activeEvidence: string;
  summaries: EditableSummary[];
  deletedSummaries: EditableSummary[];
  outputDraft: string;
  outputStale: boolean;
  outputGeneratedAt: string;
  uploadStatus: RequestStatus;
  analysisStatus: RequestStatus;
  generationStatus: RequestStatus;
  errorMessage: string;
  chat: ChatMessage[];
  setRequestState: (
    area: "upload" | "analysis" | "generation",
    status: RequestStatus,
    error?: string,
  ) => void;
  loadParsedDocument: (payload: ParseDocumentResponse) => void;
  loadAnalysis: (summaries: ApiSummary[]) => void;
  appendAnalysis: (summaries: ApiSummary[]) => void;
  setActiveSummary: (summary: Summary) => void;
  updateSummary: (id: string, summary: string) => void;
  updateChunkText: (id: string, text: string) => void;
  restoreChunkText: (id: string) => void;
  softDeleteChunk: (id: string) => void;
  restoreDeletedChunk: (id: string) => void;
  toggleSummaryConfirmed: (id: string) => void;
  toggleSummaryExcluded: (id: string) => void;
  toggleSummaryFlagged: (id: string) => void;
  setSummaryLinkedDimension: (
    id: string,
    linkedDimensionKey: DimensionKey | null,
    linkedDimensionLabel: string | null,
  ) => void;
  restoreSummary: (id: string) => void;
  confirmAllSummaries: () => void;
  deleteSummary: (id: string) => void;
  undoDeleteSummary: () => void;
  setGeneratedOutput: (output: string) => void;
  setOutputDraft: (output: string) => void;
  addManualAnnotation: (payload: { chunkId: string; quote: string; startOffset: number; endOffset: number; dimension: string; title: string; note: string; source?: Exclude<SummarySource, "ai"> }) => void;
  addChatMessage: (role: ChatMessage["role"], content: string) => void;
  clearChat: () => void;
  restoreWorkspace: (payload: {
    document: DocumentMetadata;
    rawChunks: DocumentChunk[];
    summaries: EditableSummary[];
    deletedSummaries: EditableSummary[];
    outputDraft: string;
    outputStale: boolean;
    outputGeneratedAt: string;
    activeSummaryId: string;
    activeDimension: DimensionKey;
    activeEvidence: string;
    chat: ChatMessage[];
  }) => void;
};

const emptyDocument: DocumentMetadata = {
  filename: "",
  document_type: "generic_text",
  title: "",
  char_count: 0,
  chunk_count: 0,
  meeting_time: null,
  duration_seconds: null,
  duration_text: null,
  keywords: [],
  metadata: {},
};

function currentTime() {
  return new Intl.DateTimeFormat("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
    hour12: false,
  }).format(new Date());
}

function normalizeChunkEditState(chunk: DocumentChunk): DocumentChunk {
  const originalText = chunk.originalText ?? chunk.text;
  const currentText = chunk.currentText ?? chunk.text;
  return {
    ...chunk,
    text: currentText,
    originalText,
    currentText,
    isEdited: chunk.isEdited ?? currentText !== originalText,
    isDeleted: chunk.isDeleted ?? false,
    updatedAt: chunk.updatedAt ?? null,
  };
}

function normalizeChunks(chunks: DocumentChunk[]) {
  return chunks.map(normalizeChunkEditState);
}

function annotateSegments(
  segments: DocumentChunk[],
  summaries: ApiSummary[],
): Transcript[] {
  return segments.map((segment) => {
    const normalizedSegment = normalizeChunkEditState(segment);
    const evidences = summaries.flatMap((summary) =>
      summary.evidences
        .filter((evidence) => evidence.segment_id === normalizedSegment.id)
        .map((evidence) => ({ ...evidence, annotationId: summary.id })),
    );
    const boundaries = Array.from(
      new Set([
        0,
        normalizedSegment.text.length,
        ...evidences.flatMap((item) => [item.start_offset, item.end_offset]),
      ]),
    ).sort((a, b) => a - b);
    const fragments = boundaries.slice(0, -1).flatMap((start, index) => {
      const end = boundaries[index + 1];
      if (end <= start) return [];
      const annotationIds = evidences
        .filter((item) => item.start_offset <= start && item.end_offset >= end)
        .map((item) => item.annotationId);
      return [
        {
          text: normalizedSegment.text.slice(start, end),
          annotationIds: annotationIds.length ? annotationIds : undefined,
        },
      ];
    });
    return {
      id: normalizedSegment.id,
      speaker: normalizedSegment.speaker ?? chunkKindLabel(normalizedSegment.kind),
      timestamp: normalizedSegment.timestamp ?? "--",
      fragments,
      originalText: normalizedSegment.originalText,
      currentText: normalizedSegment.currentText,
      isEdited: normalizedSegment.isEdited,
      isDeleted: normalizedSegment.isDeleted,
      updatedAt: normalizedSegment.updatedAt,
    };
  });
}

function toEditableSummary(item: ApiSummary): EditableSummary {
  return {
    id: item.id,
    key: item.dimension,
    title: item.title,
    summary: item.summary,
    evidenceId: item.evidences[0]?.segment_id ?? "P1",
    confidence: 0,
    originalSummary: item.summary,
    status: item.review_status,
    editedByUser: false,
    flagged: false,
    source: "ai",
    linkedDimensionKey: item.linked_dimension_key ?? null,
    linkedDimensionLabel: item.linked_dimension_label ?? null,
    evidences: item.evidences,
  };
}

function chunkKindLabel(kind: DocumentChunk["kind"]) {
  return kind === "utterance" ? "发言" : kind === "heading" ? "标题" : "文档片段";
}

function localInitialOutput() {
  return "上传 TXT 文档后，系统将在此生成阅读输出。";
}

export const usePrototypeStore = create<PrototypeState>((set) => ({
  document: emptyDocument,
  rawChunks: [],
  transcripts: [],
  activeSummaryId: "",
  activeDimension: "topic",
  activeEvidence: "",
  summaries: [],
  deletedSummaries: [],
  outputDraft: localInitialOutput(),
  outputStale: false,
  outputGeneratedAt: "尚未生成",
  uploadStatus: "idle",
  analysisStatus: "idle",
  generationStatus: "idle",
  errorMessage: "",
  chat: [
    {
      id: 1,
      role: "assistant",
      content:
        "你好，我是文档阅读助手。这里是普通 AI 对话，不会修改页面配置或触发分析操作。",
    },
  ],
  setRequestState: (area, status, error = "") =>
    set({
      [`${area}Status`]: status,
      errorMessage: error,
    } as Partial<PrototypeState>),
  loadParsedDocument: (payload) => {
    const rawChunks = normalizeChunks(payload.chunks);
    set({
      document: payload.document,
      rawChunks,
      transcripts: rawChunks.map((segment) => ({
        id: segment.id,
        speaker: segment.speaker ?? chunkKindLabel(segment.kind),
        timestamp: segment.timestamp ?? "--",
        fragments: [{ text: segment.text }],
        originalText: segment.originalText,
        currentText: segment.currentText,
        isEdited: segment.isEdited,
        isDeleted: segment.isDeleted,
        updatedAt: segment.updatedAt,
      })),
      summaries: [],
      deletedSummaries: [],
      activeSummaryId: "",
      activeEvidence: payload.chunks[0]?.id ?? "",
      outputDraft: "文档已解析，请确认阅读维度后点击“开始 AI 分析”。",
      outputStale: true,
      uploadStatus: "success",
      analysisStatus: "idle",
      generationStatus: "idle",
      errorMessage: "",
    });
  },
  loadAnalysis: (items) => {
    const aiSummaries = items.map(toEditableSummary);
    set((state) => {
      const manualSummaries = state.summaries.filter((summary) =>
        summary.id.startsWith("M"),
      );
      const summaries = [...aiSummaries, ...manualSummaries];
      return {
        summaries,
        transcripts: annotateSegments(state.rawChunks, toApiSummaries(summaries)),
        activeSummaryId: aiSummaries[0]?.id ?? manualSummaries[0]?.id ?? "",
        activeDimension:
          aiSummaries[0]?.key ?? manualSummaries[0]?.key ?? "topic",
        activeEvidence:
          aiSummaries[0]?.evidenceId ??
          manualSummaries[0]?.evidenceId ??
          state.rawChunks[0]?.id ??
          "",
        analysisStatus: "success",
        outputStale: true,
        errorMessage: "",
      };
    });
  },
  appendAnalysis: (items) => {
    const aiSummaries = items.map(toEditableSummary);
    set((state) => {
      const summaries = [...state.summaries, ...aiSummaries];
      return {
        summaries,
        transcripts: annotateSegments(state.rawChunks, toApiSummaries(summaries)),
        activeSummaryId: aiSummaries[0]?.id ?? state.activeSummaryId,
        activeDimension: aiSummaries[0]?.key ?? state.activeDimension,
        activeEvidence: aiSummaries[0]?.evidenceId ?? state.activeEvidence,
        analysisStatus: "success",
        outputStale: true,
        errorMessage: "",
      };
    });
  },
  setActiveSummary: (summary) =>
    set({
      activeSummaryId: summary.id,
      activeDimension: summary.key,
      activeEvidence: summary.evidenceId,
    }),
  updateSummary: (id, summary) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id
          ? { ...item, summary, editedByUser: summary !== item.originalSummary }
          : item,
      ),
      outputStale: true,
    })),
  updateChunkText: (id, text) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const rawChunks = state.rawChunks.map((chunk) => {
        if (chunk.id !== id) return normalizeChunkEditState(chunk);
        const normalized = normalizeChunkEditState(chunk);
        const currentText = text;
        return {
          ...normalized,
          text: currentText,
          currentText,
          isEdited: currentText !== normalized.originalText,
          updatedAt,
        };
      });
      return {
        rawChunks,
        transcripts: annotateSegments(rawChunks, toApiSummaries(state.summaries)),
        outputStale: true,
      };
    }),
  restoreChunkText: (id) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const rawChunks = state.rawChunks.map((chunk) => {
        if (chunk.id !== id) return normalizeChunkEditState(chunk);
        const normalized = normalizeChunkEditState(chunk);
        const currentText = normalized.originalText ?? normalized.text;
        return {
          ...normalized,
          text: currentText,
          currentText,
          isEdited: false,
          updatedAt,
        };
      });
      return {
        rawChunks,
        transcripts: annotateSegments(rawChunks, toApiSummaries(state.summaries)),
        outputStale: true,
      };
    }),
  softDeleteChunk: (id) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const rawChunks = state.rawChunks.map((chunk) =>
        chunk.id === id
          ? { ...normalizeChunkEditState(chunk), isDeleted: true, updatedAt }
          : normalizeChunkEditState(chunk),
      );
      return {
        rawChunks,
        transcripts: annotateSegments(rawChunks, toApiSummaries(state.summaries)),
        outputStale: true,
      };
    }),
  restoreDeletedChunk: (id) =>
    set((state) => {
      const updatedAt = new Date().toISOString();
      const rawChunks = state.rawChunks.map((chunk) =>
        chunk.id === id
          ? { ...normalizeChunkEditState(chunk), isDeleted: false, updatedAt }
          : normalizeChunkEditState(chunk),
      );
      return {
        rawChunks,
        transcripts: annotateSegments(rawChunks, toApiSummaries(state.summaries)),
        outputStale: true,
      };
    }),
  toggleSummaryConfirmed: (id) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.status === "confirmed" ? "draft" : "confirmed",
            }
          : item,
      ),
      outputStale: true,
    })),
  toggleSummaryExcluded: (id) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id
          ? {
              ...item,
              status: item.status === "excluded" ? "draft" : "excluded",
            }
          : item,
      ),
      outputStale: true,
    })),
  toggleSummaryFlagged: (id) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id ? { ...item, flagged: !item.flagged } : item,
      ),
    })),
  setSummaryLinkedDimension: (id, linkedDimensionKey, linkedDimensionLabel) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id && item.source === "manual"
          ? { ...item, linkedDimensionKey, linkedDimensionLabel }
          : item,
      ),
      outputStale: true,
    })),
  restoreSummary: (id) =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.id === id
          ? { ...item, summary: item.originalSummary, editedByUser: false }
          : item,
      ),
      outputStale: true,
    })),
  confirmAllSummaries: () =>
    set((state) => ({
      summaries: state.summaries.map((item) =>
        item.status === "excluded" ? item : { ...item, status: "confirmed" },
      ),
      outputStale: true,
    })),

  deleteSummary: (id) =>
    set((state) => {
      const target = state.summaries.find((item) => item.id === id);
      if (!target) return {};
      const summaries = state.summaries.filter((item) => item.id !== id);
      const nextActive = summaries[0];
      return {
        summaries,
        deletedSummaries: [...state.deletedSummaries, target],
        transcripts: annotateSegments(state.rawChunks, toApiSummaries(summaries)),
        activeSummaryId: nextActive?.id ?? "",
        activeDimension: nextActive?.key ?? state.activeDimension,
        activeEvidence: nextActive?.evidenceId ?? state.rawChunks[0]?.id ?? "",
        outputStale: true,
      };
    }),
  undoDeleteSummary: () =>
    set((state) => {
      const restored = state.deletedSummaries.at(-1);
      if (!restored) return {};
      const summaries = [...state.summaries, restored];
      return {
        summaries,
        deletedSummaries: state.deletedSummaries.slice(0, -1),
        transcripts: annotateSegments(state.rawChunks, toApiSummaries(summaries)),
        activeSummaryId: restored.id,
        activeDimension: restored.key,
        activeEvidence: restored.evidenceId,
        outputStale: true,
      };
    }),
  setGeneratedOutput: (outputDraft) =>
    set({
      outputDraft,
      outputStale: false,
      outputGeneratedAt: currentTime(),
      generationStatus: "success",
      errorMessage: "",
    }),
  setOutputDraft: (outputDraft) => set({ outputDraft }),
  addManualAnnotation: (payload) =>
    set((state) => {
      const nextIndex = state.summaries.length + 1;
      const id = `M${Date.now()}`;
      const summary: EditableSummary = {
        id,
        key: payload.dimension,
        title: payload.title,
        summary: payload.note,
        evidenceId: payload.chunkId,
        confidence: 0,
        originalSummary: payload.note,
        status: "draft",
        editedByUser: payload.source === "manual",
        flagged: false,
        source: payload.source ?? "manual",
        linkedDimensionKey: null,
        linkedDimensionLabel: null,
        evidences: [
          {
            id: `ME${nextIndex}-1`,
            segment_id: payload.chunkId,
            quote: payload.quote,
            start_offset: payload.startOffset,
            end_offset: payload.endOffset,
            verified: true,
          },
        ],
      };
      const summaries = [...state.summaries, summary];
      return {
        summaries,
        transcripts: annotateSegments(state.rawChunks, toApiSummaries(summaries)),
        activeSummaryId: id,
        activeDimension: payload.dimension,
        activeEvidence: payload.chunkId,
        outputStale: true,
      };
    }),
  addChatMessage: (role, content) =>
    set((state) => ({
      chat: [...state.chat, { id: Date.now(), role, content }],
    })),
  clearChat: () =>
    set({
      chat: [
        {
          id: Date.now(),
          role: "assistant",
          content: "对话已清空。你可以继续和 AI 助手聊天。",
        },
      ],
    }),
  restoreWorkspace: (payload) => {
    const rawChunks = normalizeChunks(payload.rawChunks);
    set({
      document: payload.document,
      rawChunks,
      transcripts: annotateSegments(rawChunks, toApiSummaries(payload.summaries)),
      summaries: payload.summaries,
      deletedSummaries: payload.deletedSummaries,
      activeSummaryId: payload.activeSummaryId,
      activeDimension: payload.activeDimension,
      activeEvidence: payload.activeEvidence,
      outputDraft: payload.outputDraft,
      outputStale: payload.outputStale,
      outputGeneratedAt: payload.outputGeneratedAt,
      uploadStatus: rawChunks.length ? "success" : "idle",
      analysisStatus: payload.summaries.length ? "success" : "idle",
      generationStatus: payload.outputGeneratedAt !== "尚未生成" ? "success" : "idle",
      errorMessage: "",
      chat: payload.chat.length ? payload.chat : [
        {
          id: Date.now(),
          role: "assistant",
          content: "工作区已恢复。你可以继续和 AI 助手聊天。",
        },
      ],
    });
  },
}));

export function toApiSummaries(summaries: EditableSummary[]): ApiSummary[] {
  return summaries.map((item) => ({
    id: item.id,
    dimension: item.key,
    title: item.title,
    summary: item.summary,
    evidences: item.evidences,
    review_status: item.status,
    model_confidence: null,
    source: item.source,
    linked_dimension_key: item.linkedDimensionKey ?? null,
    linked_dimension_label: item.linkedDimensionLabel ?? null,
  }));
}
