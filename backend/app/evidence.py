from dataclasses import replace

from .domain import ParsedTranscriptSegment
from .llm import ProviderEvidence, ProviderSummary


class EvidenceValidationError(ValueError):
    pass


def verify_summaries(
    summaries: list[ProviderSummary], segments: list[ParsedTranscriptSegment]
) -> list[ProviderSummary]:
    segment_map = {segment.id: segment for segment in segments}
    verified: list[ProviderSummary] = []

    for summary in summaries:
        evidences: list[ProviderEvidence] = []
        for evidence in summary.evidences:
            segment = segment_map.get(evidence.segment_id)
            if segment is None:
                raise EvidenceValidationError(
                    f"证据引用了不存在的段落：{evidence.segment_id}"
                )
            if (
                not 0
                <= evidence.start_offset
                < evidence.end_offset
                <= len(segment.text)
            ):
                raise EvidenceValidationError(
                    f"证据字符范围无效：{evidence.segment_id}"
                )
            actual = segment.text[evidence.start_offset : evidence.end_offset]
            if actual != evidence.quote:
                raise EvidenceValidationError(
                    f"证据文本与原文不匹配：{evidence.segment_id}"
                )
            evidences.append(evidence)
        verified.append(replace(summary, evidences=evidences))
    return verified
