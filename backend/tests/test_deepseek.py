import json
import unittest
from datetime import datetime

from app.config import LLMSettings
from app.domain import ParsedMeetingMetadata, ParsedTranscriptSegment
from app.llm import DeepSeekLLMProvider, LLMProviderError, ProviderDimension


class FakeTransport:
    def __init__(self, contents: list[dict | str | tuple[dict | str, str]]) -> None:
        self.contents = contents
        self.requests: list[dict] = []

    def __call__(self, url: str, headers: dict, payload: dict, timeout: float) -> dict:
        self.requests.append(
            {"url": url, "headers": headers, "payload": payload, "timeout": timeout}
        )
        response_item = self.contents.pop(0)
        if isinstance(response_item, tuple):
            content, finish_reason = response_item
        else:
            content, finish_reason = response_item, "stop"
        rendered = (
            content
            if isinstance(content, str)
            else json.dumps(content, ensure_ascii=False)
        )
        return {
            "choices": [
                {
                    "finish_reason": finish_reason,
                    "message": {"content": rendered},
                }
            ]
        }


class DeepSeekProviderTests(unittest.TestCase):
    def setUp(self) -> None:
        self.settings = LLMSettings(
            provider="deepseek",
            deepseek_api_key="test-key",
            deepseek_base_url="https://api.deepseek.com",
            deepseek_model="deepseek-v4-pro",
            deepseek_timeout_seconds=30,
            deepseek_max_tokens=4096,
            deepseek_thinking="disabled",
        )
        self.segments = [
            ParsedTranscriptSegment(
                id="P1",
                speaker="说话人 1",
                timestamp="00:33",
                start_seconds=33,
                text="下一步选择典型场景进行验证。",
            )
        ]

    @staticmethod
    def dimensions(*keys: str) -> list[ProviderDimension]:
        labels = {"topic": "课题", "next": "后续目标"}
        return [
            ProviderDimension(key, labels.get(key, key), f"识别{labels.get(key, key)}")
            for key in keys
        ]

    def test_analysis_uses_json_output_and_derives_offsets(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "选择典型场景开展验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "选择典型场景进行验证"}
                            ],
                        }
                    ]
                }
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(result[0].evidences[0].start_offset, 3)
        self.assertEqual(result[0].evidences[0].end_offset, 13)
        request = transport.requests[0]
        self.assertEqual(request["url"], "https://api.deepseek.com/chat/completions")
        self.assertEqual(request["payload"]["model"], "deepseek-v4-pro")
        self.assertEqual(request["payload"]["response_format"], {"type": "json_object"})
        self.assertEqual(request["payload"]["thinking"], {"type": "disabled"})
        self.assertNotIn("test-key", json.dumps(request["payload"], ensure_ascii=False))

    def test_analysis_sends_custom_dimension_definition(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "risk",
                            "summary": "需要关注交付风险。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "典型场景进行验证"}
                            ],
                        }
                    ]
                }
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(
            self.segments,
            [ProviderDimension("risk", "风险问题", "识别风险、阻塞和依赖")],
        )

        self.assertEqual(result[0].dimension, "risk")
        self.assertEqual(result[0].title, "风险问题")
        user_payload = json.loads(
            transport.requests[0]["payload"]["messages"][1]["content"]
        )
        self.assertEqual(
            user_payload["dimensions"][0],
            {
                "key": "risk",
                "label": "风险问题",
                "description": "识别风险、阻塞和依赖",
            },
        )

    def test_analysis_batches_long_transcript_and_preserves_source_order(self) -> None:
        segments = [
            ParsedTranscriptSegment(
                id=f"P{index}",
                speaker="说话人 1",
                timestamp=f"00:{index:02d}",
                start_seconds=index,
                text=f"第{index}段需要继续验证。",
            )
            for index in range(1, 42)
        ]
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第一批需要继续验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "需要继续验证"}
                            ],
                        }
                    ]
                },
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第二批需要继续验证。",
                            "evidences": [
                                {"segment_id": "P41", "quote": "需要继续验证"}
                            ],
                        }
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(segments, self.dimensions("next"))

        self.assertEqual(len(transport.requests), 2)
        request_segment_counts = [
            len(json.loads(request["payload"]["messages"][1]["content"])["segments"])
            for request in transport.requests
        ]
        self.assertEqual(request_segment_counts, [40, 1])
        self.assertEqual(
            [summary.evidences[0].segment_id for summary in result], ["P1", "P41"]
        )

    def test_analysis_recovers_from_truncation_by_splitting_batch(self) -> None:
        segments = [
            ParsedTranscriptSegment(
                id="P1",
                speaker="说话人 1",
                timestamp="00:01",
                start_seconds=1,
                text="第一项需要继续验证。",
            ),
            ParsedTranscriptSegment(
                id="P2",
                speaker="说话人 2",
                timestamp="00:02",
                start_seconds=2,
                text="第二项需要继续验证。",
            ),
        ]
        transport = FakeTransport(
            [
                ('{"summaries":[', "length"),
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第一项需要验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "第一项需要继续验证"}
                            ],
                        }
                    ]
                },
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第二项需要验证。",
                            "evidences": [
                                {"segment_id": "P2", "quote": "第二项需要继续验证"}
                            ],
                        }
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(segments, self.dimensions("next"))

        self.assertEqual(len(transport.requests), 3)
        self.assertEqual(
            [summary.evidences[0].segment_id for summary in result], ["P1", "P2"]
        )

    def test_analysis_allows_empty_intermediate_batch(self) -> None:
        segments = [
            ParsedTranscriptSegment(
                id=f"P{index}",
                speaker="说话人 1",
                timestamp=f"00:{index:02d}",
                start_seconds=index,
                text=f"第{index}段普通交流。",
            )
            for index in range(1, 42)
        ]
        transport = FakeTransport(
            [
                {"summaries": []},
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "最后提出后续安排。",
                            "evidences": [{"segment_id": "P41", "quote": "普通交流"}],
                        }
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(segments, self.dimensions("next"))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].evidences[0].segment_id, "P41")

    def test_minutes_use_confirmed_summaries(self) -> None:
        transport = FakeTransport([{"minutes": "一、会议结论\n开展典型场景验证。"}])
        provider = DeepSeekLLMProvider(self.settings, transport)
        meeting = ParsedMeetingMetadata(
            filename="会议纪要.txt",
            meeting_time=datetime(2026, 5, 7, 15, 1),
            duration_seconds=300,
            duration_text="5分钟",
            keywords=["验证"],
        )

        result = provider.generate_minutes(
            meeting,
            [
                {
                    "dimension": "next",
                    "title": "后续目标",
                    "summary": "开展典型场景验证。",
                    "review_status": "confirmed",
                },
                {
                    "dimension": "topic",
                    "title": "课题",
                    "summary": "已排除内容",
                    "review_status": "excluded",
                },
            ],
        )

        self.assertIn("开展典型场景验证", result)
        user_content = transport.requests[0]["payload"]["messages"][1]["content"]
        self.assertNotIn("已排除内容", user_content)

    def test_chat_sends_multi_round_history_without_operation_tools(self) -> None:
        transport = FakeTransport(["会议纪要应优先记录结论和行动项。"])
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.chat(
            [
                {"role": "user", "content": "会议纪要应该记录什么？"},
                {"role": "assistant", "content": "通常需要记录结论。"},
                {"role": "user", "content": "还需要什么？"},
            ],
            {
                "segments": [{"id": "P1", "text": "下一步开展验证。"}],
                "summaries": [
                    {
                        "id": "A1",
                        "summary": "用户修改后的总结",
                        "review_status": "confirmed",
                    }
                ],
            },
        )

        self.assertIn("行动项", result)
        payload = transport.requests[0]["payload"]
        self.assertNotIn("response_format", payload)
        self.assertEqual(payload["messages"][-1]["content"], "还需要什么？")
        self.assertIn("不能触发会议分析", payload["messages"][0]["content"])
        self.assertIn("用户修改后的总结", payload["messages"][1]["content"])

    def test_config_assistant_uses_separate_json_prompt(self) -> None:
        transport = FakeTransport(
            [
                {
                    "reply": "建议新增风险问题维度。",
                    "operations": [
                        {
                            "type": "add_dimension",
                            "label": "风险问题",
                            "description": "识别项目风险和阻碍",
                        }
                    ],
                    "warnings": [],
                    "requires_confirmation": True,
                }
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.interpret_config(
            [{"role": "user", "content": "增加风险问题维度"}],
            [
                {
                    "key": "topic",
                    "label": "课题",
                    "description": "识别会议课题",
                    "enabled": True,
                }
            ],
        )

        self.assertEqual(result["operations"][0]["type"], "add_dimension")
        payload = transport.requests[0]["payload"]
        self.assertEqual(payload["response_format"], {"type": "json_object"})
        self.assertIn("会议分析配置助手", payload["messages"][0]["content"])
        self.assertIn("current_dimensions", payload["messages"][1]["content"])

    def test_analysis_aligns_harmless_quote_format_differences(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "选择典型场景开展验证。",
                            "evidences": [
                                {
                                    "segment_id": "P1",
                                    "quote": "下一步，选择典型场景进行验证",
                                }
                            ],
                        }
                    ]
                }
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        evidence = result[0].evidences[0]
        self.assertEqual(evidence.quote, "下一步选择典型场景进行验证")
        self.assertEqual(
            self.segments[0].text[evidence.start_offset : evidence.end_offset],
            evidence.quote,
        )

    def test_analysis_retries_once_when_quote_cannot_be_aligned(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第一次引用有误。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "原文不存在的内容"}
                            ],
                        }
                    ]
                },
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "选择典型场景开展验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "典型场景进行验证"}
                            ],
                        }
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(len(transport.requests), 2)
        self.assertEqual(result[0].evidences[0].quote, "典型场景进行验证")
        retry_system_prompt = transport.requests[1]["payload"]["messages"][0]["content"]
        self.assertIn("上一次结果存在 quote", retry_system_prompt)

    def test_analysis_extracts_json_from_markdown_fence(self) -> None:
        transport = FakeTransport(
            [
                """```json
{"summaries":[{"dimension":"next","summary":"选择典型场景开展验证。","evidences":[{"segment_id":"P1","quote":"典型场景进行验证"}]}]}
```"""
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].summary, "选择典型场景开展验证。")

    def test_analysis_accepts_structured_no_result(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [],
                    "noResult": {
                        "dimension": "后续目标",
                        "reason": "未发现明确分配给个人或角色的待办事项。",
                    },
                }
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(result, [])
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(provider.last_no_results[0].dimension, "next")
        self.assertEqual(
            provider.last_no_results[0].reason,
            "未发现明确分配给个人或角色的待办事项。",
        )

    def test_analysis_builds_fallback_no_result_for_empty_summaries(self) -> None:
        transport = FakeTransport([{"summaries": []}])
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(result, [])
        self.assertEqual(len(transport.requests), 1)
        self.assertEqual(provider.last_no_results[0].dimension, "next")
        self.assertEqual(provider.last_no_results[0].title, "后续目标")
        self.assertEqual(provider.last_no_results[0].reason, "未发现符合该维度定义的内容。")

    def test_analysis_retries_non_json_then_accepts_valid_json(self) -> None:
        transport = FakeTransport(
            [
                "我认为下一步应该选择典型场景进行验证。",
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "选择典型场景开展验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "典型场景进行验证"}
                            ],
                        }
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(len(transport.requests), 2)
        self.assertEqual(result[0].summary, "选择典型场景开展验证。")
        self.assertIn("严格返回 JSON 对象", transport.requests[1]["payload"]["messages"][0]["content"])

    def test_analysis_reports_raw_preview_after_two_non_json_outputs(self) -> None:
        transport = FakeTransport(["第一次不是 JSON", "第二次仍然不是 JSON"])
        provider = DeepSeekLLMProvider(self.settings, transport)

        with self.assertRaisesRegex(LLMProviderError, "原始返回前 500 字符"):
            provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(len(transport.requests), 2)

    def test_analysis_drops_only_unverifiable_summary_after_retry(self) -> None:
        transport = FakeTransport(
            [
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "第一次引用有误。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "原文不存在的内容"}
                            ],
                        }
                    ]
                },
                {
                    "summaries": [
                        {
                            "dimension": "next",
                            "summary": "选择典型场景开展验证。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "典型场景进行验证"}
                            ],
                        },
                        {
                            "dimension": "next",
                            "summary": "这条总结仍然使用错误引用。",
                            "evidences": [
                                {"segment_id": "P1", "quote": "仍然不存在的引用"}
                            ],
                        },
                    ]
                },
            ]
        )
        provider = DeepSeekLLMProvider(self.settings, transport)

        result = provider.analyze(self.segments, self.dimensions("next"))

        self.assertEqual(len(result), 1)
        self.assertEqual(result[0].summary, "选择典型场景开展验证。")
        self.assertEqual(result[0].evidences[0].quote, "典型场景进行验证")
        self.assertIn("P1", transport.requests[1]["payload"]["messages"][0]["content"])

    def test_rejects_quote_not_found_in_source(self) -> None:
        invalid_response = {
            "summaries": [
                {
                    "dimension": "next",
                    "summary": "虚构总结",
                    "evidences": [{"segment_id": "P1", "quote": "原文不存在的内容"}],
                }
            ]
        }
        transport = FakeTransport([invalid_response, invalid_response])
        provider = DeepSeekLLMProvider(self.settings, transport)
        with self.assertRaisesRegex(LLMProviderError, "未返回可解析的结构化 summaries"):
            provider.analyze(self.segments, self.dimensions("next"))

    def test_requires_api_key(self) -> None:
        with self.assertRaisesRegex(LLMProviderError, "DEEPSEEK_API_KEY"):
            DeepSeekLLMProvider(LLMSettings(provider="deepseek"))


if __name__ == "__main__":
    unittest.main()
