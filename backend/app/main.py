from dataclasses import asdict

from fastapi import FastAPI, File, HTTPException, UploadFile
from pydantic import ValidationError

from .domain import ParsedMeetingMetadata, ParsedTranscriptSegment
from .config_assistant import (
    ConfigOperationError,
    apply_config_operations,
    interpret_config_request,
)
from .agent import plan_agent_request, validate_agent_plan_payload
from .config import get_llm_settings
from .evidence import EvidenceValidationError
from .llm import LLMProviderError, ProviderDimension, create_llm_provider
from .models import (
    AnalyzeDocumentRequest,
    AnalyzeDocumentResponse,
    AgentPlanRequest,
    AgentPlanResponse,
    AnalyzeMeetingRequest,
    AnalyzeMeetingResponse,
    ApplyConfigRequest,
    ApplyConfigResponse,
    ChatRequest,
    ChatResponse,
    ConfigAssistantRequest,
    ConfigAssistantResponse,
    GenerateMinutesRequest,
    GenerateMinutesResponse,
    GenerateOutputRequest,
    GenerateOutputResponse,
    HealthResponse,
    ParseDocumentResponse,
    ParseMeetingResponse,
)
from .services import analyze_document, analyze_meeting, build_output, build_minutes
from .parser import TranscriptParseError, decode_transcript, parse_document, parse_feishu_transcript

MAX_UPLOAD_BYTES = 5 * 1024 * 1024

app = FastAPI(title="Reading Without Effort API", version="0.2.0")
llm_provider = create_llm_provider(get_llm_settings())



async def _read_txt_upload(file: UploadFile) -> tuple[str, str]:
    filename = file.filename or "document.txt"
    if not filename.lower().endswith(".txt"):
        raise HTTPException(
            status_code=415,
            detail={"code": "INVALID_FILE_TYPE", "message": "仅支持 TXT 文件。"},
        )
    data = await file.read(MAX_UPLOAD_BYTES + 1)
    await file.close()
    if not data:
        raise HTTPException(
            status_code=400,
            detail={"code": "EMPTY_FILE", "message": "上传的 TXT 文件为空。"},
        )
    if len(data) > MAX_UPLOAD_BYTES:
        raise HTTPException(
            status_code=413,
            detail={"code": "FILE_TOO_LARGE", "message": "TXT 文件不能超过 5 MB。"},
        )
    return filename, decode_transcript(data)

@app.get("/api/health", response_model=HealthResponse)
def health() -> HealthResponse:
    return HealthResponse(status="ok")


@app.post("/api/documents/parse", response_model=ParseDocumentResponse)
async def parse_uploaded_document(file: UploadFile = File(...)) -> ParseDocumentResponse:
    try:
        filename, content = await _read_txt_upload(file)
        parsed = parse_document(content, filename)
        return ParseDocumentResponse.model_validate(asdict(parsed))
    except TranscriptParseError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": error.message},
        ) from error


@app.post("/api/meetings/parse", response_model=ParseMeetingResponse)
async def parse_meeting(file: UploadFile = File(...)) -> ParseMeetingResponse:
    try:
        filename, content = await _read_txt_upload(file)
        parsed = parse_feishu_transcript(content, filename)
        return ParseMeetingResponse.model_validate(asdict(parsed))
    except TranscriptParseError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": error.code, "message": error.message},
        ) from error


@app.post("/api/documents/analyze", response_model=AnalyzeDocumentResponse)
def analyze_document_endpoint(request: AnalyzeDocumentRequest) -> AnalyzeDocumentResponse:
    chunks = [ParsedTranscriptSegment(**chunk.model_dump()) for chunk in request.chunks]
    try:
        analysis = analyze_document(
            llm_provider,
            chunks,
            [ProviderDimension(key=d.key, label=d.label, description=d.description) for d in request.dimensions],
        )
    except EvidenceValidationError as error:
        raise HTTPException(status_code=422, detail={"code": "INVALID_EVIDENCE", "message": str(error)}) from error
    except LLMProviderError as error:
        raise HTTPException(status_code=502, detail={"code": error.code, "message": error.message}) from error
    return AnalyzeDocumentResponse.model_validate(analysis)


@app.post("/api/meetings/analyze", response_model=AnalyzeMeetingResponse)
def analyze(request: AnalyzeMeetingRequest) -> AnalyzeMeetingResponse:
    segments = [
        ParsedTranscriptSegment(**segment.model_dump()) for segment in request.segments
    ]
    try:
        analysis = analyze_document(
            llm_provider,
            segments,
            [
                ProviderDimension(
                    key=dimension.key,
                    label=dimension.label,
                    description=dimension.description,
                )
                for dimension in request.dimensions
            ],
        )
    except EvidenceValidationError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_EVIDENCE", "message": str(error)},
        ) from error
    except LLMProviderError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": error.code, "message": error.message},
        ) from error
    return AnalyzeMeetingResponse.model_validate(analysis)


@app.post("/api/documents/generate-output", response_model=GenerateOutputResponse)
def generate_output(request: GenerateOutputRequest) -> GenerateOutputResponse:
    metadata = ParsedMeetingMetadata(**request.document.model_dump())
    try:
        output = build_output(
            llm_provider,
            metadata,
            [summary.model_dump(mode="json") for summary in request.summaries],
            request.output_type,
        )
    except LLMProviderError as error:
        raise HTTPException(status_code=502, detail={"code": error.code, "message": error.message}) from error
    return GenerateOutputResponse(output=output)


@app.post("/api/meetings/generate-minutes", response_model=GenerateMinutesResponse)
def generate_minutes(request: GenerateMinutesRequest) -> GenerateMinutesResponse:
    metadata = ParsedMeetingMetadata(**request.meeting.model_dump())
    try:
        minutes = build_minutes(
            llm_provider,
            metadata,
            [summary.model_dump(mode="json") for summary in request.summaries],
        )
    except LLMProviderError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": error.code, "message": error.message},
        ) from error
    return GenerateMinutesResponse(minutes=minutes)


@app.post("/api/chat", response_model=ChatResponse)
def chat(request: ChatRequest) -> ChatResponse:
    try:
        content = llm_provider.chat(
            [message.model_dump() for message in request.messages],
            request.context.model_dump(mode="json") if request.context else None,
        )
    except LLMProviderError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": error.code, "message": error.message},
        ) from error
    return ChatResponse.model_validate(
        {"message": {"role": "assistant", "content": content}}
    )


@app.post("/api/analysis-config/interpret", response_model=ConfigAssistantResponse)
def interpret_analysis_config(
    request: ConfigAssistantRequest,
) -> ConfigAssistantResponse:
    try:
        result = interpret_config_request(
            llm_provider,
            [message.model_dump() for message in request.messages],
            [dimension.model_dump() for dimension in request.dimensions],
        )
        return ConfigAssistantResponse.model_validate(result)
    except ValidationError as error:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "INVALID_CONFIG_ASSISTANT_RESPONSE",
                "message": "大模型返回的配置操作格式无效，请换一种说法重试。",
            },
        ) from error
    except LLMProviderError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": error.code, "message": error.message},
        ) from error


@app.post("/api/analysis-config/apply", response_model=ApplyConfigResponse)
def apply_analysis_config(request: ApplyConfigRequest) -> ApplyConfigResponse:
    try:
        dimensions, affected = apply_config_operations(
            request.dimensions, request.operations
        )
    except ConfigOperationError as error:
        raise HTTPException(
            status_code=422,
            detail={"code": "INVALID_CONFIG_OPERATION", "message": str(error)},
        ) from error
    return ApplyConfigResponse(
        dimensions=dimensions,
        affected_dimension_keys=affected,
        analysis_required=True,
    )


@app.post("/api/agent/plan", response_model=AgentPlanResponse)
def plan_agent(request: AgentPlanRequest) -> AgentPlanResponse:
    try:
        payload = plan_agent_request(
            llm_provider,
            request.message,
            request.context.model_dump(mode="json"),
            [message.model_dump(mode="json") for message in request.recentMessages],
        )
        return validate_agent_plan_payload(payload, request.context.model_dump(mode="json"))
    except ValidationError as error:
        raise HTTPException(
            status_code=502,
            detail={
                "code": "INVALID_AGENT_PLAN",
                "message": "Agent 返回的操作计划格式无效，请换一种说法重试。",
            },
        ) from error
    except LLMProviderError as error:
        raise HTTPException(
            status_code=502,
            detail={"code": error.code, "message": error.message},
        ) from error
