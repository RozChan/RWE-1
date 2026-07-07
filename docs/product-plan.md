# Reading Without Effort 产品规划及开发计划

> 文档状态：基于当前代码重构更新  
> 当前阶段：本地 MVP 已从会议专用工具升级为通用文档阅读工作台  
> 更新日期：2026-06-16

## 一、产品定位

Reading Without Effort 是一个面向长文档的 AI 阅读、批注、总结和问答工具。它不追求一次性生成不可验证的长篇结论，而是把文档拆分为可追溯片段，让 AI 的每条分析结果都必须绑定原文证据，再交给用户审核、编辑和生成最终输出。

核心链路：

```text
文档原文 → DocumentChunk/P 编号 → 阅读维度/模板 → AI 可追溯分析
→ 原文高亮与 SVG 证据连线 → 人工审核和批注 → Reading Output
```

## 二、当前演示场景

当前仍以本地 Web MVP 运行，支持两类 TXT：

1. **飞书会议 TXT**：保留原有会议解析能力，提取会议时间、时长、关键词、说话人、时间戳和发言内容；
2. **普通 TXT**：按空行、标题和自然段切分，生成 P1、P2、P3 文档片段。

页面结构保持工作台式布局：

- 顶部：文档信息与阅读维度配置；
- 左侧：原文 / Source；
- 中间：分析结果 / Summary；
- 右侧：AI 助手，包括文档问答与分析配置；
- 下方：输出结果 / Reading Output。

## 三、已完成能力

| 能力 | 状态 | 说明 |
|---|---|---|
| 通用文档模型 | 已完成 | `DocumentMetadata`、`DocumentChunk`、`ParseDocumentResponse` |
| 飞书会议兼容 | 已完成 | 旧会议 TXT 仍能解析，chunk.kind 为 `utterance` |
| 普通 TXT 解析 | 已完成 | 按空行/标题/自然段拆分为 P 编号片段 |
| 阅读维度配置 | 已完成 | 最少 1 个、最多 9 个，可新增、删除、停用、改名和修改说明 |
| MockLLMProvider | 已完成 | 本地规则分析，适合离线演示和测试 |
| DeepSeekLLMProvider | 已完成 | 支持 JSON Output、长文本分批和截断拆分重试 |
| Evidence 校验 | 已完成 | quote 必须逐字来自原文，offset 后端计算 |
| 原文/总结联动 | 已完成 | 下划线、高亮、SVG 连线、筛选和定位 |
| 总结人工审核 | 已完成 | 编辑、确认、排除、恢复 AI 原稿、标记待修改 |
| 输出生成 | 已完成 | `/api/documents/generate-output` 根据 confirmed 总结生成 |
| 文档问答 | 已完成 | `/api/chat` 读取当前文档、总结、审核状态和输出草稿，但只读 |
| 分析配置助手 | 已完成 | 白名单 operations，用户确认后后端校验执行 |
| 旧会议接口 | 已保留 | `/api/meetings/*` 继续兼容 |

## 四、默认阅读模板

短期默认模板从会议专用维度调整为通用阅读维度：

- 核心观点；
- 关键事实；
- 重要进展；
- 风险问题；
- 行动建议；
- 待确认事项。

后续可继续扩展文档类型模板：`meeting`、`generic_text`、`policy`、`contract`、`report`、`paper`、`requirement`、`other`。

## 五、当前边界

本阶段暂不实现：数据库、用户登录、权限、Docker、Redis、异步任务、PDF/Word 解析、飞书 API、项目保存、Word 导出、生产部署和多用户协作。

## 六、下一阶段计划

1. 将前端大型页面继续拆分为 SourcePanel、SummaryPanel、AssistantPanel 和 OutputPanel；
2. 将 evidence 字段从兼容 `segment_id` 逐步迁移到 `chunk_id`；
3. 增加更多阅读模板和输出类型；
4. 增加项目保存/打开和本地导出；
5. 增加 PDF / Word 解析和页码定位；
6. 增加更完整的端到端测试样例。
