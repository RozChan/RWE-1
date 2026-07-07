from datetime import datetime
from enum import StrEnum
from typing import Any, Literal

from pydantic import BaseModel, Field, model_validator


class ReviewStatus(StrEnum):
    DRAFT = "draft"
    CONFIRMED = "confirmed"
    EXCLUDED = "excluded"


class DocumentType(StrEnum):
    MEETING = "meeting"
    GENERIC_TEXT = "generic_text"
    POLICY = "policy"
    CONTRACT = "contract"
    REPORT = "report"
    PAPER = "paper"
    REQUIREMENT = "requirement"
    OTHER = "other"


class DocumentMetadata(BaseModel):
    filename: str
    document_type: DocumentType = DocumentType.GENERIC_TEXT
    title: str | None = None
    char_count: int = Field(default=0, ge=0)
    chunk_count: int = Field(default=0, ge=0)
    meeting_time: datetime | None = None
    duration_seconds: int | None = Field(default=None, ge=0)
    duration_text: str | None = None
    keywords: list[str] = Field(default_factory=list)
    metadata: dict[str, Any] = Field(default_factory=dict)


class DocumentChunk(BaseModel):
    id: str = Field(pattern=r"^P[1-9]\d*$")
    text: str = Field(min_length=1)
    kind: Literal["utterance", "paragraph", "heading", "list_item", "table", "quote"] = "paragraph"
    speaker: str | None = None
    timestamp: str | None = Field(default=None, pattern=r"^\d{2}:\d{2}(?::\d{2})?$")
    start_seconds: int | None = Field(default=None, ge=0)
    heading_path: list[str] | None = None
    page_number: int | None = Field(default=None, ge=1)
    start_offset: int | None = Field(default=None, ge=0)
    end_offset: int | None = Field(default=None, ge=0)
    metadata: dict[str, Any] = Field(default_factory=dict)

    @model_validator(mode="after")
    def validate_offsets(self) -> "DocumentChunk":
        if self.start_offset is not None and self.end_offset is not None:
            if self.end_offset <= self.start_offset:
                raise ValueError("end_offset must be greater than start_offset")
        return self


class ParseDocumentResponse(BaseModel):
    document: DocumentMetadata
    chunks: list[DocumentChunk]


# Backward-compatible meeting names. They intentionally point at the document model.
MeetingMetadata = DocumentMetadata
TranscriptSegment = DocumentChunk


class ParseMeetingResponse(BaseModel):
    meeting: MeetingMetadata
    segments: list[TranscriptSegment]


class Evidence(BaseModel):
    id: str
    # segment_id is retained for wire compatibility; it now refers to a generic document chunk id.
    segment_id: str = Field(pattern=r"^P[1-9]\d*$")
    quote: str = Field(min_length=1)
    start_offset: int = Field(ge=0)
    end_offset: int = Field(gt=0)
    verified: bool = False

    @model_validator(mode="after")
    def validate_offsets(self) -> "Evidence":
        if self.end_offset <= self.start_offset:
            raise ValueError("end_offset must be greater than start_offset")
        return self


class AnalysisDimension(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str = Field(min_length=1, max_length=20)
    description: str = Field(min_length=1, max_length=200)


class StructuredSummary(BaseModel):
    id: str
    dimension: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    title: str
    summary: str = Field(min_length=1)
    evidences: list[Evidence] = Field(min_length=1)
    review_status: ReviewStatus = ReviewStatus.DRAFT
    model_confidence: float | None = Field(default=None, ge=0, le=1)
    source: Literal["ai", "selection_ai", "manual"] | None = None
    linked_dimension_key: str | None = Field(
        default=None, pattern=r"^[a-z][a-z0-9_-]{0,31}$"
    )
    linked_dimension_label: str | None = Field(default=None, min_length=1, max_length=20)


class AnalysisNoResult(BaseModel):
    dimension: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    title: str
    reason: str = Field(min_length=1)


class HealthResponse(BaseModel):
    status: str
    llm_provider: str
    llm_model: str


class AnalyzeDocumentRequest(BaseModel):
    document: DocumentMetadata
    chunks: list[DocumentChunk] = Field(min_length=1)
    dimensions: list[AnalysisDimension] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_dimensions(self) -> "AnalyzeDocumentRequest":
        keys = [dimension.key for dimension in self.dimensions]
        if len(keys) != len(set(keys)):
            raise ValueError("分析维度 key 不能重复")
        return self


class AnalyzeDocumentResponse(BaseModel):
    summaries: list[StructuredSummary]
    no_results: list[AnalysisNoResult] = Field(default_factory=list)


class AnalyzeMeetingRequest(BaseModel):
    meeting: MeetingMetadata
    segments: list[TranscriptSegment] = Field(min_length=1)
    dimensions: list[AnalysisDimension] = Field(min_length=1)

    @model_validator(mode="after")
    def validate_unique_dimensions(self) -> "AnalyzeMeetingRequest":
        keys = [dimension.key for dimension in self.dimensions]
        if len(keys) != len(set(keys)):
            raise ValueError("分析维度 key 不能重复")
        return self


AnalyzeMeetingResponse = AnalyzeDocumentResponse


class GenerateOutputRequest(BaseModel):
    document: DocumentMetadata
    summaries: list[StructuredSummary]
    output_type: Literal[
        "meeting_minutes",
        "reading_summary",
        "executive_summary",
        "risk_report",
        "action_items",
        "study_notes",
    ] = "reading_summary"


class GenerateOutputResponse(BaseModel):
    output: str


class GenerateMinutesRequest(BaseModel):
    meeting: MeetingMetadata
    summaries: list[StructuredSummary]


class GenerateMinutesResponse(BaseModel):
    minutes: str


class ChatMessage(BaseModel):
    role: Literal["user", "assistant"]
    content: str = Field(min_length=1, max_length=4000)


class ChatSummary(BaseModel):
    id: str
    dimension: str
    title: str
    summary: str = Field(default="", max_length=10000)
    review_status: ReviewStatus
    evidences: list[Evidence] = Field(default_factory=list)


class ChatContext(BaseModel):
    document: DocumentMetadata | None = None
    chunks: list[DocumentChunk] = Field(default_factory=list)
    summaries: list[ChatSummary] = Field(default_factory=list)
    output_draft: str | None = None
    # Backward compatibility for old clients.
    meeting: MeetingMetadata | None = None
    segments: list[TranscriptSegment] = Field(default_factory=list)


class ChatRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)
    context: ChatContext | None = None

    @model_validator(mode="after")
    def validate_last_message(self) -> "ChatRequest":
        if self.messages[-1].role != "user":
            raise ValueError("最后一条消息必须来自用户")
        return self


class ChatResponse(BaseModel):
    message: ChatMessage


class AnalysisDimensionConfig(AnalysisDimension):
    enabled: bool = True


class ConfigOperation(BaseModel):
    type: Literal[
        "add_dimension",
        "remove_dimension",
        "update_dimension",
        "enable_dimension",
        "disable_dimension",
    ]
    dimension_key: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str | None = Field(default=None, min_length=1, max_length=20)
    description: str | None = Field(default=None, min_length=1, max_length=200)

    @model_validator(mode="after")
    def validate_operation_fields(self) -> "ConfigOperation":
        if self.type == "add_dimension":
            if not self.label or not self.description:
                raise ValueError("新增维度必须包含 label 和 description")
            return self
        if not self.dimension_key:
            raise ValueError(f"{self.type} 必须包含 dimension_key")
        if self.type == "update_dimension" and not (self.label or self.description):
            raise ValueError("修改维度必须至少包含 label 或 description")
        return self


class ConfigAssistantRequest(BaseModel):
    messages: list[ChatMessage] = Field(min_length=1, max_length=30)
    dimensions: list[AnalysisDimensionConfig] = Field(default_factory=list)

    @model_validator(mode="after")
    def validate_request(self) -> "ConfigAssistantRequest":
        if self.messages[-1].role != "user":
            raise ValueError("最后一条消息必须来自用户")
        keys = [dimension.key for dimension in self.dimensions]
        if len(keys) != len(set(keys)):
            raise ValueError("分析维度 key 不能重复")
        return self


class ConfigAssistantResponse(BaseModel):
    reply: str = Field(min_length=1)
    operations: list[ConfigOperation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    requires_confirmation: bool = True


class ApplyConfigRequest(BaseModel):
    dimensions: list[AnalysisDimensionConfig] = Field(default_factory=list)
    operations: list[ConfigOperation] = Field(min_length=1)


class ApplyConfigResponse(BaseModel):
    dimensions: list[AnalysisDimensionConfig]
    affected_dimension_keys: list[str]
    analysis_required: bool


AgentOperationType = Literal[
    "answer_question",
    "add_dimension",
    "update_dimension",
    "enable_dimension",
    "disable_dimension",
    "delete_dimension",
    "run_selection_analysis",
    "run_analysis",
    "generate_output",
    "export_word",
    "export_txt",
]


class AgentMessage(BaseModel):
    id: str
    role: Literal["user", "assistant", "system"]
    content: str = Field(min_length=1, max_length=4000)
    createdAt: str
    messageKind: Literal[
        "plain_answer",
        "plan_preview",
        "execution_update",
        "error",
        "clarification_question",
    ]
    planId: str | None = None
    executionId: str | None = None


class AgentCapability(BaseModel):
    operationType: AgentOperationType
    enabled: bool
    disabledReason: str | None = None
    requiresConfirmation: bool


class AgentContextDocument(BaseModel):
    id: str
    title: str
    type: DocumentType
    chunkCount: int = Field(ge=0)


class AgentContextDimension(BaseModel):
    key: str = Field(pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str = Field(min_length=1, max_length=20)
    description: str = Field(min_length=1, max_length=200)
    enabled: bool


class AgentContextSummary(BaseModel):
    id: str
    title: str
    dimension: str
    status: ReviewStatus
    source: Literal["ai", "selection_ai", "manual"] = "ai"
    flagged: bool
    editedByUser: bool
    preview: str = Field(default="", max_length=500)


class AgentContextOutputDraft(BaseModel):
    exists: bool
    length: int = Field(ge=0)
    preview: str | None = Field(default=None, max_length=500)


class AgentContextSelection(BaseModel):
    chunkId: str
    quote: str = Field(min_length=1, max_length=2000)
    startOffset: int = Field(ge=0)
    endOffset: int = Field(gt=0)


class AgentContext(BaseModel):
    agentSurface: Literal["global_panel", "selection_popover"] = "global_panel"
    document: AgentContextDocument | None = None
    dimensions: list[AgentContextDimension] = Field(default_factory=list)
    summaries: list[AgentContextSummary] = Field(default_factory=list, max_length=100)
    outputDraft: AgentContextOutputDraft
    selection: AgentContextSelection | None = None
    capabilities: list[AgentCapability] = Field(default_factory=list)


class AgentAnalysisScope(BaseModel):
    type: Literal[
        "all_enabled_dimensions",
        "selected_dimensions",
        "new_dimension_only",
        "current_dimension_only",
    ]
    dimensionKeys: list[str] | None = None
    dimensionLabels: list[str] | None = None
    tempDimensionRef: str | None = None
    dependsOnOperationId: str | None = None
    dimensionLabel: str | None = None
    dimensionKey: str | None = None


class PreserveRules(BaseModel):
    manualAnnotations: Literal["always"] = "always"
    translationCards: Literal["always"] = "always"
    selectionAiSummaries: Literal["keep", "replace", "ask"] = "keep"
    confirmedSummaries: Literal["keep", "replace", "ask"] = "ask"
    editedSummaries: Literal["keep", "replace", "ask"] = "ask"
    excludedSummaries: Literal["keep", "drop", "ask"] = "keep"


class AgentOperationParams(BaseModel):
    dimensionKey: str | None = Field(default=None, pattern=r"^[a-z][a-z0-9_-]{0,31}$")
    label: str | None = Field(default=None, min_length=1, max_length=20)
    description: str | None = Field(default=None, min_length=1, max_length=200)
    target: Literal["current_selection"] | None = None
    dimensionLabel: str | None = Field(default=None, min_length=1, max_length=20)
    dependsOnOperationId: str | None = Field(default=None, max_length=80)
    analysisScope: AgentAnalysisScope | None = None
    mergeMode: Literal[
        "append_results",
        "replace_ai_results",
        "replace_same_dimensions",
        "new_version",
    ] | None = None
    preserveRules: PreserveRules | None = None
    answer: str | None = Field(default=None, max_length=4000)


class AgentOperation(BaseModel):
    id: str
    type: AgentOperationType
    title: str = Field(min_length=1)
    description: str = Field(min_length=1)
    riskLevel: Literal["low", "medium", "high"]
    requiresConfirmation: bool
    params: AgentOperationParams = Field(default_factory=AgentOperationParams)

    @model_validator(mode="after")
    def validate_agent_operation(self) -> "AgentOperation":
        if self.type != "answer_question" and not self.requiresConfirmation:
            raise ValueError("修改页面状态的 Agent operation 必须 requiresConfirmation=true")
        if self.type == "answer_question" and self.riskLevel != "low":
            raise ValueError("answer_question 必须是 low risk")
        if self.type == "run_analysis":
            if not self.params.analysisScope:
                raise ValueError("run_analysis 必须包含 analysisScope")
            if not self.params.mergeMode:
                raise ValueError("run_analysis 必须包含 mergeMode")
            if self.params.analysisScope.type == "new_dimension_only" and not (
                self.params.analysisScope.dependsOnOperationId
                or self.params.analysisScope.tempDimensionRef
                or self.params.analysisScope.dimensionLabel
            ):
                raise ValueError("run_analysis 的 new_dimension_only 必须包含 dependsOnOperationId、tempDimensionRef 或 dimensionLabel")
        if self.type == "run_selection_analysis":
            if self.params.target != "current_selection":
                raise ValueError("run_selection_analysis 只能包含 target=current_selection")
            if not self.params.dimensionLabel:
                raise ValueError("run_selection_analysis 必须包含 dimensionLabel")
            if self.params.mergeMode != "append_results":
                raise ValueError("run_selection_analysis 必须包含 mergeMode=append_results")
        if self.type in {"add_dimension", "update_dimension"}:
            if self.type == "add_dimension" and not (self.params.label and self.params.description):
                raise ValueError("add_dimension 必须包含 label 和 description")
            if self.type == "update_dimension" and not self.params.dimensionKey:
                raise ValueError("update_dimension 必须包含 dimensionKey")
        if self.type in {"enable_dimension", "disable_dimension", "delete_dimension"} and not self.params.dimensionKey:
            raise ValueError(f"{self.type} 必须包含 dimensionKey")
        return self


class AgentPlan(BaseModel):
    id: str
    userIntent: str
    assistantReply: str
    operations: list[AgentOperation] = Field(default_factory=list)
    warnings: list[str] = Field(default_factory=list)
    assumptions: list[str] = Field(default_factory=list)
    requiresConfirmation: bool
    confirmationText: str
    createdAt: str
    expiresAt: str | None = None


class AgentPlanRequest(BaseModel):
    message: str = Field(min_length=1, max_length=8000)
    context: AgentContext
    recentMessages: list[AgentMessage] = Field(default_factory=list, max_length=20)


class AgentPlanResponse(BaseModel):
    plan: AgentPlan | None = None
    message: AgentMessage | None = None

    @model_validator(mode="after")
    def validate_response_shape(self) -> "AgentPlanResponse":
        if bool(self.plan) == bool(self.message):
            raise ValueError("AgentPlanResponse 必须且只能包含 plan 或 message")
        return self
