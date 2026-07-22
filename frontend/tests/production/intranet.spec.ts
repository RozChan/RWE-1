import { expect, test } from "@playwright/test";
import { installRuntimeErrorGuards } from "../e2e/utils/runtimeErrors";

test("production server exposes the home page and same-origin backend health", async ({ page }) => {
  const runtimeErrors = installRuntimeErrorGuards(page);
  const healthResponse = await page.request.get("/api/health");

  expect(healthResponse.ok()).toBeTruthy();
  await expect(healthResponse.json()).resolves.toEqual({ status: "ok" });

  await page.goto("/");
  await expect(page.getByTestId("source-panel")).toBeVisible();
  await runtimeErrors.assertNoRuntimeErrors();
});
