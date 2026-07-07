import { Icon } from "@/components/icons";
import { EvidenceChangeNotice, type EvidenceChangeState } from "@/components/EvidenceChangeNotice";
import { ManualAnnotationDimensionSelect } from "@/components/ManualAnnotationDimensionSelect";
import { dimensionMeta, type DimensionKey, type Summary } from "@/lib/mock-data";
import type { EditableSummary } from "@/lib/store";
import type { AnalysisDimensionConfig } from "@/lib/types";

type ManualAnnotationMeta = {
  color: string;
  soft: string;
  label: string;
};

type SummaryCardProps = {
  item: EditableSummary;
  selected: boolean;
  evidenceState: EvidenceChangeState;
  manualAnnotationMeta: ManualAnnotationMeta;
  outputDimensionOptions: AnalysisDimensionConfig[];
  dimensionOrder?: number;
  summaryOrder?: number;
  flaggedOrder?: number;
  onSelectSummary: (summary: Summary) => void;
  onUpdateSummary: (id: string, summary: string) => void;
  onChangeLinkedDimension: (
    id: string,
    linkedDimensionKey: DimensionKey | null,
    linkedDimensionLabel: string | null,
  ) => void;
  onToggleConfirmed: (id: string) => void;
  onToggleExcluded: (id: string) => void;
  onToggleFlagged: (id: string) => void;
  onRestoreSummary: (id: string) => void;
  onDeleteSummary: (id: string) => void;
  onLocate: (summary: Summary) => void;
};

export function SummaryCard({
  item,
  selected,
  evidenceState,
  manualAnnotationMeta,
  outputDimensionOptions,
  dimensionOrder,
  summaryOrder,
  flaggedOrder,
  onSelectSummary,
  onUpdateSummary,
  onChangeLinkedDimension,
  onToggleConfirmed,
  onToggleExcluded,
  onToggleFlagged,
  onRestoreSummary,
  onDeleteSummary,
  onLocate,
}: SummaryCardProps) {
  const manual = item.source === "manual";
  const meta = manual ? manualAnnotationMeta : dimensionMeta[item.key];
  const excluded = item.status === "excluded";
  const confirmed = item.status === "confirmed";

  return (
    <article
      id={`summary-${item.id}`}
      data-summary-id={item.id}
      className={`scroll-mt-28 rounded-xl border-l-[3px] p-4 shadow-sm transition ${excluded ? "bg-slate-50 opacity-75" : "bg-white"} ${selected ? "ring-2 ring-blue-100 shadow-md" : "border-y border-r border-slate-100"}`}
      style={{
        borderLeftColor: excluded ? "#94a3b8" : meta.color,
      }}
    >
      <div className="flex flex-wrap items-center gap-2">
        <span
          className="rounded-md px-2 py-1 text-[10px] font-bold text-white"
          style={{ background: meta.color }}
        >
          {item.title} #{dimensionOrder}
        </span>
        <span className="rounded-full bg-slate-100 px-2 py-0.5 text-[10px] font-semibold text-slate-500">
          总序 {summaryOrder}
        </span>
        {item.flagged && (
          <span className="rounded-full bg-amber-100 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            标记 #{flaggedOrder}
          </span>
        )}
        <span className="text-[10px] text-slate-400">
          来自{" "}
          {Array.from(
            new Set(item.evidences.map((evidence) => evidence.segment_id)),
          ).join("、")}
        </span>
        <span
          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
            confirmed
              ? "bg-emerald-50 text-emerald-700"
              : excluded
                ? "bg-slate-200 text-slate-600"
                : "bg-amber-50 text-amber-700"
          }`}
        >
          {confirmed ? "已确认" : excluded ? "已排除" : "待确认"}
        </span>
        {item.source === "selection_ai" && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-brand">
            框选 AI 分析
          </span>
        )}
        {item.editedByUser && !manual && (
          <span className="rounded-full bg-blue-50 px-2 py-0.5 text-[10px] font-semibold text-brand">
            已人工修改
          </span>
        )}
      </div>
      {manual && (
        <ManualAnnotationDimensionSelect
          valueKey={item.linkedDimensionKey}
          valueLabel={item.linkedDimensionLabel}
          dimensions={outputDimensionOptions}
          onChange={(linkedDimensionKey, linkedDimensionLabel) =>
            onChangeLinkedDimension(
              item.id,
              linkedDimensionKey,
              linkedDimensionLabel,
            )
          }
        />
      )}
      <EvidenceChangeNotice state={evidenceState} />
      <label className="mt-3 block">
        <span className="sr-only">编辑{item.title}总结</span>
        <textarea
          value={item.summary}
          onFocus={() => onSelectSummary(item)}
          onChange={(event) => onUpdateSummary(item.id, event.target.value)}
          disabled={excluded}
          rows={3}
          className="w-full resize-y rounded-lg border border-slate-200 bg-white px-3 py-2 text-sm font-medium leading-6 text-slate-700 outline-none transition focus:border-blue-300 focus:ring-4 focus:ring-blue-50 disabled:cursor-not-allowed disabled:bg-slate-100"
        />
      </label>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => onToggleConfirmed(item.id)}
          className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
            confirmed
              ? "bg-emerald-50 text-emerald-700 hover:bg-emerald-100"
              : "bg-blue-50 text-brand hover:bg-blue-100"
          }`}
        >
          {confirmed ? "取消确认" : "确认采用"}
        </button>
        <button
          type="button"
          onClick={() => onToggleExcluded(item.id)}
          className="rounded-md bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
        >
          {excluded ? "恢复参与" : "排除本条"}
        </button>
        <button
          type="button"
          onClick={() => onDeleteSummary(item.id)}
          className="rounded-md bg-rose-50 px-2.5 py-1.5 text-[11px] font-semibold text-rose-600 hover:bg-rose-100"
        >
          删除本条
        </button>
        {!manual && (
          <button
            type="button"
            onClick={() => onRestoreSummary(item.id)}
            disabled={!item.editedByUser || excluded}
            className="rounded-md px-2.5 py-1.5 text-[11px] font-semibold text-slate-500 hover:bg-slate-100 disabled:cursor-not-allowed disabled:text-slate-300"
          >
            恢复 AI 原稿
          </button>
        )}
        <button
          type="button"
          onClick={() => onToggleFlagged(item.id)}
          aria-pressed={item.flagged}
          className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold transition ${item.flagged ? "bg-amber-100 text-amber-700 hover:bg-amber-200" : "bg-slate-100 text-slate-600 hover:bg-amber-50 hover:text-amber-700"}`}
        >
          {item.flagged ? `取消标记 #${flaggedOrder}` : "标记待修改"}
        </button>
        <button
          type="button"
          onClick={() => onLocate(item)}
          className="ml-auto flex items-center gap-1 text-[11px] font-semibold text-brand hover:underline"
        >
          <Icon name="link" className="h-3.5 w-3.5" />
          定位原文
        </button>
      </div>
    </article>
  );
}
