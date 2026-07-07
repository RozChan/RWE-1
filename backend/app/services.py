from dataclasses import asdict

from .domain import ParsedMeetingMetadata, ParsedTranscriptSegment
from .evidence import verify_summaries
from .llm import LLMProvider, ProviderDimension, ProviderNoResult, ProviderSummary


def analyze_document(
    provider: LLMProvider,
    chunks: list[ParsedTranscriptSegment],
    dimensions: list[ProviderDimension],
) -> dict:
    summaries = verify_summaries(provider.analyze(chunks, dimensions), chunks)
    return {
        "summaries": [
            _summary_to_dict(index, summary)
            for index, summary in enumerate(summaries, 1)
        ],
        "no_results": [
            _no_result_to_dict(no_result)
            for no_result in getattr(provider, "last_no_results", [])
        ],
    }


def analyze_meeting(
    provider: LLMProvider,
    segments: list[ParsedTranscriptSegment],
    dimensions: list[ProviderDimension],
) -> dict:
    return analyze_document(provider, segments, dimensions)


def build_output(
    provider: LLMProvider,
    document: ParsedMeetingMetadata,
    summaries: list[dict],
    output_type: str = "reading_summary",
) -> str:
    return provider.generate_minutes(document, summaries)


def build_minutes(
    provider: LLMProvider,
    meeting: ParsedMeetingMetadata,
    summaries: list[dict],
) -> str:
    return build_output(provider, meeting, summaries, "meeting_minutes")


def _summary_to_dict(index: int, summary: ProviderSummary) -> dict:
    return {
        "id": f"A{index}",
        "dimension": summary.dimension,
        "title": summary.title,
        "summary": summary.summary,
        "evidences": [
            {"id": f"E{index}-{evidence_index}", **asdict(evidence), "verified": True}
            for evidence_index, evidence in enumerate(summary.evidences, 1)
        ],
        "review_status": "draft",
        "model_confidence": summary.model_confidence,
    }


def _no_result_to_dict(no_result: ProviderNoResult) -> dict:
    return {
        "dimension": no_result.dimension,
        "title": no_result.title,
        "reason": no_result.reason,
    }
