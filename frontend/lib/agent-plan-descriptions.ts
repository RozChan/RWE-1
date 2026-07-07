import type {
  AgentOperation,
  AgentOperationResult,
  AgentPlan,
  AnalysisMergeMode,
  AnalysisNoResult,
  AnalysisScope,
} from "@/lib/types";

export function describeConfigOperationResult(operation: AgentOperation) {
  if (operation.type === "add_dimension") return `已新增“${operation.params.label ?? "新"}”维度。`;
  if (operation.type === "enable_dimension") return "维度已启用。";
  if (operation.type === "disable_dimension") return "维度已停用。";
  if (operation.type === "delete_dimension") return "维度已删除。";
  if (operation.type === "update_dimension") return "维度配置已更新。";
  return "维度配置已更新。";
}

export function buildConfigOperationDetails(operation: AgentOperation) {
  if (operation.type === "add_dimension") {
    const details = [`已新增“${operation.params.label ?? "新"}”维度`];
    if (operation.params.description) {
      details.push(`已使用推荐描述：${operation.params.description}`);
    }
    details.push("未覆盖已有总结");
    return details;
  }
  if (operation.type === "enable_dimension") return ["已启用目标阅读维度", "未覆盖已有总结"];
  if (operation.type === "disable_dimension") return ["已停用目标阅读维度", "未覆盖已有总结"];
  if (operation.type === "delete_dimension") return ["已删除目标阅读维度配置", "已有总结卡片不会被删除", "后续 AI 分析不会再使用该维度"];
  if (operation.type === "update_dimension") {
    const details = ["已更新目标阅读维度"];
    if (operation.params.label) details.push(`名称改为“${operation.params.label}”`);
    if (operation.params.description) details.push(`说明改为：${operation.params.description}`);
    details.push("未覆盖已有总结");
    return details;
  }
  return ["维度配置已更新"];
}

export function describeAnalysisScope(scope: AnalysisScope | null | undefined) {
  if (!scope) return "未指定分析范围";
  if (scope.type === "all_enabled_dimensions") return "全文 · 所有启用维度";
  if (scope.type === "selected_dimensions") {
    const labels = scope.dimensionLabels?.filter(Boolean);
    const keys = scope.dimensionKeys?.filter(Boolean);
    const target = labels?.length ? labels.join("、") : keys?.length ? keys.join("、") : "指定维度";
    return `全文 · 仅 ${target}`;
  }
  if (scope.type === "new_dimension_only") {
    return `全文 · 仅新增维度${scope.dimensionLabel ? `“${scope.dimensionLabel}”` : ""}`;
  }
  if (scope.type === "current_dimension_only") return "全文 · 当前指定维度";
  return "全文 · 安全默认范围";
}

export function describeMergeMode(mode: AnalysisMergeMode | null | undefined) {
  if (!mode || mode === "append_results") return "追加结果";
  if (mode === "replace_ai_results") return "替换 AI 结果";
  if (mode === "replace_same_dimensions") return "替换相同维度";
  if (mode === "new_version") return "生成新版本";
  return "按计划合并";
}

function analysisScopeActionText(scope: AnalysisScope | null | undefined) {
  if (!scope) return "已按计划分析全文";
  if (scope.type === "new_dimension_only") {
    return `已仅使用${scope.dimensionLabel ? `“${scope.dimensionLabel}”` : "新增"}维度分析全文`;
  }
  if (scope.type === "selected_dimensions") {
    const labels = scope.dimensionLabels?.filter(Boolean);
    const keys = scope.dimensionKeys?.filter(Boolean);
    const target = labels?.length ? labels.join("、") : keys?.length ? keys.join("、") : "指定维度";
    return `已仅使用“${target}”维度分析全文`;
  }
  if (scope.type === "current_dimension_only") {
    const target = scope.dimensionKey ?? "当前指定";
    return `已仅使用“${target}”维度分析全文`;
  }
  return "已按当前所有启用维度分析全文";
}

function mergeModeResultText(mode: AnalysisMergeMode | null | undefined) {
  if (!mode || mode === "append_results") return "结果已追加，未覆盖已有总结";
  if (mode === "replace_same_dimensions") return "结果已按相同维度替换旧 AI 总结";
  if (mode === "replace_ai_results") return "结果已替换旧 AI 总结";
  if (mode === "new_version") return "结果已生成新版本";
  return "结果已按计划合并";
}

export function buildRunAnalysisResultDetails(
  operation: AgentOperation,
  result: { addedCount: number; noResults: AnalysisNoResult[] },
) {
  const details = [analysisScopeActionText(operation.params.analysisScope)];
  if (result.addedCount > 0) {
    details.push(`新增 ${result.addedCount} 条总结卡片`);
  } else if (result.noResults.length) {
    for (const item of result.noResults) {
      details.push(`未发现“${item.title}”相关内容`);
      if (item.reason) details.push(`原因：${item.reason}`);
    }
    details.push("未新增总结卡片");
  } else {
    details.push("分析已完成，但未新增总结卡片");
  }
  details.push(mergeModeResultText(operation.params.mergeMode));
  return details;
}

export function buildFailedOperationDetails(operation: AgentOperation, message: string) {
  const details = [`${operation.title}失败：${message}`];
  if (operation.type === "run_analysis") {
    details.push("建议：稍后可直接输入“用该维度分析全文”重试，系统会复用已有维度，不会重复新增。");
  }
  return details;
}

function resultLinePrefix(result: AgentOperationResult, detail: string) {
  if (result.status === "failed") return "❌";
  if (result.status === "skipped") return "○";
  if (detail.startsWith("未发现") || detail.startsWith("原因：")) return "ℹ️";
  if (result.status === "succeeded") return "✅";
  return "⏳";
}

export function buildAgentExecutionFeedback(
  plan: AgentPlan,
  results: AgentOperationResult[],
  failed: boolean,
  succeededCount: number,
) {
  const lines = [
    failed
      ? succeededCount > 0
        ? "部分完成："
        : "执行遇到问题："
      : "已完成：",
  ];
  for (const operation of plan.operations) {
    const result = results.find((item) => item.operationId === operation.id);
    if (!result || result.status === "pending") continue;
    const details = result.details?.length ? result.details : [result.message];
    for (const detail of details) {
      lines.push(`${resultLinePrefix(result, detail)} ${detail}`);
    }
  }
  const hasRunAnalysis = plan.operations.some((operation) => operation.type === "run_analysis");
  if (!hasRunAnalysis && !failed) {
    lines.push("✅ 未触发全文分析");
  }
  if (failed && succeededCount > 0) {
    lines.push("⚠️ 已成功的步骤会保留，请根据失败步骤稍后重试。");
  }
  return lines.join("\n");
}

export function describeOperationImpact(operation: AgentOperation) {
  if (operation.type === "run_selection_analysis") {
    return {
      scope: "当前选区",
      merge: describeMergeMode(operation.params.mergeMode),
      overwrite: "不影响全文分析结果",
    };
  }
  if (operation.type === "run_analysis") {
    const mergeMode = operation.params.mergeMode ?? "append_results";
    return {
      scope: describeAnalysisScope(operation.params.analysisScope),
      merge: describeMergeMode(mergeMode),
      overwrite: mergeMode === "append_results" ? "不覆盖已有总结" : "会按合并方式影响旧结果",
    };
  }
  if (operation.type === "add_dimension" || operation.type === "update_dimension" || operation.type === "enable_dimension" || operation.type === "disable_dimension" || operation.type === "delete_dimension") {
    return {
      scope: "阅读维度配置",
      merge: "不生成分析结果",
      overwrite: "不覆盖已有总结",
    };
  }
  if (operation.type === "generate_output") {
    return {
      scope: "最终输出草稿",
      merge: "基于已确认总结生成",
      overwrite: "不改动总结卡片",
    };
  }
  if (operation.type === "export_word" || operation.type === "export_txt") {
    return {
      scope: "当前输出草稿",
      merge: "仅导出文件",
      overwrite: "不改动页面内容",
    };
  }
  return {
    scope: "对话回复",
    merge: "不改动页面状态",
    overwrite: "不覆盖已有内容",
  };
}
