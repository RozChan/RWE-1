import re
from datetime import datetime

from .domain import ParsedDocument, ParsedDocumentChunk, ParsedDocumentMetadata, ParsedMeeting, ParsedMeetingMetadata, ParsedTranscriptSegment

_DATE_RE = re.compile(
    r"(?P<year>\d{4})年(?P<month>\d{1,2})月(?P<day>\d{1,2})日\s*"
    r"(?:(?P<period>上午|下午)\s*)?(?P<hour>\d{1,2}):(?P<minute>\d{2})"
)
_DURATION_RE = re.compile(
    r"(?:(?P<hours>\d+)\s*小时)?\s*"
    r"(?:(?P<minutes>\d+)\s*分钟)?\s*"
    r"(?:(?P<seconds>\d+)\s*秒)"
)
_SPEAKER_RE = re.compile(
    r"^(?P<speaker>[^:：|]{1,30}?)\s+(?P<timestamp>\d{1,2}:\d{2}(?::\d{2})?)$"
)
_KEYWORD_MARKER_RE = re.compile(r"^关键词\s*[:：]?\s*(?P<inline>.*)$", re.IGNORECASE)
_TRANSCRIPT_MARKER_RE = re.compile(r"^文字记录\s*[:：]?\s*$", re.IGNORECASE)


class TranscriptParseError(ValueError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


def decode_transcript(data: bytes) -> str:
    for encoding in ("utf-8-sig", "gb18030"):
        try:
            return data.decode(encoding)
        except UnicodeDecodeError:
            continue
    raise TranscriptParseError(
        "UNSUPPORTED_ENCODING", "文件编码无法识别，请使用 UTF-8 或 GB18030 编码。"
    )


def _normalize_lines(content: str) -> tuple[str, list[str]]:
    normalized = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
    return normalized, [line.strip() for line in normalized.split("\n")]


def detect_feishu_meeting_text(content: str) -> bool:
    _normalized, lines = _normalize_lines(content)
    nonempty = [line for line in lines if line]
    if len(nonempty) < 4:
        return False
    has_date = any(_DATE_RE.search(line) for line in nonempty[:20])
    has_duration = any(_DURATION_RE.search(line) for line in nonempty[:20])
    has_keyword = any(_KEYWORD_MARKER_RE.match(line) for line in nonempty[:30])
    transcript_index = _find_transcript_marker(lines, 0)
    speaker_indices = _speaker_header_indices(lines)
    speaker_count = len(speaker_indices)

    if transcript_index is not None and speaker_count >= 2:
        return True
    if speaker_count >= 3 and (has_date or has_duration or has_keyword):
        return True

    score = 0
    score += 2 if has_date else 0
    score += 2 if has_duration else 0
    score += 1 if has_keyword else 0
    score += 2 if transcript_index is not None else 0
    score += min(speaker_count, 3)
    return score >= 7 and speaker_count >= 2


def parse_feishu_transcript(content: str, filename: str) -> ParsedMeeting:
    normalized, lines = _normalize_lines(content)
    nonempty = [line for line in lines if line]
    if len(nonempty) < 4 or not detect_feishu_meeting_text(content):
        raise TranscriptParseError(
            "INCOMPLETE_HEADER", "会议文字稿缺少必要的飞书会议特征。"
        )

    meeting_time, date_index = _find_meeting_time(lines)
    duration_index, duration_text, duration_seconds = _find_duration(lines, date_index)

    keyword_marker = _find_keyword_marker(lines, duration_index + 1)
    transcript_marker = _find_transcript_marker(lines, keyword_marker + 1 if keyword_marker is not None else duration_index + 1)
    first_speaker = _first_speaker_header_index(lines, transcript_marker + 1 if transcript_marker is not None else 0)
    if first_speaker is None:
        raise TranscriptParseError(
            "NO_TRANSCRIPT_SEGMENTS", "会议文字稿中没有识别到有效发言段落。"
        )

    keyword_end = transcript_marker if transcript_marker is not None else first_speaker
    keywords = _parse_keywords(lines, keyword_marker, keyword_end) if keyword_marker is not None else []
    segment_start = transcript_marker + 1 if transcript_marker is not None else first_speaker
    segments = _parse_segments(lines[segment_start:])

    if not segments:
        raise TranscriptParseError(
            "NO_TRANSCRIPT_SEGMENTS", "“文字记录”后没有识别到有效发言段落。"
        )

    return ParsedMeeting(
        meeting=ParsedMeetingMetadata(
            filename=filename,
            document_type="meeting",
            title=filename,
            char_count=len(normalized),
            chunk_count=len(segments),
            meeting_time=meeting_time,
            duration_seconds=duration_seconds,
            duration_text=duration_text,
            keywords=keywords,
            metadata={"source_parser": "feishu_meeting"},
        ),
        segments=segments,
    )


def _find_meeting_time(lines: list[str]) -> tuple[datetime, int]:
    for index, line in enumerate(lines[:30]):
        if _DATE_RE.search(line):
            return _parse_meeting_time(line), index
    raise TranscriptParseError(
        "INVALID_MEETING_TIME",
        "会议时间格式不正确，应类似“2026年5月7日 下午 3:01”。",
    )


def _find_duration(lines: list[str], start: int) -> tuple[int, str, int]:
    for index in range(start, min(len(lines), start + 8)):
        line = lines[index]
        match = _DURATION_RE.search(line)
        if match:
            duration_text = _normalize_duration_text(match)
            return index, duration_text, _parse_duration(duration_text)
    raise TranscriptParseError(
        "INVALID_DURATION",
        "会议时长格式不正确，应类似“2小时 24分钟 50秒”。",
    )


def _normalize_duration_text(match: re.Match[str]) -> str:
    hours = match.group("hours")
    minutes = match.group("minutes")
    seconds = match.group("seconds")
    parts: list[str] = []
    if hours is not None:
        parts.append(f"{int(hours)}小时")
    if minutes is not None:
        parts.append(f"{int(minutes)}分钟")
    if seconds is not None:
        parts.append(f"{int(seconds)}秒")
    return "".join(parts)


def _parse_meeting_time(value: str) -> datetime:
    match = _DATE_RE.search(value)
    if not match:
        raise TranscriptParseError(
            "INVALID_MEETING_TIME",
            "会议时间格式不正确，应类似“2026年5月7日 下午 3:01”。",
        )

    hour = int(match.group("hour"))
    period = match.group("period")
    if period:
        if not 1 <= hour <= 12:
            raise TranscriptParseError(
                "INVALID_MEETING_TIME", "会议时间中的小时必须在 1 到 12 之间。"
            )
        if period == "下午" and hour != 12:
            hour += 12
        elif period == "上午" and hour == 12:
            hour = 0
    elif not 0 <= hour <= 23:
        raise TranscriptParseError(
            "INVALID_MEETING_TIME", "会议时间中的小时必须在 0 到 23 之间。"
        )

    try:
        return datetime(
            int(match.group("year")),
            int(match.group("month")),
            int(match.group("day")),
            hour,
            int(match.group("minute")),
        )
    except ValueError as error:
        raise TranscriptParseError(
            "INVALID_MEETING_TIME", "会议日期或时间不是有效值。"
        ) from error


def _parse_duration(value: str) -> int:
    match = _DURATION_RE.fullmatch(value)
    if not match or not any(
        match.group(name) for name in ("hours", "minutes", "seconds")
    ):
        raise TranscriptParseError(
            "INVALID_DURATION",
            "会议时长格式不正确，应类似“2小时 24分钟 50秒”。",
        )
    hours = int(match.group("hours") or 0)
    minutes = int(match.group("minutes") or 0)
    seconds = int(match.group("seconds") or 0)
    if minutes >= 60 or seconds >= 60:
        raise TranscriptParseError(
            "INVALID_DURATION", "会议时长中的分钟和秒必须小于 60。"
        )
    return hours * 3600 + minutes * 60 + seconds


def _find_keyword_marker(lines: list[str], start: int) -> int | None:
    for index in range(max(0, start), len(lines)):
        if _KEYWORD_MARKER_RE.match(lines[index].strip()):
            return index
    return None


def _find_transcript_marker(lines: list[str], start: int) -> int | None:
    for index in range(max(0, start), len(lines)):
        if _TRANSCRIPT_MARKER_RE.match(lines[index].strip()):
            return index
    return None


def _speaker_header_match(line: str) -> re.Match[str] | None:
    if _DATE_RE.search(line) or _DURATION_RE.search(line) or _KEYWORD_MARKER_RE.match(line) or _TRANSCRIPT_MARKER_RE.match(line):
        return None
    return _SPEAKER_RE.fullmatch(line)


def _speaker_header_indices(lines: list[str]) -> list[int]:
    return [index for index, line in enumerate(lines) if _speaker_header_match(line.strip())]


def _first_speaker_header_index(lines: list[str], start: int) -> int | None:
    for index in range(max(0, start), len(lines)):
        if _speaker_header_match(lines[index].strip()):
            return index
    return None


def _parse_keywords(lines: list[str], marker_index: int, end_index: int) -> list[str]:
    marker = lines[marker_index].strip()
    marker_match = _KEYWORD_MARKER_RE.match(marker)
    keyword_texts: list[str] = []
    inline = marker_match.group("inline").strip() if marker_match else ""
    if inline:
        keyword_texts.append(inline)
    keyword_texts.extend(line.strip() for line in lines[marker_index + 1 : end_index] if line.strip())
    keywords: list[str] = []
    for text in keyword_texts:
        if _DATE_RE.search(text) or _DURATION_RE.search(text) or _TRANSCRIPT_MARKER_RE.match(text):
            continue
        keywords.extend(keyword for keyword in re.split(r"[\s,，、]+", text) if keyword)
    return keywords


def _parse_segments(lines: list[str]) -> list[ParsedTranscriptSegment]:
    segments: list[ParsedTranscriptSegment] = []
    speaker: str | None = None
    timestamp: str | None = None
    content_lines: list[str] = []

    def flush() -> None:
        nonlocal speaker, timestamp, content_lines
        if speaker is None or timestamp is None:
            return
        text = "\n".join(line.strip() for line in content_lines).strip()
        if text:
            normalized_timestamp, start_seconds = _parse_timestamp(timestamp)
            segments.append(
                ParsedTranscriptSegment(
                    id=f"P{len(segments) + 1}",
                    text=text,
                    kind="utterance",
                    speaker=speaker,
                    timestamp=normalized_timestamp,
                    start_seconds=start_seconds,
                )
            )
        speaker = None
        timestamp = None
        content_lines = []

    for raw_line in lines:
        stripped = raw_line.strip()
        header = _speaker_header_match(stripped) if stripped else None
        if header:
            flush()
            speaker = header.group("speaker").strip()
            timestamp = header.group("timestamp")
            continue
        if speaker is not None:
            content_lines.append(raw_line)

    flush()
    return segments


def _parse_timestamp(value: str) -> tuple[str, int]:
    parts = [int(part) for part in value.split(":")]
    if len(parts) == 2:
        minutes, seconds = parts
        if seconds >= 60:
            raise TranscriptParseError(
                "INVALID_TIMESTAMP", f"发言时间戳“{value}”无效。"
            )
        return f"{minutes:02d}:{seconds:02d}", minutes * 60 + seconds

    hours, minutes, seconds = parts
    if minutes >= 60 or seconds >= 60:
        raise TranscriptParseError("INVALID_TIMESTAMP", f"发言时间戳“{value}”无效。")
    return (
        f"{hours:02d}:{minutes:02d}:{seconds:02d}",
        hours * 3600 + minutes * 60 + seconds,
    )


class FeishuMeetingParser:
    def parse(self, content: str, filename: str) -> ParsedDocument:
        parsed = parse_feishu_transcript(content, filename)
        return ParsedDocument(document=parsed.meeting, chunks=parsed.segments)


class PlainTextParser:
    _heading_re = re.compile(r"^(#{1,6}\s+.+|[一二三四五六七八九十]+[、.．].+|\d+(?:\.\d+)*[、.．\s].+)$")
    _list_re = re.compile(r"^\s*(?:[-*•]|\d+[.)）]|[一二三四五六七八九十]+[.)）])\s+.+")

    def parse(self, content: str, filename: str) -> ParsedDocument:
        normalized = content.replace("\r\n", "\n").replace("\r", "\n").lstrip("\ufeff")
        blocks = [block.strip() for block in re.split(r"\n\s*\n+", normalized) if block.strip()]
        if not blocks:
            raise TranscriptParseError("NO_DOCUMENT_CONTENT", "TXT 文件没有可解析的正文内容。")
        chunks: list[ParsedDocumentChunk] = []
        search_from = 0
        heading_path: list[str] = []
        for block in blocks:
            first_line = block.split("\n", 1)[0].strip()
            kind = "paragraph"
            if self._heading_re.fullmatch(first_line) and len(block) <= 120:
                kind = "heading"
                heading_path = [first_line]
            elif self._list_re.fullmatch(first_line):
                kind = "list_item"
            start = normalized.find(block, search_from)
            if start < 0:
                start = search_from
            end = start + len(block)
            chunks.append(ParsedDocumentChunk(
                id=f"P{len(chunks)+1}", text=block, kind=kind,
                heading_path=list(heading_path) if heading_path else None,
                start_offset=start, end_offset=end,
            ))
            search_from = end
        return ParsedDocument(
            document=ParsedDocumentMetadata(
                filename=filename, document_type="generic_text", title=filename,
                char_count=len(normalized), chunk_count=len(chunks),
                metadata={"source_parser": "plain_text"},
            ),
            chunks=chunks,
        )


def parse_document(content: str, filename: str) -> ParsedDocument:
    if detect_feishu_meeting_text(content):
        try:
            return FeishuMeetingParser().parse(content, filename)
        except TranscriptParseError:
            pass
    return PlainTextParser().parse(content, filename)
