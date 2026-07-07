"use client";

import {
  FormEvent,
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Icon } from "@/components/icons";
import type { AnalysisProgressState } from "@/components/AnalysisProgressPanel";
import { AgentConversationPanel } from "@/components/AgentConversationPanel";
import { AgentPlanCard } from "@/components/AgentPlanCard";
import type { OutputProgressState } from "@/components/OutputProgressPanel";
import { ConnectorOverlay as ConnectorOverlayView, type Connector } from "@/components/ConnectorOverlay";
import { DimensionConfigPanel } from "@/components/DimensionConfigPanel";
import { FinalOutputPanel } from "@/components/FinalOutputPanel";
import { NavigationBar } from "@/components/NavigationBar";
import { InfoBlock, Panel, TopButton } from "@/components/PagePrimitives";
import { SourceReplacePanel } from "@/components/SourceReplacePanel";
import { SourceSegmentCard } from "@/components/SourceSegmentCard";
import { SummaryCard } from "@/components/SummaryCard";
import {
  dimensionMeta,
  type DimensionKey,
  type Summary,
  type Transcript,
} from "@/lib/mock-data";
import {
  analyzeDocument,
  applyAnalysisConfig,
  chatWithAssistant,
  generateReadingOutput,
  interpretAnalysisConfig,
  planWithAgent,
  parseDocument,
} from "@/lib/api";
import type {
  AgentContext,
  AgentExecution,
  AgentMessage,
  AgentOperation,
  AgentOperationResult,
  AgentPlan,
  AgentPlanResponse,
  AgentSurface,
  AnalysisMergeMode,
  AnalysisNoResult,
  AnalysisScope,
  AnalysisDimensionConfig,
  ConfigAssistantResponse,
  ConfigOperation,
} from "@/lib/types";
import {
  toApiSummaries,
  usePrototypeStore,
  type EditableSummary,
} from "@/lib/store";
import {
  buildAgentExecutionFeedback,
  buildConfigOperationDetails,
  buildFailedOperationDetails,
  buildRunAnalysisResultDetails,
  describeConfigOperationResult,
} from "@/lib/agent-plan-descriptions";
import {
  extractTranslationLanguage,
  isGlobalSelectionTask,
  parseSelectionDimensionIntent,
} from "@/lib/selection-intent-parser";
import {
  getSourceReplacePreview,
  replacePlainText,
  type SourceReplaceScope,
} from "@/lib/source-text-editing";
import {
  createWorkspaceSnapshot,
  downloadWorkspaceSnapshot,
  readWorkspaceSnapshotFile,
} from "@/lib/workspace-snapshot";


const defaultDimensionConfigs: AnalysisDimensionConfig[] = [
  { key: "topic", label: "核心观点", description: "识别文档的核心观点、问题背景与讨论范围。", enabled: true },
  { key: "goal", label: "关键事实", description: "提炼重要事实、数据、对象、约束和判断依据。", enabled: true },
  { key: "progress", label: "重要进展", description: "总结已经完成、正在推进和状态变化。", enabled: true },
  { key: "next", label: "行动建议", description: "识别下一步计划、建议动作、责任分工和时间安排。", enabled: true },
  { key: "highlight", label: "风险问题", description: "提炼风险、阻塞、争议、依赖和潜在影响。", enabled: true },
  { key: "advice", label: "待确认事项", description: "整理仍需补充、核实或人工确认的内容。", enabled: true },
];

const manualAnnotationKey = "manual_annotation";
const manualAnnotationMeta = {
  color: "#8b5cf6",
  soft: "#f5f3ff",
  border: "#c4b5fd",
  label: "人工批注",
};

type AssistantMessage = {
  id: number;
  role: "user" | "assistant";
  content: string;
};

type SourceSelection = {
  chunkId: string;
  quote: string;
  startOffset: number;
  endOffset: number;
  x: number;
  y: number;
  placement: "left" | "right" | "above" | "below";
};

type SelectionAction = SourceSelection & {
  dimensionKey: string;
  note: string;
  language: string;
};

type PendingSelectionDimensionPlan = {
  action: "add" | "enable";
  dimensionLabel: string;
  dimensionKey?: string;
  selection: SelectionAction;
};

type PendingSelectionAgentPlan = {
  plan: AgentPlan;
  selection: SelectionAction;
};

function cloneDimensionConfigs(configs: AnalysisDimensionConfig[]) {
  return configs.map((config) => ({ ...config }));
}

function describeConfigOperation(
  operation: ConfigOperation,
  dimensions: AnalysisDimensionConfig[],
) {
  const target = dimensions.find(
    (dimension) => dimension.key === operation.dimension_key,
  );
  if (operation.type === "add_dimension") {
    return `新增维度“${operation.label}”：${operation.description}`;
  }
  if (operation.type === "remove_dimension") {
    return `删除维度“${target?.label ?? operation.dimension_key}”`;
  }
  if (operation.type === "enable_dimension") {
    return `启用维度“${target?.label ?? operation.dimension_key}”`;
  }
  if (operation.type === "disable_dimension") {
    return `停用维度“${target?.label ?? operation.dimension_key}”`;
  }
  const changes = [
    operation.label ? `名称改为“${operation.label}”` : "",
    operation.description ? `说明改为“${operation.description}”` : "",
  ].filter(Boolean);
  return `修改维度“${target?.label ?? operation.dimension_key}”：${changes.join("；")}`;
}

export default function PrototypePage() {
  const {
    document: sourceDocument,
    rawChunks,
    transcripts,
    activeSummaryId,
    activeDimension,
    activeEvidence,
    summaries,
    deletedSummaries,
    outputDraft,
    outputStale,
    outputGeneratedAt,
    uploadStatus,
    analysisStatus,
    generationStatus,
    errorMessage,
    chat,
    setRequestState,
    loadParsedDocument,
    loadAnalysis,
    appendAnalysis,
    setActiveSummary,
    updateSummary,
    updateChunkText,
    restoreChunkText,
    softDeleteChunk,
    restoreDeletedChunk,
    toggleSummaryConfirmed,
    toggleSummaryExcluded,
    toggleSummaryFlagged,
    setSummaryLinkedDimension,
    restoreSummary,
    confirmAllSummaries,
    deleteSummary,
    undoDeleteSummary,
    setGeneratedOutput,
    setOutputDraft,
    addManualAnnotation,
    addChatMessage,
    clearChat,
    restoreWorkspace,
  } = usePrototypeStore();
  const [message, setMessage] = useState("");
  const [agentMessage, setAgentMessage] = useState("");
  const [agentMessages, setAgentMessages] = useState<AgentMessage[]>([
    {
      id: "agent_welcome",
      role: "assistant",
      content:
        "你好，我是 AI Agent。你可以让我回答文档问题，也可以让我生成需确认的操作计划，例如新增维度、追加分析、生成输出或导出文件。",
      createdAt: new Date().toISOString(),
      messageKind: "plain_answer",
    },
  ]);
  const [agentLoading, setAgentLoading] = useState(false);
  const [agentError, setAgentError] = useState("");
  const [pendingAgentPlan, setPendingAgentPlan] = useState<AgentPlan | null>(null);
  const [agentExecutions, setAgentExecutions] = useState<AgentExecution[]>([]);
  const [configMessage, setConfigMessage] = useState("");
  const [configChat, setConfigChat] = useState<AssistantMessage[]>([
    {
      id: 1,
      role: "assistant" as const,
      content:
        "你可以用自然语言调整分析维度。我会先生成变更预览，只有你确认后才会更新配置。",
    },
  ]);
  const [configLoading, setConfigLoading] = useState(false);
  const [configError, setConfigError] = useState("");
  const [pendingConfig, setPendingConfig] =
    useState<ConfigAssistantResponse | null>(null);
  const [copied, setCopied] = useState(false);
  const [onlyEvidence, setOnlyEvidence] = useState(false);
  const [chatLoading, setChatLoading] = useState(false);
  const [chatError, setChatError] = useState("");
  const [dimensionDrafts, setDimensionDrafts] = useState<AnalysisDimensionConfig[]>(
    () => cloneDimensionConfigs(defaultDimensionConfigs),
  );
  const [confirmedDimensions, setConfirmedDimensions] = useState<AnalysisDimensionConfig[]>(
    () => cloneDimensionConfigs(defaultDimensionConfigs),
  );
  const [dimensionEditing, setDimensionEditing] = useState(true);
  const [dimensionConfigConfirmed, setDimensionConfigConfirmed] = useState(false);
  const [dimensionConfigError, setDimensionConfigError] = useState("");
  const [selectionAction, setSelectionAction] = useState<SelectionAction | null>(null);
  const [pendingSelectionDimensionPlan, setPendingSelectionDimensionPlan] =
    useState<PendingSelectionDimensionPlan | null>(null);
  const [pendingSelectionAgentPlan, setPendingSelectionAgentPlan] =
    useState<PendingSelectionAgentPlan | null>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const workspaceInputRef = useRef<HTMLInputElement>(null);
  const [workspaceNotice, setWorkspaceNotice] = useState("");
  const [analysisProgress, setAnalysisProgress] =
    useState<AnalysisProgressState | null>(null);
  const [outputProgress, setOutputProgress] =
    useState<OutputProgressState | null>(null);
  const confirmedDimensionLabels = useMemo(
    () =>
      Object.fromEntries(
        confirmedDimensions.map((dimension) => [dimension.key, dimension.label]),
      ) as Record<DimensionKey, string>,
    [confirmedDimensions],
  );

  function locate(summary: Summary) {
    setActiveSummary(summary);
    window.setTimeout(
      () =>
        document
          .getElementById(`segment-${summary.evidenceId}`)
          ?.scrollIntoView({ behavior: "smooth", block: "center" }),
      30,
    );
  }

  const activeConfirmedDimensions = useMemo(
    () => confirmedDimensions.filter((dimension) => dimension.enabled),
    [confirmedDimensions],
  );
  const activeDimensionKeys = useMemo(
    () => activeConfirmedDimensions.map((dimension) => dimension.key),
    [activeConfirmedDimensions],
  );
  const analyzableChunks = useMemo(
    () =>
      rawChunks
        .filter((chunk) => !chunk.isDeleted)
        .map((chunk) => ({
          ...chunk,
          text: chunk.currentText ?? chunk.text,
        })),
    [rawChunks],
  );
  const sourceEditStats = useMemo(
    () => ({
      editedCount: rawChunks.filter((chunk) => chunk.isEdited).length,
      deletedCount: rawChunks.filter((chunk) => chunk.isDeleted).length,
    }),
    [rawChunks],
  );

  useEffect(() => {
    if (analysisProgress?.status !== "running") return;
    const timer = window.setInterval(() => {
      setAnalysisProgress((current) => {
        if (!current || current.status !== "running") return current;
        const nextProgress =
          current.progress < 55
            ? current.progress + 7
            : current.progress < 82
              ? current.progress + 3
              : current.progress < 90
                ? current.progress + 1
                : current.progress;
        return { ...current, progress: Math.min(nextProgress, 90) };
      });
    }, 1200);
    return () => window.clearInterval(timer);
  }, [analysisProgress?.status]);

  useEffect(() => {
    if (outputProgress?.status !== "running") return;
    const timer = window.setInterval(() => {
      setOutputProgress((current) => {
        if (!current || current.status !== "running") return current;
        const nextProgress =
          current.progress < 55
            ? current.progress + 8
            : current.progress < 84
              ? current.progress + 4
              : current.progress < 92
                ? current.progress + 1
                : current.progress;
        return { ...current, progress: Math.min(nextProgress, 92) };
      });
    }, 1000);
    return () => window.clearInterval(timer);
  }, [outputProgress?.status]);


  function updateDimensionDraft(
    key: DimensionKey,
    patch: Partial<AnalysisDimensionConfig>,
  ) {
    setDimensionDrafts((current) =>
      current.map((dimension) =>
        dimension.key === key ? { ...dimension, ...patch } : dimension,
      ),
    );
    setDimensionConfigError("");
  }

  function addDimensionDraft() {
    const usedColorIndexes = new Set(
      dimensionDrafts.map((dimension) => {
        const custom = /^custom_(\d+)$/.exec(dimension.key);
        if (custom) return Number(custom[1]);
        return ["topic", "goal", "progress", "next", "highlight", "advice"].indexOf(
          dimension.key,
        );
      }),
    );
    const colorIndex = Array.from({ length: 10000 }, (_, index) => index).find(
      (index) => !usedColorIndexes.has(index),
    );
    if (colorIndex === undefined) return;
    const customCount = dimensionDrafts.filter((item) =>
      item.key.startsWith("custom_"),
    ).length;
    setDimensionDrafts((current) => [
      ...current,
      {
        key: `custom_${colorIndex}`,
        label: `自定义维度 ${customCount + 1}`,
        description: "请填写该维度需要识别和总结的内容。",
        enabled: true,
      },
    ]);
    setDimensionConfigError("");
  }

  function removeDimensionDraft(key: DimensionKey) {
    setDimensionDrafts((current) =>
      current.filter((dimension) => dimension.key !== key),
    );
    setDimensionConfigError("");
  }

  function confirmDimensionConfig() {
    if (
      dimensionDrafts.some(
        (dimension) =>
          !dimension.label.trim() || !dimension.description.trim(),
      )
    ) {
      setDimensionConfigError("阅读维度的名称和分析说明不能为空。");
      return;
    }
    setConfirmedDimensions(cloneDimensionConfigs(dimensionDrafts));
    setDimensionEditing(false);
    setDimensionConfigConfirmed(true);
    setDimensionConfigError("");
  }

  function beginDimensionEditing() {
    setDimensionDrafts(cloneDimensionConfigs(confirmedDimensions));
    setDimensionEditing(true);
    setDimensionConfigConfirmed(false);
  }

  function startAnalysisProgress(
    scopeLabel: string,
    dimensions: AnalysisDimensionConfig[],
    mergeModeLabel = "追加结果，不覆盖已有总结",
  ) {
    setAnalysisProgress({
      status: "running",
      scopeLabel,
      dimensionLabels: dimensions.map((dimension) => dimension.label),
      chunkCount: analyzableChunks.length,
      mergeModeLabel,
      progress: 12,
    });
  }

  function completeAnalysisProgress(
    addedCount: number,
    noResults: AnalysisNoResult[] = [],
  ) {
    setAnalysisProgress((current) => {
      if (!current) return current;
      return {
        ...current,
        status: addedCount > 0 ? "succeeded" : "no_result",
        progress: 100,
        addedCount,
        noResults,
      };
    });
  }

  function failAnalysisProgress(error: string) {
    setAnalysisProgress((current) => {
      if (!current) return current;
      return {
        ...current,
        status: "failed",
        progress: Math.max(current.progress, 35),
        error,
      };
    });
  }

  async function runAnalysis() {
    if (!rawChunks.length || !dimensionConfigConfirmed) return;
    const dimensions = activeConfirmedDimensions.map((dimension) => dimension.key);
    if (!dimensions.length) return;
    if (!analyzableChunks.length) {
      setRequestState("analysis", "error", "当前没有可分析的原文内容。");
      return;
    }
    setRequestState("analysis", "loading");
    startAnalysisProgress("全文", activeConfirmedDimensions);
    try {
      const response = await analyzeDocument(
        sourceDocument,
        analyzableChunks,
        activeConfirmedDimensions.map(({ key, label, description }) => ({
          key,
          label,
          description,
        })),
      );
      const labels = new Map(
        activeConfirmedDimensions.map((dimension) => [dimension.key, dimension.label]),
      );
      const mapped = response.summaries.map((summary) => ({
          ...summary,
          title: labels.get(summary.dimension) ?? summary.title,
        }));
      if (mapped.length) {
        loadAnalysis(mapped);
      } else {
        setRequestState("analysis", "success");
      }
      completeAnalysisProgress(mapped.length, response.no_results ?? []);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 分析失败。";
      failAnalysisProgress(message);
      setRequestState(
        "analysis",
        "error",
        message,
      );
    }
  }

  async function handleUpload(file?: File) {
    if (!file) return;
    setRequestState("upload", "loading");
    setAnalysisProgress(null);
    setOutputProgress(null);
    try {
      const response = await parseDocument(file);
      loadParsedDocument(response);
      setDimensionDrafts(cloneDimensionConfigs(confirmedDimensions));
      setDimensionEditing(true);
      setDimensionConfigConfirmed(false);
    } catch (error) {
      setRequestState(
        "upload",
        "error",
        error instanceof Error ? error.message : "TXT 上传解析失败。",
      );
    }
  }

  function handleSaveWorkspace() {
    const snapshot = createWorkspaceSnapshot({
      document: sourceDocument,
      rawChunks,
      dimensions: confirmedDimensions,
      summaries,
      deletedSummaries,
      outputDraft,
      chat,
      agentMessages,
      agentExecutions,
      uiState: {
        activeSummaryId,
        activeDimension,
        activeEvidence,
        dimensionConfigConfirmed,
        outputStale,
        outputGeneratedAt,
      },
    });
    downloadWorkspaceSnapshot(snapshot);
    setWorkspaceNotice("进度文件已导出。");
  }

  async function handleRestoreWorkspace(file?: File) {
    if (!file) return;
    setWorkspaceNotice("");
    const hasWorkspaceContent = Boolean(
      sourceDocument.filename || rawChunks.length || summaries.length || outputDraft,
    );
    if (
      hasWorkspaceContent &&
      !window.confirm("恢复进度会覆盖当前工作区，是否继续？")
    ) {
      return;
    }
    try {
      const snapshot = await readWorkspaceSnapshotFile(file);
      const workspace = snapshot.workspace;
      restoreWorkspace({
        document: workspace.document,
        rawChunks: workspace.rawChunks,
        summaries: workspace.summaries,
        deletedSummaries: workspace.deletedSummaries,
        outputDraft: workspace.outputDraft,
        outputStale: workspace.uiState.outputStale,
        outputGeneratedAt: workspace.uiState.outputGeneratedAt,
        activeSummaryId: workspace.uiState.activeSummaryId,
        activeDimension: workspace.uiState.activeDimension,
        activeEvidence: workspace.uiState.activeEvidence,
        chat: workspace.chat,
      });
      const dimensions = workspace.dimensions.length
        ? workspace.dimensions
        : cloneDimensionConfigs(defaultDimensionConfigs);
      setConfirmedDimensions(cloneDimensionConfigs(dimensions));
      setDimensionDrafts(cloneDimensionConfigs(dimensions));
      setDimensionEditing(false);
      setDimensionConfigConfirmed(workspace.uiState.dimensionConfigConfirmed);
      setDimensionConfigError("");
      setAgentMessages(workspace.agentMessages.length ? workspace.agentMessages : agentMessages);
      setAgentExecutions(workspace.agentExecutions);
      setPendingAgentPlan(null);
      setPendingConfig(null);
      setPendingSelectionAgentPlan(null);
      setPendingSelectionDimensionPlan(null);
      setSelectionAction(null);
      setAnalysisProgress(null);
      setOutputProgress(null);
      setWorkspaceNotice(`已恢复工作区：${workspace.document.filename || "未命名文档"}`);
    } catch (error) {
      setWorkspaceNotice(error instanceof Error ? error.message : "恢复进度失败。");
    }
  }

  async function submitMessage(event: FormEvent) {
    event.preventDefault();
    const content = message.trim();
    if (!content || chatLoading) return;

    const requestMessages = [
      ...chat.slice(-29).map(({ role, content: previousContent }) => ({
        role,
        content: previousContent,
      })),
      { role: "user" as const, content },
    ];
    setMessage("");
    setChatError("");
    setChatLoading(true);
    addChatMessage("user", content);

    try {
      const response = await chatWithAssistant(requestMessages, {
        document: sourceDocument.filename ? sourceDocument : null,
        chunks: rawChunks,
        output_draft: outputDraft,
        summaries: toApiSummaries(summaries),
      });
      addChatMessage("assistant", response.message.content);
    } catch (error) {
      setChatError(
        error instanceof Error ? error.message : "AI 对话请求失败。",
      );
    } finally {
      setChatLoading(false);
    }
  }

  async function submitConfigMessage(event: FormEvent) {
    event.preventDefault();
    const content = configMessage.trim();
    if (!content || configLoading || pendingConfig) return;
    const requestMessages = [
      ...configChat.slice(-29).map(({ role, content: previousContent }) => ({
        role,
        content: previousContent,
      })),
      { role: "user" as const, content },
    ];
    setConfigMessage("");
    setConfigError("");
    setConfigLoading(true);
    setConfigChat((current) => [
      ...current,
      { id: Date.now(), role: "user", content },
    ]);
    try {
      const response = await interpretAnalysisConfig(
        requestMessages,
        confirmedDimensions,
      );
      setConfigChat((current) => [
        ...current,
        { id: Date.now() + 1, role: "assistant", content: response.reply },
      ]);
      if (response.operations.length) setPendingConfig(response);
    } catch (error) {
      setConfigError(
        error instanceof Error ? error.message : "分析配置助手请求失败。",
      );
    } finally {
      setConfigLoading(false);
    }
  }

  async function confirmConfigOperations() {
    if (!pendingConfig?.operations.length || configLoading) return;
    setConfigLoading(true);
    setConfigError("");
    try {
      const response = await applyAnalysisConfig(
        confirmedDimensions,
        pendingConfig.operations,
      );
      const updated = response.dimensions.map((dimension) => ({
        ...dimension,
        key: dimension.key as DimensionKey,
      }));
      setConfirmedDimensions(updated);
      setDimensionDrafts(cloneDimensionConfigs(updated));
      setDimensionEditing(false);
      setDimensionConfigConfirmed(true);
      setDimensionConfigError("");
      setPendingConfig(null);
      setConfigChat((current) => [
        ...current,
        {
          id: Date.now(),
          role: "assistant",
          content:
            "配置已更新。已有总结不会被自动覆盖；请点击“按当前配置重新分析”生成与新配置对应的结果。",
        },
      ]);
    } catch (error) {
      setConfigError(
        error instanceof Error ? error.message : "应用分析配置失败。",
      );
    } finally {
      setConfigLoading(false);
    }
  }

  function clearCurrentAssistantChat() {
    setAgentMessages([
      {
        id: `agent_${Date.now()}`,
        role: "assistant",
        content: "Agent 对话已清空。你可以继续输入办公操作或文档问题。",
        createdAt: agentNow(),
        messageKind: "plain_answer",
      },
    ]);
    setPendingAgentPlan(null);
    setAgentExecutions([]);
    setAgentError("");
  }

  function startOutputProgress() {
    setOutputProgress({
      status: "running",
      confirmedCount: summaries.filter((summary) => summary.status === "confirmed").length,
      summaryCount: summaries.length,
      progress: 12,
    });
  }

  function completeOutputProgress(output: string) {
    setOutputProgress((current) => {
      if (!current) return current;
      return {
        ...current,
        status: "succeeded",
        progress: 100,
        outputLength: output.length,
      };
    });
  }

  function failOutputProgress(error: string) {
    setOutputProgress((current) => {
      if (!current) return current;
      return {
        ...current,
        status: "failed",
        progress: Math.max(current.progress, 35),
        error,
      };
    });
  }

  async function generateOutput() {
    setRequestState("generation", "loading");
    startOutputProgress();
    try {
      const response = await generateReadingOutput(
        sourceDocument,
        toApiSummaries(summaries),
      );
      setGeneratedOutput(response.output);
      completeOutputProgress(response.output);
    } catch (error) {
      const message =
        error instanceof Error ? error.message : "输出结果生成失败。";
      failOutputProgress(message);
      setRequestState(
        "generation",
        "error",
        message,
      );
    }
  }

  async function copyOutput() {
    await navigator.clipboard.writeText(outputDraft);
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1600);
  }

  function outputFileBaseName() {
    const sourceName = sourceDocument.filename?.replace(/\.[^/.]+$/, "") || "reading-output";
    const safeName = sourceName
      .trim()
      .replace(/[\\/:*?"<>|]+/g, "-")
      .replace(/\s+/g, "-")
      .slice(0, 80);
    return safeName || "reading-output";
  }

  function downloadBlob(blob: Blob, filename: string) {
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = filename;
    document.body.appendChild(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(url);
  }

  function escapeHtml(value: string) {
    return value
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;")
      .replace(/"/g, "&quot;")
      .replace(/'/g, "&#39;");
  }

  function exportOutputAsTxt() {
    const blob = new Blob([outputDraft], { type: "text/plain;charset=utf-8" });
    downloadBlob(blob, `${outputFileBaseName()}-输出结果.txt`);
  }

  function exportOutputAsWord() {
    const title = sourceDocument.title || sourceDocument.filename || "输出结果";
    const escapedTitle = escapeHtml(title);
    const escapedOutput = escapeHtml(outputDraft);
    const html = `<!doctype html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${escapedTitle}</title>
  <style>
    body { font-family: "Microsoft YaHei", Arial, sans-serif; line-height: 1.7; color: #0f172a; }
    h1 { font-size: 20pt; margin-bottom: 16pt; }
    .meta { color: #64748b; font-size: 10pt; margin-bottom: 18pt; }
    .content { white-space: pre-wrap; font-size: 11pt; }
  </style>
</head>
<body>
  <h1>${escapedTitle}</h1>
  <div class="meta">生成时间：${escapeHtml(outputGeneratedAt)}</div>
  <div class="content">${escapedOutput}</div>
</body>
</html>`;
    const blob = new Blob([html], { type: "application/msword;charset=utf-8" });
    downloadBlob(blob, `${outputFileBaseName()}-输出结果.doc`);
  }

  function openSelectionToolbar(selection: SourceSelection) {
    setPendingSelectionDimensionPlan(null);
    setPendingSelectionAgentPlan(null);
    setSelectionAction({
      ...selection,
      dimensionKey: activeConfirmedDimensions[0]?.key ?? "topic",
      note: "",
      language: "英文",
    });
  }

  function closeSelectionToolbar() {
    setPendingSelectionDimensionPlan(null);
    setPendingSelectionAgentPlan(null);
    setSelectionAction(null);
    window.getSelection()?.removeAllRanges();
  }

  function appendManualAnnotation(noteOverride?: string) {
    const note = noteOverride ?? selectionAction?.note ?? "";
    if (!selectionAction || !note.trim()) return "请先输入批注内容。";
    addManualAnnotation({
      chunkId: selectionAction.chunkId,
      quote: selectionAction.quote,
      startOffset: selectionAction.startOffset,
      endOffset: selectionAction.endOffset,
      dimension: manualAnnotationKey,
      title: manualAnnotationMeta.label,
      note: note.trim(),
      source: "manual",
    });
    setSelectionAction((current) => current ? { ...current, note: "" } : current);
    return "已添加到右侧总结。";
  }

  async function runSelectionAnalysis(
    dimensionKey?: string,
    selectionOverride?: SelectionAction,
    dimensionLabelOverride?: string,
    ignoreLoading = false,
  ) {
    const action = selectionOverride ?? selectionAction;
    if (!action || (chatLoading && !ignoreLoading)) return "当前暂时不能分析，请稍后再试。";
    const targetDimensionKey = dimensionKey ?? action.dimensionKey;
    const dimension = confirmedDimensions.find(
      (item) => item.key === targetDimensionKey,
    );
    const dimensionLabel = dimensionLabelOverride ?? dimension?.label ?? targetDimensionKey;
    setChatLoading(true);
    setChatError("");
    try {
      const prompt = `请按“${dimensionLabel}”这个阅读维度分析这段原文，并生成一条可放入右侧总结卡片的简洁总结。只返回总结内容。`;
      const response = await chatWithAssistant(
        [{ role: "user", content: `引用原文 ${action.chunkId}：
「${action.quote}」

${prompt}` }],
        {
          document: sourceDocument.filename ? sourceDocument : null,
          chunks: rawChunks,
          output_draft: outputDraft,
          summaries: toApiSummaries(summaries),
        },
      );
      addManualAnnotation({
        chunkId: action.chunkId,
        quote: action.quote,
        startOffset: action.startOffset,
        endOffset: action.endOffset,
        dimension: targetDimensionKey,
        title: dimensionLabel,
        note: response.message.content,
        source: "selection_ai",
      });
      return "已按当前维度分析，并添加到右侧总结。";
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 分析失败。";
      setChatError(message);
      return message;
    } finally {
      setChatLoading(false);
    }
  }

  async function translateSelection(languageOverride?: string) {
    if (!selectionAction || chatLoading) return "当前暂时不能翻译，请稍后再试。";
    const action = selectionAction;
    const targetLanguage = languageOverride?.trim() || action.language;
    setChatLoading(true);
    setChatError("");
    try {
      const response = await chatWithAssistant(
        [{ role: "user", content: `请把以下原文翻译成${targetLanguage}，保留原意，只返回译文：
${action.quote}` }],
        {
          document: sourceDocument.filename ? sourceDocument : null,
          chunks: rawChunks,
          output_draft: outputDraft,
          summaries: toApiSummaries(summaries),
        },
      );
      return response.message.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "一键翻译失败。";
      setChatError(message);
      return message;
    } finally {
      setChatLoading(false);
    }
  }

  async function quoteSelectionToQuestion(prompt = "这段话在说什么？") {
    if (!selectionAction) return "请先框选一段原文。";
    const action = selectionAction;
    const response = await chatWithAssistant(
      [{ role: "user", content: `请基于以下框选原文回答用户问题。

框选原文 ${action.chunkId}：
「${action.quote}」

用户问题：${prompt}` }],
      {
        document: sourceDocument.filename ? sourceDocument : null,
        chunks: rawChunks,
        output_draft: outputDraft,
        summaries: toApiSummaries(summaries),
      },
    );
    return response.message.content;
  }

  function findSelectionDimension(label: string) {
    return confirmedDimensions.find((dimension) => dimension.label === label);
  }

  function shouldUseSelectionAgentPlan(content: string) {
    return content.includes("维度") && /(新增|增加|添加|修改|改成|关闭|关掉|停用|启用|打开|以后)/.test(content);
  }

  async function handleSelectionPrompt(prompt: string) {
    const content = prompt.trim();
    if (!selectionAction || !content) return "请先输入要问 AI 的内容。";
    const requestedDimensionLabel = parseSelectionDimensionIntent(content);
    if (!requestedDimensionLabel) {
      setPendingSelectionDimensionPlan(null);
    }
    setPendingSelectionAgentPlan(null);
    if (isGlobalSelectionTask(content)) {
      return "这是全局工作台任务，请在右侧 AI Agent 中操作。框选小对话框只处理当前选区。";
    }
    if (!requestedDimensionLabel && shouldUseSelectionAgentPlan(content)) {
      return await planSelectionAgent(content, selectionAction);
    }
    if (content.includes("批注")) {
      const note = content
        .replace(/^加一段?人工?批注[:：]?/, "")
        .replace(/^批注[:：]?/, "")
        .trim();
      if (note) {
        return appendManualAnnotation(note);
      }
      return "请在“批注：”后面输入要添加的内容。";
    }
    if (content.includes("翻译")) {
      return await translateSelection(extractTranslationLanguage(content, selectionAction.language));
    }
    if (requestedDimensionLabel) {
      const dimension = findSelectionDimension(requestedDimensionLabel);
      if (dimension?.enabled) {
        setPendingSelectionDimensionPlan(null);
        return await runSelectionAnalysis(dimension.key, selectionAction, dimension.label);
      }
      if (dimension) {
        setPendingSelectionDimensionPlan({
          action: "enable",
          dimensionLabel: dimension.label,
          dimensionKey: dimension.key,
          selection: selectionAction,
        });
        return undefined;
      }
      setPendingSelectionDimensionPlan({
        action: "add",
        dimensionLabel: requestedDimensionLabel,
        selection: selectionAction,
      });
      return undefined;
    }
    if (content.includes("分析")) {
      return await runSelectionAnalysis();
    }
    try {
      return await quoteSelectionToQuestion(content);
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 回答失败。";
      setChatError(message);
      return message;
    }
  }

  function cancelSelectionDimensionPlan() {
    setPendingSelectionDimensionPlan(null);
  }

  async function confirmSelectionDimensionPlan() {
    if (!pendingSelectionDimensionPlan) return "当前没有待确认的选区维度计划。";
    if (chatLoading) return "当前暂时不能分析，请稍后再试。";
    const plan = pendingSelectionDimensionPlan;
    const description = `围绕“${plan.dimensionLabel}”概括和分析选中文本的重点信息。`;
    const operation: ConfigOperation = plan.action === "enable"
      ? {
          type: "enable_dimension",
          dimension_key: plan.dimensionKey,
        }
      : {
          type: "add_dimension",
          label: plan.dimensionLabel,
          description,
        };
    setChatLoading(true);
    setChatError("");
    try {
      const response = await applyAnalysisConfig(confirmedDimensions, [operation]);
      const updated = response.dimensions.map((dimension) => ({
        ...dimension,
        key: dimension.key as DimensionKey,
      }));
      const newDimensionKey =
        plan.dimensionKey ??
        response.affected_dimension_keys[0] ??
        updated.find((dimension) => dimension.label === plan.dimensionLabel)?.key;
      if (!newDimensionKey) {
        throw new Error("新增维度失败：未返回新维度标识。");
      }
      setConfirmedDimensions(updated);
      setDimensionDrafts(cloneDimensionConfigs(updated));
      setDimensionEditing(false);
      setDimensionConfigConfirmed(true);
      setDimensionConfigError("");
      setPendingSelectionDimensionPlan(null);
      setSelectionAction((current) =>
        current && current.chunkId === plan.selection.chunkId
          ? { ...current, dimensionKey: newDimensionKey }
          : current,
      );
      return await runSelectionAnalysis(newDimensionKey, plan.selection, plan.dimensionLabel, true);
    } catch (error) {
      const message = error instanceof Error ? error.message : "新增维度并分析失败。";
      setChatError(message);
      return message;
    } finally {
      setChatLoading(false);
    }
  }

  async function planSelectionAgent(content: string, selection: SelectionAction) {
    setChatLoading(true);
    setChatError("");
    try {
      const response = await planWithAgent(
        content,
        buildAgentContext({ surface: "selection_popover", selection }),
        agentMessages.slice(-12),
      );
      if (response.plan) {
        setPendingSelectionAgentPlan({ plan: response.plan, selection });
        return undefined;
      }
      return response.message.content;
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selection Agent 规划失败。";
      setChatError(message);
      return message;
    } finally {
      setChatLoading(false);
    }
  }

  function cancelSelectionAgentPlan() {
    setPendingSelectionAgentPlan(null);
  }

  async function executeSelectionAgentPlan() {
    if (!pendingSelectionAgentPlan) return "当前没有待确认的选区 Agent 计划。";
    const { plan, selection } = pendingSelectionAgentPlan;
    const allowed = new Set([
      "answer_question",
      "add_dimension",
      "update_dimension",
      "enable_dimension",
      "disable_dimension",
      "run_selection_analysis",
    ]);
    const blocked = plan.operations.find((operation) => !allowed.has(operation.type));
    if (blocked) {
      setPendingSelectionAgentPlan(null);
      return "该计划包含全文或全局输出操作，请到右侧 AI Agent 中确认执行。";
    }
    setChatLoading(true);
    setChatError("");
    try {
      let workingDimensions = confirmedDimensions;
      const operationDimensionKeys = new Map<string, DimensionKey>();
      const messages: string[] = [];
      for (const operation of plan.operations) {
        if (operation.type === "answer_question") {
          if (operation.params.answer) messages.push(operation.params.answer);
          continue;
        }
        if (operation.type === "run_selection_analysis") {
          if (operation.params.target !== "current_selection") {
            throw new Error("run_selection_analysis 只能分析当前选区。");
          }
          if (operation.params.mergeMode !== "append_results") {
            throw new Error("run_selection_analysis 只能追加 selection_ai 卡片。");
          }
          const dimensionLabel = operation.params.dimensionLabel ?? operation.params.label ?? "";
          const dependentKey = operation.params.dependsOnOperationId
            ? operationDimensionKeys.get(operation.params.dependsOnOperationId)
            : undefined;
          const targetDimension =
            workingDimensions.find((dimension) => dimension.key === operation.params.dimensionKey) ??
            (dependentKey ? workingDimensions.find((dimension) => dimension.key === dependentKey) : undefined) ??
            workingDimensions.find((dimension) => dimension.label === dimensionLabel);
          if (!targetDimension) {
            throw new Error(`找不到“${dimensionLabel || "指定"}”阅读维度，无法分析当前选区。`);
          }
          let enabledDimension = targetDimension;
          if (!targetDimension.enabled) {
            const response = await applyAnalysisConfig(workingDimensions, [
              { type: "enable_dimension", dimension_key: targetDimension.key },
            ]);
            workingDimensions = response.dimensions.map((dimension) => ({
              ...dimension,
              key: dimension.key as DimensionKey,
            }));
            enabledDimension =
              workingDimensions.find((dimension) => dimension.key === targetDimension.key) ?? targetDimension;
            messages.push(`已启用“${enabledDimension.label}”维度。`);
          }
          const result = await runSelectionAnalysis(enabledDimension.key, selection, enabledDimension.label, true);
          messages.push(result || `已用“${enabledDimension.label}”维度分析当前选区。`);
          continue;
        }
        if (operation.type === "add_dimension" && operation.params.label) {
          const existing = workingDimensions.find((dimension) => dimension.label === operation.params.label);
          if (existing) {
            if (!existing.enabled) {
              const response = await applyAnalysisConfig(workingDimensions, [
                { type: "enable_dimension", dimension_key: existing.key },
              ]);
              workingDimensions = response.dimensions.map((dimension) => ({
                ...dimension,
                key: dimension.key as DimensionKey,
              }));
              operationDimensionKeys.set(operation.id, existing.key);
              messages.push(`启用维度：${existing.label}：已完成。`);
            } else {
              operationDimensionKeys.set(operation.id, existing.key);
              messages.push(`维度“${existing.label}”已存在，已复用该维度。`);
            }
            continue;
          }
        }
        const configOperation = agentOperationToConfigOperation(operation);
        if (!configOperation) continue;
        const response = await applyAnalysisConfig(workingDimensions, [configOperation]);
        workingDimensions = response.dimensions.map((dimension) => ({
          ...dimension,
          key: dimension.key as DimensionKey,
        }));
        if (operation.type === "add_dimension") {
          const addedKey = response.affected_dimension_keys[0];
          const addedDimension = workingDimensions.find((dimension) => dimension.key === addedKey)
            ?? workingDimensions.find((dimension) => dimension.label === operation.params.label);
          if (addedDimension) operationDimensionKeys.set(operation.id, addedDimension.key);
        }
        if (operation.type === "update_dimension" && operation.params.dimensionKey) {
          operationDimensionKeys.set(operation.id, operation.params.dimensionKey as DimensionKey);
        }
        if (
          (operation.type === "enable_dimension" || operation.type === "disable_dimension") &&
          operation.params.dimensionKey
        ) {
          operationDimensionKeys.set(operation.id, operation.params.dimensionKey as DimensionKey);
        }
        messages.push(`${operation.title}：已完成。`);
      }
      setConfirmedDimensions(workingDimensions);
      setDimensionDrafts(cloneDimensionConfigs(workingDimensions));
      setDimensionEditing(false);
      setDimensionConfigConfirmed(true);
      setDimensionConfigError("");
      setPendingSelectionAgentPlan(null);
      return messages.length ? messages.join("\n") : "Selection Agent 计划已执行。";
    } catch (error) {
      const message = error instanceof Error ? error.message : "Selection Agent 执行失败。";
      setChatError(message);
      return message;
    } finally {
      setChatLoading(false);
    }
  }

  function agentNow() {
    return new Date().toISOString();
  }

  function addAgentMessage(
    role: AgentMessage["role"],
    content: string,
    messageKind: AgentMessage["messageKind"] = "plain_answer",
    patch: Partial<AgentMessage> = {},
  ) {
    setAgentMessages((current) => [
      ...current,
      {
        id: `agent_${Date.now()}_${current.length}`,
        role,
        content,
        createdAt: agentNow(),
        messageKind,
        ...patch,
      },
    ]);
  }

  function buildAgentCapabilities(surface: AgentSurface = "global_panel"): AgentContext["capabilities"] {
    const hasDocument = Boolean(analyzableChunks.length);
    const hasConfirmedSummary = summaries.some((item) => item.status === "confirmed");
    const hasOutput = Boolean(outputDraft.trim());
    const dimensionsReady = dimensionConfigConfirmed && activeConfirmedDimensions.length > 0;
    const capabilities: AgentContext["capabilities"] = [
      { operationType: "answer_question", enabled: true, requiresConfirmation: false },
      {
        operationType: "add_dimension",
        enabled: true,
        disabledReason: null,
        requiresConfirmation: true,
      },
      { operationType: "update_dimension", enabled: true, requiresConfirmation: true },
      { operationType: "enable_dimension", enabled: true, requiresConfirmation: true },
      { operationType: "disable_dimension", enabled: confirmedDimensions.length > 0, disabledReason: confirmedDimensions.length ? null : "当前没有可停用的阅读维度。", requiresConfirmation: true },
      { operationType: "delete_dimension", enabled: confirmedDimensions.length > 0, disabledReason: confirmedDimensions.length ? null : "当前没有可删除的阅读维度。", requiresConfirmation: true },
      {
        operationType: "run_analysis",
        enabled: hasDocument && dimensionsReady,
        disabledReason: !hasDocument ? "请先上传并解析文档。" : !dimensionsReady ? "请先添加或启用至少一个阅读维度后再进行 AI 分析。" : null,
        requiresConfirmation: true,
      },
      {
        operationType: "generate_output",
        enabled: hasConfirmedSummary,
        disabledReason: hasConfirmedSummary ? null : "请先确认至少一条总结，再生成最终输出。",
        requiresConfirmation: true,
      },
      {
        operationType: "export_word",
        enabled: hasOutput,
        disabledReason: hasOutput ? null : "当前没有最终纪要/输出草稿，无法导出 Word。",
        requiresConfirmation: true,
      },
      {
        operationType: "export_txt",
        enabled: hasOutput,
        disabledReason: hasOutput ? null : "当前没有最终纪要/输出草稿，无法导出 TXT。",
        requiresConfirmation: true,
      },
    ];
    if (surface === "selection_popover") {
      capabilities.push({
        operationType: "run_selection_analysis",
        enabled: Boolean(selectionAction),
        disabledReason: selectionAction ? null : "请先框选原文。",
        requiresConfirmation: true,
      });
      const allowed = new Set([
        "answer_question",
        "add_dimension",
        "update_dimension",
        "enable_dimension",
        "disable_dimension",
        "run_selection_analysis",
      ]);
      return capabilities.filter((capability) => allowed.has(capability.operationType));
    }
    return capabilities;
  }

  function buildAgentContext({
    surface = "global_panel",
    selection: selectionOverride,
  }: {
    surface?: AgentSurface;
    selection?: SelectionAction | null;
  } = {}): AgentContext {
    const sourceSelection = selectionOverride ?? selectionAction;
    const selection = sourceSelection
      ? {
          chunkId: sourceSelection.chunkId,
          quote: sourceSelection.quote.slice(0, 2000),
          startOffset: sourceSelection.startOffset,
          endOffset: sourceSelection.endOffset,
        }
      : null;
    return {
      agentSurface: surface,
      document: sourceDocument.filename
        ? {
            id: sourceDocument.filename,
            title: sourceDocument.title || sourceDocument.filename,
            type: sourceDocument.document_type,
            chunkCount: rawChunks.length,
          }
        : null,
      dimensions: confirmedDimensions.map(({ key, label, description, enabled }) => ({
        key,
        label,
        description,
        enabled,
      })),
      summaries: summaries.slice(0, 80).map((summary) => ({
        id: summary.id,
        title: summary.title,
        dimension: summary.key,
        status: summary.status,
        source: summary.source,
        flagged: summary.flagged,
        editedByUser: summary.editedByUser,
        preview: summary.summary.slice(0, 240),
      })),
      outputDraft: {
        exists: Boolean(outputDraft.trim()),
        length: outputDraft.length,
        preview: outputDraft.trim().slice(0, 300),
      },
      selection,
      capabilities: buildAgentCapabilities(surface),
    };
  }

  async function submitAgentMessage(event: FormEvent) {
    event.preventDefault();
    const content = agentMessage.trim();
    await sendAgentContent(content);
  }

  async function sendAgentContent(content: string) {
    if (!content || agentLoading) return;
    if (pendingAgentPlan && /^(确认|确认执行|执行)$/u.test(content)) {
      setAgentMessage("");
      await executeAgentPlan(pendingAgentPlan);
      return;
    }
    if (pendingAgentPlan) {
      setPendingAgentPlan(null);
    }
    setAgentMessage("");
    setAgentError("");
    setAgentLoading(true);
    addAgentMessage("user", content);
    try {
      const response: AgentPlanResponse = await planWithAgent(
        content,
        buildAgentContext(),
        agentMessages.slice(-12),
      );
      if (response.plan) {
        setPendingAgentPlan(response.plan);
        addAgentMessage("assistant", response.plan.assistantReply, "plan_preview", {
          planId: response.plan.id,
        });
      } else if (response.message) {
        setAgentMessages((current) => [...current, response.message]);
      }
    } catch (error) {
      const content = error instanceof Error ? error.message : "Agent 规划请求失败。";
      setAgentError(content);
      addAgentMessage("assistant", content, "error");
    } finally {
      setAgentLoading(false);
    }
  }

  function agentOperationToConfigOperation(operation: AgentOperation): ConfigOperation | null {
    if (operation.type === "add_dimension") {
      return {
        type: "add_dimension",
        label: operation.params.label,
        description: operation.params.description,
      };
    }
    if (operation.type === "update_dimension") {
      return {
        type: "update_dimension",
        dimension_key: operation.params.dimensionKey,
        label: operation.params.label,
        description: operation.params.description,
      };
    }
    if (operation.type === "enable_dimension" || operation.type === "disable_dimension") {
      return {
        type: operation.type,
        dimension_key: operation.params.dimensionKey,
      };
    }
    if (operation.type === "delete_dimension") {
      return {
        type: "remove_dimension",
        dimension_key: operation.params.dimensionKey,
      };
    }
    return null;
  }

  function resolveAnalysisDimensions(
    scope: AnalysisScope | null | undefined,
    dimensions: AnalysisDimensionConfig[],
    operationDimensionKeys: Map<string, DimensionKey> = new Map(),
  ) {
    const enabled = dimensions.filter((dimension) => dimension.enabled);
    if (!scope || scope.type === "all_enabled_dimensions") return enabled;
    if (scope.type === "new_dimension_only") {
      const operationId = scope.dependsOnOperationId ?? scope.tempDimensionRef ?? "";
      const dimensionKey = operationDimensionKeys.get(operationId);
      if (dimensionKey) {
        return dimensions.filter((dimension) => dimension.key === dimensionKey);
      }
      if (scope.dimensionLabel) {
        return dimensions.filter((dimension) => dimension.label === scope.dimensionLabel);
      }
      return [];
    }
    if (scope.type === "selected_dimensions") {
      const keys = new Set(scope.dimensionKeys ?? []);
      const labels = new Set(scope.dimensionLabels ?? []);
      return dimensions.filter((dimension) => keys.has(dimension.key) || labels.has(dimension.label));
    }
    if (scope.type === "current_dimension_only") {
      const key = scope.dimensionKey ?? activeDimension;
      return dimensions.filter((dimension) => dimension.key === key);
    }
    return enabled;
  }

  async function runAgentAnalysis(
    operation: AgentOperation,
    dimensions: AnalysisDimensionConfig[],
    operationDimensionKeys: Map<string, DimensionKey>,
  ) {
    if (!rawChunks.length) throw new Error("请先上传并解析文档。");
    if (!analyzableChunks.length) throw new Error("当前没有可分析的原文内容。");
    const selected = resolveAnalysisDimensions(
      operation.params.analysisScope,
      dimensions,
      operationDimensionKeys,
    );
    if (!selected.length) throw new Error("没有可用于分析的维度。");
    const mergeMode: AnalysisMergeMode = operation.params.mergeMode ?? "append_results";
    if (mergeMode === "new_version") {
      throw new Error("MVP 暂不支持分析版本管理，请使用追加结果。");
    }
    const mergeLabel =
      mergeMode === "append_results"
        ? "追加结果，不覆盖已有总结"
        : "按计划合并分析结果";
    setRequestState("analysis", "loading");
    startAnalysisProgress("全文（Agent 触发）", selected, mergeLabel);
    try {
      const response = await analyzeDocument(
        sourceDocument,
        analyzableChunks,
        selected.map(({ key, label, description }) => ({ key, label, description })),
      );
      const labels = new Map(selected.map((dimension) => [dimension.key, dimension.label]));
      const mapped = response.summaries.map((summary) => ({
        ...summary,
        id: mergeMode === "append_results" ? `A${Date.now()}_${summary.id}` : summary.id,
        title: labels.get(summary.dimension) ?? summary.title,
      }));
      if (mergeMode === "append_results") {
        if (mapped.length) {
          appendAnalysis(mapped);
        } else {
          setRequestState("analysis", "success");
        }
        completeAnalysisProgress(mapped.length, response.no_results ?? []);
        return {
          addedCount: mapped.length,
          noResults: response.no_results ?? [],
        };
      }
      loadAnalysis(mapped);
      completeAnalysisProgress(mapped.length, response.no_results ?? []);
      return {
        addedCount: mapped.length,
        noResults: response.no_results ?? [],
      };
    } catch (error) {
      const message = error instanceof Error ? error.message : "AI 分析失败。";
      failAnalysisProgress(message);
      setRequestState("analysis", "error", message);
      throw error;
    }
  }

  async function executeAgentPlan(plan: AgentPlan) {
    const executionId = `exec_${Date.now()}`;
    const initialResults: AgentOperationResult[] = plan.operations.map((operation) => ({
      operationId: operation.id,
      type: operation.type,
      status: "pending",
      message: "等待执行",
    }));
    const execution: AgentExecution = {
      id: executionId,
      planId: plan.id,
      status: "running",
      startedAt: agentNow(),
      operationResults: initialResults,
    };
    setAgentExecutions((current) => [execution, ...current]);
    setPendingAgentPlan(null);

    let currentResults = initialResults;
    const updateResult = (operation: AgentOperation, patch: Partial<AgentOperationResult>) => {
      currentResults = currentResults.map((result) =>
        result.operationId === operation.id ? { ...result, ...patch } : result,
      );
      setAgentExecutions((current) =>
        current.map((item) =>
          item.id === executionId
            ? {
                ...item,
                operationResults: item.operationResults.map((result) =>
                  result.operationId === operation.id
                    ? { ...result, ...patch }
                    : result,
                ),
              }
            : item,
        ),
      );
    };

    let workingDimensions = confirmedDimensions;
    const operationDimensionKeys = new Map<string, DimensionKey>();
    let failed = false;
    let succeededCount = 0;
    for (const operation of plan.operations) {
      updateResult(operation, { status: "running", message: "执行中…" });
      try {
        const configOperation = agentOperationToConfigOperation(operation);
        if (configOperation) {
          if (operation.type === "add_dimension" && operation.params.label) {
            const existing = workingDimensions.find((dimension) => dimension.label === operation.params.label);
            if (existing) {
              operationDimensionKeys.set(operation.id, existing.key);
              if (!existing.enabled) {
                const response = await applyAnalysisConfig(workingDimensions, [
                  { type: "enable_dimension", dimension_key: existing.key },
                ]);
                workingDimensions = response.dimensions.map((dimension) => ({
                  ...dimension,
                  key: dimension.key as DimensionKey,
                }));
                setConfirmedDimensions(workingDimensions);
                setDimensionDrafts(cloneDimensionConfigs(workingDimensions));
                setDimensionEditing(false);
                setDimensionConfigConfirmed(true);
                updateResult(operation, {
                  status: "succeeded",
                  message: `维度“${existing.label}”已存在，已启用并复用。`,
                  details: [
                    `已启用并复用“${existing.label}”维度`,
                    "未新增重复维度",
                    "未覆盖已有总结",
                  ],
                });
              } else {
                updateResult(operation, {
                  status: "succeeded",
                  message: `维度“${existing.label}”已存在，已复用。`,
                  details: [
                    `已复用“${existing.label}”维度`,
                    "未新增重复维度",
                    "未覆盖已有总结",
                  ],
                });
              }
              succeededCount += 1;
              continue;
            }
          }
          const response = await applyAnalysisConfig(workingDimensions, [configOperation]);
          workingDimensions = response.dimensions.map((dimension) => ({
            ...dimension,
            key: dimension.key as DimensionKey,
          }));
          const affectedDimensionKey = response.affected_dimension_keys[0] as DimensionKey | undefined;
          if (affectedDimensionKey) {
            operationDimensionKeys.set(operation.id, affectedDimensionKey);
          }
          if (operation.type === "add_dimension" && !affectedDimensionKey && operation.params.label) {
            const addedDimension = workingDimensions.find((dimension) => dimension.label === operation.params.label);
            if (addedDimension) operationDimensionKeys.set(operation.id, addedDimension.key);
          }
          setConfirmedDimensions(workingDimensions);
          setDimensionDrafts(cloneDimensionConfigs(workingDimensions));
          setDimensionEditing(false);
          setDimensionConfigConfirmed(true);
          updateResult(operation, {
            status: "succeeded",
            message: describeConfigOperationResult(operation),
            details: buildConfigOperationDetails(operation),
          });
          succeededCount += 1;
        } else if (operation.type === "run_analysis") {
          const analysisResult = await runAgentAnalysis(operation, workingDimensions, operationDimensionKeys);
          const noResultMessage = analysisResult.noResults
            .map((item) => `未发现“${item.title}”相关内容。${item.reason ? `原因：${item.reason}` : ""}`)
            .join("；");
          const analysisDetails = buildRunAnalysisResultDetails(operation, analysisResult);
          updateResult(operation, {
            status: "succeeded",
            message: analysisResult.addedCount
              ? `${operation.title}：已完成，结果已追加。`
              : `${operation.title}：已完成分析，但未新增总结卡片。${noResultMessage ? ` ${noResultMessage}` : ""}`,
            details: analysisDetails,
          });
          succeededCount += 1;
        } else if (operation.type === "generate_output") {
          await generateOutput();
          updateResult(operation, { status: "succeeded", message: "最终输出已生成。" });
          succeededCount += 1;
        } else if (operation.type === "export_word") {
          exportOutputAsWord();
          updateResult(operation, { status: "succeeded", message: "Word 导出已触发下载。" });
          succeededCount += 1;
        } else if (operation.type === "export_txt") {
          exportOutputAsTxt();
          updateResult(operation, { status: "succeeded", message: "TXT 导出已触发下载。" });
          succeededCount += 1;
        } else if (operation.type === "answer_question") {
          updateResult(operation, { status: "skipped", message: operation.params.answer ?? "问答操作无需执行页面状态变更。" });
        }
      } catch (error) {
        failed = true;
        const message = error instanceof Error ? error.message : "执行失败。";
        updateResult(operation, {
          status: "failed",
          message,
          details: buildFailedOperationDetails(operation, message),
        });
        break;
      }
    }
    setAgentExecutions((current) =>
      current.map((item) =>
        item.id === executionId
          ? {
              ...item,
              status: failed ? "partially_succeeded" : "succeeded",
              finishedAt: agentNow(),
            }
          : item,
      ),
    );
    addAgentMessage(
      "assistant",
      buildAgentExecutionFeedback(plan, currentResults, failed, succeededCount),
      "execution_update",
      { executionId },
    );
  }

  return (
    <main className="min-h-screen bg-canvas text-ink">
      <header className="sticky top-0 z-50 flex h-16 items-center border-b border-slate-200 bg-white/95 px-5 shadow-sm backdrop-blur">
        <div className="flex items-center gap-3">
          <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-brand text-white shadow-lg shadow-blue-200">
            <Icon name="logo" className="h-5 w-5" />
          </span>
          <div>
            <h1 className="text-base font-bold tracking-tight">
              Reading Without Effort
            </h1>
            <p className="text-[10px] tracking-wide text-slate-400">
              AI READING WORKSPACE
            </p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          <TopButton
            icon="plus"
            label={uploadStatus === "loading" ? "解析中..." : "上传文档"}
            onClick={() => fileInputRef.current?.click()}
          />
          <input
            ref={fileInputRef}
            type="file"
            data-testid="file-upload-input"
            accept=".txt,text/plain"
            className="hidden"
            onChange={(event) => {
              void handleUpload(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          <TopButton icon="save" label="保存进度" onClick={handleSaveWorkspace} />
          <TopButton
            icon="folder"
            label="恢复进度"
            onClick={() => workspaceInputRef.current?.click()}
          />
          <input
            ref={workspaceInputRef}
            type="file"
            accept=".json,.rwe.json,.meeting-workspace.json,application/json"
            className="hidden"
            onChange={(event) => {
              void handleRestoreWorkspace(event.target.files?.[0]);
              event.currentTarget.value = "";
            }}
          />
          {workspaceNotice && (
            <span className="max-w-[220px] truncate rounded-full bg-slate-100 px-2.5 py-1 text-[11px] font-medium text-slate-600">
              {workspaceNotice}
            </span>
          )}
          <div className="ml-2 flex items-center gap-2 border-l border-slate-200 pl-4">
            <span className="flex h-8 w-8 items-center justify-center rounded-full bg-gradient-to-br from-amber-200 to-orange-400 text-xs font-bold text-white">
              张
            </span>
            <span className="text-sm font-medium">张三</span>
            <Icon name="chevron" className="h-3.5 w-3.5 text-slate-400" />
          </div>
        </div>
      </header>

      <section className="m-4 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <div className="flex flex-wrap items-center gap-5 px-4 py-3">
          <div className="flex min-w-[285px] items-center gap-3">
            <span className="flex h-11 w-11 items-center justify-center rounded-xl border border-blue-100 bg-blue-50 text-brand">
              <Icon name="file" className="h-6 w-6" />
            </span>
            <div>
              <div className="flex items-center gap-2">
                <strong className="text-sm">
                  {sourceDocument.filename || "尚未上传 TXT 文档"}
                </strong>
                <span
                  className={`inline-flex items-center gap-1 text-xs font-medium ${rawChunks.length ? "text-emerald-600" : "text-slate-400"}`}
                >
                  <i
                    className={`h-1.5 w-1.5 rounded-full ${rawChunks.length ? "bg-emerald-500" : "bg-slate-300"}`}
                  />
                  {uploadStatus === "loading"
                    ? "正在解析"
                    : rawChunks.length
                      ? "解析成功"
                      : "等待上传"}
                </span>
              </div>
              <p className="mt-1 text-[11px] text-slate-400">
                原文段落：{rawChunks.length} 段 ｜ 当前分析：
                {analysisStatus === "loading"
                  ? "处理中"
                  : summaries.length
                    ? `${summaries.length} 条总结`
                    : "未分析"}
              </p>
            </div>
          </div>
          <InfoBlock
            title={sourceDocument.document_type === "meeting" ? "会议时间" : "文档信息"}
            value={sourceDocument.document_type === "meeting" && sourceDocument.meeting_time ? formatDocumentTime(sourceDocument.meeting_time) : documentTypeLabel(sourceDocument.document_type)}
          />
          <InfoBlock
            title={sourceDocument.document_type === "meeting" ? "会议时长" : "文档长度"}
            value={sourceDocument.document_type === "meeting" ? (sourceDocument.duration_text || "--") : (sourceDocument.char_count ? `${sourceDocument.char_count} 字符` : "--")}
          />
          <div className="min-w-0 flex-1">
            <p className="text-[11px] font-semibold text-slate-500">关键词</p>
            <div className="mt-1.5 flex gap-1.5 overflow-hidden">
              {sourceDocument.keywords.length ? (
                sourceDocument.keywords.slice(0, 6).map((tag) => (
                  <span
                    key={tag}
                    className="whitespace-nowrap rounded-md bg-blue-50 px-2.5 py-1 text-xs font-medium text-blue-700"
                  >
                    {tag}
                  </span>
                ))
              ) : (
                <span className="text-xs text-slate-300">上传后显示关键词</span>
              )}
            </div>
          </div>
        </div>

        <DimensionConfigPanel
          dimensionEditing={dimensionEditing}
          dimensionConfigConfirmed={dimensionConfigConfirmed}
          dimensionDrafts={dimensionDrafts}
          activeConfirmedDimensions={activeConfirmedDimensions}
          dimensionConfigError={dimensionConfigError}
          analysisStatus={analysisStatus}
          analyzableChunkCount={analyzableChunks.length}
          editedSegmentCount={sourceEditStats.editedCount}
          deletedSegmentCount={sourceEditStats.deletedCount}
          summaries={summaries}
          analysisProgress={analysisProgress}
          onBeginEditing={beginDimensionEditing}
          onRunAnalysis={() => void runAnalysis()}
          onUpdateDimensionDraft={updateDimensionDraft}
          onRemoveDimensionDraft={removeDimensionDraft}
          onAddDimensionDraft={addDimensionDraft}
          onRestoreDefaultDimensions={() =>
            setDimensionDrafts(cloneDimensionConfigs(defaultDimensionConfigs))
          }
          onConfirmDimensionConfig={confirmDimensionConfig}
        />
      </section>

      {errorMessage && (
        <div className="mx-4 mb-3 rounded-lg border border-rose-200 bg-rose-50 px-4 py-3 text-sm text-rose-700">
          {errorMessage}
        </div>
      )}

      <section className="grid grid-cols-1 gap-3 px-4 xl:grid-cols-[minmax(0,2.1fr)_.82fr]">
        <AnnotationWorkspace
          transcripts={transcripts}
          activeSummaryId={activeSummaryId}
          activeDimension={activeDimension}
          activeEvidence={activeEvidence}
          onlyEvidence={onlyEvidence}
          onToggleEvidence={() => setOnlyEvidence(!onlyEvidence)}
          summaries={summaries}
          dimensionLabels={confirmedDimensionLabels}
          availableDimensions={activeDimensionKeys}
          outputDimensionOptions={confirmedDimensions}
          onLocate={locate}
          onSelectSummary={setActiveSummary}
          onUpdateSummary={updateSummary}
          onUpdateSegmentText={updateChunkText}
          onRestoreSegmentText={restoreChunkText}
          onDeleteSegment={softDeleteChunk}
          onRestoreDeletedSegment={restoreDeletedChunk}
          onChangeSummaryLinkedDimension={setSummaryLinkedDimension}
          onToggleConfirmed={toggleSummaryConfirmed}
          onToggleExcluded={toggleSummaryExcluded}
          onToggleFlagged={toggleSummaryFlagged}
          onRestoreSummary={restoreSummary}
          onConfirmAll={confirmAllSummaries}
          deletedSummaryCount={deletedSummaries.length}
          onDeleteSummary={deleteSummary}
          onUndoDeleteSummary={undoDeleteSummary}
          onSourceSelection={openSelectionToolbar}
          selectionAction={selectionAction}
          selectionDimensions={activeConfirmedDimensions}
          onChangeSelection={setSelectionAction}
          onAnalyzeSelection={runSelectionAnalysis}
          onAppendSelectionAnnotation={appendManualAnnotation}
          onAskSelection={handleSelectionPrompt}
          onCloseSelection={closeSelectionToolbar}
          pendingSelectionDimensionPlan={pendingSelectionDimensionPlan}
          onConfirmSelectionDimensionPlan={confirmSelectionDimensionPlan}
          onCancelSelectionDimensionPlan={cancelSelectionDimensionPlan}
          pendingSelectionAgentPlan={pendingSelectionAgentPlan?.plan ?? null}
          onConfirmSelectionAgentPlan={executeSelectionAgentPlan}
          onCancelSelectionAgentPlan={cancelSelectionAgentPlan}
        />

        <AgentConversationPanel
          agentMessages={agentMessages}
          agentExecutions={agentExecutions}
          pendingAgentPlan={pendingAgentPlan}
          agentLoading={agentLoading}
          agentError={agentError}
          agentMessage={agentMessage}
          onClear={clearCurrentAssistantChat}
          onSubmit={submitAgentMessage}
          onChangeMessage={setAgentMessage}
          onCancelAgentPlan={() => setPendingAgentPlan(null)}
          onConfirmAgentPlan={() => {
            if (pendingAgentPlan) void executeAgentPlan(pendingAgentPlan);
          }}
          onExampleClick={setAgentMessage}
        />
      </section>
      <FinalOutputPanel
        outputDraft={outputDraft}
        outputStale={outputStale}
        outputGeneratedAt={outputGeneratedAt}
        outputProgress={outputProgress}
        summaries={summaries}
        generationStatus={generationStatus}
        copied={copied}
        onGenerateOutput={generateOutput}
        onCopyOutput={copyOutput}
        onChangeOutputDraft={setOutputDraft}
        onExportWord={exportOutputAsWord}
        onExportTxt={exportOutputAsTxt}
      />
    </main>
  );
}

function AnnotationWorkspace({
  transcripts,
  summaries,
  dimensionLabels,
  availableDimensions,
  outputDimensionOptions,
  activeSummaryId,
  activeDimension,
  activeEvidence,
  onlyEvidence,
  onToggleEvidence,
  onLocate,
  onSelectSummary,
  onUpdateSummary,
  onUpdateSegmentText,
  onRestoreSegmentText,
  onDeleteSegment,
  onRestoreDeletedSegment,
  onChangeSummaryLinkedDimension,
  onToggleConfirmed,
  onToggleExcluded,
  onToggleFlagged,
  onRestoreSummary,
  onConfirmAll,
  deletedSummaryCount,
  onDeleteSummary,
  onUndoDeleteSummary,
  onSourceSelection,
  selectionAction,
  selectionDimensions,
  onChangeSelection,
  onAnalyzeSelection,
  onAppendSelectionAnnotation,
  onAskSelection,
  onCloseSelection,
  pendingSelectionDimensionPlan,
  onConfirmSelectionDimensionPlan,
  onCancelSelectionDimensionPlan,
  pendingSelectionAgentPlan,
  onConfirmSelectionAgentPlan,
  onCancelSelectionAgentPlan,
}: {
  transcripts: Transcript[];
  summaries: EditableSummary[];
  dimensionLabels: Record<DimensionKey, string>;
  availableDimensions: DimensionKey[];
  outputDimensionOptions: AnalysisDimensionConfig[];
  activeSummaryId: string;
  activeDimension: DimensionKey;
  activeEvidence: string;
  onlyEvidence: boolean;
  onToggleEvidence: () => void;
  onLocate: (summary: Summary) => void;
  onSelectSummary: (summary: Summary) => void;
  onUpdateSummary: (id: string, summary: string) => void;
  onUpdateSegmentText: (id: string, text: string) => void;
  onRestoreSegmentText: (id: string) => void;
  onDeleteSegment: (id: string) => void;
  onRestoreDeletedSegment: (id: string) => void;
  onChangeSummaryLinkedDimension: (
    id: string,
    linkedDimensionKey: DimensionKey | null,
    linkedDimensionLabel: string | null,
  ) => void;
  onToggleConfirmed: (id: string) => void;
  onToggleExcluded: (id: string) => void;
  onToggleFlagged: (id: string) => void;
  onRestoreSummary: (id: string) => void;
  onConfirmAll: () => void;
  deletedSummaryCount: number;
  onDeleteSummary: (id: string) => void;
  onUndoDeleteSummary: () => void;
  onSourceSelection: (selection: SourceSelection) => void;
  selectionAction: SelectionAction | null;
  selectionDimensions: AnalysisDimensionConfig[];
  onChangeSelection: (selection: SelectionAction) => void;
  onAnalyzeSelection: () => void;
  onAppendSelectionAnnotation: (note?: string) => void;
  onAskSelection: (prompt: string) => Promise<string | undefined>;
  onCloseSelection: () => void;
  pendingSelectionDimensionPlan: PendingSelectionDimensionPlan | null;
  onConfirmSelectionDimensionPlan: () => Promise<string | undefined>;
  onCancelSelectionDimensionPlan: () => void;
  pendingSelectionAgentPlan: AgentPlan | null;
  onConfirmSelectionAgentPlan: () => Promise<string | undefined>;
  onCancelSelectionAgentPlan: () => void;
}) {
  const viewportRef = useRef<HTMLDivElement>(null);
  const rowsRef = useRef<HTMLDivElement>(null);
  const contentRef = useRef<HTMLDivElement>(null);
  const [connectors, setConnectors] = useState<Connector[]>([]);
  const [canvasSize, setCanvasSize] = useState({ width: 0, height: 0 });
  const [selectedDimensions, setSelectedDimensions] = useState<DimensionKey[]>(
    () => [...availableDimensions],
  );
  const dimensionEntries = useMemo(
    () =>
      availableDimensions.map(
        (key) => [key, dimensionMeta[key]] as const,
      ),
    [availableDimensions],
  );
  const [navigationDimension, setNavigationDimension] =
    useState<DimensionKey>(activeDimension);
  const [flagJumpValue, setFlagJumpValue] = useState("1");
  const [dimensionJumpValue, setDimensionJumpValue] = useState("1");
  const [showDeletedSegments, setShowDeletedSegments] = useState(false);
  const [editingSegmentId, setEditingSegmentId] = useState<string | null>(null);
  const [segmentDraft, setSegmentDraft] = useState("");
  const [segmentEditError, setSegmentEditError] = useState("");
  const [replacePanelOpen, setReplacePanelOpen] = useState(false);
  const [replaceScope, setReplaceScope] = useState<SourceReplaceScope>("all");
  const [replaceSegmentId, setReplaceSegmentId] = useState<string | null>(null);
  const [replaceQuery, setReplaceQuery] = useState("");
  const [replaceReplacement, setReplaceReplacement] = useState("");
  const [replaceNotice, setReplaceNotice] = useState("");
  const [replaceError, setReplaceError] = useState("");

  const orderedSummaries = useMemo(() => {
    const segmentOrder = new Map(
      transcripts.map((segment, index) => [segment.id, index]),
    );
    const originalOrder = new Map(
      summaries.map((summary, index) => [summary.id, index]),
    );
    return [...summaries].sort((left, right) => {
      const segmentDifference =
        (segmentOrder.get(left.evidenceId) ?? Number.MAX_SAFE_INTEGER) -
        (segmentOrder.get(right.evidenceId) ?? Number.MAX_SAFE_INTEGER);
      return (
        segmentDifference ||
        (originalOrder.get(left.id) ?? 0) - (originalOrder.get(right.id) ?? 0)
      );
    });
  }, [summaries, transcripts]);
  const visibleSummaries = useMemo(
    () =>
      orderedSummaries.filter((summary) =>
        summary.source === "manual" || selectedDimensions.includes(summary.key),
      ),
    [orderedSummaries, selectedDimensions],
  );
  const visibleSegments = useMemo(
    () =>
      transcripts.filter((segment) => {
        if (segment.isDeleted && !showDeletedSegments) return false;
        const hasVisibleAnnotation = visibleSummaries.some(
          (summary) => summary.evidenceId === segment.id,
        );
        return !onlyEvidence || hasVisibleAnnotation;
      }),
    [onlyEvidence, showDeletedSegments, transcripts, visibleSummaries],
  );
  const replacePreview = useMemo(
    () =>
      getSourceReplacePreview(
        transcripts,
        replaceQuery,
        replaceScope,
        replaceSegmentId,
      ),
    [replaceQuery, replaceScope, replaceSegmentId, transcripts],
  );
  const replaceTargetSegment = useMemo(
    () => transcripts.find((segment) => segment.id === replaceSegmentId) ?? null,
    [replaceSegmentId, transcripts],
  );
  const flaggedSummaries = useMemo(
    () => orderedSummaries.filter((summary) => summary.flagged),
    [orderedSummaries],
  );
  const dimensionSummaries = useMemo(
    () =>
      orderedSummaries.filter((summary) => summary.key === navigationDimension),
    [navigationDimension, orderedSummaries],
  );
  const summaryOrder = useMemo(
    () =>
      new Map(orderedSummaries.map((summary, index) => [summary.id, index + 1])),
    [orderedSummaries],
  );
  const flaggedOrder = useMemo(
    () => new Map(flaggedSummaries.map((summary, index) => [summary.id, index + 1])),
    [flaggedSummaries],
  );
  const dimensionOrder = useMemo(() => {
    const result = new Map<string, number>();
    const counts = new Map<DimensionKey, number>();
    orderedSummaries.forEach((summary) => {
      const next = (counts.get(summary.key) ?? 0) + 1;
      counts.set(summary.key, next);
      result.set(summary.id, next);
    });
    return result;
  }, [orderedSummaries]);

  function beginSegmentEdit(segment: Transcript) {
    setEditingSegmentId(segment.id);
    setSegmentDraft(segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join(""));
    setSegmentEditError("");
  }

  function saveSegmentEdit(segmentId: string) {
    const nextText = segmentDraft.trim();
    if (!nextText) {
      setSegmentEditError("段落内容不能为空。如需移除该段，请使用删除。");
      return;
    }
    onUpdateSegmentText(segmentId, nextText);
    setEditingSegmentId(null);
    setSegmentDraft("");
    setSegmentEditError("");
  }

  function cancelSegmentEdit() {
    setEditingSegmentId(null);
    setSegmentDraft("");
    setSegmentEditError("");
  }

  function openReplacePanel(scope: SourceReplaceScope, segmentId?: string) {
    setReplacePanelOpen(true);
    setReplaceScope(scope);
    setReplaceSegmentId(segmentId ?? null);
    setReplaceNotice("");
    setReplaceError("");
  }

  function clearReplaceForm() {
    setReplaceQuery("");
    setReplaceReplacement("");
    setReplaceNotice("");
    setReplaceError("");
  }

  function cancelReplacePanel() {
    setReplacePanelOpen(false);
    setReplaceScope("all");
    setReplaceSegmentId(null);
    clearReplaceForm();
  }

  function applySourceReplacement() {
    const query = replaceQuery.trim();
    const replacement = replaceReplacement.trim();
    if (!query) {
      setReplaceError("请输入查找内容。");
      return;
    }
    if (!replacement) {
      setReplaceError("替换内容不能为空，避免误删原文。");
      return;
    }
    if (replacePreview.matchCount === 0) {
      setReplaceError("当前范围内没有命中内容。");
      return;
    }

    transcripts.forEach((segment) => {
      if (segment.isDeleted) return;
      if (replaceScope === "segment" && segment.id !== replaceSegmentId) return;
      const currentText = segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join("");
      if (!currentText.includes(query)) return;
      onUpdateSegmentText(segment.id, replacePlainText(currentText, query, replacement));
    });
    setReplaceError("");
    setReplaceNotice(
      `已替换 ${replacePreview.matchCount} 处，涉及 ${replacePreview.segmentCount} 个段落。后续 AI 分析将使用替换后的原文。`,
    );
  }

  function evidenceChangeState(summary: EditableSummary) {
    const evidenceSegments = summary.evidences
      .map((evidence) => transcripts.find((segment) => segment.id === evidence.segment_id))
      .filter(Boolean);
    if (evidenceSegments.some((segment) => segment?.isDeleted)) return "deleted";
    if (evidenceSegments.some((segment) => segment?.isEdited)) return "edited";
    return null;
  }

  const measureConnectors = useCallback(() => {
    const content = contentRef.current;
    if (!content) return;
    const contentRect = content.getBoundingClientRect();
    const next: Connector[] = [];

    visibleSummaries.forEach((summary) => {
      const sources = content.querySelectorAll<HTMLElement>(
        `[data-annotation-id="${summary.id}"]`,
      );
      const target = content.querySelector<HTMLElement>(
        `[data-summary-id="${summary.id}"]`,
      );
      if (!sources.length || !target) return;

      sources.forEach((source, sourceIndex) => {
        const sourceRect = source.getBoundingClientRect();
        const targetRect = target.getBoundingClientRect();
        const startX = sourceRect.right - contentRect.left + 6;
        const startY = sourceRect.top - contentRect.top + sourceRect.height / 2;
        const endX = targetRect.left - contentRect.left - 10;
        const endY = targetRect.top - contentRect.top + 34 + sourceIndex * 5;
        const bend = Math.max(28, (endX - startX) * 0.45);
        next.push({
          id: `${summary.id}-${sourceIndex}`,
          summaryId: summary.id,
          key: summary.key,
          color: summary.source === "manual"
            ? manualAnnotationMeta.color
            : dimensionMeta[summary.key].color,
          startX,
          startY,
          path: `M ${startX} ${startY} C ${startX + bend} ${startY}, ${endX - bend} ${endY}, ${endX} ${endY}`,
        });
      });
    });

    const rows = rowsRef.current;
    setCanvasSize({
      width: content.clientWidth,
      height: Math.max(rows?.scrollHeight ?? 0, content.clientHeight),
    });
    setConnectors(next);
  }, [onlyEvidence, visibleSegments, visibleSummaries]);

  useEffect(() => {
    const frame = window.requestAnimationFrame(measureConnectors);
    const observer = new ResizeObserver(measureConnectors);
    if (contentRef.current) observer.observe(contentRef.current);
    if (rowsRef.current) observer.observe(rowsRef.current);
    window.addEventListener("resize", measureConnectors);
    return () => {
      window.cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener("resize", measureConnectors);
    };
  }, [measureConnectors]);

  useEffect(() => {
    setSelectedDimensions([...availableDimensions]);
    setNavigationDimension((current) =>
      availableDimensions.includes(current)
        ? current
        : (availableDimensions[0] ?? "topic"),
    );
  }, [availableDimensions]);

  useEffect(() => {
    if (viewportRef.current) viewportRef.current.scrollTop = 0;
  }, [onlyEvidence, selectedDimensions]);

  function selectAnnotation(summary: Summary) {
    onSelectSummary(summary);
    window.setTimeout(() => {
      document
        .getElementById(`summary-${summary.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 20);
  }

  function ensureDimensionVisible(dimension: DimensionKey) {
    setSelectedDimensions((current) =>
      current.includes(dimension) ? current : [...current, dimension],
    );
  }

  function jumpToSummary(summary?: EditableSummary) {
    if (!summary) return;
    ensureDimensionVisible(summary.key);
    onSelectSummary(summary);
    window.setTimeout(() => {
      document
        .getElementById(`summary-${summary.id}`)
        ?.scrollIntoView({ behavior: "smooth", block: "center" });
    }, 30);
  }

  function moveWithin(items: EditableSummary[], offset: -1 | 1) {
    if (!items.length) return;
    const currentIndex = items.findIndex((item) => item.id === activeSummaryId);
    const baseIndex = currentIndex < 0 ? (offset === 1 ? -1 : 0) : currentIndex;
    const nextIndex = Math.min(
      items.length - 1,
      Math.max(0, baseIndex + offset),
    );
    jumpToSummary(items[nextIndex]);
  }

  function jumpByNumber(items: EditableSummary[], rawValue: string) {
    const requested = Number.parseInt(rawValue, 10);
    if (!Number.isFinite(requested)) return;
    jumpToSummary(items[Math.min(items.length, Math.max(1, requested)) - 1]);
  }

  function toggleDimension(dimension: DimensionKey) {
    setSelectedDimensions((current) =>
      current.includes(dimension)
        ? current.filter((item) => item !== dimension)
        : [...current, dimension],
    );
  }

  function handleSourceMouseUp(segment: Transcript) {
    if (segment.isDeleted) return;
    window.setTimeout(() => {
      const selection = window.getSelection();
      const quote = selection?.toString().trim();
      if (!selection || !quote || selection.rangeCount === 0) return;
      const article = document.getElementById(`segment-${segment.id}`);
      if (!article) return;
      const range = selection.getRangeAt(0);
      if (!article.contains(range.commonAncestorContainer)) return;
      const fullText = segment.fragments.map((fragment) => fragment.text).join("");
      const startOffset = fullText.indexOf(quote);
      if (startOffset < 0) return;
      const rect = range.getBoundingClientRect();
      const contentRect = contentRef.current?.getBoundingClientRect();
      if (!contentRect) return;
      const toolbarWidth = 520;
      const toolbarHeight = 420;
      const viewportWidth = window.innerWidth || document.documentElement.clientWidth;
      const viewportHeight = window.innerHeight || document.documentElement.clientHeight;
      const spaceRight = viewportWidth - rect.right;
      const spaceLeft = rect.left;
      const placement =
        spaceRight >= toolbarWidth + 24 || spaceRight >= spaceLeft
          ? "right"
          : spaceLeft >= toolbarWidth + 24
            ? "left"
            : rect.bottom + toolbarHeight > viewportHeight && rect.top > toolbarHeight
              ? "above"
              : "below";
      onSourceSelection({
        chunkId: segment.id,
        quote,
        startOffset,
        endOffset: startOffset + quote.length,
        x:
          (placement === "right"
            ? rect.right + 16
            : placement === "left"
              ? rect.left - 16
              : rect.left + rect.width / 2) - contentRect.left,
        y:
          (placement === "below"
            ? rect.bottom + 12
            : placement === "above"
              ? rect.top - 12
              : rect.top) - contentRect.top,
        placement,
      });
    }, 0);
  }

  return (
    <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
      <div className="grid min-h-14 grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] border-b border-slate-100">
        <div data-testid="source-panel" className="flex items-center px-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Icon name="transcript" className="h-4 w-4 text-slate-500" />
            原文
          </h2>
          <label className="ml-auto flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              aria-label="仅看已标注"
              onClick={onToggleEvidence}
              className={`relative h-5 w-9 rounded-full transition ${onlyEvidence ? "bg-brand" : "bg-slate-200"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${onlyEvidence ? "left-[18px]" : "left-0.5"}`}
              />
            </button>
            仅看已标注
          </label>
          <label className="ml-3 flex items-center gap-2 text-xs text-slate-500">
            <button
              type="button"
              aria-label="显示已删除段落"
              onClick={() => setShowDeletedSegments((current) => !current)}
              className={`relative h-5 w-9 rounded-full transition ${showDeletedSegments ? "bg-rose-400" : "bg-slate-200"}`}
            >
              <span
                className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${showDeletedSegments ? "left-[18px]" : "left-0.5"}`}
              />
            </button>
            显示已删除
          </label>
          <button
            type="button"
            onClick={() => openReplacePanel("all")}
            className="ml-3 rounded-lg border border-blue-100 bg-blue-50 px-2.5 py-1.5 text-[11px] font-semibold text-brand hover:bg-blue-100"
          >
            批量替换
          </button>
        </div>
        <div className="flex items-center justify-center border-x border-slate-100 bg-slate-50/70 text-[10px] font-semibold text-slate-400">
          关联
        </div>
        <div data-testid="summary-panel" className="flex items-center px-4">
          <h2 className="flex items-center gap-1.5 text-sm font-bold">
            <Icon name="summary" className="h-4 w-4 text-slate-500" />
            总结
          </h2>
          <div className="ml-auto flex items-center gap-2">
            <span className="rounded-lg bg-emerald-50 px-2.5 py-1.5 text-[11px] font-medium text-emerald-700">
              {summaries.filter((item) => item.status === "confirmed").length}/
              {summaries.length} 已确认
            </span>
            <button
              type="button"
              onClick={onUndoDeleteSummary}
              disabled={!deletedSummaryCount}
              className="rounded-lg border border-amber-200 bg-amber-50 px-2.5 py-1.5 text-[11px] font-semibold text-amber-700 hover:bg-amber-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-300"
            >
              撤销删除{deletedSummaryCount ? ` (${deletedSummaryCount})` : ""}
            </button>
            <button
              type="button"
              onClick={onConfirmAll}
              className="rounded-lg border border-slate-200 bg-white px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:border-blue-200 hover:bg-blue-50 hover:text-brand"
            >
              全部确认
            </button>
          </div>
        </div>
      </div>

      {replacePanelOpen && (
        <SourceReplacePanel
          query={replaceQuery}
          replacement={replaceReplacement}
          scope={replaceScope}
          targetSegmentLabel={replaceTargetSegment?.id ?? null}
          preview={replacePreview}
          notice={replaceNotice}
          error={replaceError}
          onChangeQuery={(value) => {
            setReplaceQuery(value);
            setReplaceNotice("");
            setReplaceError("");
          }}
          onChangeReplacement={(value) => {
            setReplaceReplacement(value);
            setReplaceNotice("");
            setReplaceError("");
          }}
          onChangeScope={(value) => {
            setReplaceScope(value);
            setReplaceNotice("");
            setReplaceError("");
          }}
          onApply={applySourceReplacement}
          onClear={clearReplaceForm}
          onCancel={cancelReplacePanel}
        />
      )}

      <div className="space-y-3 border-b border-slate-100 px-4 py-3">
        <div className="flex flex-wrap items-center gap-2 text-[11px] text-slate-500">
          <span className="font-semibold text-slate-600">筛选维度：</span>
          {dimensionEntries.map(
            ([key, meta]) => {
              const selected = selectedDimensions.includes(key);
              const count = summaries.filter((summary) => summary.key === key).length;
              return (
                <button
                  type="button"
                  key={key}
                  aria-pressed={selected}
                  onClick={() => toggleDimension(key)}
                  className={`flex items-center gap-1 rounded-full border px-2.5 py-1 font-semibold transition ${selected ? "shadow-sm" : "border-slate-200 bg-white text-slate-400"}`}
                  style={
                    selected
                      ? { color: meta.color, background: meta.soft, borderColor: meta.border }
                      : undefined
                  }
                >
                  <i className="h-2 w-2 rounded-full" style={{ background: selected ? meta.color : "#cbd5e1" }} />
                  {dimensionLabels[key]} {count}
                </button>
              );
            },
          )}
          <button
            type="button"
            onClick={() => setSelectedDimensions([...availableDimensions])}
            className="rounded-md px-2 py-1 font-semibold text-brand hover:bg-blue-50"
          >
            全选
          </button>
          <button
            type="button"
            onClick={() => setSelectedDimensions([])}
            className="rounded-md px-2 py-1 font-semibold text-slate-500 hover:bg-slate-100"
          >
            清空
          </button>
          <span className="ml-auto rounded-md bg-blue-50 px-2 py-1 text-[10px] text-blue-600">
            原文标注、总结卡片和连线同步筛选
          </span>
        </div>

        <div className="grid gap-2 xl:grid-cols-2">
          <NavigationBar
            label="待修改标记"
            count={flaggedSummaries.length}
            current={flaggedSummaries.findIndex((item) => item.id === activeSummaryId) + 1}
            inputValue={flagJumpValue}
            onInputChange={setFlagJumpValue}
            onPrevious={() => moveWithin(flaggedSummaries, -1)}
            onNext={() => moveWithin(flaggedSummaries, 1)}
            onJump={() => jumpByNumber(flaggedSummaries, flagJumpValue)}
            disabled={!flaggedSummaries.length}
          />
          <div className="flex flex-wrap items-center gap-2 rounded-lg border border-slate-200 bg-slate-50/70 px-3 py-2 text-[11px]">
            <select
              aria-label="选择总结维度"
              value={navigationDimension}
              onChange={(event) => {
                const dimension = event.target.value as DimensionKey;
                setNavigationDimension(dimension);
                ensureDimensionVisible(dimension);
                setDimensionJumpValue("1");
              }}
              className="rounded-md border border-slate-200 bg-white px-2 py-1.5 font-semibold text-slate-700 outline-none focus:border-blue-300"
            >
              {dimensionEntries.map(([key, meta]) => (
                <option key={key} value={key}>{dimensionLabels[key]}</option>
              ))}
            </select>
            <NavigationBar
              compact
              label={`${dimensionLabels[navigationDimension]}总结`}
              count={dimensionSummaries.length}
              current={dimensionSummaries.findIndex((item) => item.id === activeSummaryId) + 1}
              inputValue={dimensionJumpValue}
              onInputChange={setDimensionJumpValue}
              onPrevious={() => moveWithin(dimensionSummaries, -1)}
              onNext={() => moveWithin(dimensionSummaries, 1)}
              onJump={() => jumpByNumber(dimensionSummaries, dimensionJumpValue)}
              disabled={!dimensionSummaries.length}
            />
          </div>
        </div>
      </div>

      <div ref={viewportRef} className="scrollbar h-[635px] overflow-y-auto bg-slate-50/35">
        <div ref={contentRef} className="relative min-h-full">
          {selectionAction && (
            <SelectionToolbar
              selection={selectionAction}
              dimensions={selectionDimensions}
              onChange={onChangeSelection}
              onAnalyze={onAnalyzeSelection}
              onAppendAnnotation={onAppendSelectionAnnotation}
              onAsk={onAskSelection}
              onClose={onCloseSelection}
              pendingDimensionPlan={pendingSelectionDimensionPlan}
              onConfirmDimensionPlan={onConfirmSelectionDimensionPlan}
              onCancelDimensionPlan={onCancelSelectionDimensionPlan}
              pendingAgentPlan={pendingSelectionAgentPlan}
              onConfirmAgentPlan={onConfirmSelectionAgentPlan}
              onCancelAgentPlan={onCancelSelectionAgentPlan}
            />
          )}
          <div ref={rowsRef}>
          {visibleSegments.map((segment) => {
              const annotations = visibleSummaries.filter(
                (summary) => summary.evidenceId === segment.id,
              );
              const active = activeEvidence === segment.id;
              const editingThisSegment = editingSegmentId === segment.id;

              return (
                <div
                  key={segment.id}
                  className="grid grid-cols-[minmax(0,1fr)_72px_minmax(0,1fr)] border-b border-slate-100 last:border-b-0"
                >
                  <div className="p-4 pr-5">
                    <SourceSegmentCard
                      segment={segment}
                      annotations={annotations}
                      active={active}
                      editing={editingThisSegment}
                      draftText={segmentDraft}
                      editError={segmentEditError}
                      dimensionLabels={dimensionLabels}
                      activeSummaryId={activeSummaryId}
                      visibleSummaries={visibleSummaries}
                      manualAnnotationMeta={manualAnnotationMeta}
                      onMouseUp={() => handleSourceMouseUp(segment)}
                      onSelectAnnotation={selectAnnotation}
                      onStartEdit={() => beginSegmentEdit(segment)}
                      onChangeDraft={(value) => {
                        setSegmentDraft(value);
                        setSegmentEditError("");
                      }}
                      onSaveEdit={() => saveSegmentEdit(segment.id)}
                      onCancelEdit={cancelSegmentEdit}
                      onRestoreOriginal={() => onRestoreSegmentText(segment.id)}
                      onDelete={() => onDeleteSegment(segment.id)}
                      onRestoreDeleted={() => onRestoreDeletedSegment(segment.id)}
                      onOpenReplace={() => openReplacePanel("segment", segment.id)}
                    />
                  </div>

                  <div className="relative border-x border-slate-100 bg-white/70">
                    {annotations.length === 0 && (
                      <span className="absolute left-1/2 top-1/2 -translate-x-1/2 -translate-y-1/2 text-[9px] text-slate-300">
                        无注释
                      </span>
                    )}
                  </div>

                  <div className="space-y-3 p-4 pl-5">
                    {annotations.length === 0 ? (
                      <div className="flex min-h-20 items-center justify-center rounded-xl border border-dashed border-slate-200 text-[11px] text-slate-300">
                        本段暂未生成结构化总结
                      </div>
                    ) : (
                      <>
                        {annotations.map((item) => (
                          <SummaryCard
                            key={item.id}
                            item={item}
                            selected={activeSummaryId === item.id}
                            evidenceState={evidenceChangeState(item)}
                            manualAnnotationMeta={manualAnnotationMeta}
                            outputDimensionOptions={outputDimensionOptions}
                            dimensionOrder={dimensionOrder.get(item.id)}
                            summaryOrder={summaryOrder.get(item.id)}
                            flaggedOrder={flaggedOrder.get(item.id)}
                            onSelectSummary={onSelectSummary}
                            onUpdateSummary={onUpdateSummary}
                            onChangeLinkedDimension={onChangeSummaryLinkedDimension}
                            onToggleConfirmed={onToggleConfirmed}
                            onToggleExcluded={onToggleExcluded}
                            onToggleFlagged={onToggleFlagged}
                            onRestoreSummary={onRestoreSummary}
                            onDeleteSummary={onDeleteSummary}
                            onLocate={onLocate}
                          />
                        ))}
                      </>
                    )}
                  </div>
                </div>
              );
            })}
          {visibleSegments.length === 0 && (
            <div className="flex h-[220px] flex-col items-center justify-center gap-2 text-sm text-slate-400">
              <Icon name="file" className="h-8 w-8 text-slate-300" />
              <span>
                {transcripts.length
                  ? "当前筛选条件下没有可显示的原文或总结。"
                  : "请先上传TXT 文档，解析后的原文将在这里显示。"}
              </span>
            </div>
          )}
          </div>

          <ConnectorOverlayView
            connectors={connectors}
            canvasSize={canvasSize}
            activeSummaryId={activeSummaryId}
            summaries={summaries}
          />
        </div>
      </div>
    </div>
  );
}


function SelectionToolbar({
  selection,
  onAsk,
  onClose,
  pendingDimensionPlan,
  onConfirmDimensionPlan,
  onCancelDimensionPlan,
  pendingAgentPlan,
  onConfirmAgentPlan,
  onCancelAgentPlan,
}: {
  selection: SelectionAction;
  dimensions: AnalysisDimensionConfig[];
  onChange: (selection: SelectionAction) => void;
  onAnalyze: () => void;
  onAppendAnnotation: (note?: string) => void;
  onAsk: (prompt: string) => Promise<string | undefined>;
  onClose: () => void;
  pendingDimensionPlan: PendingSelectionDimensionPlan | null;
  onConfirmDimensionPlan: () => Promise<string | undefined>;
  onCancelDimensionPlan: () => void;
  pendingAgentPlan: AgentPlan | null;
  onConfirmAgentPlan: () => Promise<string | undefined>;
  onCancelAgentPlan: () => void;
}) {
  const [draft, setDraft] = useState("");
  const [messages, setMessages] = useState<Array<{ id: string; role: "user" | "assistant"; content: string }>>([]);
  const [loading, setLoading] = useState(false);
  const quickActions = [
    { label: "解释", prompt: "这段话在说什么？" },
    { label: "分析", prompt: "按当前维度分析这段话" },
    { label: "翻译", prompt: "翻译成英文" },
    { label: "批注", prompt: "加一段人工批注：" },
  ];

  async function sendPrompt(content: string) {
    if (!content.trim() || loading) return;
    const userMessage = {
      id: `selection-user-${Date.now()}`,
      role: "user" as const,
      content: content.trim(),
    };
    setMessages((current) => [...current, userMessage]);
    setLoading(true);
    try {
      const answer = await onAsk(content.trim());
      if (answer) {
        setMessages((current) => [
          ...current,
          {
            id: `selection-assistant-${Date.now()}`,
            role: "assistant",
            content: answer,
          },
        ]);
      }
    } catch (error) {
      setMessages((current) => [
        ...current,
        {
          id: `selection-error-${Date.now()}`,
          role: "assistant",
          content: error instanceof Error ? error.message : "AI 处理失败，请稍后再试。",
        },
      ]);
    } finally {
      setLoading(false);
    }
  }

  function submitPrompt(event: FormEvent) {
    event.preventDefault();
    const content = draft.trim();
    if (!content) return;
    setDraft("");
    void sendPrompt(content);
  }

  function useQuickAction(prompt: string) {
    if (prompt.endsWith("：")) {
      setDraft(prompt);
      return;
    }
    void sendPrompt(prompt);
  }

  async function confirmDimensionPlan() {
    if (loading) return;
    setLoading(true);
    try {
      const answer = await onConfirmDimensionPlan();
      if (answer) {
        setMessages((current) => [
          ...current,
          {
            id: `selection-confirm-${Date.now()}`,
            role: "assistant",
            content: answer,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  function cancelDimensionPlan() {
    onCancelDimensionPlan();
    setMessages((current) => [
      ...current,
      {
        id: `selection-cancel-${Date.now()}`,
        role: "assistant",
        content: "已取消新增维度。",
      },
    ]);
  }

  async function confirmAgentPlan() {
    if (loading) return;
    setLoading(true);
    try {
      const answer = await onConfirmAgentPlan();
      if (answer) {
        setMessages((current) => [
          ...current,
          {
            id: `selection-agent-confirm-${Date.now()}`,
            role: "assistant",
            content: answer,
          },
        ]);
      }
    } finally {
      setLoading(false);
    }
  }

  function cancelAgentPlan() {
    onCancelAgentPlan();
    setMessages((current) => [
      ...current,
      {
        id: `selection-agent-cancel-${Date.now()}`,
        role: "assistant",
        content: "已取消 Selection Agent 计划。",
      },
    ]);
  }

  return (
    <div
      className="absolute z-[80] w-[min(420px,calc(100%_-_32px))] rounded-2xl border border-slate-200 bg-white p-3 text-xs shadow-2xl shadow-slate-300/60"
      style={{
        left: selection.placement === "right"
          ? `max(16px, min(calc(100% - 440px), ${selection.x}px))`
          : selection.placement === "left"
            ? `max(16px, min(calc(100% - 440px), ${selection.x - 420}px))`
            : `max(16px, min(calc(100% - 440px), ${selection.x - 210}px))`,
        top: selection.placement === "below"
          ? `max(16px, ${selection.y}px)`
          : selection.placement === "above"
            ? `max(16px, ${selection.y - 280}px)`
            : `max(16px, ${selection.y}px)`,
      }}
    >
      <div className="flex items-start gap-2">
        <div className="min-w-0 flex-1">
          <p className="font-bold text-slate-700">已选择 {selection.chunkId}</p>
          <p className="mt-1 line-clamp-2 text-[11px] leading-5 text-slate-500">
            {selection.quote}
          </p>
        </div>
        <button
          type="button"
          onClick={onClose}
          className="rounded-md px-2 py-1 text-slate-400 hover:bg-slate-100"
          aria-label="关闭框选对话"
        >
          ×
        </button>
      </div>

      <form onSubmit={submitPrompt} className="mt-3 rounded-xl border border-slate-200 p-2 focus-within:border-emerald-300 focus-within:ring-4 focus-within:ring-emerald-50">
        {messages.length > 0 && (
          <div className="mb-2 max-h-36 space-y-2 overflow-y-auto pr-1">
            {messages.map((message) => (
              <div
                key={message.id}
                className={`flex ${message.role === "user" ? "justify-end" : "justify-start"}`}
              >
                <div
                  className={`max-w-[86%] rounded-2xl px-3 py-2 text-[11px] leading-5 ${
                    message.role === "user"
                      ? "rounded-br-md bg-emerald-100 text-emerald-800"
                      : "rounded-bl-md bg-slate-100 text-slate-700"
                  }`}
                >
                  {message.content}
                </div>
              </div>
            ))}
            {loading && (
              <div className="flex justify-start">
                <div className="rounded-2xl rounded-bl-md bg-slate-100 px-3 py-2 text-[11px] text-slate-500">
                  AI 正在处理…
                </div>
              </div>
            )}
          </div>
        )}
        {pendingDimensionPlan && (
          <div className="mb-2 rounded-xl border border-violet-200 bg-violet-50 p-3 text-[11px] leading-5 text-slate-700">
            <p className="font-semibold text-violet-700">
              {pendingDimensionPlan.action === "enable"
                ? `当前“${pendingDimensionPlan.dimensionLabel}”阅读维度已关闭，是否启用该维度，并用它分析当前框选内容？`
                : `当前没有“${pendingDimensionPlan.dimensionLabel}”阅读维度，是否新增该维度，并用它分析当前框选内容？`}
            </p>
            <div className="mt-2 flex justify-end gap-2">
              <button
                type="button"
                onClick={cancelDimensionPlan}
                disabled={loading}
                className="rounded-lg bg-white px-2.5 py-1.5 font-semibold text-slate-500 hover:bg-slate-100 disabled:text-slate-300"
              >
                取消
              </button>
              <button
                type="button"
                onClick={() => void confirmDimensionPlan()}
                disabled={loading}
                className="rounded-lg bg-violet-600 px-2.5 py-1.5 font-semibold text-white hover:bg-violet-700 disabled:bg-slate-300"
              >
                {pendingDimensionPlan.action === "enable" ? "启用并分析" : "新增并分析"}
              </button>
            </div>
          </div>
        )}
        {pendingAgentPlan && (
          <div className="mb-2">
            <AgentPlanCard
              plan={pendingAgentPlan}
              loading={loading}
              onCancel={cancelAgentPlan}
              onConfirm={() => void confirmAgentPlan()}
            />
          </div>
        )}
        <textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          rows={2}
          placeholder="问 AI：按某个维度分析、翻译成某语言、加批注，或解释这段话..."
          className="w-full resize-none border-0 px-1 text-xs leading-5 text-slate-700 outline-none"
        />
        <div className="mt-1 flex justify-end">
          <button
            type="submit"
            disabled={!draft.trim() || loading}
            className="rounded-lg bg-slate-800 px-3 py-1.5 text-[11px] font-semibold text-white disabled:bg-slate-300"
          >
            发送
          </button>
        </div>
      </form>

      <div className="mt-2 flex flex-wrap gap-1.5">
        {quickActions.map((action) => (
          <button
            key={action.label}
            type="button"
            onClick={() => useQuickAction(action.prompt)}
            className="rounded-full bg-slate-100 px-3 py-1.5 text-[11px] font-medium text-slate-600 hover:bg-slate-200"
          >
            {action.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function documentTypeLabel(value: string) {
  const labels: Record<string, string> = {
    meeting: "会议文档",
    generic_text: "普通文本",
    policy: "政策文件",
    contract: "合同",
    report: "报告",
    paper: "论文",
    requirement: "需求文档",
    other: "其他文档",
  };
  return labels[value] ?? "普通文本";
}

function formatDocumentTime(value: string) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return new Intl.DateTimeFormat("zh-CN", {
    year: "numeric",
    month: "long",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  }).format(date);
}
