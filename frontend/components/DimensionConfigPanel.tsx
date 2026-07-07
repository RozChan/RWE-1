import { Icon } from "@/components/icons";
import {
  AnalysisProgressPanel,
  type AnalysisProgressState,
} from "@/components/AnalysisProgressPanel";
import { dimensionMeta, type DimensionKey } from "@/lib/mock-data";
import type { AnalysisDimensionConfig } from "@/lib/types";
import type { EditableSummary } from "@/lib/store";

type DimensionConfigPanelProps = {
  dimensionEditing: boolean;
  dimensionConfigConfirmed: boolean;
  dimensionDrafts: AnalysisDimensionConfig[];
  activeConfirmedDimensions: AnalysisDimensionConfig[];
  dimensionConfigError: string;
  analysisStatus: string;
  analyzableChunkCount: number;
  editedSegmentCount: number;
  deletedSegmentCount: number;
  summaries: EditableSummary[];
  analysisProgress: AnalysisProgressState | null;
  onBeginEditing: () => void;
  onRunAnalysis: () => void;
  onUpdateDimensionDraft: (
    key: DimensionKey,
    patch: Partial<AnalysisDimensionConfig>,
  ) => void;
  onRemoveDimensionDraft: (key: DimensionKey) => void;
  onAddDimensionDraft: () => void;
  onRestoreDefaultDimensions: () => void;
  onConfirmDimensionConfig: () => void;
};

export function DimensionConfigPanel({
  dimensionEditing,
  dimensionConfigConfirmed,
  dimensionDrafts,
  activeConfirmedDimensions,
  dimensionConfigError,
  analysisStatus,
  analyzableChunkCount,
  editedSegmentCount,
  deletedSegmentCount,
  summaries,
  analysisProgress,
  onBeginEditing,
  onRunAnalysis,
  onUpdateDimensionDraft,
  onRemoveDimensionDraft,
  onAddDimensionDraft,
  onRestoreDefaultDimensions,
  onConfirmDimensionConfig,
}: DimensionConfigPanelProps) {
  const isAnalyzing = analysisStatus === "loading";

  return (
    <div
      data-testid="dimension-config-panel"
      className="border-t border-slate-100 bg-slate-50/50 px-4 py-3"
    >
      <div className="flex flex-wrap items-center gap-3">
        <div>
          <div className="flex items-center gap-2">
            <h2 className="text-sm font-bold">AI 分析配置</h2>
            <span
              className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${dimensionConfigConfirmed ? "bg-emerald-50 text-emerald-700" : "bg-amber-50 text-amber-700"}`}
            >
              {dimensionConfigConfirmed ? "已确认" : "待确认"}
            </span>
          </div>
          <p className="mt-0.5 text-[10px] text-slate-400">
            先确定分析维度，再主动调用大模型；上传文档 不会自动分析
          </p>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {!dimensionEditing && (
            <button
              type="button"
              onClick={onBeginEditing}
              className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:border-blue-200 hover:text-brand"
            >
              编辑维度
            </button>
          )}
          <button
            type="button"
            onClick={onRunAnalysis}
            disabled={
              !analyzableChunkCount ||
              !dimensionConfigConfirmed ||
              isAnalyzing ||
              !activeConfirmedDimensions.length
            }
            title={
              !analyzableChunkCount
                ? "当前没有可分析的原文内容。"
                : !activeConfirmedDimensions.length
                  ? "请先添加或启用至少一个阅读维度后再进行 AI 分析。"
                  : undefined
            }
            className="flex items-center gap-1.5 rounded-lg bg-brand px-4 py-2 text-xs font-semibold text-white shadow-sm hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
          >
            <Icon name="spark" className="h-4 w-4" />
            {isAnalyzing
              ? "正在分析，请稍候"
              : summaries.length
                ? "按当前配置重新分析"
                : "开始 AI 分析"}
          </button>
        </div>
      </div>
      {dimensionConfigConfirmed && !activeConfirmedDimensions.length && (
        <p className="mt-2 text-[11px] font-medium text-amber-600">
          请先添加或启用至少一个阅读维度后再进行 AI 分析。
        </p>
      )}
      {(editedSegmentCount > 0 || deletedSegmentCount > 0) && (
        <p className="mt-2 rounded-lg bg-amber-50 px-3 py-2 text-[11px] font-medium text-amber-700">
          当前原文包含 {editedSegmentCount} 处手动修改、{deletedSegmentCount} 处删除。AI 将基于修改后的原文进行分析，并跳过已删除段落。
        </p>
      )}
      {analysisProgress && <AnalysisProgressPanel progress={analysisProgress} />}

      {dimensionEditing ? (
        <div className="mt-3">
          <div className="grid gap-2 lg:grid-cols-2 xl:grid-cols-3">
            {dimensionDrafts.map((dimension) => {
              const meta = dimensionMeta[dimension.key];
              return (
                <div
                  key={dimension.key}
                  className={`rounded-xl border bg-white p-3 transition ${dimension.enabled ? "shadow-sm" : "opacity-60"}`}
                  style={{ borderColor: dimension.enabled ? meta.border : "#e2e8f0" }}
                >
                  <div className="flex items-center gap-2">
                    <button
                      type="button"
                      role="switch"
                      aria-checked={dimension.enabled}
                      onClick={() =>
                        onUpdateDimensionDraft(dimension.key, {
                          enabled: !dimension.enabled,
                        })
                      }
                      className={`relative h-5 w-9 rounded-full transition ${dimension.enabled ? "bg-brand" : "bg-slate-200"}`}
                    >
                      <span
                        className={`absolute top-0.5 h-4 w-4 rounded-full bg-white shadow transition ${dimension.enabled ? "left-[18px]" : "left-0.5"}`}
                      />
                    </button>
                    <input
                      value={dimension.label}
                      disabled={!dimension.enabled}
                      maxLength={20}
                      onChange={(event) =>
                        onUpdateDimensionDraft(dimension.key, {
                          label: event.target.value,
                        })
                      }
                      className="min-w-0 flex-1 rounded-md border border-slate-200 px-2 py-1.5 text-xs font-bold text-slate-700 outline-none focus:border-blue-300 disabled:bg-slate-100"
                      aria-label={`${dimensionMeta[dimension.key].label}维度名称`}
                    />
                    <span className="text-[10px] text-slate-400">
                      {dimension.enabled ? "启用" : "停用"}
                    </span>
                    <button
                      type="button"
                      onClick={() => onRemoveDimensionDraft(dimension.key)}
                      className="rounded px-1.5 py-1 text-[10px] font-semibold text-rose-500 hover:bg-rose-50"
                      aria-label={`删除${dimension.label}维度`}
                    >
                      删除
                    </button>
                  </div>
                  <textarea
                    value={dimension.description}
                    disabled={!dimension.enabled}
                    maxLength={100}
                    rows={2}
                    onChange={(event) =>
                      onUpdateDimensionDraft(dimension.key, {
                        description: event.target.value,
                      })
                    }
                    className="mt-2 w-full resize-none rounded-lg border border-slate-200 px-2.5 py-2 text-[11px] leading-5 text-slate-600 outline-none focus:border-blue-300 disabled:bg-slate-100"
                    aria-label={`${dimension.label}分析说明`}
                  />
                </div>
              );
            })}
          </div>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <span className="text-[11px] text-slate-500">
              已启用 {dimensionDrafts.filter((item) => item.enabled).length} 个维度
            </span>
            <span className="text-[10px] text-slate-400">
              可添加、删除、停用、改名和修改说明，最少 0 个，不设数量硬上限
            </span>
            {dimensionConfigError && (
              <span className="text-[11px] font-medium text-rose-600">
                {dimensionConfigError}
              </span>
            )}
            <button
              type="button"
              onClick={onAddDimensionDraft}
              disabled={false}
              className="ml-auto rounded-lg border border-blue-200 bg-blue-50 px-3 py-2 text-xs font-semibold text-brand hover:bg-blue-100 disabled:cursor-not-allowed disabled:border-slate-200 disabled:bg-slate-100 disabled:text-slate-400"
            >
              + 添加维度
            </button>
            <button
              type="button"
              onClick={onRestoreDefaultDimensions}
              className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
            >
              恢复默认
            </button>
            <button
              type="button"
              onClick={onConfirmDimensionConfig}
              className="rounded-lg bg-emerald-600 px-4 py-2 text-xs font-semibold text-white hover:bg-emerald-700"
            >
              确认分析配置
            </button>
          </div>
        </div>
      ) : (
        <div className="mt-3 flex flex-wrap gap-2">
          {activeConfirmedDimensions.map((dimension) => (
            <span
              key={dimension.key}
              className="rounded-full border px-2.5 py-1 text-[11px] font-semibold"
              style={{
                color: dimensionMeta[dimension.key].color,
                backgroundColor: dimensionMeta[dimension.key].soft,
                borderColor: dimensionMeta[dimension.key].border,
              }}
              title={dimension.description}
            >
              {dimension.label}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}
