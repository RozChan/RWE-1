import { useState } from "react";
import {
  dimensionMeta,
  type DimensionKey,
  type Transcript,
} from "@/lib/mock-data";
import type { EditableSummary } from "@/lib/store";

type ManualAnnotationMeta = {
  color: string;
  soft: string;
  label: string;
};

type SourceSegmentCardProps = {
  segment: Transcript;
  annotations: EditableSummary[];
  active: boolean;
  editing: boolean;
  draftText: string;
  editError: string;
  dimensionLabels: Record<DimensionKey, string>;
  activeSummaryId: string;
  visibleSummaries: EditableSummary[];
  manualAnnotationMeta: ManualAnnotationMeta;
  onMouseUp: () => void;
  onSelectAnnotation: (summary: EditableSummary) => void;
  onStartEdit: () => void;
  onChangeDraft: (value: string) => void;
  onSaveEdit: () => void;
  onCancelEdit: () => void;
  onRestoreOriginal: () => void;
  onDelete: () => void;
  onRestoreDeleted: () => void;
  onOpenReplace: () => void;
};

export function SourceSegmentCard({
  segment,
  annotations,
  active,
  editing,
  draftText,
  editError,
  dimensionLabels,
  activeSummaryId,
  visibleSummaries,
  manualAnnotationMeta,
  onMouseUp,
  onSelectAnnotation,
  onStartEdit,
  onChangeDraft,
  onSaveEdit,
  onCancelEdit,
  onRestoreOriginal,
  onDelete,
  onRestoreDeleted,
  onOpenReplace,
}: SourceSegmentCardProps) {
  const [showOriginalCompare, setShowOriginalCompare] = useState(false);
  const dimensions = Array.from(
    new Set(
      annotations
        .filter((summary) => summary.source !== "manual")
        .map((summary) => summary.key),
    ),
  );
  const renderedConnectorIds = new Set<string>();

  return (
    <article
      data-testid="source-segment-card"
      id={`segment-${segment.id}`}
      onMouseUp={onMouseUp}
      className={`scroll-mt-28 rounded-xl border p-3.5 transition-all ${segment.isDeleted ? "border-rose-100 bg-rose-50/70 opacity-80" : "bg-white"} ${active ? "shadow-md ring-2 ring-blue-300" : "border-slate-200 shadow-sm"}`}
    >
      <div className="mb-2 flex items-center gap-2">
        <span className="rounded-md bg-slate-600 px-2 py-1 text-[11px] font-bold text-white">
          {segment.id}
        </span>
        <strong className="text-xs">{segment.speaker}</strong>
        <time className="text-[11px] text-slate-400">
          {segment.timestamp}
        </time>
        {segment.isEdited && !segment.isDeleted && (
          <span className="rounded-full bg-amber-50 px-2 py-0.5 text-[10px] font-bold text-amber-700">
            已编辑
          </span>
        )}
        {segment.isDeleted && (
          <span className="rounded-full bg-rose-100 px-2 py-0.5 text-[10px] font-bold text-rose-700">
            已删除
          </span>
        )}
        <div className="ml-auto flex gap-1">
          {dimensions.map((key) => (
            <span
              key={key}
              className="rounded px-1.5 py-0.5 text-[10px] font-semibold"
              style={{
                color: dimensionMeta[key].color,
                background: dimensionMeta[key].soft,
              }}
            >
              {dimensionLabels[key]}
            </span>
          ))}
          {!segment.isDeleted && !editing && (
            <button
              type="button"
              onClick={onStartEdit}
              className="rounded bg-slate-100 px-1.5 py-0.5 text-[10px] font-semibold text-slate-600 hover:bg-blue-50 hover:text-brand"
            >
              编辑
            </button>
          )}
          {segment.isEdited && !segment.isDeleted && !editing && (
            <button
              type="button"
              onClick={onRestoreOriginal}
              className="rounded bg-amber-50 px-1.5 py-0.5 text-[10px] font-semibold text-amber-700 hover:bg-amber-100"
            >
              恢复原文
            </button>
          )}
          {segment.isEdited && !editing && (
            <button
              type="button"
              onClick={() => setShowOriginalCompare((current) => !current)}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-blue-100"
            >
              {showOriginalCompare ? "收起原文" : "查看原文"}
            </button>
          )}
          {!segment.isDeleted && !editing && (
            <button
              type="button"
              onClick={onOpenReplace}
              className="rounded bg-blue-50 px-1.5 py-0.5 text-[10px] font-semibold text-brand hover:bg-blue-100"
            >
              替换
            </button>
          )}
          {!segment.isDeleted && !editing && (
            <button
              type="button"
              onClick={onDelete}
              className="rounded bg-rose-50 px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-100"
            >
              删除
            </button>
          )}
          {segment.isDeleted && (
            <button
              type="button"
              onClick={onRestoreDeleted}
              className="rounded bg-white px-1.5 py-0.5 text-[10px] font-semibold text-rose-600 hover:bg-rose-100"
            >
              恢复
            </button>
          )}
        </div>
      </div>
      {segment.isDeleted ? (
        <p className="whitespace-pre-wrap text-sm leading-7 text-rose-500">
          {segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join("")}
        </p>
      ) : editing ? (
        <div className="space-y-2">
          <textarea
            value={draftText}
            onChange={(event) => onChangeDraft(event.target.value)}
            rows={4}
            className="w-full resize-y rounded-lg border border-blue-200 bg-white px-3 py-2 text-sm leading-7 text-slate-700 outline-none focus:border-blue-400 focus:ring-4 focus:ring-blue-50"
          />
          {editError && (
            <p className="text-[11px] font-medium text-rose-600">
              {editError}
            </p>
          )}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={onSaveEdit}
              className="rounded-md bg-brand px-2.5 py-1.5 text-[11px] font-semibold text-white hover:bg-blue-700"
            >
              保存
            </button>
            <button
              type="button"
              onClick={onCancelEdit}
              className="rounded-md bg-slate-100 px-2.5 py-1.5 text-[11px] font-semibold text-slate-600 hover:bg-slate-200"
            >
              取消
            </button>
          </div>
        </div>
      ) : (
        <p className="text-sm leading-7 text-slate-700">
          {segment.fragments.map((fragment, index) => {
            const fragmentAnnotations = (fragment.annotationIds ?? [])
              .map((annotationId) =>
                visibleSummaries.find((summary) => summary.id === annotationId),
              )
              .filter(
                (annotation): annotation is EditableSummary => Boolean(annotation),
              );
            if (fragmentAnnotations.length === 0) {
              return <span key={index}>{fragment.text}</span>;
            }

            const visibleAnnotations = fragmentAnnotations.filter(
              (annotation) => annotation.status !== "excluded",
            );
            const underlineAnnotations =
              visibleAnnotations.length > 0
                ? visibleAnnotations
                : fragmentAnnotations;
            const selected = fragmentAnnotations.some(
              (annotation) => annotation.id === activeSummaryId,
            );
            const underlineColors = underlineAnnotations.map((annotation) =>
              annotation.status === "excluded"
                ? "#94a3b8"
                : annotation.source === "manual"
                  ? manualAnnotationMeta.color
                  : dimensionMeta[annotation.key].color,
            );
            const markerAnnotations = fragmentAnnotations.filter((annotation) => {
              if (renderedConnectorIds.has(annotation.id)) {
                return false;
              }
              renderedConnectorIds.add(annotation.id);
              return true;
            });

            return (
              <span
                key={index}
                className="relative inline"
                title={`本句关联：${fragmentAnnotations
                  .map((annotation) =>
                    annotation.source === "manual"
                      ? manualAnnotationMeta.label
                      : dimensionLabels[annotation.key],
                  )
                  .join("、")}`}
              >
                <span
                  role="button"
                  tabIndex={0}
                  onClick={() => onSelectAnnotation(fragmentAnnotations[0])}
                  onKeyDown={(event) => {
                    if (event.key === "Enter" || event.key === " ") {
                      onSelectAnnotation(fragmentAnnotations[0]);
                    }
                  }}
                  className={`rounded-sm px-0.5 text-left transition hover:brightness-95 ${selected ? "font-semibold" : ""}`}
                  style={{
                    backgroundColor:
                      underlineAnnotations.length === 1
                        ? underlineAnnotations[0].source === "manual"
                          ? manualAnnotationMeta.soft
                          : dimensionMeta[underlineAnnotations[0].key].soft
                        : "#f8fafc",
                    backgroundImage: underlineColors
                      .map((color) => `linear-gradient(${color}, ${color})`)
                      .join(", "),
                    backgroundRepeat: "no-repeat",
                    backgroundSize: underlineColors.map(() => "100% 2px").join(", "),
                    backgroundPosition: underlineColors
                      .map((_, colorIndex) => `0 calc(100% - ${colorIndex * 4}px)`)
                      .join(", "),
                    paddingBottom: `${Math.max(4, underlineColors.length * 4)}px`,
                  }}
                >
                  {fragment.text}
                </span>
                <span className="ml-1 inline-flex translate-y-0.5 items-center gap-0.5">
                  {markerAnnotations.map((annotation) => {
                    const meta = annotation.source === "manual"
                      ? manualAnnotationMeta
                      : dimensionMeta[annotation.key];
                    return (
                      <button
                        type="button"
                        key={annotation.id}
                        data-annotation-id={annotation.id}
                        onClick={() => onSelectAnnotation(annotation)}
                        aria-label={`定位${meta.label}总结`}
                        title={`${annotation.status === "excluded" ? "已排除：" : "定位"}${meta.label}总结`}
                        className={`h-2.5 w-2.5 rounded-full border border-white shadow-sm transition hover:scale-125 ${activeSummaryId === annotation.id ? "ring-2 ring-blue-300 ring-offset-1" : ""}`}
                        style={{
                          background:
                            annotation.status === "excluded"
                              ? "#94a3b8"
                              : meta.color,
                        }}
                      />
                    );
                  })}
                </span>
              </span>
            );
          })}
        </p>
      )}
      {segment.isEdited && showOriginalCompare && !editing && (
        <div className="mt-3 rounded-lg border border-amber-100 bg-amber-50/70 p-3 text-[11px] leading-5">
          <p className="font-semibold text-amber-700">原始文本：</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-600">
            {segment.originalText ?? segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join("")}
          </p>
          <p className="mt-2 font-semibold text-amber-700">当前文本：</p>
          <p className="mt-1 whitespace-pre-wrap text-slate-700">
            {segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join("")}
          </p>
        </div>
      )}
    </article>
  );
}
