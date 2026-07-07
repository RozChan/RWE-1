import unittest
from datetime import datetime

from app.domain import ParsedMeetingMetadata, ParsedTranscriptSegment
from app.evidence import EvidenceValidationError, verify_summaries
from app.llm import (
    MockLLMProvider,
    ProviderDimension,
    ProviderEvidence,
    ProviderSummary,
)
from app.services import analyze_meeting, build_minutes


class MockAnalysisTests(unittest.TestCase):
    def setUp(self) -> None:
        self.segments = [
            ParsedTranscriptSegment(
                id="P1",
                speaker="说话人 1",
                timestamp="00:33",
                start_seconds=33,
                text="已经完成需求收集，下一步选择典型场景进行验证。",
            ),
            ParsedTranscriptSegment(
                id="P2",
                speaker="说话人 2",
                timestamp="01:12",
                start_seconds=72,
                text="建议关注结果可解释性，避免重复建设并提升落地效率。",
            ),
        ]

    def test_mock_provider_returns_verified_multi_dimension_results(self) -> None:
        results = analyze_meeting(
            MockLLMProvider(),
            self.segments,
            [
                ProviderDimension("progress", "课题进展", "识别进展"),
                ProviderDimension("next", "后续目标", "识别下一步"),
                ProviderDimension("advice", "建议", "识别建议"),
                ProviderDimension("highlight", "亮点", "识别亮点"),
            ],
        )
        summaries = results["summaries"]
        self.assertEqual(
            {item["dimension"] for item in summaries},
            {"progress", "next", "advice", "highlight"},
        )
        self.assertTrue(all(item["evidences"][0]["verified"] for item in summaries))
        next_item = next(item for item in summaries if item["dimension"] == "next")
        self.assertEqual(next_item["evidences"][0]["segment_id"], "P1")

    def test_evidence_validator_rejects_mismatched_quote(self) -> None:
        summary = ProviderSummary(
            dimension="topic",
            title="课题",
            summary="错误证据",
            evidences=[ProviderEvidence("P1", "不存在", 0, 3)],
        )
        with self.assertRaises(EvidenceValidationError):
            verify_summaries([summary], self.segments)

    def test_minutes_use_confirmed_summaries_only(self) -> None:
        meeting = ParsedMeetingMetadata(
            filename="会议纪要.txt",
            meeting_time=datetime(2026, 5, 7, 15, 1),
            duration_seconds=300,
            duration_text="5分钟",
            keywords=["AI", "验证"],
        )
        summaries = [
            {
                "dimension": "next",
                "title": "后续目标",
                "summary": "开展验证。",
                "review_status": "confirmed",
            },
            {
                "dimension": "topic",
                "title": "课题",
                "summary": "不应出现。",
                "review_status": "excluded",
            },
        ]
        minutes = build_minutes(MockLLMProvider(), meeting, summaries)
        self.assertIn("开展验证。", minutes)
        self.assertNotIn("不应出现。", minutes)

    def test_manual_annotation_can_link_to_output_dimension(self) -> None:
        meeting = ParsedMeetingMetadata(
            filename="阅读材料.txt",
            meeting_time=datetime(2026, 6, 29, 9, 30),
            duration_seconds=None,
            duration_text=None,
            keywords=[],
        )
        summaries = [
            {
                "dimension": "highlight",
                "title": "风险问题",
                "summary": "交付周期存在压缩风险。",
                "review_status": "confirmed",
            },
            {
                "dimension": "manual_annotation",
                "title": "人工批注",
                "summary": "这个风险后续需要重点关注。",
                "review_status": "confirmed",
                "source": "manual",
                "linked_dimension_key": "highlight",
                "linked_dimension_label": "风险问题",
            },
        ]

        minutes = build_minutes(MockLLMProvider(), meeting, summaries)

        self.assertIn("风险问题", minutes)
        self.assertIn("交付周期存在压缩风险。", minutes)
        self.assertIn("人工补充：这个风险后续需要重点关注。", minutes)
        self.assertNotIn("人工批注\n", minutes)


if __name__ == "__main__":
    unittest.main()
