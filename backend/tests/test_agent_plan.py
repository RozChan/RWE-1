import unittest

from pydantic import ValidationError

from app.agent import _mock_agent_plan, _sanitize_agent_plan, validate_agent_plan_payload
from app.models import AgentOperation


class AgentPlanTests(unittest.TestCase):
    def setUp(self) -> None:
        self.dimensions = [
            {
                "key": "topic",
                "label": "核心观点",
                "description": "识别核心观点",
                "enabled": True,
            },
            {
                "key": "highlight",
                "label": "风险问题",
                "description": "识别风险、阻塞和依赖",
                "enabled": True,
            },
            {
                "key": "terms",
                "label": "术语解释",
                "description": "识别并解释术语",
                "enabled": True,
            },
        ]

    def context(self, surface: str, with_selection: bool = False, dimensions: list[dict] | None = None) -> dict:
        context = {
            "agentSurface": surface,
            "document": {
                "id": "sample-science-reading.txt",
                "title": "sample-science-reading.txt",
                "type": "generic_text",
                "chunkCount": 3,
            },
            "dimensions": self.dimensions if dimensions is None else dimensions,
            "summaries": [],
            "outputDraft": {"exists": False, "length": 0},
            "selection": None,
            "capabilities": [],
        }
        if with_selection:
            context["selection"] = {
                "chunkId": "P1",
                "quote": "Sunlight looks white, but it is actually made of many colors.",
                "startOffset": 0,
                "endOffset": 64,
            }
        return context

    def plan_for(self, message: str, context: dict):
        payload = _mock_agent_plan(message, context)
        return validate_agent_plan_payload(payload, context)

    def operation_types(self, response) -> list[str]:
        self.assertIsNotNone(response.plan)
        return [operation.type for operation in response.plan.operations]

    def assert_new_dimension_only_plan(self, message: str, expected_label: str) -> None:
        response = self.plan_for(message, self.context("global_panel"))

        self.assertEqual(self.operation_types(response), ["add_dimension", "run_analysis"])
        add_dimension, run_analysis = response.plan.operations
        scope = run_analysis.params.analysisScope
        self.assertEqual(add_dimension.params.label, expected_label)
        self.assertEqual(scope.type, "new_dimension_only")
        self.assertEqual(scope.dependsOnOperationId, add_dimension.id)
        self.assertEqual(scope.dimensionLabel, expected_label)
        self.assertEqual(run_analysis.params.mergeMode, "append_results")
        self.assertNotEqual(scope.type, "all_enabled_dimensions")

    def test_selection_add_dimension_and_analyze_current_selection(self) -> None:
        response = self.plan_for(
            "新增一个术语解释维度，并用它分析这段话",
            self.context("selection_popover", with_selection=True),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "run_selection_analysis"])
        run_selection = response.plan.operations[1]
        self.assertEqual(run_selection.params.target, "current_selection")
        self.assertEqual(run_selection.params.dimensionLabel, "术语解释")
        self.assertEqual(run_selection.params.mergeMode, "append_results")
        self.assertNotIn("run_analysis", self.operation_types(response))
        self.assertNotIn("generate_output", self.operation_types(response))
        self.assertNotIn("export_word", self.operation_types(response))
        self.assertNotIn("export_txt", self.operation_types(response))

    def test_selection_blocks_full_document_analysis(self) -> None:
        response = self.plan_for(
            "重新分析全文",
            self.context("selection_popover", with_selection=True),
        )

        self.assertIsNone(response.plan)
        self.assertIsNotNone(response.message)
        self.assertIn("右侧 AI Agent", response.message.content)

    def test_selection_blocks_export_word(self) -> None:
        response = self.plan_for(
            "导出 Word",
            self.context("selection_popover", with_selection=True),
        )

        self.assertIsNone(response.plan)
        self.assertIsNotNone(response.message)
        self.assertIn("右侧 AI Agent", response.message.content)

    def test_selection_requires_selection_for_selection_analysis(self) -> None:
        response = self.plan_for(
            "新增一个术语解释维度，并用它分析这段话",
            self.context("selection_popover", with_selection=False),
        )

        self.assertIsNone(response.plan)
        self.assertIsNotNone(response.message)
        self.assertIn("请先框选原文", response.message.content)

    def test_run_selection_analysis_params_are_validated(self) -> None:
        valid = {
            "id": "op_run_selection_analysis",
            "type": "run_selection_analysis",
            "title": "用术语解释维度分析当前选区",
            "description": "仅分析当前选区。",
            "riskLevel": "medium",
            "requiresConfirmation": True,
            "params": {
                "target": "current_selection",
                "dimensionLabel": "术语解释",
                "mergeMode": "append_results",
            },
        }
        self.assertEqual(AgentOperation.model_validate(valid).type, "run_selection_analysis")

        for invalid_params in (
            {"target": "full_document", "dimensionLabel": "术语解释", "mergeMode": "append_results"},
            {"target": "current_selection", "mergeMode": "append_results"},
            {"target": "current_selection", "dimensionLabel": "术语解释", "mergeMode": "replace_ai_results"},
        ):
            invalid = {**valid, "params": invalid_params}
            with self.assertRaises(ValidationError):
                AgentOperation.model_validate(invalid)

    def test_global_add_dimension_and_analyze_only_new_dimension(self) -> None:
        self.assert_new_dimension_only_plan(
            "新增一个术语解释维度，并用它分析这篇文章",
            "术语解释",
        )

    def test_global_add_dimension_and_analyze_omitted_pronoun(self) -> None:
        response = self.plan_for(
            "新增一个待办维度，并分析全文",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "run_analysis"])
        add_dimension, run_analysis = response.plan.operations
        scope = run_analysis.params.analysisScope
        self.assertEqual(add_dimension.params.label, "待办事项")
        self.assertIn("明确分配给某个人或角色", add_dimension.params.description)
        self.assertEqual(scope.type, "new_dimension_only")
        self.assertEqual(scope.dependsOnOperationId, add_dimension.id)
        self.assertEqual(scope.dimensionLabel, "待办事项")
        self.assertEqual(run_analysis.params.mergeMode, "append_results")

    def test_global_add_dimension_only_does_not_auto_analyze(self) -> None:
        response = self.plan_for(
            "新增一个待办维度",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension"])
        self.assertEqual(response.plan.operations[0].params.label, "待办事项")
        self.assertIn("明确分配给某个人或角色", response.plan.operations[0].params.description)

    def test_global_add_dimension_only_templates_and_fallbacks(self) -> None:
        cases = [
            ("新增一个术语解释维度", "术语解释", "专业术语"),
            ("新增一个自定义洞察维度", "自定义洞察", "围绕“自定义洞察”识别文档中的相关信息"),
            ("Create an action item dimension", "待办事项", "明确分配给某个人或角色"),
        ]

        for message, expected_label, expected_description in cases:
            with self.subTest(message=message):
                response = self.plan_for(message, self.context("global_panel"))
                self.assertEqual(self.operation_types(response), ["add_dimension"])
                operation = response.plan.operations[0]
                self.assertEqual(operation.params.label, expected_label)
                self.assertIn(expected_description, operation.params.description)

    def test_global_add_dimension_uses_user_description_first(self) -> None:
        response = self.plan_for(
            "新增一个待办维度，描述为识别明确责任人、截止时间和交付物",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension"])
        operation = response.plan.operations[0]
        self.assertEqual(operation.params.label, "待办事项")
        self.assertEqual(operation.params.description, "识别明确责任人、截止时间和交付物")

    def test_global_add_dimension_and_analyze_semantic_variants(self) -> None:
        cases = [
            ("新增待办维度，并分析全文", "待办事项"),
            ("新增一个待办事项维度，并分析这篇文章", "待办事项"),
            ("新建一个待办维度，并分析全文", "待办事项"),
            ("创建一个待办维度，并分析全文", "待办事项"),
            ("增加一个待办维度，并分析全文", "待办事项"),
            ("新增一个待办维度，并进行分析", "待办事项"),
            ("新增一个待办维度，并分析文档", "待办事项"),
            ("建一个待办事项维度，然后分析整篇文档", "待办事项"),
            ("帮我加个风险问题维度，并用它分析这篇文章", "风险问题"),
            ("创建术语解释维度，跑一下全文分析", "术语解释"),
            ("Add a todo dimension and analyze the full document.", "待办事项"),
            ("Create an action item dimension and run analysis on the whole article.", "待办事项"),
            ("Add a risk dimension and analyze the document with it.", "风险问题"),
            ("Create a terminology dimension and apply it to the full text.", "术语解释"),
        ]

        for message, expected_label in cases:
            with self.subTest(message=message):
                self.assert_new_dimension_only_plan(message, expected_label)

    def test_global_sanitizer_repairs_incomplete_add_and_analyze_plan(self) -> None:
        context = self.context("global_panel")
        payload = {
            "plan": {
                "id": "plan_incomplete",
                "userIntent": "新增一个待办维度，并分析全文",
                "assistantReply": "我将新增待办维度并分析全文。",
                "operations": [
                    {
                        "id": "op_add_dimension",
                        "type": "add_dimension",
                        "title": "新增维度",
                        "description": "新增维度",
                        "riskLevel": "medium",
                        "requiresConfirmation": True,
                        "params": {"label": "待办", "description": ""},
                    },
                    {
                        "id": "op_run_analysis",
                        "type": "run_analysis",
                        "title": "分析全文",
                        "description": "分析全文",
                        "riskLevel": "medium",
                        "requiresConfirmation": True,
                        "params": {},
                    },
                ],
                "warnings": [],
                "assumptions": [],
                "requiresConfirmation": True,
                "confirmationText": "确认后将执行 2 个操作。",
                "createdAt": "2026-06-23T00:00:00+00:00",
            }
        }

        repaired = _sanitize_agent_plan("新增一个待办维度，并分析全文", context, payload)
        response = validate_agent_plan_payload(repaired, context)
        add_dimension, run_analysis = response.plan.operations
        self.assertEqual(add_dimension.params.label, "待办事项")
        self.assertEqual(run_analysis.params.analysisScope.type, "new_dimension_only")
        self.assertEqual(run_analysis.params.analysisScope.dependsOnOperationId, add_dimension.id)
        self.assertEqual(run_analysis.params.analysisScope.dimensionLabel, "待办事项")
        self.assertEqual(run_analysis.params.mergeMode, "append_results")

    def test_global_sanitizer_removes_unwanted_analysis_for_add_only_intent(self) -> None:
        context = self.context("global_panel")
        payload = {
            "plan": {
                "id": "plan_unwanted_analysis",
                "userIntent": "新增一个待办维度",
                "assistantReply": "我将新增待办维度。",
                "operations": [
                    {
                        "id": "op_add_dimension",
                        "type": "add_dimension",
                        "title": "新增维度",
                        "description": "新增维度",
                        "riskLevel": "medium",
                        "requiresConfirmation": True,
                        "params": {"label": "待办", "description": ""},
                    },
                    {
                        "id": "op_run_analysis",
                        "type": "run_analysis",
                        "title": "分析全文",
                        "description": "分析全文",
                        "riskLevel": "medium",
                        "requiresConfirmation": True,
                        "params": {"analysisScope": {"type": "all_enabled_dimensions"}, "mergeMode": "append_results"},
                    },
                ],
                "warnings": [],
                "assumptions": [],
                "requiresConfirmation": True,
                "confirmationText": "确认后将执行 2 个操作。",
                "createdAt": "2026-06-23T00:00:00+00:00",
            }
        }

        repaired = _sanitize_agent_plan("新增一个待办维度", context, payload)
        response = validate_agent_plan_payload(repaired, context)
        self.assertEqual(self.operation_types(response), ["add_dimension"])
        self.assertEqual(response.plan.operations[0].params.label, "待办事项")
        self.assertIn("明确分配给某个人或角色", response.plan.operations[0].params.description)

    def test_global_analyzes_only_selected_dimension(self) -> None:
        response = self.plan_for(
            "用风险问题维度分析全文",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["run_analysis"])
        scope = response.plan.operations[0].params.analysisScope
        self.assertEqual(scope.type, "selected_dimensions")
        self.assertEqual(scope.dimensionKeys, ["highlight"])
        self.assertEqual(scope.dimensionLabels, ["风险问题"])
        self.assertEqual(response.plan.operations[0].params.mergeMode, "append_results")

    def test_global_all_dimensions_analysis_is_explicit(self) -> None:
        response = self.plan_for(
            "按当前所有维度重新分析全文",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["run_analysis"])
        scope = response.plan.operations[0].params.analysisScope
        self.assertEqual(scope.type, "all_enabled_dimensions")
        self.assertEqual(response.plan.operations[0].params.mergeMode, "append_results")

    def test_global_adds_multiple_dimensions_from_spaced_lines(self) -> None:
        message = """添加维度及介绍如下：
课题    只提取本次会议或文档明确讨论的核心主题、项目名称、工具名称或关键问题，不提取背景铺垫和无关内容。
工具目标    只提取明确说明“工具要解决什么问题、提升什么效率、服务什么场景”的内容，不把普通功能描述当作目标。
实现方案    只提取具体的功能设计、技术路径、模块划分、流程方案或系统实现方式，不提取单纯目标或价值描述。"""
        response = self.plan_for(message, self.context("global_panel"))

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension"])
        labels = [operation.params.label for operation in response.plan.operations]
        descriptions = [operation.params.description for operation in response.plan.operations]
        self.assertEqual(labels, ["课题", "工具目标", "实现方案"])
        self.assertIn("核心主题", descriptions[0])
        self.assertIn("工具要解决什么问题", descriptions[1])
        self.assertIn("功能设计", descriptions[2])

    def test_global_adds_eight_dimensions(self) -> None:
        message = """添加维度及介绍如下：
课题    只提取本次会议或文档明确讨论的核心主题、项目名称、工具名称或关键问题，不提取背景铺垫和无关内容。
工具目标    只提取明确说明“工具要解决什么问题、提升什么效率、服务什么场景”的内容，不把普通功能描述当作目标。
实现方案    只提取具体的功能设计、技术路径、模块划分、流程方案或系统实现方式，不提取单纯目标或价值描述。
当前进展    只提取已经完成、正在进行、已经验证或已有阶段性结果的内容，避免把计划和设想误判为进展。
难点    只提取明确存在的不确定性、阻碍、风险、技术瓶颈、数据问题或协作问题，不把普通待办事项当作难点。
需要支持    只提取需要他人、部门、资源、权限、数据、环境或决策支持的内容，尽量包含支持对象和支持事项。
亮点总结    只提取适合汇报展示的优势、创新点、价值点、效率提升点或差异化能力，不提取普通功能罗列。
待办事项    识别会议中明确分配给某个人或角色的后续行动项，要求尽量包含执行人、具体动作、交付物和时间节点。"""
        response = self.plan_for(message, self.context("global_panel"))

        self.assertEqual(len(response.plan.operations), 8)
        self.assertEqual(set(self.operation_types(response)), {"add_dimension"})
        self.assertEqual([operation.params.label for operation in response.plan.operations], ["课题", "工具目标", "实现方案", "当前进展", "难点", "需要支持", "亮点总结", "待办事项"])

    def test_global_adds_multiple_dimensions_from_numbered_colon_list(self) -> None:
        response = self.plan_for(
            """新增以下维度：
1. 课题：xxx
2. 工具目标：xxx
3. 当前进展：xxx""",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension"])
        self.assertEqual([operation.params.label for operation in response.plan.operations], ["课题", "工具目标", "当前进展"])

    def test_global_adds_multiple_dimensions_from_inline_names_without_analysis(self) -> None:
        response = self.plan_for(
            "添加课题、工具目标、实现方案三个维度",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension"])
        self.assertNotIn("run_analysis", self.operation_types(response))

    def test_global_adds_multiple_dimensions_and_analyzes_only_them(self) -> None:
        response = self.plan_for(
            "添加课题、工具目标两个维度，并分析全文",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "run_analysis"])
        scope = response.plan.operations[-1].params.analysisScope
        self.assertEqual(scope.type, "selected_dimensions")
        self.assertEqual(scope.dimensionLabels, ["课题", "工具目标"])
        self.assertEqual(response.plan.operations[-1].params.mergeMode, "append_results")

    def test_global_disables_multiple_dimensions(self) -> None:
        dimensions = self.dimensions + [
            {"key": "subject", "label": "课题", "description": "课题", "enabled": True},
            {"key": "tool_goal", "label": "工具目标", "description": "工具目标", "enabled": True},
            {"key": "difficulty", "label": "难点", "description": "难点", "enabled": True},
        ]
        response = self.plan_for(
            "停用课题、工具目标、难点三个维度",
            self.context("global_panel", dimensions=dimensions),
        )

        self.assertEqual(self.operation_types(response), ["disable_dimension", "disable_dimension", "disable_dimension"])
        self.assertEqual([operation.params.dimensionKey for operation in response.plan.operations], ["subject", "tool_goal", "difficulty"])


    def test_global_deletes_all_dimensions_with_high_risk_operations(self) -> None:
        response = self.plan_for(
            "删除所有维度",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["delete_dimension", "delete_dimension", "delete_dimension"])
        self.assertTrue(all(operation.requiresConfirmation for operation in response.plan.operations))
        self.assertTrue(all(operation.riskLevel == "high" for operation in response.plan.operations))

    def test_global_deletes_multiple_dimensions(self) -> None:
        dimensions = self.dimensions + [
            {"key": "subject", "label": "课题", "description": "课题", "enabled": True},
            {"key": "tool_goal", "label": "工具目标", "description": "工具目标", "enabled": True},
            {"key": "difficulty", "label": "难点", "description": "难点", "enabled": True},
        ]
        response = self.plan_for(
            "删除课题、工具目标、难点这几个维度",
            self.context("global_panel", dimensions=dimensions),
        )

        self.assertEqual(self.operation_types(response), ["delete_dimension", "delete_dimension", "delete_dimension"])
        self.assertEqual([operation.params.dimensionKey for operation in response.plan.operations], ["subject", "tool_goal", "difficulty"])

    def test_global_current_message_only_for_multi_dimension_add(self) -> None:
        previous_payload = _mock_agent_plan(
            """添加维度及介绍如下：
课题    上一轮课题描述
工具目标    上一轮目标描述
实现方案    上一轮方案描述
当前进展    上一轮进展描述
难点    上一轮难点描述
需要支持    上一轮支持描述
亮点总结    上一轮亮点描述
待办事项    上一轮待办描述""",
            self.context("global_panel"),
        )
        self.assertEqual(len(previous_payload["plan"]["operations"]), 8)

        response = self.plan_for(
            "添加以下维度：课题、工具目标、实现方案、进度",
            self.context("global_panel"),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension", "add_dimension"])
        self.assertEqual([operation.params.label for operation in response.plan.operations], ["课题", "工具目标", "实现方案", "当前进展"])
        self.assertTrue(all("上一轮" not in operation.params.description for operation in response.plan.operations))
        self.assertNotIn("run_analysis", self.operation_types(response))

    def test_blocked_plan_is_not_executed_by_new_add_message(self) -> None:
        response = self.plan_for("添加", self.context("global_panel"))

        self.assertIsNone(response.plan)
        self.assertIsNotNone(response.message)
        self.assertIn("告诉我你想做什么", response.message.content)

    def test_global_updates_multiple_dimension_descriptions(self) -> None:
        dimensions = self.dimensions + [
            {"key": "subject", "label": "课题", "description": "旧课题", "enabled": True},
            {"key": "tool_goal", "label": "工具目标", "description": "旧目标", "enabled": True},
        ]
        response = self.plan_for(
            """修改以下维度描述：
课题：只提取本次讨论的核心主题
工具目标：只提取工具目标和预期效果""",
            self.context("global_panel", dimensions=dimensions),
        )

        self.assertEqual(self.operation_types(response), ["update_dimension", "update_dimension"])
        self.assertEqual([operation.params.description for operation in response.plan.operations], ["只提取本次讨论的核心主题", "只提取工具目标和预期效果"])

    def test_global_allows_adding_past_previous_dimension_limit(self) -> None:
        dimensions = [
            {"key": f"custom_{index}", "label": f"维度{index}", "description": "描述", "enabled": True}
            for index in range(18)
        ]
        response = self.plan_for(
            "添加课题、工具目标、实现方案三个维度",
            self.context("global_panel", dimensions=dimensions),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension"])
        self.assertNotIn("最多支持 20 个阅读维度", response.plan.assistantReply)

    def test_global_allows_adding_when_already_over_twenty_dimensions(self) -> None:
        dimensions = [
            {"key": f"custom_{index}", "label": f"维度{index}", "description": "描述", "enabled": True}
            for index in range(25)
        ]
        response = self.plan_for(
            "添加课题、工具目标、实现方案三个维度",
            self.context("global_panel", dimensions=dimensions),
        )

        self.assertEqual(self.operation_types(response), ["add_dimension", "add_dimension", "add_dimension"])

    def test_global_analysis_requires_enabled_dimensions(self) -> None:
        response = self.plan_for(
            "分析全文",
            self.context("global_panel", dimensions=[]),
        )

        self.assertIsNone(response.plan)
        self.assertIsNotNone(response.message)
        self.assertIn("当前没有启用的阅读维度", response.message.content)


if __name__ == "__main__":
    unittest.main()
