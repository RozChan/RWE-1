import unittest
from pathlib import Path

from app.parser import TranscriptParseError, decode_transcript, parse_document, parse_feishu_transcript

FIXTURE = Path(__file__).parent / "fixtures" / "会议纪要.txt"


class TranscriptParserTests(unittest.TestCase):
    def test_parses_meeting_metadata_and_segments(self) -> None:
        result = parse_feishu_transcript(
            FIXTURE.read_text(encoding="utf-8"), FIXTURE.name
        )

        self.assertEqual(result.meeting.filename, "会议纪要.txt")
        self.assertEqual(result.meeting.meeting_time.isoformat(), "2026-05-07T15:01:00")
        self.assertEqual(result.meeting.duration_seconds, 8690)
        self.assertEqual(result.meeting.keywords[:3], ["分享", "飞书", "知识库"])
        self.assertEqual(
            [segment.id for segment in result.segments], ["P1", "P2", "P3", "P4"]
        )
        self.assertEqual(result.segments[0].speaker, "说话人 4")
        self.assertEqual(result.segments[0].timestamp, "02:33")
        self.assertEqual(result.segments[0].start_seconds, 153)
        self.assertEqual(result.segments[2].speaker, "张瑞天")
        self.assertEqual(result.segments[2].text, "好。")

    def test_decodes_utf8_bom_and_gb18030(self) -> None:
        text = FIXTURE.read_text(encoding="utf-8")
        self.assertEqual(decode_transcript(text.encode("utf-8-sig")), text)
        self.assertEqual(decode_transcript(text.encode("gb18030")), text)

    def test_rejects_missing_transcript_section(self) -> None:
        content = "2026年5月7日 下午 3:01\n2小时 24分钟 50秒\n关键词\nAI\n其他部分"
        with self.assertRaises(TranscriptParseError):
            parse_feishu_transcript(content, "broken.txt")

    def test_rejects_invalid_timestamp(self) -> None:
        content = FIXTURE.read_text(encoding="utf-8").replace("02:33", "02:99", 1)
        with self.assertRaisesRegex(TranscriptParseError, "02:99"):
            parse_feishu_transcript(content, FIXTURE.name)

    def test_standard_feishu_format_is_detected(self) -> None:
        content = """2026年6月18日 下午 3:01
1小时 03分钟 18秒
关键词
知识库 资料检索 项目管理 用户反馈 权限 标签 归档 测试 交付 待确认
文字记录
张三 00:34
大家好，今天这个会主要讨论……
李四 02:08
我先补充一下背景……"""
        parsed = parse_document(content, "标准飞书.txt")

        self.assertEqual(parsed.document.document_type, "meeting")
        self.assertEqual(parsed.document.meeting_time.isoformat(), "2026-06-18T15:01:00")
        self.assertEqual(parsed.document.duration_seconds, 3798)
        self.assertEqual(parsed.document.keywords[:3], ["知识库", "资料检索", "项目管理"])
        self.assertEqual([chunk.speaker for chunk in parsed.chunks], ["张三", "李四"])
        self.assertEqual(parsed.chunks[0].text, "大家好，今天这个会主要讨论……")

    def test_real_feishu_inline_date_duration_and_colon_markers(self) -> None:
        content = """2026年6月4日 下午 2:24|2小时 11分钟 20秒

关键词:
飞书、智能、数据库、工作流、知识、集成、机器人、分享、表格、数字员工、数据分析、数据科学、知识体系、模型输出、开发人员、机器学习、深度学习、自然语言

文字记录:
张瑞天 05:38
嗯，开始。我看一下黄茜老师在线上。
朱哲杰 06:29
各位领导同事大家好，我是来自高压及充电系统部门的 AI 接口。
朱哲杰 06:58
第二个就是我们的充电性能这一块……"""
        parsed = parse_document(content, "真实飞书.txt")

        self.assertEqual(parsed.document.document_type, "meeting")
        self.assertEqual(parsed.document.meeting_time.isoformat(), "2026-06-04T14:24:00")
        self.assertEqual(parsed.document.duration_seconds, 7880)
        self.assertEqual(parsed.document.duration_text, "2小时11分钟20秒")
        self.assertEqual(parsed.document.keywords[:3], ["飞书", "智能", "数据库"])
        self.assertEqual([chunk.speaker for chunk in parsed.chunks], ["张瑞天", "朱哲杰", "朱哲杰"])
        self.assertEqual(parsed.chunks[0].timestamp, "05:38")

    def test_feishu_without_colons_is_detected(self) -> None:
        content = """2026年6月4日 下午 2:24
2小时 11分钟 20秒
关键词
飞书 智能 数据库 工作流 知识 集成 机器人
文字记录
张瑞天 05:38
嗯，开始。
朱哲杰 06:29
各位领导同事大家好。"""
        parsed = parse_document(content, "无冒号飞书.txt")

        self.assertEqual(parsed.document.document_type, "meeting")
        self.assertEqual(parsed.document.duration_seconds, 7880)
        self.assertEqual([chunk.speaker for chunk in parsed.chunks], ["张瑞天", "朱哲杰"])

    def test_feishu_without_transcript_marker_uses_first_speaker(self) -> None:
        content = """2026年6月4日 下午 2:24
2小时 11分钟 20秒
关键词
飞书 智能 数据库
张瑞天 05:38
嗯，开始。
朱哲杰 06:29
各位领导同事大家好。
王五 08:12
我补充一下。"""
        parsed = parse_document(content, "无文字记录标题.txt")

        self.assertEqual(parsed.document.document_type, "meeting")
        self.assertEqual([chunk.speaker for chunk in parsed.chunks], ["张瑞天", "朱哲杰", "王五"])
        self.assertEqual(parsed.chunks[0].text, "嗯，开始。")

    def test_plain_article_with_keywords_is_not_misclassified(self) -> None:
        content = """标题：人工智能发展趋势
关键词：人工智能、模型、数据
正文：本文介绍人工智能的发展历程……"""
        parsed = parse_document(content, "科普文章.txt")

        self.assertEqual(parsed.document.document_type, "generic_text")
        self.assertEqual(parsed.chunks[0].text, content)


if __name__ == "__main__":
    unittest.main()
