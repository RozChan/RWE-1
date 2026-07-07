export type EvidenceChangeState = "edited" | "deleted" | null | undefined;

export function EvidenceChangeNotice({ state }: { state: EvidenceChangeState }) {
  if (!state) return null;
  return (
    <div className="mt-3 rounded-lg border border-amber-200 bg-amber-50 px-3 py-2 text-[11px] font-semibold text-amber-700">
      ⚠️ {state === "deleted"
        ? "引用原文已被删除，建议检查或重新分析。"
        : "引用原文已被修改，建议检查或重新分析。"}
    </div>
  );
}
