# Reading Without Effort MVP 数据契约

本文档描述当前本地 MVP 的前后端数据边界。核心对象已从会议语义升级为通用文档语义：`DocumentMetadata` + `DocumentChunk`。

## 1. 文档解析

### `POST /api/documents/parse`

请求为 `multipart/form-data`，字段名 `file`，仅接收不超过 5 MB 的 `.txt` 文件。

响应：

```json
{
  "document": {
    "filename": "example.txt",
    "document_type": "generic_text",
    "title": "example.txt",
    "char_count": 1200,
    "chunk_count": 8,
    "meeting_time": null,
    "duration_seconds": null,
    "duration_text": null,
    "keywords": [],
    "metadata": {"source_parser": "plain_text"}
  },
  "chunks": [
    {
      "id": "P1",
      "text": "第一段正文。",
      "kind": "paragraph",
      "speaker": null,
      "timestamp": null,
      "start_seconds": null,
      "heading_path": null,
      "page_number": null,
      "start_offset": 0,
      "end_offset": 6,
      "metadata": {}
    }
  ]
}
```

飞书会议 TXT 会被识别为 `document_type = meeting`，并保留 `meeting_time`、`duration_seconds`、`duration_text`、`keywords`、`speaker`、`timestamp` 和 `start_seconds`。

旧接口 `POST /api/meetings/parse` 仍返回 `{meeting, segments}`，用于兼容旧客户端。

## 2. 文档分析

### `POST /api/documents/analyze`

```json
{
  "document": {},
  "chunks": [],
  "dimensions": [
    {"key": "core_point", "label": "核心观点", "description": "识别文档核心观点"}
  ]
}
```

`dimensions` 最少 1 项、最多 9 项，`key` 唯一。

响应：

```json
{
  "summaries": [
    {
      "id": "A1",
      "dimension": "core_point",
      "title": "核心观点",
      "summary": "文档强调……",
      "review_status": "draft",
      "model_confidence": null,
      "evidences": [
        {
          "id": "E1-1",
          "segment_id": "P1",
          "quote": "逐字来自原文",
          "start_offset": 0,
          "end_offset": 6,
          "verified": true
        }
      ]
    }
  ]
}
```

`segment_id` 为兼容字段，现在表示通用 `DocumentChunk.id`。字符 offset 使用前闭后开范围，由后端根据 quote 重新计算并校验。

## 3. 输出生成

### `POST /api/documents/generate-output`

```json
{
  "document": {},
  "summaries": [],
  "output_type": "reading_summary"
}
```

支持 `meeting_minutes`、`reading_summary`、`executive_summary`、`risk_report`、`action_items`、`study_notes`。后端只使用 `review_status = confirmed` 的总结。

响应：

```json
{"output": "完整输出文本"}
```

旧 `POST /api/meetings/generate-minutes` 仍返回 `{minutes}`。

## 4. 文档问答

### `POST /api/chat`

聊天接口只读，不具备页面操作能力。前端可提交：

```json
{
  "messages": [{"role": "user", "content": "P3 的风险是否进入总结？"}],
  "context": {
    "document": {},
    "chunks": [],
    "summaries": [],
    "output_draft": "当前人工编辑后的输出草稿"
  }
}
```

## 5. 分析配置助手

`/api/analysis-config/interpret` 仅把自然语言转成白名单操作建议；`/api/analysis-config/apply` 在用户确认后执行确定性校验。允许操作仍为：`add_dimension`、`remove_dimension`、`update_dimension`、`enable_dimension`、`disable_dimension`。

## 6. LLM Provider

- `mock`：本地确定性规则，不发送外部请求；
- `deepseek`：调用 DeepSeek Chat Completions JSON Output。

模型只返回维度、总结、`segment_id` 和精确 quote；offset、verified 和无效证据过滤由后端统一处理。真实密钥只允许放在未纳入 Git 的 `backend/.env`。
