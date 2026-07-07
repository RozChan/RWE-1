import type { Transcript } from "@/lib/mock-data";

export type SourceReplaceScope = "all" | "segment";

export type SourceReplacePreview = {
  matchCount: number;
  segmentCount: number;
};

export function countTextMatches(text: string, query: string) {
  if (!query) return 0;
  let count = 0;
  let index = 0;
  while (index <= text.length) {
    const found = text.indexOf(query, index);
    if (found === -1) break;
    count += 1;
    index = found + query.length;
  }
  return count;
}

export function getSourceReplacePreview(
  segments: Transcript[],
  query: string,
  scope: SourceReplaceScope,
  segmentId?: string | null,
): SourceReplacePreview {
  if (!query) return { matchCount: 0, segmentCount: 0 };
  const targetSegments = segments.filter((segment) => {
    if (segment.isDeleted) return false;
    if (scope === "segment") return segment.id === segmentId;
    return true;
  });
  return targetSegments.reduce<SourceReplacePreview>(
    (preview, segment) => {
      const text = segment.currentText ?? segment.fragments.map((fragment) => fragment.text).join("");
      const matches = countTextMatches(text, query);
      if (matches > 0) {
        preview.matchCount += matches;
        preview.segmentCount += 1;
      }
      return preview;
    },
    { matchCount: 0, segmentCount: 0 },
  );
}

export function replacePlainText(text: string, query: string, replacement: string) {
  if (!query) return text;
  return text.split(query).join(replacement);
}
