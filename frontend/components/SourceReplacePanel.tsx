import type { SourceReplacePreview, SourceReplaceScope } from "@/lib/source-text-editing";

type SourceReplacePanelProps = {
  query: string;
  replacement: string;
  scope: SourceReplaceScope;
  targetSegmentLabel?: string | null;
  preview: SourceReplacePreview;
  notice?: string;
  error?: string;
  onChangeQuery: (value: string) => void;
  onChangeReplacement: (value: string) => void;
  onChangeScope: (value: SourceReplaceScope) => void;
  onApply: () => void;
  onClear: () => void;
  onCancel: () => void;
};

export function SourceReplacePanel({
  query,
  replacement,
  scope,
  targetSegmentLabel,
  preview,
  notice,
  error,
  onChangeQuery,
  onChangeReplacement,
  onChangeScope,
  onApply,
  onClear,
  onCancel,
}: SourceReplacePanelProps) {
  const hasTargetSegment = Boolean(targetSegmentLabel);
  const canApply = Boolean(query.trim()) && Boolean(replacement.trim()) && preview.matchCount > 0;

  return (
    <div className="border-b border-blue-100 bg-blue-50/60 px-4 py-3">
      <div className="flex flex-wrap items-end gap-2">
        <div className="min-w-[160px] flex-1">
          <label className="text-[10px] font-semibold text-slate-500">查找内容</label>
          <input
            value={query}
            onChange={(event) => onChangeQuery(event.target.value)}
            className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-300"
            placeholder="例如：支架"
          />
        </div>
        <div className="min-w-[160px] flex-1">
          <label className="text-[10px] font-semibold text-slate-500">替换为</label>
          <input
            value={replacement}
            onChange={(event) => onChangeReplacement(event.target.value)}
            className="mt-1 w-full rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-300"
            placeholder="例如：智驾"
          />
        </div>
        <div>
          <label className="text-[10px] font-semibold text-slate-500">应用范围</label>
          <select
            value={scope}
            onChange={(event) => onChangeScope(event.target.value as SourceReplaceScope)}
            className="mt-1 block rounded-lg border border-blue-100 bg-white px-3 py-2 text-xs text-slate-700 outline-none focus:border-blue-300"
          >
            <option value="all">全文</option>
            <option value="segment" disabled={!hasTargetSegment}>
              当前段落{targetSegmentLabel ? `（${targetSegmentLabel}）` : ""}
            </option>
          </select>
        </div>
        <button
          type="button"
          onClick={onApply}
          disabled={!canApply}
          className="rounded-lg bg-brand px-3 py-2 text-xs font-semibold text-white hover:bg-blue-700 disabled:cursor-not-allowed disabled:bg-slate-300"
        >
          应用替换
        </button>
        <button
          type="button"
          onClick={onClear}
          className="rounded-lg border border-slate-200 bg-white px-3 py-2 text-xs font-semibold text-slate-600 hover:bg-slate-50"
        >
          清空
        </button>
        <button
          type="button"
          onClick={onCancel}
          className="rounded-lg px-3 py-2 text-xs font-semibold text-slate-500 hover:bg-slate-100"
        >
          取消
        </button>
      </div>
      <div className="mt-2 space-y-1 text-[11px]">
        {!query.trim() ? (
          <p className="text-slate-500">请输入查找内容后预览命中数量。</p>
        ) : scope === "segment" ? (
          <p className="font-medium text-blue-700">当前段落命中 {preview.matchCount} 处。</p>
        ) : (
          <p className="font-medium text-blue-700">
            全文命中 {preview.matchCount} 处，涉及 {preview.segmentCount} 个段落。
          </p>
        )}
        {!replacement.trim() && query.trim() && (
          <p className="text-amber-600">替换内容不能为空，避免误删原文。</p>
        )}
        {error && <p className="font-medium text-rose-600">{error}</p>}
        {notice && <p className="font-medium text-emerald-600">{notice}</p>}
      </div>
    </div>
  );
}
