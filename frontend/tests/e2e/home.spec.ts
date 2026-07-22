import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { installRuntimeErrorGuards } from "./utils/runtimeErrors";

const parseApiUrl = "**/api/documents/parse";

async function openHomeWithoutRuntimeErrors(page: Page) {
  const runtimeErrors = installRuntimeErrorGuards(page);
  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await runtimeErrors.assertNoRuntimeErrors();
  return runtimeErrors;
}

test("home page opens without runtime error overlays", async ({ page }) => {
  const runtimeErrors = await openHomeWithoutRuntimeErrors(page);

  await expect(page.getByTestId("dimension-config-panel")).toBeVisible();
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await expect(page.getByTestId("final-output-panel")).toBeVisible();
  await expect(page.getByTestId("file-upload-input")).toBeAttached();
  await runtimeErrors.assertNoRuntimeErrors();
});

test("basic page structure is present", async ({ page }) => {
  const runtimeErrors = await openHomeWithoutRuntimeErrors(page);

  await expect(page.getByTestId("source-panel")).toBeVisible();
  await expect(page.getByTestId("summary-panel")).toBeVisible();
  await expect(page.getByTestId("dimension-config-panel")).toBeVisible();
  await expect(page.getByTestId("agent-panel")).toBeVisible();
  await expect(page.getByTestId("final-output-panel")).toBeVisible();
  await expect(page.getByTestId("file-upload-input")).toBeAttached();
  await runtimeErrors.assertNoRuntimeErrors();
});

test("uploading a sample meeting txt renders source paragraphs", async ({ page }) => {
  const runtimeErrors = installRuntimeErrorGuards(page);
  await page.route(parseApiUrl, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        document: {
          filename: "sample-feishu-meeting.txt",
          document_type: "meeting",
          title: "sample-feishu-meeting.txt",
          char_count: 72,
          chunk_count: 3,
          meeting_time: "2026年6月18日 下午 3:01",
          duration_text: "1小时 03分钟 18秒",
          duration_seconds: 3798,
          keywords: ["知识库", "资料检索", "项目管理", "用户反馈"],
        },
        chunks: [
          {
            id: "P1",
            kind: "utterance",
            text: "大家好，今天主要讨论知识库资料检索的问题。",
            originalText: "大家好，今天主要讨论知识库资料检索的问题。",
            currentText: "大家好，今天主要讨论知识库资料检索的问题。",
            isEdited: false,
            isDeleted: false,
            speaker: "张三",
            timestamp: "00:34",
            start_seconds: 34,
            start_offset: 0,
            end_offset: 22,
          },
          {
            id: "P2",
            kind: "utterance",
            text: "我补充一下项目管理和用户反馈的背景。",
            originalText: "我补充一下项目管理和用户反馈的背景。",
            currentText: "我补充一下项目管理和用户反馈的背景。",
            isEdited: false,
            isDeleted: false,
            speaker: "李四",
            timestamp: "02:08",
            start_seconds: 128,
            start_offset: 23,
            end_offset: 42,
          },
          {
            id: "P3",
            kind: "utterance",
            text: "后续需要整理测试清单并确认交付时间。",
            originalText: "后续需要整理测试清单并确认交付时间。",
            currentText: "后续需要整理测试清单并确认交付时间。",
            isEdited: false,
            isDeleted: false,
            speaker: "王五",
            timestamp: "03:21",
            start_seconds: 201,
            start_offset: 43,
            end_offset: 62,
          },
        ],
      }),
    });
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page
    .getByTestId("file-upload-input")
    .setInputFiles(path.join(__dirname, "../fixtures/sample-feishu-meeting.txt"));

  await expect(page.getByTestId("source-segment-card")).toHaveCount(3);
  await expect(page.getByTestId("source-segment-card").first()).toContainText("P1");
  await expect(page.getByTestId("source-segment-card").first()).toContainText("知识库资料检索");
  await expect(page.getByTestId("source-segment-card").nth(1)).toContainText("项目管理和用户反馈");
  await runtimeErrors.assertNoRuntimeErrors();
});

test("AgentPlanCard renders a pending plan without plan reference errors", async ({ page }) => {
  const runtimeErrors = installRuntimeErrorGuards(page);
  await page.route("**/api/agent/plan", async (route) => {
    await route.fulfill({
      status: 200,
      contentType: "application/json",
      body: JSON.stringify({
        plan: {
          id: "plan-regression-1",
          userIntent: "新增一个客户洞察维度",
          assistantReply: "我会先新增一个客户洞察维度，等待你确认后再执行。",
          operations: [
            {
              id: "op-add-customer-insight",
              type: "add_dimension",
              title: "新增客户洞察维度",
              description: "识别客户诉求、反馈和潜在机会。",
              riskLevel: "low",
              requiresConfirmation: true,
              params: {
                label: "客户洞察",
                description: "识别客户诉求、反馈和潜在机会。",
              },
            },
          ],
          warnings: [],
          assumptions: [],
          requiresConfirmation: true,
          confirmationText: "确认后我将新增该维度。",
          createdAt: "2026-07-07T00:00:00.000Z",
        },
      }),
    });
  });

  await page.goto("/");
  await page.waitForLoadState("networkidle");
  await page.getByTestId("agent-panel").locator("textarea").fill("新增一个客户洞察维度");
  await page.getByTestId("agent-panel").locator('button[type="submit"]').click();

  await expect(page.getByText("我准备这样做")).toBeVisible();
  await expect(page.getByText("1 个操作")).toBeVisible();
  await expect(page.getByText("新增客户洞察维度")).toBeVisible();
  await runtimeErrors.assertNoRuntimeErrors();
});
