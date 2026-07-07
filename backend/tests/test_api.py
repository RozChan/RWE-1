import os
import unittest
from pathlib import Path

from fastapi.testclient import TestClient

os.environ["LLM_PROVIDER"] = "mock"
os.environ.pop("DEEPSEEK_API_KEY", None)

from app.main import app

FIXTURE = Path(__file__).parent / "fixtures" / "会议纪要.txt"


class MeetingApiTests(unittest.TestCase):
    @classmethod
    def setUpClass(cls) -> None:
        cls.client = TestClient(app)

    def test_health(self) -> None:
        response = self.client.get("/api/health")
        self.assertEqual(response.status_code, 200)
        self.assertEqual(
            response.json(),
            {"status": "ok", "llm_provider": "mock", "llm_model": "local-rules"},
        )

    def test_uploads_and_parses_txt(self) -> None:
        with FIXTURE.open("rb") as file:
            response = self.client.post(
                "/api/meetings/parse",
                files={"file": (FIXTURE.name, file, "text/plain")},
            )

        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertEqual(payload["meeting"]["duration_seconds"], 8690)
        self.assertEqual(payload["segments"][0]["id"], "P1")
        self.assertEqual(payload["segments"][2]["speaker"], "张瑞天")

    def test_mock_analysis_and_minutes_generation(self) -> None:
        with FIXTURE.open("rb") as file:
            parsed = self.client.post(
                "/api/meetings/parse",
                files={"file": (FIXTURE.name, file, "text/plain")},
            ).json()

        analysis = self.client.post(
            "/api/meetings/analyze",
            json={
                **parsed,
                "dimensions": [
                    {"key": "topic", "label": "课题", "description": "识别课题"},
                    {"key": "next", "label": "后续目标", "description": "识别行动项"},
                    {"key": "advice", "label": "建议", "description": "识别建议"},
                ],
            },
        )
        self.assertEqual(analysis.status_code, 200)
        summaries = analysis.json()["summaries"]
        self.assertTrue(summaries)
        summaries[0]["review_status"] = "confirmed"

        generated = self.client.post(
            "/api/meetings/generate-minutes",
            json={"meeting": parsed["meeting"], "summaries": summaries},
        )
        self.assertEqual(generated.status_code, 200)
        self.assertIn(summaries[0]["summary"], generated.json()["minutes"])

    def test_mock_chat_is_separate_from_page_operations(self) -> None:
        response = self.client.post(
            "/api/chat",
            json={
                "messages": [{"role": "user", "content": "你好，请介绍一下会议纪要。"}],
                "context": {"segments": [], "summaries": []},
            },
        )

        self.assertEqual(response.status_code, 200)
        payload = response.json()["message"]
        self.assertEqual(payload["role"], "assistant")
        self.assertIn("MockLLMProvider", payload["content"])

    def test_chat_requires_last_message_from_user(self) -> None:
        response = self.client.post(
            "/api/chat",
            json={"messages": [{"role": "assistant", "content": "这是一条助手消息。"}]},
        )

        self.assertEqual(response.status_code, 422)

    def test_config_assistant_previews_and_applies_whitelisted_operation(self) -> None:
        dimensions = [
            {
                "key": "topic",
                "label": "课题",
                "description": "识别会议课题",
                "enabled": True,
            },
            {
                "key": "highlight",
                "label": "亮点总结",
                "description": "识别亮点",
                "enabled": True,
            },
        ]
        interpreted = self.client.post(
            "/api/analysis-config/interpret",
            json={
                "messages": [{"role": "user", "content": "请删除亮点总结维度。"}],
                "dimensions": dimensions,
            },
        )
        self.assertEqual(interpreted.status_code, 200)
        preview = interpreted.json()
        self.assertTrue(preview["requires_confirmation"])
        self.assertEqual(preview["operations"][0]["type"], "remove_dimension")
        self.assertEqual(preview["operations"][0]["dimension_key"], "highlight")

        applied = self.client.post(
            "/api/analysis-config/apply",
            json={"dimensions": dimensions, "operations": preview["operations"]},
        )
        self.assertEqual(applied.status_code, 200)
        payload = applied.json()
        self.assertEqual([item["key"] for item in payload["dimensions"]], ["topic"])
        self.assertEqual(payload["affected_dimension_keys"], ["highlight"])
        self.assertTrue(payload["analysis_required"])

    def test_config_apply_allows_zero_enabled_dimensions(self) -> None:
        response = self.client.post(
            "/api/analysis-config/apply",
            json={
                "dimensions": [
                    {
                        "key": "topic",
                        "label": "课题",
                        "description": "识别会议课题",
                        "enabled": True,
                    }
                ],
                "operations": [{"type": "disable_dimension", "dimension_key": "topic"}],
            },
        )
        self.assertEqual(response.status_code, 200)
        payload = response.json()
        self.assertFalse(payload["dimensions"][0]["enabled"])

    def test_analysis_requires_one_to_nine_unique_dimensions(self) -> None:
        base = {
            "meeting": {
                "filename": "会议.txt",
                "meeting_time": "2026-06-07T15:01:00",
                "duration_seconds": 60,
                "duration_text": "1分钟",
                "keywords": [],
            },
            "segments": [
                {
                    "id": "P1",
                    "speaker": "说话人 1",
                    "timestamp": "00:01",
                    "start_seconds": 1,
                    "text": "讨论项目风险。",
                }
            ],
        }
        empty = self.client.post(
            "/api/meetings/analyze", json={**base, "dimensions": []}
        )
        duplicate = self.client.post(
            "/api/meetings/analyze",
            json={
                **base,
                "dimensions": [
                    {"key": "risk", "label": "风险", "description": "识别风险"},
                    {"key": "risk", "label": "风险2", "description": "识别风险"},
                ],
            },
        )
        self.assertEqual(empty.status_code, 422)
        self.assertEqual(duplicate.status_code, 422)

    def test_rejects_non_txt_file(self) -> None:
        response = self.client.post(
            "/api/meetings/parse",
            files={"file": ("meeting.pdf", b"not a txt", "application/pdf")},
        )
        self.assertEqual(response.status_code, 415)
        self.assertEqual(response.json()["detail"]["code"], "INVALID_FILE_TYPE")


if __name__ == "__main__":
    unittest.main()
