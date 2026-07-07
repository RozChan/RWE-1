import { Icon } from "@/components/icons";
import { OutputProgressPanel, type OutputProgressState } from "@/components/OutputProgressPanel";
import type { EditableSummary } from "@/lib/store";

type FinalOutputPanelProps = {
  outputDraft: string;
  outputStale: boolean;
  outputGeneratedAt: string;
  outputProgress: OutputProgressState | null;
  summaries: EditableSummary[];
  generationStatus: string;
  copied: boolean;
  onGenerateOutput: () => void;
  onCopyOutput: () => void;
  onChangeOutputDraft: (value: string) => void;
  onExportWord: () => void;
  onExportTxt: () => void;
};

export function FinalOutputPanel({
  outputDraft,
  outputStale,
  outputGeneratedAt,
  outputProgress,
  summaries,
  generationStatus,
  copied,
  onGenerateOutput,
  onCopyOutput,
  onChangeOutputDraft,
  onExportWord,
  onExportTxt,
}: FinalOutputPanelProps) {
  const hasConfirmedSummaries = summaries.some((item) => item.status === "confirmed");
  const isGenerating = generationStatus === "loading";

  return (
    <section data-testid="final-output-panel" className="grid grid-cols-1 gap-3 px-4 pb-6 pt-3 xl:grid-cols-[1fr_220px]">
      <div className="overflow-hidden rounded-xl border border-slate-200 bg-white shadow-panel">
        <div className="flex items-center border-b border-slate-100 px-4 py-3">
          <div>
            <h2 className="text-sm font-bold">
              输出结果{" "}
              <span className="text-[11px] font-normal text-slate-400">
                （可编辑）
              </span>
            </h2>
            <p className="mt-0.5 text-[10px] text-slate-400">
              由已确认的结构化总结生成，可继续人工调整
            </p>
          </div>
          <div className="ml-auto flex items-center gap-2">
            {outputStale && summaries.length > 0 && (
              <span className="rounded-md bg-amber-50 px-2 py-1 text-[11px] font-medium text-amber-700">
                总结已更新，请重新生成输出
              </span>
            )}
            <span className="text-[11px] text-slate-400">
              生成时间：{outputGeneratedAt}
            </span>
            <button
              onClick={onGenerateOutput}
              disabled={!hasConfirmedSummaries || isGenerating}
              className="flex items-center gap-1.5 rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
            >
              <Icon name="spark" className="h-4 w-4" />
              {isGenerating ? "正在生成，请稍候" : "生成输出结果"}
            </button>
            <button
              onClick={onCopyOutput}
              className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-xs font-semibold hover:bg-slate-50"
            >
              {copied ? (
                <Icon name="check" className="h-4 w-4 text-emerald-500" />
              ) : (
                <Icon name="copy" className="h-4 w-4" />
              )}
              {copied ? "已复制" : "复制输出"}
            </button>
          </div>
        </div>
        {outputProgress && <OutputProgressPanel progress={outputProgress} />}
        <div className="flex h-9 items-center gap-4 border-b border-slate-100 px-4 text-xs text-slate-400">
          <strong className="text-slate-700">B</strong>
          <em>I</em>
          <u>U</u>
          <span>☷</span>
          <span>≡</span>
          <span>↶</span>
          <span>↷</span>
        </div>
        <textarea
          value={outputDraft}
          onChange={(event) => onChangeOutputDraft(event.target.value)}
          className="min-h-[300px] w-full resize-y border-0 px-6 py-5 text-sm leading-7 text-slate-700 outline-none"
          spellCheck={false}
        />
        <div className="border-t border-slate-100 px-4 py-2 text-right text-[11px] text-slate-400">
          字数：{outputDraft.length}
        </div>
      </div>
      <aside className="rounded-xl border border-slate-200 bg-white p-4 shadow-panel">
        <h2 className="text-sm font-bold">操作</h2>
        <div className="mt-4 space-y-2">
          <button
            type="button"
            onClick={onExportWord}
            disabled={!outputDraft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-brand px-3 py-2.5 text-xs font-semibold text-white shadow-md shadow-blue-200 hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300 disabled:shadow-none"
          >
            <Icon name="export" className="h-4 w-4" />
            导出 Word
          </button>
          <button
            type="button"
            onClick={onExportTxt}
            disabled={!outputDraft.trim()}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-rose-500 px-3 py-2.5 text-xs font-semibold text-white hover:bg-rose-600 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Icon name="export" className="h-4 w-4" />
            导出 TXT
          </button>
          <button
            onClick={onCopyOutput}
            className="flex w-full items-center justify-center gap-2 rounded-lg bg-teal-600 px-3 py-2.5 text-xs font-semibold text-white"
          >
            <Icon name="copy" className="h-4 w-4" />
            复制全部内容
          </button>
        </div>
      </aside>
    </section>
  );
}
