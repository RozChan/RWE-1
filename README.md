# Reading Without Effort — 本地 MVP

Reading Without Effort 是一个面向长文档的 AI 阅读、批注、总结和问答工具。当前版本由原本的“AI 会议纪要助手”重构而来，底层语义从 `Meeting / TranscriptSegment` 升级为 `Document / DocumentChunk`，同时保留飞书会议 TXT 演示场景和原有可追溯证据能力。

```text
上传 TXT 文档 → FastAPI 解析为 P 编号文档片段 → 用户确认阅读维度
→ Mock / DeepSeek 结构化分析 → 原文证据高亮与 SVG 连线
→ 人工编辑/确认/排除/标记 → 生成 Reading Output → 人工编辑与复制
文档问答 → /api/chat 只读读取当前文档、总结、审核状态和输出草稿
分析配置 → 大模型生成白名单维度操作建议 → 用户确认 → 后端校验执行
```

## 项目结构

- `frontend/`：Next.js + React + TypeScript + Tailwind CSS + Zustand；
- `backend/`：FastAPI + Pydantic + Python 解析器 + Mock / DeepSeek Provider；
- `docs/data-contract.md`：通用 Document/Chunk 数据契约；
- `docs/product-plan.md`：产品定位、已完成能力和后续计划。

## 已实现能力

- `POST /api/documents/parse`：上传 `.txt`，自动识别飞书会议 TXT 或普通 TXT；
- 飞书会议 TXT 保留会议时间、时长、关键词、说话人、时间戳，chunk.kind 为 `utterance`；
- 普通 TXT 按空行/标题/自然段切分为 P1、P2、P3，chunk.kind 为 `heading`、`paragraph` 或 `list_item`；
- `POST /api/documents/analyze`：按 1～9 个阅读维度调用 Mock 或 DeepSeek；
- Evidence 仍保留 `segment_id` 兼容字段，它现在表示通用文档片段 ID；quote offset 仍由后端校验和计算；
- 原文下划线、总结卡片、SVG 连线、维度筛选、导航、待修改标记、编辑/确认/排除/恢复 AI 原稿仍可用；
- `POST /api/documents/generate-output`：根据已确认总结生成输出结果；会议文档默认生成会议纪要语气，普通文档默认生成阅读总结；
- `POST /api/chat`：文档问答只读读取当前文档、片段、总结、审核状态和输出草稿；
- `POST /api/analysis-config/interpret` 与 `/api/analysis-config/apply`：分析配置助手继续只生成白名单操作建议；
- 旧 `/api/meetings/parse`、`/api/meetings/analyze`、`/api/meetings/generate-minutes` 保持兼容。

## DeepSeek 配置

复制后端示例配置：

```bash
cd backend
cp .env.example .env
```

Windows PowerShell：

```powershell
Copy-Item .env.example .env
```

编辑 `backend/.env`，不要把真实 Key 写入代码、文档或前端环境变量：

```env
LLM_PROVIDER=deepseek
DEEPSEEK_API_KEY=在这里填写新生成的Key
DEEPSEEK_BASE_URL=https://api.deepseek.com
DEEPSEEK_MODEL=deepseek-v4-pro
DEEPSEEK_TIMEOUT_SECONDS=120
DEEPSEEK_MAX_TOKENS=8192
DEEPSEEK_THINKING=disabled
```

如果暂时不想产生 API 费用，将 `LLM_PROVIDER` 改回 `mock`。

## 本地运行

需要让同一公司内网的其他电脑访问时，请使用生产构建和专用脚本，不要长期运行开发服务器。完整步骤、架构、防火墙说明和多人使用限制见 [`docs/INTRANET_DEPLOYMENT_WINDOWS.md`](docs/INTRANET_DEPLOYMENT_WINDOWS.md)。

### Windows 公司电脑：推荐一键启动

1. 双击 `setup-windows.cmd`；
2. 脚本会创建 `backend\.venv`、安装前后端依赖，并在缺少时创建本地环境文件；
3. 双击 `start-windows.cmd`；
4. 浏览器打开 <http://localhost:3000>。

使用期间保持后端和前端两个命令窗口打开。脚本直接调用 `npm.cmd` 和虚拟环境中的 `python.exe`，不需要修改 PowerShell 执行策略。

> 后端依赖当前固定使用 Python 3.12。若公司电脑曾用 Python 3.14 创建过 `backend\.venv`，可能出现 `ModuleNotFoundError: pydantic_core._pydantic_core`。重新双击 `setup-windows.cmd` 会检测并重建非 3.12 的虚拟环境；也可以手动删除 `backend\.venv` 后再运行 setup。

### 手动启动后端

```bash
cd backend
py -3.12 -m venv .venv  # Windows；macOS/Linux 请使用 Python 3.12 创建虚拟环境
source .venv/bin/activate   # Windows PowerShell: .venv\Scripts\Activate.ps1
pip install -r requirements-dev.txt
uvicorn app.main:app --reload --port 8000
```

### 手动启动前端

```bash
cd frontend
cp .env.example .env.local
npm install
npm run dev
```

## 使用流程

1. 点击“上传文档”选择飞书会议 TXT 或普通 TXT；
2. 页面解析并显示 P 编号原文片段和文档信息；
3. 编辑并确认阅读维度；
4. 点击“开始 AI 分析”；
5. 检查原文证据高亮和总结连线；
6. 编辑、确认、排除或标记总结；
7. 点击“生成输出”，在 textarea 中继续编辑并复制；
8. 右侧“文档问答”可以基于当前文档和总结进行只读问答。

## 测试

```bash
cd backend
PYTHONPATH=. python -m unittest discover -s tests -v
ruff check app tests
black --check app tests

cd ../frontend
npm run typecheck
npm run build
```

> 当前仓库仍不包含数据库、登录、权限、Docker、Redis、异步任务、PDF/Word 解析、飞书 API、项目保存、Word 导出或多用户协作。
