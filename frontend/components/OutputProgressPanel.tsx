import { Icon } from "@/components/icons";

export type OutputProgressState = {
  status: "running" | "succeeded" | "failed";
  confirmedCount: number;
  summaryCount: number;
  progress: number;
  outputLength?: number;
  error?: string;
};

function outputProgressStage(progress: OutputProgressState) {
  if (progress.status === "failed") return "生成失败";
  if (progress.status === "succeeded") return "输出结果已生成";
  if (progress.progress < 35) return "正在收集已确认总结";
  if (progress.progress < 70) return "正在组织输出结构";
  if (progress.progress < 90) return "正在等待 AI 生成草稿";
  return "正在写入输出结果";
}

export function OutputProgressPanel({ progress }: { progress: OutputProgressState }) {
  const stage = outputProgressStage(progress);
  const isRunning = progress.status === "running";
  return (
    <div className="border-b border-slate-100 bg-emerald-50/60 px-4 py-3">
      <div className="rounded-2xl border border-emerald-100 bg-white p-4 shadow-sm">
        <div className="flex items-start gap-3">
          <span
            className={`mt-0.5 flex h-9 w-9 items-center justify-center rounded-xl ${
              progress.status === "failed"
                ? "bg-rose-100 text-rose-600"
                : "bg-emerald-100 text-emerald-600"
            }`}
          >
            <Icon name={isRunning ? "spark" : progress.status === "failed" ? "refresh" : "check"} className="h-5 w-5" />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <div>
                <p className="text-sm font-bold text-slate-800">
                  {isRunning ? "正在生成输出结果，请稍候…" : stage}
                </p>
                <p className="mt-1 text-[11px] text-slate-500">
                  当前阶段：{stage}。会基于已确认总结生成可编辑草稿，不会修改原始总结卡片。
                </p>
              </div>
              <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-[11px] font-semibold text-emerald-700">
                {isRunning ? "生成中" : progress.status === "failed" ? "失败" : "已完成"}
              </span>
            </div>
            <div className="mt-3 h-2 overflow-hidden rounded-full bg-emerald-100">
              <div
                className={`h-full rounded-full transition-all duration-700 ${
                  progress.status === "failed" ? "bg-rose-400" : "bg-emerald-500"
                }`}
                style={{ width: `${progress.progress}%` }}
              />
            </div>
            <div className="mt-3 grid gap-2 text-[11px] text-slate-600 sm:grid-cols-2">
              <p>输入来源：{progress.confirmedCount} 条已确认总结</p>
              <p>总结总数：{progress.summaryCount} 条</p>
              <p>输出方式：生成可编辑草稿</p>
              <p>覆盖情况：不覆盖总结卡片</p>
            </div>
            {progress.status === "succeeded" && (
              <div className="mt-3 space-y-1 text-[11px] font-medium text-emerald-700">
                <p>✅ 已基于 {progress.confirmedCount} 条已确认总结生成输出结果</p>
                <p>✅ 草稿字数：{progress.outputLength ?? 0}</p>
                <p>✅ 原总结卡片未被修改</p>
              </div>
            )}
            {progress.status === "failed" && (
              <div className="mt-3 space-y-1 text-[11px] font-medium text-rose-700">
                <p>❌ 原因：{progress.error ?? "输出结果生成失败。"}</p>
                <p>建议：请确认至少有一条已确认总结，或稍后重试。</p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
