import json
import unicodedata
from collections import defaultdict
from dataclasses import dataclass
from datetime import datetime
from typing import Callable, Protocol
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

from .config import LLMSettings
from .domain import ParsedMeetingMetadata, ParsedTranscriptSegment

DIMENSION_TITLES = {
    "topic": "课题",
    "goal": "课题目标",
    "progress": "课题进展",
    "next": "后续目标",
    "highlight": "亮点总结",
    "advice": "评委分享及建议",
}


class LLMProviderError(RuntimeError):
    def __init__(self, code: str, message: str) -> None:
        super().__init__(message)
        self.code = code
        self.message = message


@dataclass(frozen=True, slots=True)
class ProviderDimension:
    key: str
    label: str
    description: str


@dataclass(frozen=True, slots=True)
class ProviderEvidence:
    segment_id: str
    quote: str
    start_offset: int
    end_offset: int


@dataclass(frozen=True, slots=True)
class ProviderSummary:
    dimension: str
    title: str
    summary: str
    evidences: list[ProviderEvidence]
    model_confidence: float | None = None


@dataclass(frozen=True, slots=True)
class ProviderNoResult:
    dimension: str
    title: str
    reason: str


class LLMProvider(Protocol):
    name: str
    model_name: str
    last_no_results: list[ProviderNoResult]

    def analyze(
        self,
        segments: list[ParsedTranscriptSegment],
        dimensions: list[ProviderDimension],
    ) -> list[ProviderSummary]: ...

    def generate_minutes(
        self, meeting: ParsedMeetingMetadata, summaries: list[dict]
    ) -> str: ...

    def chat(
        self, messages: list[dict[str, str]], context: dict | None = None
    ) -> str: ...

    def interpret_config(
        self, messages: list[dict[str, str]], dimensions: list[dict]
    ) -> dict: ...

    def interpret_agent(
        self, message: str, context: dict, recent_messages: list[dict]
    ) -> dict: ...


class MockLLMProvider:
    """Deterministic local provider used when no external model is configured."""

    name = "mock"
    model_name = "local-rules"
    last_no_results: list[ProviderNoResult] = []
    _rules = {
        "topic": ("AI", "需求", "课题", "方案", "建设"),
        "goal": ("目标", "体系", "层次", "层级", "验证", "边界"),
        "progress": ("已经", "已完成", "完成了", "推进", "建立"),
        "next": ("下一步", "后续", "计划", "明确", "未来"),
        "highlight": ("避免", "提升", "优势", "亮点", "效率", "落地"),
        "advice": ("建议", "需要", "关注", "注意", "补充", "人工确认"),
    }
    _templates = {
        "topic": "文档围绕以下核心观点展开：{quote}",
        "goal": "文档提出的目标、标准或边界为：{quote}",
        "progress": "当前已形成的进展为：{quote}",
        "next": "后续需要推进的事项为：{quote}",
        "highlight": "该内容体现出的亮点为：{quote}",
        "advice": "文档中的建议、风险或注意事项为：{quote}",
    }

    def analyze(
        self,
        segments: list[ParsedTranscriptSegment],
        dimensions: list[ProviderDimension],
    ) -> list[ProviderSummary]:
        self.last_no_results = []
        results: list[ProviderSummary] = []
        for dimension in dimensions:
            rules = self._rules.get(dimension.key, ())
            matched = (
                [
                    segment
                    for segment in segments
                    if any(keyword in segment.text for keyword in rules)
                ]
                if rules
                else segments
            )
            if not matched and segments:
                matched = [segments[min(len(results), len(segments) - 1)]]

            for segment in matched[:2]:
                quote = self._select_quote(segment.text, rules)
                start = segment.text.find(quote)
                template = self._templates.get(
                    dimension.key, f"{dimension.label}：{{quote}}"
                )
                results.append(
                    ProviderSummary(
                        dimension=dimension.key,
                        title=dimension.label,
                        summary=template.format(quote=quote),
                        evidences=[
                            ProviderEvidence(
                                segment_id=segment.id,
                                quote=quote,
                                start_offset=start,
                                end_offset=start + len(quote),
                            )
                        ],
                    )
                )
        return results

    def generate_minutes(
        self, meeting: ParsedMeetingMetadata, summaries: list[dict]
    ) -> str:
        return format_minutes_locally(meeting, summaries)

    def chat(self, messages: list[dict[str, str]], context: dict | None = None) -> str:
        latest = messages[-1]["content"].strip()
        return f"当前使用 MockLLMProvider，尚未连接真实大模型。你刚才说：{latest}"

    def interpret_config(
        self, messages: list[dict[str, str]], dimensions: list[dict]
    ) -> dict:
        latest = messages[-1]["content"].strip()
        for dimension in dimensions:
            label = dimension["label"]
            if ("删除" in latest or "移除" in latest) and label in latest:
                return {
                    "reply": f"准备删除“{label}”维度，请确认后执行。",
                    "operations": [
                        {
                            "type": "remove_dimension",
                            "dimension_key": dimension["key"],
                        }
                    ],
                    "warnings": ["删除维度后，建议按新配置重新进行 AI 分析。"],
                    "requires_confirmation": True,
                }
            if ("停用" in latest or "关闭" in latest) and label in latest:
                return {
                    "reply": f"准备停用“{label}”维度，请确认后执行。",
                    "operations": [
                        {
                            "type": "disable_dimension",
                            "dimension_key": dimension["key"],
                        }
                    ],
                    "warnings": [],
                    "requires_confirmation": True,
                }
            if ("启用" in latest or "打开" in latest) and label in latest:
                return {
                    "reply": f"准备启用“{label}”维度，请确认后执行。",
                    "operations": [
                        {
                            "type": "enable_dimension",
                            "dimension_key": dimension["key"],
                        }
                    ],
                    "warnings": [],
                    "requires_confirmation": True,
                }
        if "增加" in latest or "添加" in latest or "新增" in latest:
            label = _extract_mock_dimension_label(latest)
            return {
                "reply": f"准备新增“{label}”维度，请确认名称和分析说明。",
                "operations": [
                    {
                        "type": "add_dimension",
                        "label": label,
                        "description": f"识别并总结文档中与{label}相关的内容。",
                    }
                ],
                "warnings": ["新增维度后需要重新进行 AI 分析才会产生对应总结。"],
                "requires_confirmation": True,
            }
        return {
            "reply": (
                "我可以协助新增、删除、启用、停用或修改分析维度。"
                "请明确说明目标维度和希望的修改。"
            ),
            "operations": [],
            "warnings": [],
            "requires_confirmation": False,
        }

    def interpret_agent(
        self, message: str, context: dict, recent_messages: list[dict]
    ) -> dict:
        from .agent import _mock_agent_plan

        return _mock_agent_plan(message, context)

    @staticmethod
    def _select_quote(text: str, keywords: tuple[str, ...]) -> str:
        sentences = [
            part.strip()
            for part in text.replace("！", "。").replace("？", "。").split("。")
            if part.strip()
        ]
        for sentence in sentences:
            if any(keyword in sentence for keyword in keywords):
                return sentence[:120]
        return text.strip()[:120]


JsonTransport = Callable[[str, dict[str, str], dict, float], dict]


def _extract_mock_dimension_label(content: str) -> str:
    cleaned = content
    for token in (
        "请",
        "帮我",
        "增加",
        "添加",
        "新增",
        "一个",
        "分析",
        "维度",
        "。",
        "，",
    ):
        cleaned = cleaned.replace(token, "")
    return cleaned.strip()[:20] or "自定义维度"


class DeepSeekLLMProvider:
    """DeepSeek Chat Completions provider using JSON Output."""

    name = "deepseek"
    _analysis_batch_max_segments = 40
    _analysis_batch_max_characters = 24_000

    def __init__(
        self, settings: LLMSettings, transport: JsonTransport | None = None
    ) -> None:
        if not settings.deepseek_api_key:
            raise LLMProviderError(
                "DEEPSEEK_API_KEY_MISSING",
                "已选择 DeepSeek，但后端未配置 DEEPSEEK_API_KEY。",
            )
        self.settings = settings
        self.model_name = settings.deepseek_model
        self.transport = transport or _post_json
        self.last_no_results: list[ProviderNoResult] = []

    def analyze(
        self,
        segments: list[ParsedTranscriptSegment],
        dimensions: list[ProviderDimension],
    ) -> list[ProviderSummary]:
        dimension_map = {dimension.key: dimension for dimension in dimensions}
        segment_order = {segment.id: index for index, segment in enumerate(segments)}
        results: list[ProviderSummary] = []
        no_results: list[ProviderNoResult] = []

        for batch in self._analysis_batches(segments):
            batch_results, batch_no_results = self._analyze_batch(
                batch, dimensions, dimension_map
            )
            results.extend(batch_results)
            no_results.extend(batch_no_results)

        self.last_no_results = self._dedupe_no_results(no_results) if not results else []

        if not results:
            if self.last_no_results:
                return []
            raise LLMProviderError(
                "DEEPSEEK_EMPTY_RESPONSE",
                "DeepSeek 未返回可解析的结构化 summaries；可能是模型输出为空、非 JSON、字段缺失或没有命中当前维度。请稍后重试，或仅用该维度重新分析全文。",
            )
        return sorted(
            results,
            key=lambda summary: min(
                segment_order[evidence.segment_id] for evidence in summary.evidences
            ),
        )

    def _analyze_batch(
        self,
        segments: list[ParsedTranscriptSegment],
        dimensions: list[ProviderDimension],
        dimension_map: dict[str, ProviderDimension],
    ) -> tuple[list[ProviderSummary], list[ProviderNoResult]]:
        transcript = [
            {
                "id": segment.id,
                "kind": segment.kind,
                "speaker": segment.speaker,
                "timestamp": segment.timestamp,
                "heading_path": segment.heading_path,
                "text": segment.text,
            }
            for segment in segments
        ]
        base_system_prompt = """你是可追溯文档阅读分析器。必须只输出合法 JSON，不要输出 Markdown。
从用户给出的 P 编号文档片段中提取结构化分析结果。不得编造原文没有的事实。
每条总结必须给出至少一个 evidence；evidence 只返回 segment_id 和原文中连续出现的精确 quote。
quote 必须逐字复制对应文档片段的 text，保留原始标点、空格、大小写和错别字，禁止改写、纠错、补字或省略。
同一句可以属于多个维度，一个总结也可以引用多个证据。只使用用户提供的维度 key。
同一个维度可以输出多条独立总结；不同议题或相距较远的不同事项必须拆成不同总结，不要强行合并成每维度一条。
每条总结只表达一个独立语义事项，按首个 evidence 在原文中的顺序输出。
summary 应简洁，通常为一至两句话；quote 只截取足以支撑总结的最短连续原文，不要复制整段。
无论是否找到结果，都必须返回合法 JSON，不要返回空字符串、Markdown 或自然语言说明。
如果找到内容，返回 summaries 数组；如果本批原文没有任何符合维度定义的内容，返回 {"summaries":[],"noResult":{"dimension":"维度名称","reason":"未发现该维度相关内容的具体原因"}}。
无结果时不得为了凑数而编造低质量总结卡片。
输出 JSON 格式：
{"summaries":[{"dimension":"topic","summary":"总结内容","evidences":[{"segment_id":"P1","quote":"原文精确引用"}]}]}"""
        user_payload = {
            "dimensions": [
                {
                    "key": dimension.key,
                    "label": dimension.label,
                    "description": dimension.description,
                }
                for dimension in dimensions
            ],
            "document_type": "generic_text",
            "chunks": transcript,
            "segments": transcript,
        }
        user_prompt = json.dumps(user_payload, ensure_ascii=False)
        segment_map = {segment.id: segment for segment in segments}
        last_error: LLMProviderError | None = None

        for attempt in range(2):
            system_prompt = base_system_prompt
            if attempt:
                error_detail = last_error.message if last_error else "原文引用无法校验"
                if last_error and last_error.code in {
                    "DEEPSEEK_INVALID_RESPONSE",
                    "DEEPSEEK_EMPTY_RESPONSE",
                    "DEEPSEEK_INVALID_DIMENSION",
                }:
                    system_prompt += (
                        f"\n上一次输出无法解析为系统需要的结构化 summaries：{error_detail}。"
                        "请严格返回 JSON 对象，不要使用 Markdown，不要输出解释文本。"
                        "JSON 顶层必须包含 summaries 数组；没有命中内容时必须返回 summaries: [] 和 noResult.reason；"
                        "每条 summary 必须包含 dimension、summary、evidences；每条 evidence 必须包含 segment_id 和 quote。"
                    )
                else:
                    system_prompt += (
                        f"\n上一次结果存在 quote 无法在原文中逐字找到的问题：{error_detail}。"
                        "本次必须先从对应 segment.text 复制连续子串，再填写 quote；"
                        "不确定或无法精确引用的总结不要输出。"
                    )
            try:
                data = self._chat_json(system_prompt, user_prompt)
            except LLMProviderError as error:
                if error.code == "DEEPSEEK_OUTPUT_TRUNCATED" and len(segments) > 1:
                    left, right = self._split_analysis_batch(segments)
                    left_results, left_no_results = self._analyze_batch(
                        left, dimensions, dimension_map
                    )
                    right_results, right_no_results = self._analyze_batch(
                        right, dimensions, dimension_map
                    )
                    return left_results + right_results, left_no_results + right_no_results
                if error.code == "DEEPSEEK_OUTPUT_TRUNCATED":
                    raise LLMProviderError(
                        "DEEPSEEK_OUTPUT_TRUNCATED",
                        f"DeepSeek 分析段落 {segments[0].id} 时输出仍被截断；"
                        "请缩短该段原文或提高 DEEPSEEK_MAX_TOKENS 后重试。",
                    ) from error
                if error.code in {"DEEPSEEK_INVALID_RESPONSE", "DEEPSEEK_EMPTY_RESPONSE"} and not attempt:
                    last_error = error
                    continue
                raise
            try:
                return self._parse_analysis_data(
                    data,
                    dimension_map,
                    segment_map,
                    allow_empty=True,
                    skip_invalid_evidence=bool(attempt),
                )
            except LLMProviderError as error:
                last_error = error
                retryable = {
                    "DEEPSEEK_INVALID_RESPONSE",
                    "DEEPSEEK_EMPTY_RESPONSE",
                    "DEEPSEEK_INVALID_DIMENSION",
                    "DEEPSEEK_INVALID_EVIDENCE",
                }
                if error.code not in retryable or attempt:
                    raise

        raise last_error or LLMProviderError(
            "DEEPSEEK_INVALID_EVIDENCE", "DeepSeek 未返回可验证的原文引用。"
        )

    @classmethod
    def _analysis_batches(
        cls, segments: list[ParsedTranscriptSegment]
    ) -> list[list[ParsedTranscriptSegment]]:
        batches: list[list[ParsedTranscriptSegment]] = []
        current: list[ParsedTranscriptSegment] = []
        current_characters = 0
        for segment in segments:
            segment_characters = len(segment.text)
            if current and (
                len(current) >= cls._analysis_batch_max_segments
                or current_characters + segment_characters
                > cls._analysis_batch_max_characters
            ):
                batches.append(current)
                current = []
                current_characters = 0
            current.append(segment)
            current_characters += segment_characters
        if current:
            batches.append(current)
        return batches

    @staticmethod
    def _split_analysis_batch(
        segments: list[ParsedTranscriptSegment],
    ) -> tuple[list[ParsedTranscriptSegment], list[ParsedTranscriptSegment]]:
        total_characters = sum(len(segment.text) for segment in segments)
        target = total_characters / 2
        consumed = 0
        split_at = 1
        for index, segment in enumerate(segments[:-1], 1):
            consumed += len(segment.text)
            split_at = index
            if consumed >= target:
                break
        return segments[:split_at], segments[split_at:]

    def _parse_analysis_data(
        self,
        data: dict,
        dimension_map: dict[str, ProviderDimension],
        segment_map: dict[str, ParsedTranscriptSegment],
        *,
        allow_empty: bool = False,
        skip_invalid_evidence: bool = False,
    ) -> tuple[list[ProviderSummary], list[ProviderNoResult]]:
        raw_summaries = data.get("summaries")
        if not isinstance(raw_summaries, list):
            raise LLMProviderError(
                "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 返回结果缺少 summaries 数组。"
            )

        results: list[ProviderSummary] = []
        for item in raw_summaries:
            if not isinstance(item, dict):
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 总结条目格式无效。"
                )
            dimension = item.get("dimension")
            if dimension not in dimension_map:
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_DIMENSION",
                    f"DeepSeek 返回了未请求的维度：{dimension}",
                )
            summary_text = str(item.get("summary", "")).strip()
            if not summary_text:
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 返回了空总结。"
                )
            try:
                evidences = self._parse_evidences(item.get("evidences"), segment_map)
            except LLMProviderError as error:
                if skip_invalid_evidence and error.code == "DEEPSEEK_INVALID_EVIDENCE":
                    continue
                raise
            results.append(
                ProviderSummary(
                    dimension=dimension,
                    title=dimension_map[dimension].label,
                    summary=summary_text,
                    evidences=evidences,
                )
            )
        if not results and raw_summaries:
            raise LLMProviderError(
                "DEEPSEEK_EMPTY_RESPONSE",
                "DeepSeek 未返回可解析的结构化 summaries；模型返回了总结条目，但没有任何条目通过原文证据校验。",
            )
        if not results and not allow_empty:
            raise LLMProviderError(
                "DEEPSEEK_EMPTY_RESPONSE", "DeepSeek 未返回任何结构化总结。"
            )
        no_results = self._parse_no_results(data, dimension_map) if not results else []
        return results, no_results

    @classmethod
    def _parse_no_results(
        cls,
        data: dict,
        dimension_map: dict[str, ProviderDimension],
    ) -> list[ProviderNoResult]:
        raw_no_result = data.get("noResult", data.get("no_result"))
        items = raw_no_result if isinstance(raw_no_result, list) else [raw_no_result]
        parsed: list[ProviderNoResult] = []
        for item in items:
            if not isinstance(item, dict):
                continue
            dimension = cls._resolve_no_result_dimension(item.get("dimension"), dimension_map)
            if not dimension:
                continue
            reason = str(item.get("reason", "")).strip() or "未发现符合该维度定义的内容。"
            parsed.append(
                ProviderNoResult(
                    dimension=dimension.key,
                    title=dimension.label,
                    reason=reason,
                )
            )
        if parsed:
            return parsed
        return [
            ProviderNoResult(
                dimension=dimension.key,
                title=dimension.label,
                reason="未发现符合该维度定义的内容。",
            )
            for dimension in dimension_map.values()
        ]

    @staticmethod
    def _resolve_no_result_dimension(
        raw_dimension: object,
        dimension_map: dict[str, ProviderDimension],
    ) -> ProviderDimension | None:
        if len(dimension_map) == 1:
            return next(iter(dimension_map.values()))
        dimension_text = str(raw_dimension or "").strip()
        if dimension_text in dimension_map:
            return dimension_map[dimension_text]
        for dimension in dimension_map.values():
            if dimension_text == dimension.label:
                return dimension
        return None

    @staticmethod
    def _dedupe_no_results(no_results: list[ProviderNoResult]) -> list[ProviderNoResult]:
        deduped: dict[str, ProviderNoResult] = {}
        for item in no_results:
            deduped[item.dimension] = item
        return list(deduped.values())

    def generate_minutes(
        self, meeting: ParsedMeetingMetadata, summaries: list[dict]
    ) -> str:
        confirmed = [
            item for item in summaries if item.get("review_status") == "confirmed"
        ]
        if not confirmed:
            return format_minutes_locally(meeting, summaries)
        system_prompt = """你是文档阅读输出撰写助手。必须只输出合法 JSON，不要输出 Markdown。
只能依据用户提交的已确认结构化总结撰写，不得恢复已排除内容，不得编造责任人、日期、数字或结论。
如果 source=manual 且 linked_dimension_label 存在，应把该条作为对应维度下的“人工补充”组织，而不是单独放在“人工批注”章节；仍需保留其人工来源语义。
输出应适合作为阅读总结/报告；如果文档类型是 meeting，可组织为会议纪要。语言正式、简洁。
输出 JSON 格式：{"minutes":"完整输出文本"}"""
        user_payload = {
            "meeting": {
                "filename": meeting.filename,
                "document_type": meeting.document_type,
                "meeting_time": meeting.meeting_time.isoformat() if meeting.meeting_time else None,
                "duration_text": meeting.duration_text,
                "keywords": meeting.keywords,
            },
            "confirmed_summaries": [
                {
                    "dimension": item["dimension"],
                    "title": _output_summary_title(item),
                    "original_title": item["title"],
                    "summary": _output_summary_text(item),
                    "source": item.get("source") or "ai",
                    "linked_dimension_label": item.get("linked_dimension_label"),
                }
                for item in confirmed
            ],
        }
        data = self._chat_json(
            system_prompt, json.dumps(user_payload, ensure_ascii=False)
        )
        minutes = data.get("minutes")
        if not isinstance(minutes, str) or not minutes.strip():
            raise LLMProviderError(
                "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 返回结果缺少 minutes 文本。"
            )
        return minutes.strip()

    def chat(self, messages: list[dict[str, str]], context: dict | None = None) -> str:
        system_prompt = (
            "你是 Reading Without Effort 中的只读文档问答助手。"
            "你可以基于随请求提供的文档原文片段、AI总结、用户修改后的总结和审核状态回答问题，"
            "也可以解释、比较和提出建议；但不能修改分析维度、不能触发文档分析、不能触发会议分析、"
            "不能编辑总结、不能改变审核状态、不能生成或覆盖输出结果，"
            "也不要声称已经执行了任何界面操作。"
            "回答文档问题时必须以提供的上下文为准；上下文没有的信息要明确说明不知道。"
        )
        context_message = {
            "role": "system",
            "content": "当前文档只读上下文："
            + json.dumps(context or {}, ensure_ascii=False),
        }
        payload = {
            "model": self.settings.deepseek_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                context_message,
                *messages,
            ],
            "thinking": {"type": self.settings.deepseek_thinking},
            "temperature": 0.7,
            "max_tokens": min(self.settings.deepseek_max_tokens, 4096),
            "stream": False,
        }
        response = self._request_chat(payload)
        try:
            choice = response["choices"][0]
            if choice.get("finish_reason") == "length":
                raise LLMProviderError(
                    "DEEPSEEK_OUTPUT_TRUNCATED", "DeepSeek 对话输出被截断，请重试。"
                )
            content = choice["message"]["content"]
            if not isinstance(content, str) or not content.strip():
                raise LLMProviderError(
                    "DEEPSEEK_EMPTY_RESPONSE", "DeepSeek 返回了空内容，请重试。"
                )
            return content.strip()
        except LLMProviderError:
            raise
        except (KeyError, IndexError, TypeError) as error:
            raise LLMProviderError(
                "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 对话响应结构不符合预期。"
            ) from error

    def interpret_config(
        self, messages: list[dict[str, str]], dimensions: list[dict]
    ) -> dict:
        system_prompt = """你是文档阅读分析配置助手（兼容原会议分析配置助手）。你的任务仅是把用户对分析维度的自然语言要求转换成结构化操作建议。
你不能分析文档原文，不能生成文档总结，不能声称已经修改页面，也不能输出代码。
允许的 type 只有 add_dimension、remove_dimension、update_dimension、enable_dimension、disable_dimension。
add_dimension 必须返回 label 和 description；其他操作必须返回现有 dimension_key；update_dimension 至少返回 label 或 description。
用户只是在询问、讨论或表达不确定意见时，operations 必须为空。
删除、停用、修改已有维度或新增维度都需要 requires_confirmation=true。
只能引用当前配置中真实存在的 dimension_key。最多建议 9 个操作。
必须只输出合法 JSON，不要输出 Markdown。
输出格式：
{"reply":"给用户的简短说明","operations":[{"type":"add_dimension","label":"风险问题","description":"识别文档中的风险、阻碍和待确认因素"}],"warnings":["可能影响已有分析结果"],"requires_confirmation":true}"""
        payload = {
            "current_dimensions": dimensions,
            "conversation": messages,
        }
        return self._chat_json(
            system_prompt,
            json.dumps(payload, ensure_ascii=False),
        )

    def interpret_agent(
        self, message: str, context: dict, recent_messages: list[dict]
    ) -> dict:
        system_prompt = """你是AI Agent。必须只输出合法 JSON，不要输出 Markdown。
你负责把用户自然语言转换为 AgentPlan，或者在普通问答时返回 AgentMessage。
固定规则：
1. 只能从白名单 operationType 选择：answer_question、add_dimension、update_dimension、enable_dimension、disable_dimension、delete_dimension、run_selection_analysis、run_analysis、generate_output、export_word、export_txt。
2. 不允许编造 operationType、函数名或 JS 代码。
3. 修改页面状态前必须返回 plan 并等待用户确认；不得声称已经执行未执行的操作。
4. 默认不要覆盖已有总结；默认 run_analysis 使用 mergeMode=append_results。
5. 默认 preserveRules 为：manualAnnotations=always、translationCards=always、selectionAiSummaries=keep、confirmedSummaries=ask、editedSummaries=ask、excludedSummaries=keep。
6. 如果用户指令含糊，优先采用安全默认并写入 assumptions；涉及删除、覆盖全部、批量排除等高风险操作时，MVP 阶段返回 clarification_question，不生成危险操作。
7. 如果 capabilities 中某操作 disabled，不得生成对应 operation，应返回原因。
8. 长文档不会默认全量提供，只能依据 AgentContext 摘要和 selection 作计划。
9. 当 context.agentSurface = "selection_popover" 时，默认“这段话/当前内容/这里”指 context.selection；不得默认生成全文 run_analysis，不得生成 generate_output/export_word/export_txt；允许 run_selection_analysis，但它只能 target=current_selection、mergeMode=append_results，必须包含 dimensionLabel，且 context.selection 缺失时不得返回该操作，应提示“请先框选原文”；如果用户说“新增/增加/添加某维度，并用它分析这段话/当前选区”，plan.operations 应包含 add_dimension 和 run_selection_analysis，后者用 dependsOnOperationId 指向 add_dimension；涉及全文分析、生成输出、导出、清空或覆盖总结等全局任务时返回普通 message，提示用户去右侧 AI Agent；涉及维度新增/修改/启用/禁用/删除时可以返回 requiresConfirmation=true 的 AgentPlan，但不得编造未注册 operationType。
10. 当 context.agentSurface = "global_panel" 时，允许删除维度配置：用户说“删除/移除/清空维度”时返回 delete_dimension，删除所有维度必须为 high risk 且 requiresConfirmation=true；删除维度不删除已有总结卡片。必须区分“只新增维度”和“新增维度并分析全文”：如果用户只表达“新增/新建/创建/添加/增加 X 维度”（例如“新增一个待办维度”“Create an action item dimension”），plan.operations 只能包含 add_dimension，不得自动追加 run_analysis；如果用户表达“新增/新建/创建/添加/增加 X 维度，并分析全文/文章/文档/整篇内容”，即使没有明确说“用它”，也默认理解为“只用新建的 X 维度分析全文”：必须返回 add_dimension + run_analysis，且 run_analysis.params.analysisScope.type="new_dimension_only"，写入 dependsOnOperationId 指向 add_dimension、dimensionLabel=X，mergeMode="append_results"。只有用户明确说“所有维度/当前所有维度/全部维度/所有启用维度/all dimensions”时才使用 all_enabled_dimensions；用户说“只用/仅用/用 X 维度分析全文”时使用 selected_dimensions，并写入 dimensionKeys 或 dimensionLabels；不得让 run_analysis 缺少 analysisScope。
返回 plan 格式：
{"plan":{"id":"plan_x","userIntent":"...","assistantReply":"...","operations":[{"id":"op_x","type":"run_analysis","title":"...","description":"...","riskLevel":"medium","requiresConfirmation":true,"params":{"analysisScope":{"type":"all_enabled_dimensions"},"mergeMode":"append_results","preserveRules":{"manualAnnotations":"always","translationCards":"always","selectionAiSummaries":"keep","confirmedSummaries":"ask","editedSummaries":"ask","excludedSummaries":"keep"}}}],"warnings":[],"assumptions":[],"requiresConfirmation":true,"confirmationText":"确认后将执行 1 个操作。","createdAt":"ISO时间"}}
普通问答或信息不足返回 message 格式：
{"message":{"id":"msg_x","role":"assistant","content":"...","createdAt":"ISO时间","messageKind":"plain_answer"}}"""
        payload = {
            "message": message,
            "context": context,
            "recentMessages": recent_messages,
        }
        return self._chat_json(system_prompt, json.dumps(payload, ensure_ascii=False))

    def _request_chat(self, payload: dict) -> dict:
        return self.transport(
            f"{self.settings.deepseek_base_url}/chat/completions",
            {
                "Authorization": f"Bearer {self.settings.deepseek_api_key}",
                "Content-Type": "application/json",
            },
            payload,
            self.settings.deepseek_timeout_seconds,
        )

    def _chat_json(self, system_prompt: str, user_prompt: str) -> dict:
        payload = {
            "model": self.settings.deepseek_model,
            "messages": [
                {"role": "system", "content": system_prompt},
                {"role": "user", "content": user_prompt},
            ],
            "response_format": {"type": "json_object"},
            "thinking": {"type": self.settings.deepseek_thinking},
            "temperature": 0.2,
            "max_tokens": self.settings.deepseek_max_tokens,
            "stream": False,
        }
        response = self._request_chat(payload)
        try:
            choice = response["choices"][0]
            if choice.get("finish_reason") == "length":
                raise LLMProviderError(
                    "DEEPSEEK_OUTPUT_TRUNCATED", "DeepSeek JSON 输出被截断，请重试。"
                )
            content = choice["message"]["content"]
            if not content:
                raise LLMProviderError(
                    "DEEPSEEK_EMPTY_RESPONSE", "DeepSeek 返回了空内容，请重试。"
                )
            parsed = self._parse_json_content(content)
        except LLMProviderError:
            raise
        except (KeyError, IndexError, TypeError) as error:
            raise LLMProviderError(
                "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 返回的 JSON 无法解析。"
            ) from error
        if isinstance(parsed, list):
            parsed = {"summaries": parsed}
        if not isinstance(parsed, dict):
            raise LLMProviderError(
                "DEEPSEEK_INVALID_RESPONSE", "DeepSeek 返回的 JSON 顶层必须是对象。"
            )
        return parsed

    @staticmethod
    def _parse_json_content(content: str) -> object:
        candidates = [content.strip()]
        fenced = DeepSeekLLMProvider._strip_markdown_code_fence(content)
        if fenced != candidates[0]:
            candidates.append(fenced)
        extracted = DeepSeekLLMProvider._extract_first_json_value(content)
        if extracted:
            candidates.append(extracted)
        last_error: json.JSONDecodeError | None = None
        for candidate in candidates:
            if not candidate:
                continue
            try:
                return json.loads(candidate)
            except json.JSONDecodeError as error:
                last_error = error
        preview = content.strip().replace("\n", " ")[:500]
        raise LLMProviderError(
            "DEEPSEEK_INVALID_RESPONSE",
            f"DeepSeek 返回内容无法解析为 JSON。原始返回前 500 字符：{preview}",
        ) from last_error

    @staticmethod
    def _strip_markdown_code_fence(content: str) -> str:
        stripped = content.strip()
        if not stripped.startswith("```"):
            return stripped
        lines = stripped.splitlines()
        if len(lines) >= 3 and lines[-1].strip() == "```":
            return "\n".join(lines[1:-1]).strip()
        return stripped

    @staticmethod
    def _extract_first_json_value(content: str) -> str | None:
        start_positions = [
            position for position in (content.find("{"), content.find("["))
            if position != -1
        ]
        if not start_positions:
            return None
        start = min(start_positions)
        opening = content[start]
        closing = "}" if opening == "{" else "]"
        depth = 0
        in_string = False
        escaped = False
        for index in range(start, len(content)):
            char = content[index]
            if in_string:
                if escaped:
                    escaped = False
                elif char == "\\":
                    escaped = True
                elif char == '"':
                    in_string = False
                continue
            if char == '"':
                in_string = True
            elif char == opening:
                depth += 1
            elif char == closing:
                depth -= 1
                if depth == 0:
                    return content[start : index + 1].strip()
        return None

    @staticmethod
    def _parse_evidences(
        raw_evidences: object,
        segment_map: dict[str, ParsedTranscriptSegment],
    ) -> list[ProviderEvidence]:
        if not isinstance(raw_evidences, list) or not raw_evidences:
            raise LLMProviderError(
                "DEEPSEEK_INVALID_EVIDENCE", "DeepSeek 总结缺少原文证据。"
            )
        parsed: list[ProviderEvidence] = []
        for raw in raw_evidences:
            if not isinstance(raw, dict):
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_EVIDENCE", "DeepSeek 证据格式无效。"
                )
            segment_id = str(raw.get("segment_id", ""))
            quote = str(raw.get("quote", "")).strip()
            segment = segment_map.get(segment_id)
            if segment is None or not quote:
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_EVIDENCE", f"DeepSeek 证据段落无效：{segment_id}"
                )
            aligned = DeepSeekLLMProvider._align_quote(segment.text, quote)
            if aligned is None:
                raise LLMProviderError(
                    "DEEPSEEK_INVALID_EVIDENCE",
                    f"DeepSeek 引用内容无法与原文对齐：{segment_id}",
                )
            exact_quote, start, end = aligned
            parsed.append(
                ProviderEvidence(
                    segment_id=segment_id,
                    quote=exact_quote,
                    start_offset=start,
                    end_offset=end,
                )
            )
        return parsed

    @staticmethod
    def _align_quote(source: str, quote: str) -> tuple[str, int, int] | None:
        """Map harmless punctuation/spacing differences back to an exact source slice."""
        exact_start = source.find(quote)
        if exact_start >= 0:
            return quote, exact_start, exact_start + len(quote)

        def comparable(character: str) -> str:
            normalized = unicodedata.normalize("NFKC", character).casefold()
            return "".join(
                item
                for item in normalized
                if not unicodedata.category(item).startswith(("P", "Z"))
                and not item.isspace()
            )

        normalized_source: list[str] = []
        source_indexes: list[int] = []
        for index, character in enumerate(source):
            for item in comparable(character):
                normalized_source.append(item)
                source_indexes.append(index)
        normalized_quote = "".join(comparable(character) for character in quote)
        if len(normalized_quote) < 4:
            return None

        normalized_text = "".join(normalized_source)
        normalized_start = normalized_text.find(normalized_quote)
        if normalized_start < 0:
            return None
        source_start = source_indexes[normalized_start]
        source_end = source_indexes[normalized_start + len(normalized_quote) - 1] + 1
        return source[source_start:source_end], source_start, source_end


def create_llm_provider(settings: LLMSettings) -> LLMProvider:
    if settings.provider == "mock":
        return MockLLMProvider()
    if settings.provider == "deepseek":
        return DeepSeekLLMProvider(settings)
    raise LLMProviderError(
        "INVALID_LLM_PROVIDER", f"不支持的 LLM_PROVIDER：{settings.provider}"
    )


def _output_summary_title(item: dict) -> str:
    if item.get("source") == "manual" and item.get("linked_dimension_label"):
        return str(item["linked_dimension_label"])
    return str(item["title"])


def _output_summary_text(item: dict) -> str:
    summary = str(item["summary"])
    if item.get("source") == "manual" and item.get("linked_dimension_label"):
        return f"人工补充：{summary}"
    return summary


def format_minutes_locally(
    meeting: ParsedMeetingMetadata, summaries: list[dict]
) -> str:
    confirmed = [item for item in summaries if item["review_status"] == "confirmed"]
    grouped: dict[str, list[dict]] = defaultdict(list)
    for item in confirmed:
        grouped[_output_summary_title(item)].append(item)

    sections: list[str] = []
    for index, (title, items) in enumerate(grouped.items(), 1):
        lines = "\n".join(
            f"{item_index}. {_output_summary_text(item)}"
            if len(items) > 1
            else _output_summary_text(item)
            for item_index, item in enumerate(items, 1)
        )
        sections.append(f"{index}. {title}\n{lines}")

    actions = [
        item["summary"] for item in confirmed if item["dimension"] in {"next", "advice"}
    ]
    action_text = (
        "\n".join(f"□ {action}" for action in actions) or "□ 暂无已确认的后续事项"
    )
    keyword_text = "、".join(meeting.keywords) or "无"
    conclusion_text = "\n\n".join(sections) or "暂无已确认的结构化总结"
    meeting_time = _format_meeting_time(meeting.meeting_time)
    return f"""一、会议基本信息
• 会议时间：{meeting_time}
• 会议时长：{meeting.duration_text}
• 关键词：{keyword_text}

二、会议核心结论
{conclusion_text}

三、行动项
{action_text}"""


def _format_meeting_time(value: datetime) -> str:
    return value.strftime("%Y年%m月%d日 %H:%M")


def _post_json(
    url: str, headers: dict[str, str], payload: dict, timeout: float
) -> dict:
    request = Request(
        url,
        data=json.dumps(payload, ensure_ascii=False).encode("utf-8"),
        headers=headers,
        method="POST",
    )
    try:
        with urlopen(request, timeout=timeout) as response:
            return json.loads(response.read().decode("utf-8"))
    except HTTPError as error:
        body = error.read().decode("utf-8", errors="replace")
        try:
            message = json.loads(body).get("error", {}).get("message", body)
        except json.JSONDecodeError:
            message = body
        raise LLMProviderError(
            "DEEPSEEK_HTTP_ERROR", f"DeepSeek 请求失败（{error.code}）：{message}"
        ) from error
    except (URLError, TimeoutError) as error:
        raise LLMProviderError(
            "DEEPSEEK_CONNECTION_ERROR", f"无法连接 DeepSeek：{error}"
        ) from error
    except json.JSONDecodeError as error:
        raise LLMProviderError(
            "DEEPSEEK_INVALID_RESPONSE", "DeepSeek HTTP 响应不是合法 JSON。"
        ) from error
