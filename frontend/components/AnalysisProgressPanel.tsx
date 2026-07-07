import { Icon } from "@/components/icons";
import type { AnalysisNoResult } from "@/lib/types";

export type AnalysisProgressState = {
  status: "running" | "succeeded" | "no_result" | "failed";
  scopeLabel: string;
  dimensionLabels: string[];
  chunkCount: number;
  mergeModeLabel: string;
  progress: number;
  addedCount?: number;
  noResults?: AnalysisNoResult[];
  error?: string;
};

function formatDimensionList(labels: string[]) {
  if (!labels.length) return "未选择维度";
  if (labels.length <= 4) return labels.join("、");
  return `${labels.slice(0, 4).join("、")} 等 ${labels.length} 个维度`;
}

function progressStage(progress: AnalysisProgressState) {
  if (progress.status === "failed") return "分析失败";
  if (progress.status === "succeeded") return "分析完成";
  if (progress.status === "no_result") return "分析完成，无匹配内容";
  if (progress.progress < 30) return "准备分析任务";
  if (progress.progress < 60) return "正在调用 AI";
  if (progress.progress < 85) return "正在等待结构化结果";
  return "正在合并总结卡片";
}

export function AnalysisProgressPanel({ progress }: { progress: AnalysisProgressState }) {
  const stage = progressStage(progress);
  const isRunning = progress.status === "running";
  const noResults = progress.noResults ?? [];
  return (
    <div className="mt-3 rounded-2xl border border-blue-100 bg-gradient-to-br from-blue-50 to-white p-4 shadow-sm">
      <div className="flex items-start gap-3">
        <span
          className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
            progress.status === "failed"
              ? "bg-rose-100 text-rose-600"
              : progress.status === "no_result"
                ? "bg-amber-100 text-amber-600"
                : "bg-blue-100 text-brand"
          }`}
        >
          <Icon name={isRunning ? "spark" : progress.status === "failed" ? "refresh" : "check"} className="h-5 w-5" />
        </span>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div>
              <p className="text-sm font-bold text-slate-800">
                {isRunning ? "AI 正在分析，请稍候…" : stage}
              </p>
              <p className="mt-1 text-[11px] text-slate-500">
                当前阶段：{stage}。长文本或维度较多时可能需要 30 秒到 2 分钟。
              </p>
            </div>
            <span className="rounded-full bg-white px-2.5 py-1 text-[11px] font-semibold text-blue-700 shadow-sm">
              {isRunning ? "处理中" : progress.status === "failed" ? "失败" : "已完成"}
            </span>
          </div>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-blue-100">
            <div
              className={`h-full rounded-full transition-all duration-700 ${
                progress.status === "failed"
                  ? "bg-rose-400"
                  : progress.status === "no_result"
                    ? "bg-amber-400"
                    : "bg-brand"
              }`}
              style={{ width: `${progress.progress}%` }}
            />
          </div>
          <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
            <p>分析范围：{progress.scopeLabel}</p>
            <p>文档段落：{progress.chunkCount} 段</p>
            <p>使用维度：{formatDimensionList(progress.dimensionLabels)}</p>
            <p>合并方式：{progress.mergeModeLabel}</p>
          </div>
          {progress.status === "succeeded" && (
            <div className="mt-3 space-y-1 text-[11px] font-medium text-emerald-700">
              <p>✅ 已使用 {progress.dimensionLabels.length} 个维度分析{progress.scopeLabel}</p>
              <p>✅ 新增 {progress.addedCount ?? 0} 条总结卡片</p>
              <p>✅ 结果已追加，未覆盖已有总结</p>
            </div>
          )}
          {progress.status === "no_result" && (
            <div className="mt-3 space-y-1 text-[11px] font-medium text-amber-700">
              {noResults.length ? (
                noResults.map((item, index) => (
                  <p key={`${item.dimension}-${item.title}-${index}`}>
                    ℹ️ 未发现“{item.title}”相关内容{item.reason ? `。原因：${item.reason}` : ""}
                  </p>
                ))
              ) : (
                <p>ℹ️ 未发现符合当前维度定义的内容</p>
              )}
              <p>✅ 未新增总结卡片，未覆盖已有总结</p>
            </div>
          )}
          {progress.status === "failed" && (
            <div className="mt-3 space-y-1 text-[11px] font-medium text-rose-700">
              <p>❌ 原因：{progress.error ?? "AI 分析失败。"}</p>
              <p>建议：请稍后重试，或减少维度数量后再分析。</p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
