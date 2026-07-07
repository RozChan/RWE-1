import type { DimensionKey } from "@/lib/mock-data";
import type { AnalysisDimensionConfig } from "@/lib/types";

type ManualAnnotationDimensionSelectProps = {
  valueKey?: DimensionKey | null;
  valueLabel?: string | null;
  dimensions: AnalysisDimensionConfig[];
  onChange: (key: DimensionKey | null, label: string | null) => void;
};

export function ManualAnnotationDimensionSelect({
  valueKey,
  valueLabel,
  dimensions,
  onChange,
}: ManualAnnotationDimensionSelectProps) {
  return (
    <div className="mt-3 rounded-lg border border-violet-100 bg-violet-50/60 px-3 py-2">
      <label className="flex flex-wrap items-center gap-2 text-[11px] font-semibold text-violet-700">
        <span>归入输出维度</span>
        <select
          value={valueKey ?? ""}
          onChange={(event) => {
            const nextKey = event.target.value;
            if (!nextKey) {
              onChange(null, null);
              return;
            }
            const dimension = dimensions.find((entry) => entry.key === nextKey);
            onChange(nextKey, dimension?.label ?? valueLabel ?? null);
          }}
          className="min-w-[150px] rounded-md border border-violet-200 bg-white px-2 py-1 text-[11px] font-medium text-slate-700 outline-none focus:border-violet-400"
        >
          <option value="">不归入</option>
          {valueKey && !dimensions.some((entry) => entry.key === valueKey) && (
            <option value={valueKey}>
              已删除维度：{valueLabel ?? valueKey}
            </option>
          )}
          {dimensions.map((dimension) => (
            <option key={dimension.key} value={dimension.key}>
              {dimension.enabled ? dimension.label : `${dimension.label}（已停用）`}
            </option>
          ))}
        </select>
        {valueLabel && (
          <span className="rounded-full bg-white px-2 py-0.5 text-[10px] text-violet-500">
            输出归入：{valueLabel}
          </span>
        )}
      </label>
    </div>
  );
}
