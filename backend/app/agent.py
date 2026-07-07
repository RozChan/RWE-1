from __future__ import annotations

from datetime import datetime, timezone
import re
from typing import Any

from .llm import LLMProvider
from .models import AgentPlanResponse

DEFAULT_PRESERVE_RULES = {
    "manualAnnotations": "always",
    "translationCards": "always",
    "selectionAiSummaries": "keep",
    "confirmedSummaries": "ask",
    "editedSummaries": "ask",
    "excludedSummaries": "keep",
}

AGENT_INSTRUCTIONS = """你是AI Agent。
你只能从白名单 AgentOperation 中选择操作，不允许编造 operationType。
修改页面状态前必须生成 AgentPlan 并等待用户确认，不允许声称已经执行未执行的操作。
默认不要覆盖已有总结；默认分析结果追加；默认保留人工批注、翻译卡片、手动编辑内容。
如果用户指令含糊，比如“重新分析一下”，必须反问或采用安全默认值，并在 assumptions 中说明。
如果用户要求覆盖、批量排除等高风险操作，MVP 阶段先返回不支持或需要二次确认，不要直接执行；删除维度配置必须生成需要确认的 delete_dimension 操作，不删除已有总结卡片。
当 AgentContext.agentSurface = selection_popover 时，默认“这段话/当前内容/这里”指当前 selection；不得默认生成全文 run_analysis，不得生成 generate_output/export_word/export_txt；如果用户说“新增某维度并用它分析这段话”，AgentPlan 应返回 add_dimension + run_selection_analysis，其中 run_selection_analysis 只能 target=current_selection、mergeMode=append_results；涉及全文、导出、生成输出等全局任务时返回普通 message 提示去右侧 AI Agent；涉及维度新增/修改/启用/禁用时可以返回需要确认的 AgentPlan。
当 AgentContext.agentSurface = global_panel 时，支持一次新增、更新、启用、停用或删除多个阅读维度；允许 0 个启用维度，不设置维度数量硬上限。用户只要求新增维度时不得自动分析；只有明确要求分析全文/文档/文章时才追加 run_analysis。
长文档内容不会默认全量提供，你只能依据 AgentContext 摘要和 selection 作计划。"""


def plan_agent_request(provider: LLMProvider, message: str, context: dict[str, Any], recent_messages: list[dict[str, Any]]) -> dict[str, Any]:
    if hasattr(provider, "interpret_agent") and provider.name != "mock":
        payload = provider.interpret_agent(message, context, recent_messages)  # type: ignore[attr-defined]
        return _sanitize_agent_plan(message, context, payload)
    return _mock_agent_plan(message, context)


def _sanitize_agent_plan(message: str, context: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    payload = _sanitize_selection_popover_plan(message, context, payload)
    return _sanitize_global_panel_plan(message, context, payload)


def validate_agent_plan_payload(payload: dict[str, Any], context: dict[str, Any] | None = None) -> AgentPlanResponse:
    if context and context.get("agentSurface") == "selection_popover" and payload.get("plan"):
        operations = payload.get("plan", {}).get("operations") or []
        if any(operation.get("type") == "run_selection_analysis" for operation in operations) and not context.get("selection"):
            return AgentPlanResponse.model_validate(_message("请先框选原文，再让 Selection Agent 分析当前选区。", "clarification_question"))
    return AgentPlanResponse.model_validate(payload)


def _sanitize_selection_popover_plan(message: str, context: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    if context.get("agentSurface") != "selection_popover" or "plan" not in payload:
        return payload
    plan = payload.get("plan") or {}
    operations = plan.get("operations") or []
    disallowed_global = {"run_analysis", "generate_output", "export_word", "export_txt"}
    if any(operation.get("type") in disallowed_global for operation in operations):
        if any(token in message for token in ("这段话", "当前选区", "当前内容", "这里")):
            operations = [
                operation for operation in operations
                if operation.get("type") not in disallowed_global
            ]
        else:
            return _message("该操作会影响全文或全局输出，请到右侧 AI Agent 中确认执行。")
    if any(operation.get("type") == "run_selection_analysis" for operation in operations) and not context.get("selection"):
        return _message("请先框选原文，再让 Selection Agent 分析当前选区。", "clarification_question")
    allowed = {"answer_question", "add_dimension", "update_dimension", "enable_dimension", "disable_dimension", "run_selection_analysis"}
    sanitized_operations = []
    for operation in operations:
        if operation.get("type") not in allowed:
            continue
        if operation.get("type") == "run_selection_analysis":
            params = operation.setdefault("params", {})
            params["target"] = "current_selection"
            params["mergeMode"] = "append_results"
            if not params.get("dimensionLabel"):
                dimension_key = params.get("dimensionKey")
                matched_dimension = next(
                    (dimension for dimension in context.get("dimensions", []) if dimension.get("key") == dimension_key),
                    None,
                )
                params["dimensionLabel"] = params.get("label") or (matched_dimension or {}).get("label")
            if not params.get("dimensionLabel"):
                return _message("Selection Agent 需要明确阅读维度后才能分析当前选区。", "clarification_question")
        sanitized_operations.append(operation)
    operations = sanitized_operations
    if not operations:
        return _message("Selection Agent 当前只支持选区问答和维度配置计划；全文分析、生成输出或导出请到右侧 AI Agent 中确认执行。")
    plan["operations"] = operations
    plan["requiresConfirmation"] = any(operation.get("requiresConfirmation") for operation in operations)
    plan["confirmationText"] = f"确认后将执行 {len(operations)} 个操作。"
    payload["plan"] = plan
    return payload


def _payload_runs_all_dimensions_with_no_enabled_dimensions(payload: dict[str, Any], context: dict[str, Any]) -> bool:
    if any(dimension.get("enabled") for dimension in context.get("dimensions", [])):
        return False
    operations = (payload.get("plan") or {}).get("operations") or []
    for operation in operations:
        if operation.get("type") != "run_analysis":
            continue
        scope = (operation.get("params") or {}).get("analysisScope") or {}
        if scope.get("type") in (None, "all_enabled_dimensions"):
            return True
    return False


def _global_multi_dimension_payload(message: str, context: dict[str, Any]) -> dict[str, Any] | None:
    text = message.strip()
    delete_intent = any(token in text for token in ("删除", "移除", "删掉", "清空"))
    disable_intent = any(token in text for token in ("停用", "关闭", "关掉", "禁用"))
    if delete_intent or disable_intent:
        operation_type = "delete_dimension" if delete_intent else "disable_dimension"
        verb = "删除" if delete_intent else "停用"
        risk = "high" if delete_intent and any(token in text for token in ("所有", "全部", "清空")) else ("medium" if delete_intent else "medium")
        targets = context.get("dimensions", []) if any(token in text for token in ("所有维度", "全部维度", "所有阅读维度", "全部阅读维度", "清空所有维度", "清空维度")) else []
        if not targets:
            labels = _extract_dimension_labels_from_command(text)
            targets = [target for label in labels if (target := _find_dimension_by_label(context, label))]
        operations = []
        for target in targets:
            label = target.get("label", "目标")
            description = "删除维度配置后，后续 AI 分析不会再使用该维度；已有总结卡片不会被删除。" if delete_intent else "停用后后续分析默认不再使用该维度。"
            operations.append(_operation(
                _make_operation_id(operation_type, len(operations)),
                operation_type,
                f"{verb}维度：{label}",
                description,
                {"dimensionKey": target["key"]},
                risk,
            ))
        if operations:
            return _multi_dimension_plan(text, operations, f"我将{verb} {len(operations)} 个阅读维度。")
        if delete_intent or disable_intent:
            return _message("未找到要处理的阅读维度，请提供准确的维度名称。", "clarification_question")

    is_update = any(token in text for token in ("修改以下维度描述", "更新以下维度描述", "修改维度描述", "更新维度描述"))
    definitions = _extract_multiple_dimension_definitions(text)
    if is_update and definitions:
        operations = []
        for definition in definitions:
            target = _find_dimension_by_label(context, definition["label"])
            if target:
                operations.append(_operation(
                    _make_operation_id("update_dimension", len(operations)),
                    "update_dimension",
                    f"更新维度：{target.get('label', definition['label'])}",
                    definition["description"],
                    {"dimensionKey": target["key"], "description": definition["description"]},
                    "medium",
                ))
        if operations:
            return _multi_dimension_plan(text, operations, f"我将更新 {len(operations)} 个阅读维度的描述。")

    if not _mentions_add_dimension(text, text.lower()) or not definitions:
        if _mentions_document_analysis(text) and not any(dimension.get("enabled") for dimension in context.get("dimensions", [])):
            return _message("当前没有启用的阅读维度，请先添加或启用维度后再分析全文。", "clarification_question")
        return None

    if len(definitions) <= 1:
        return None
    operations = _operations_for_dimension_definitions(context, definitions)
    if not operations:
        return _message("这些阅读维度已存在，本次不会重复新增。")
    if _mentions_document_analysis(text):
        labels = [definition["label"] for definition in definitions]
        operations.append(_operation(
            _make_operation_id("run_analysis", len(operations)),
            "run_analysis",
            "仅用新增/指定维度分析全文",
            "仅使用本次指定的阅读维度分析全文，结果将追加到当前总结区，不覆盖已有总结。",
            {
                "analysisScope": {"type": "selected_dimensions", "dimensionLabels": labels},
                "mergeMode": "append_results",
                "preserveRules": DEFAULT_PRESERVE_RULES,
            },
            "medium",
        ))
        return _plan(text, f"我将配置 {len(definitions)} 个阅读维度，并仅用这些维度分析全文。", operations)
    return _multi_dimension_plan(text, operations, f"我将配置 {len(definitions)} 个阅读维度。")


def _sanitize_global_panel_plan(message: str, context: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    if context.get("agentSurface", "global_panel") != "global_panel" or "plan" not in payload:
        return payload
    multi_payload = _global_multi_dimension_payload(message, context)
    if multi_payload:
        return multi_payload
    if _is_add_dimension_only_intent(message):
        return _sanitize_global_add_dimension_only_plan(message, context, payload)
    if not _is_add_dimension_document_analysis_intent(message):
        if _payload_runs_all_dimensions_with_no_enabled_dimensions(payload, context):
            return _message("当前没有启用的阅读维度，请先添加或启用维度后再分析全文。", "clarification_question")
        return payload
    plan = payload.get("plan") or {}
    operations = plan.get("operations") or []
    add_operation = next((operation for operation in operations if operation.get("type") == "add_dimension"), None)
    if not add_operation:
        label = _extract_dimension_label(message)
        if label == "自定义维度":
            return _message(
                f"你是想新增“{label}”维度，并只用该维度分析全文吗？请确认：1. 是，只用新维度分析全文；2. 否，按所有启用维度分析全文；3. 只新增维度，不分析。",
                "clarification_question",
            )
        add_operation = _operation(
            "op_add_dimension",
            "add_dimension",
            f"新增维度：{label}",
            _extract_dimension_description(message, label),
            {"label": label, "description": _extract_dimension_description(message, label)},
            "medium",
        )
        operations.insert(0, add_operation)
    params = add_operation.setdefault("params", {})
    label = _normalize_dimension_label(params.get("label") or _extract_dimension_label(message))
    params["label"] = label
    if not params.get("description") or _is_generic_dimension_description(params.get("description", "")):
        params["description"] = _extract_dimension_description(message, label)
    add_operation["title"] = add_operation.get("title") or f"新增维度：{label}"
    add_operation["description"] = add_operation.get("description") or params["description"]
    run_operation = next((operation for operation in operations if operation.get("type") == "run_analysis"), None)
    if not run_operation:
        run_operation = _operation(
            "op_run_analysis",
            "run_analysis",
            f"只用“{label}”维度分析全文",
            f"仅使用新增的“{label}”维度分析全文，结果将追加到当前总结区，不覆盖已有总结。",
            {},
            "medium",
        )
        operations.append(run_operation)
    run_params = run_operation.setdefault("params", {})
    run_params["analysisScope"] = {
        "type": "new_dimension_only",
        "dependsOnOperationId": add_operation.get("id", "op_add_dimension"),
        "tempDimensionRef": add_operation.get("id", "op_add_dimension"),
        "dimensionLabel": label,
    }
    run_params["mergeMode"] = "append_results"
    run_params["preserveRules"] = run_params.get("preserveRules") or DEFAULT_PRESERVE_RULES
    run_operation["title"] = run_operation.get("title") or f"只用“{label}”维度分析全文"
    run_operation["description"] = run_operation.get("description") or f"仅使用新增的“{label}”维度分析全文，结果将追加到当前总结区，不覆盖已有总结。"
    plan["operations"] = operations
    plan["requiresConfirmation"] = any(operation.get("requiresConfirmation") for operation in operations)
    plan["confirmationText"] = f"确认后将执行 {len(operations)} 个操作。"
    payload["plan"] = plan
    return payload


def _sanitize_global_add_dimension_only_plan(message: str, context: dict[str, Any], payload: dict[str, Any]) -> dict[str, Any]:
    plan = payload.get("plan") or {}
    operations = plan.get("operations") or []
    add_operation = next((operation for operation in operations if operation.get("type") == "add_dimension"), None)
    if not add_operation:
        label = _extract_dimension_label(message)
        add_operation = _operation(
            "op_add_dimension",
            "add_dimension",
            f"新增维度：{label}",
            _extract_dimension_description(message, label),
            {"label": label, "description": _extract_dimension_description(message, label)},
            "medium",
        )
    params = add_operation.setdefault("params", {})
    label = _normalize_dimension_label(params.get("label") or _extract_dimension_label(message))
    params["label"] = label
    if not params.get("description") or _is_generic_dimension_description(params.get("description", "")):
        params["description"] = _extract_dimension_description(message, label)
    add_operation["title"] = f"新增维度：{label}"
    add_operation["description"] = params["description"]
    existing = _find_dimension_by_label(context, label)
    if existing:
        operations = []
        if params.get("description") and params.get("description") != existing.get("description"):
            operations.append(_operation("op_update_dimension", "update_dimension", f"更新维度：{existing.get('label', label)}", params["description"], {"dimensionKey": existing["key"], "description": params["description"]}, "medium"))
        if existing.get("enabled") is False:
            operations.append(_operation("op_enable_dimension", "enable_dimension", f"启用维度：{existing.get('label', label)}", "该维度已存在但当前关闭，确认后将重新启用。", {"dimensionKey": existing["key"]}, "medium"))
        if not operations:
            return _message(f"“{label}”维度已存在，本次不会重复新增。")
        plan["operations"] = operations
    else:
        plan["operations"] = [add_operation]
    plan["requiresConfirmation"] = any(operation.get("requiresConfirmation") for operation in plan["operations"])
    plan["confirmationText"] = f"确认后将执行 {len(plan['operations'])} 个操作。"
    payload["plan"] = plan
    return payload


def _now() -> str:
    return datetime.now(timezone.utc).isoformat()


def _message(content: str, kind: str = "plain_answer") -> dict[str, Any]:
    return {
        "message": {
            "id": f"msg_{int(datetime.now().timestamp() * 1000)}",
            "role": "assistant",
            "content": content,
            "createdAt": _now(),
            "messageKind": kind,
        }
    }


def _dimension_by_label(context: dict[str, Any], text: str) -> dict[str, Any] | None:
    for dimension in context.get("dimensions", []):
        if dimension.get("label") and dimension["label"] in text:
            return dimension
    normalized_text = _dimension_label_key(text)
    return next(
        (dimension for dimension in context.get("dimensions", []) if _dimension_label_key(dimension.get("label", "")) and _dimension_label_key(dimension.get("label", "")) in normalized_text),
        None,
    )


def _dimension_label_key(label: str) -> str:
    return re.sub(r"[\s\-_:：，,。.;；、]+", "", _normalize_dimension_label(label).lower())


def _find_dimension_by_label(context: dict[str, Any], label: str) -> dict[str, Any] | None:
    label_key = _dimension_label_key(label)
    return next(
        (dimension for dimension in context.get("dimensions", []) if _dimension_label_key(dimension.get("label", "")) == label_key),
        None,
    )


def _make_operation_id(prefix: str, index: int) -> str:
    return f"op_{prefix}_{index + 1}"


def _skip_dimension_definition_line(line: str) -> bool:
    compact = line.strip()
    if not compact:
        return True
    lowered = compact.lower()
    return any(token in compact for token in ("如下", "以下维度", "添加维度", "新增维度", "阅读维度", "修改以下", "介绍如下")) or lowered in {"dimensions", "dimension"}


def _strip_list_marker(line: str) -> str:
    return re.sub(r"^\s*(?:[-*•]\s*)?(?:\d+[.)、]\s*)?", "", line).strip()


def _extract_multiple_dimension_definitions(text: str) -> list[dict[str, str]]:
    definitions: list[dict[str, str]] = []
    lines = [line.strip() for line in text.splitlines()]
    index = 0
    while index < len(lines):
        raw_line = lines[index]
        line = _strip_list_marker(raw_line)
        if _skip_dimension_definition_line(line):
            index += 1
            continue
        match = re.match(r"^([^：:\t]{1,20}?)[\t ]{2,}(.+)$", line)
        if not match:
            match = re.match(r"^([^：:]{1,20})[：:]\s*(.+)$", line)
        if match:
            label = _normalize_dimension_label(match.group(1))
            description = match.group(2).strip()
            definitions.append({"label": label, "description": description or _default_dimension_description(label)})
            index += 1
            continue
        if 1 <= len(line) <= 20 and "维度" not in line and "分析" not in line:
            next_index = index + 1
            while next_index < len(lines) and not lines[next_index].strip():
                next_index += 1
            if next_index < len(lines):
                next_line = _strip_list_marker(lines[next_index])
                if next_line and not _skip_dimension_definition_line(next_line) and not re.match(r"^([^：:]{1,20})[：:]", next_line):
                    label = _normalize_dimension_label(line)
                    definitions.append({"label": label, "description": next_line.strip() or _default_dimension_description(label)})
                    index = next_index + 1
                    continue
        index += 1

    if not definitions and _mentions_add_dimension(text, text.lower()) and not any(token in text for token in ("描述为", "描述是", "说明是")):
        cleaned = text
        cleaned = re.split(r"并|然后|且|and", cleaned, maxsplit=1)[0]
        for token in ("请", "帮我", "添加", "新增", "增加", "新建", "创建", "建", "这些", "以下", "阅读", "维度", "一个", "几个", "三个", "两个"):
            cleaned = cleaned.replace(token, "")
        parts = [part.strip(" ：:，。,.;；") for part in re.split(r"[、,，/]+", cleaned) if part.strip(" ：:，。,.;；")]
        for part in parts:
            if len(part) <= 20 and not any(token in part for token in ("分析", "全文", "文档")):
                label = _normalize_dimension_label(part)
                definitions.append({"label": label, "description": _default_dimension_description(label)})

    deduped: list[dict[str, str]] = []
    seen: set[str] = set()
    for definition in definitions:
        label = _normalize_dimension_label(definition["label"])
        key = _dimension_label_key(label)
        if not label or key in seen:
            continue
        seen.add(key)
        description = definition.get("description") or _default_dimension_description(label)
        deduped.append({"label": label, "description": description[:200]})
    return deduped


def _extract_dimension_labels_from_command(text: str) -> list[str]:
    cleaned = text
    cleaned = re.split(r"并|然后|且|and", cleaned, maxsplit=1)[0]
    for token in ("请", "帮我", "停用", "关闭", "关掉", "禁用", "删除", "移除", "这些", "以下", "阅读", "维度", "这几个", "几个", "三个", "两个"):
        cleaned = cleaned.replace(token, "")
    labels = [_normalize_dimension_label(part) for part in re.split(r"[、,，/]+", cleaned) if part.strip(" ：:，。,.;；")]
    return [label for label in labels if label and label != "自定义维度"]


def _new_dimension_count(context: dict[str, Any], definitions: list[dict[str, str]]) -> int:
    return sum(1 for definition in definitions if not _find_dimension_by_label(context, definition["label"]))



def _operations_for_dimension_definitions(context: dict[str, Any], definitions: list[dict[str, str]]) -> list[dict[str, Any]]:
    operations: list[dict[str, Any]] = []
    for definition in definitions:
        label = definition["label"]
        description = definition.get("description") or _default_dimension_description(label)
        existing = _find_dimension_by_label(context, label)
        if existing:
            if description and description != existing.get("description"):
                operations.append(_operation(
                    _make_operation_id("update_dimension", len(operations)),
                    "update_dimension",
                    f"更新维度：{existing.get('label', label)}",
                    description,
                    {"dimensionKey": existing["key"], "description": description},
                    "medium",
                ))
            if existing.get("enabled") is False:
                operations.append(_operation(
                    _make_operation_id("enable_dimension", len(operations)),
                    "enable_dimension",
                    f"启用维度：{existing.get('label', label)}",
                    "该维度已存在但当前关闭，确认后将重新启用。",
                    {"dimensionKey": existing["key"]},
                    "medium",
                ))
            if not operations or operations[-1].get("params", {}).get("dimensionKey") != existing.get("key"):
                # Existing and unchanged: no page mutation is required.
                continue
        else:
            operations.append(_operation(
                _make_operation_id("add_dimension", len(operations)),
                "add_dimension",
                f"新增维度：{label}",
                description,
                {"label": label, "description": description},
                "medium",
            ))
    return operations


def _multi_dimension_plan(message: str, operations: list[dict[str, Any]], reply: str) -> dict[str, Any]:
    return _plan(
        message,
        reply,
        operations,
        assumptions=["只更新阅读维度配置，不自动分析全文，除非用户明确要求分析。", "默认追加新分析结果，不覆盖已有总结。"],
    )


DIMENSION_DESCRIPTION_TEMPLATES = {
    "待办事项": "识别会议中明确分配给某个人或角色的后续行动项，要求尽量包含执行人、具体动作、交付物和时间节点。排除泛泛的建议、讨论观点、功能设想、背景说明和未分配责任人的待确认问题。",
    "待确认事项": "识别会议中尚未决策、需要进一步确认的问题、选项、依赖条件或待定目标，重点关注责任归属、决策条件和后续确认时间。",
    "风险问题": "识别可能影响进度、质量、成本、交付或协作的问题和风险，包括未解决障碍、资源不足、方案不确定、时间压力和依赖风险。",
    "术语解释": "识别文档中的专业术语、缩写、关键概念和不易理解的表达，并结合上下文解释其含义。",
    "关键结论": "识别会议或文档中已经达成一致、明确确认或形成共识的结论，排除尚未决策的讨论内容。",
    "行动建议": "识别会议或文档中提出的后续改进建议、推进方向或可执行优化方案，重点关注建议内容、适用场景和预期价值。",
    "当前进展": "只提取已经完成、正在进行、已经验证或已有阶段性结果的内容，避免把计划和设想误判为进展。",
    "课题": "只提取本次会议或文档明确讨论的核心主题、项目名称、工具名称或关键问题，不提取背景铺垫和无关内容。",
    "工具目标": "只提取明确说明工具要解决什么问题、提升什么效率、服务什么场景的内容，不把普通功能描述当作目标。",
    "实现方案": "只提取具体的功能设计、技术路径、模块划分、流程方案或系统实现方式，不提取单纯目标或价值描述。",
    "难点": "只提取明确存在的不确定性、阻碍、风险、技术瓶颈、数据问题或协作问题，不把普通待办事项当作难点。",
    "需要支持": "只提取需要他人、部门、资源、权限、数据、环境或决策支持的内容，尽量包含支持对象和支持事项。",
    "亮点总结": "只提取适合汇报展示的优势、创新点、价值点或可推广价值，不提取普通功能罗列。",
}


def _normalize_dimension_label(label: str) -> str:
    normalized = label.strip(" ：:，。,.;")
    lowered = normalized.lower()
    if any(token in normalized for token in ("待办", "待办事项", "行动项")) or any(token in lowered for token in ("todo", "to-do", "action item", "action items")):
        return "待办事项"
    if any(token in normalized for token in ("待确认", "待确认事项")) or "pending issue" in lowered:
        return "待确认事项"
    if any(token in normalized for token in ("术语", "术语解释")) or any(token in lowered for token in ("terminology", "term", "terms")):
        return "术语解释"
    if any(token in normalized for token in ("风险", "风险问题")) or "risk" in lowered:
        return "风险问题"
    if any(token in normalized for token in ("关键结论", "结论")) or "conclusion" in lowered:
        return "关键结论"
    if any(token in normalized for token in ("当前进展", "进展", "进度")) or "progress" in lowered:
        return "当前进展"
    if any(token in normalized for token in ("行动建议", "建议")) or "suggestion" in lowered:
        return "行动建议"
    return normalized[:20] or "自定义维度"


def _mentions_add_dimension(text: str, lowered: str) -> bool:
    has_chinese_add = any(token in text for token in ("新增", "增加", "添加", "新建", "创建", "建一个", "加个", "加一个", "加个"))
    has_english_add = any(token in lowered for token in ("add ", "create ", "new "))
    has_dimension = "维度" in text or "dimension" in lowered
    return has_dimension and (has_chinese_add or has_english_add)


def _mentions_document_analysis(text: str) -> bool:
    lowered = text.lower()
    return any(
        token in text
        for token in (
            "分析全文",
            "分析这篇文章",
            "分析文章",
            "分析文档",
            "分析这份文档",
            "分析整篇文档",
            "分析本文",
            "重新分析",
            "分析一遍",
            "分析一下",
            "进行分析",
            "全文分析",
            "跑一下全文分析",
        )
    ) or any(
        token in lowered
        for token in (
            "analyze the full document",
            "analyse the full document",
            "analyze the document",
            "analyse the document",
            "analyze the whole article",
            "analyse the whole article",
            "analyze the article",
            "analyse the article",
            "run analysis on the whole article",
            "apply it to the full text",
            "full text",
        )
    )


def _mentions_all_dimensions(text: str) -> bool:
    lowered = text.lower()
    return any(token in text for token in ("所有维度", "当前所有维度", "全部维度", "所有启用维度", "全部启用维度")) or any(
        token in lowered for token in ("all dimensions", "all enabled dimensions", "every dimension")
    )


def _is_add_dimension_document_analysis_intent(message: str) -> bool:
    text = message.strip()
    return _mentions_add_dimension(text, text.lower()) and _mentions_document_analysis(text)


def _is_add_dimension_only_intent(message: str) -> bool:
    text = message.strip()
    lowered = text.lower()
    return _mentions_add_dimension(text, lowered) and not _mentions_document_analysis(text)


def _capability_enabled(context: dict[str, Any], operation_type: str) -> tuple[bool, str | None]:
    for capability in context.get("capabilities", []):
        if capability.get("operationType") == operation_type:
            return bool(capability.get("enabled")), capability.get("disabledReason")
    return True, None


def _operation(operation_id: str, operation_type: str, title: str, description: str, params: dict[str, Any], risk: str = "medium") -> dict[str, Any]:
    return {
        "id": operation_id,
        "type": operation_type,
        "title": title,
        "description": description,
        "riskLevel": risk,
        "requiresConfirmation": operation_type != "answer_question",
        "params": params,
    }


def _plan(message: str, assistant_reply: str, operations: list[dict[str, Any]], warnings: list[str] | None = None, assumptions: list[str] | None = None) -> dict[str, Any]:
    plan_id = f"plan_{int(datetime.now().timestamp() * 1000)}"
    return {
        "plan": {
            "id": plan_id,
            "userIntent": message,
            "assistantReply": assistant_reply,
            "operations": operations,
            "warnings": warnings or [],
            "assumptions": assumptions or [
                "默认追加新分析结果，不覆盖已有总结。",
                "默认保留人工批注、翻译卡片、框选 AI 分析和手动编辑内容。",
            ],
            "requiresConfirmation": any(operation.get("requiresConfirmation") for operation in operations),
            "confirmationText": f"确认后将执行 {len(operations)} 个操作。",
            "createdAt": _now(),
        }
    }


def _mock_agent_plan(message: str, context: dict[str, Any]) -> dict[str, Any]:
    text = message.strip()
    lowered = text.lower()
    surface = context.get("agentSurface", "global_panel")
    selection_mode = surface == "selection_popover"
    if selection_mode and any(token in text for token in ("分析全文", "重新分析全文", "生成纪要", "生成输出", "导出", "清空总结", "覆盖已有总结", "覆盖总结")):
        return _message("该操作会影响全文或全局输出，请到右侧 AI Agent 中确认执行。")
    if any(token in text for token in ("覆盖全部", "批量排除")):
        return _message("MVP Agent 暂不直接执行覆盖全部或批量排除等高风险操作。请改用追加分析或在界面中手动确认。", "clarification_question")

    if "导出" in text and ("word" in lowered or "Word" in text):
        enabled, reason = _capability_enabled(context, "export_word")
        if not enabled:
            return _message(reason or "当前不能导出 Word。", "clarification_question")
        return _plan(text, "我将导出当前最终输出为 Word 文件。", [
            _operation("op_export_word", "export_word", "导出 Word", "下载当前可编辑输出内容。", {}, "medium")
        ], assumptions=["只导出当前输出草稿，不重新生成内容。"])

    if "导出" in text and ("txt" in lowered or "TXT" in text):
        enabled, reason = _capability_enabled(context, "export_txt")
        if not enabled:
            return _message(reason or "当前不能导出 TXT。", "clarification_question")
        return _plan(text, "我将导出当前最终输出为 TXT 文件。", [
            _operation("op_export_txt", "export_txt", "导出 TXT", "下载当前可编辑输出内容。", {}, "medium")
        ], assumptions=["只导出当前输出草稿，不重新生成内容。"])

    if not selection_mode:
        multi_payload = _global_multi_dimension_payload(text, context)
        if multi_payload:
            return multi_payload

    target = _dimension_by_label(context, text)
    if target and "改成" in text:
        new_label = text.split("改成", 1)[1].strip(" ：:，。")
        return _plan(text, f"我将把“{target['label']}”维度改名为“{new_label[:20]}”。", [
            _operation("op_update_dimension", "update_dimension", f"修改维度：{target['label']}", "只更新维度名称，不自动重新分析全文。", {"dimensionKey": target["key"], "label": new_label[:20]}, "medium")
        ], assumptions=["这是全局维度配置变更；不会自动分析全文。"])
    if target and any(token in text for token in ("关掉", "关闭", "停用")):
        return _plan(text, f"我将停用“{target['label']}”维度。", [
            _operation("op_disable_dimension", "disable_dimension", f"停用维度：{target['label']}", "停用后后续分析默认不再使用该维度。", {"dimensionKey": target["key"]}, "medium")
        ], assumptions=["只更新维度启用状态，不自动重新分析全文。"])

    if target and any(token in text for token in ("打开", "启用")):
        return _plan(text, f"我将启用“{target['label']}”维度。", [
            _operation("op_enable_dimension", "enable_dimension", f"启用维度：{target['label']}", "启用后后续分析可使用该维度。", {"dimensionKey": target["key"]}, "medium")
        ], assumptions=["只更新维度启用状态，不自动重新分析全文。"])

    wants_analysis = _mentions_document_analysis(text)
    selection_wants_analysis = selection_mode and "分析" in text
    wants_all_dimensions = _mentions_all_dimensions(text)
    wants_add = _mentions_add_dimension(text, lowered)
    operations: list[dict[str, Any]] = []
    if wants_add:
        label = _extract_dimension_label(text)
        description = _extract_dimension_description(text, label)
        operations.append(_operation(
            "op_add_dimension",
            "add_dimension",
            f"新增维度：{label}",
            description,
            {"label": label, "description": description},
            "medium",
        ))
        if wants_analysis or selection_wants_analysis:
            if selection_mode:
                if not context.get("selection"):
                    return _message("请先框选原文，再让 Selection Agent 分析当前选区。", "clarification_question")
                operations.append(_operation(
                    "op_run_selection_analysis",
                    "run_selection_analysis",
                    f"用“{label}”维度分析当前选区",
                    "仅分析当前框选内容，并追加一条 selection_ai 卡片。",
                    {
                        "target": "current_selection",
                        "dimensionLabel": label,
                        "dependsOnOperationId": "op_add_dimension",
                        "mergeMode": "append_results",
                    },
                    "medium",
                ))
                return _plan(text, f"我将新增“{label}”维度，并只用该维度分析当前选区。", operations, assumptions=["Selection Agent 只处理当前框选内容，不触发全文分析。"])
            else:
                operations.append(_operation(
                    "op_run_analysis",
                    "run_analysis",
                    f"只用“{label}”维度分析全文",
                    f"仅使用新增的“{label}”维度分析全文，结果将追加到当前总结区，不覆盖已有总结。",
                    {
                        "analysisScope": {
                            "type": "new_dimension_only",
                            "dependsOnOperationId": "op_add_dimension",
                            "tempDimensionRef": "op_add_dimension",
                            "dimensionLabel": label,
                        },
                        "mergeMode": "append_results",
                        "preserveRules": DEFAULT_PRESERVE_RULES,
                    },
                    "medium",
                ))
        return _plan(text, f"我将新增“{label}”维度" + ("并只用该维度分析全文。" if wants_analysis and not selection_mode else "。"), operations)

    if selection_mode and target and selection_wants_analysis:
        if not context.get("selection"):
            return _message("请先框选原文，再让 Selection Agent 分析当前选区。", "clarification_question")
        return _plan(text, f"我将用“{target['label']}”维度分析当前选区。", [
            _operation(
                "op_run_selection_analysis",
                "run_selection_analysis",
                f"用“{target['label']}”维度分析当前选区",
                "仅分析当前框选内容，并追加一条 selection_ai 卡片。",
                {
                    "target": "current_selection",
                    "dimensionKey": target["key"],
                    "dimensionLabel": target["label"],
                    "mergeMode": "append_results",
                },
                "medium",
            )
        ], assumptions=["Selection Agent 只处理当前框选内容，不触发全文分析。"])

    if not selection_mode and target and wants_analysis and not wants_all_dimensions:
        return _plan(text, f"我将只用“{target['label']}”维度分析全文，并追加结果。", [
            _operation(
                "op_run_analysis",
                "run_analysis",
                f"只用“{target['label']}”维度分析全文",
                "仅使用指定阅读维度分析全文，结果将追加到当前总结区，不覆盖已有总结。",
                {
                    "analysisScope": {
                        "type": "selected_dimensions",
                        "dimensionKeys": [target["key"]],
                        "dimensionLabels": [target["label"]],
                    },
                    "mergeMode": "append_results",
                    "preserveRules": DEFAULT_PRESERVE_RULES,
                },
                "medium",
            )
        ], assumptions=["用户指定了单个阅读维度，因此不会按所有启用维度重新分析。"])

    if wants_analysis:
        if selection_mode:
            return _message("Selection Agent 只处理当前选区；如需分析全文，请到右侧 AI Agent 中确认执行。")
        if not any(dimension.get("enabled") for dimension in context.get("dimensions", [])):
            return _message("当前没有启用的阅读维度，请先添加或启用维度后再分析全文。", "clarification_question")
        return _plan(text, "我将按当前启用维度分析全文，并采用安全默认：追加结果、不覆盖旧总结。", [
            _operation(
                "op_run_analysis",
                "run_analysis",
                "按当前启用维度分析全文",
                "分析结果将追加到当前总结区，不覆盖已有总结。",
                {
                    "analysisScope": {"type": "all_enabled_dimensions"},
                    "mergeMode": "append_results",
                    "preserveRules": DEFAULT_PRESERVE_RULES,
                },
                "medium",
            )
        ], assumptions=["用户没有明确覆盖策略，因此默认追加结果。", "人工批注、翻译卡片、已确认总结和手动编辑内容都会保留。"])

    if "生成" in text and any(token in text for token in ("输出", "纪要", "总结")):
        enabled, reason = _capability_enabled(context, "generate_output")
        if not enabled:
            return _message(reason or "当前不能生成输出。", "clarification_question")
        return _plan(text, "我将基于已确认总结生成最终输出草稿。", [
            _operation("op_generate_output", "generate_output", "生成最终输出", "只使用已确认总结生成输出。", {}, "medium")
        ], assumptions=["不会使用已排除总结；生成后你仍可编辑输出草稿。"])

    if context.get("selection"):
        quote = context["selection"].get("quote", "")
        return _message(f"这段原文的大意是：{quote[:160]}。如果需要，我也可以在后续版本中把解释保存为批注卡片。")
    return _message("我可以回答文档问题，也可以生成需确认的操作计划，例如新增维度、停用维度、追加分析、生成输出或导出文件。请告诉我你想做什么。")


def _extract_dimension_label(text: str) -> str:
    for left, right in (("“", "”"), ('"', '"'), ("'", "'")):
        if left in text and right in text.split(left, 1)[1]:
            return _normalize_dimension_label(text.split(left, 1)[1].split(right, 1)[0])
    lowered = text.lower()
    english_labels = (
        (("todo", "to-do", "action item", "action items"), "待办事项"),
        (("terminology", "term dimension", "terms dimension"), "术语解释"),
        (("risk",), "风险问题"),
    )
    for tokens, label in english_labels:
        if any(token in lowered for token in tokens):
            return label
    cleaned = text.split("描述为", 1)[0].split("描述是", 1)[0].split("说明是", 1)[0]
    for token in ("帮我", "请", "新增", "增加", "添加", "新建", "创建", "建", "建一个", "加个", "加一个", "一个", "维度", "然后", "并", "用它", "用该维度", "用这个维度", "分析这段话", "分析当前选区", "分析当前内容", "分析这篇文章", "分析文章", "分析文档", "分析这份文档", "分析整篇文档", "分析本文", "分析全文", "进行分析", "全文分析", "跑一下全文分析", "分析一遍", "。", "，"):
        cleaned = cleaned.replace(token, "")
    return _normalize_dimension_label(cleaned)


def _extract_dimension_description(text: str, label: str) -> str:
    for marker in ("描述为", "描述是", "说明是", "识别"):
        if marker in text:
            tail = text.split(marker, 1)[1]
            tail = tail.split("然后", 1)[0].split("并分析", 1)[0].strip(" ：:，。")
            if marker == "识别":
                tail = f"识别{tail}"
            return tail[:200] or _default_dimension_description(label)
    return _default_dimension_description(label)


def _default_dimension_description(label: str) -> str:
    return DIMENSION_DESCRIPTION_TEMPLATES.get(label, f"围绕“{label}”识别文档中的相关信息，并提炼为结构化阅读结果。")


def _is_generic_dimension_description(description: str) -> bool:
    return description.strip() in {"新增维度", "创建维度", "自定义维度", "新增阅读维度"}
