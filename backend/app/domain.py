from dataclasses import dataclass, field
from datetime import datetime
from typing import Any, Literal


@dataclass(frozen=True, slots=True)
class ParsedDocumentMetadata:
    filename: str
    document_type: str = "generic_text"
    title: str | None = None
    char_count: int = 0
    chunk_count: int = 0
    meeting_time: datetime | None = None
    duration_seconds: int | None = None
    duration_text: str | None = None
    keywords: list[str] = field(default_factory=list)
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ParsedDocumentChunk:
    id: str
    text: str
    kind: Literal["utterance", "paragraph", "heading", "list_item", "table", "quote"] = "paragraph"
    speaker: str | None = None
    timestamp: str | None = None
    start_seconds: int | None = None
    heading_path: list[str] | None = None
    page_number: int | None = None
    start_offset: int | None = None
    end_offset: int | None = None
    metadata: dict[str, Any] = field(default_factory=dict)


@dataclass(frozen=True, slots=True)
class ParsedDocument:
    document: ParsedDocumentMetadata
    chunks: list[ParsedDocumentChunk]


ParsedMeetingMetadata = ParsedDocumentMetadata
ParsedTranscriptSegment = ParsedDocumentChunk


@dataclass(frozen=True, slots=True)
class ParsedMeeting:
    meeting: ParsedMeetingMetadata
    segments: list[ParsedTranscriptSegment]
