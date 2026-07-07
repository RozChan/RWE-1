import { expect, type Page } from "@playwright/test";

const fatalRuntimePatterns = [
  /Application error/i,
  /Unhandled Runtime Error/i,
  /client-side exception/i,
  /ReferenceError/i,
  /TypeError/i,
  /is not defined/i,
  /has already been declared/i,
  /Cannot read properties of undefined/i,
  /Cannot access .* before initialization/i,
  /ConnectorOverlay has already been declared/i,
  /plan is not defined/i,
];

function isFatalRuntimeMessage(message: string) {
  return fatalRuntimePatterns.some((pattern) => pattern.test(message));
}

export function installRuntimeErrorGuards(page: Page) {
  const pageErrors: string[] = [];
  const consoleErrors: string[] = [];

  page.on("pageerror", (error) => {
    pageErrors.push(error.stack || error.message);
  });

  page.on("console", (message) => {
    if (message.type() !== "error") return;
    const text = message.text();
    if (isFatalRuntimeMessage(text)) {
      consoleErrors.push(text);
    }
  });

  return {
    async assertNoRuntimeErrors() {
      await expect(page.locator("body")).not.toContainText(
        /Application error|Unhandled Runtime Error|client-side exception|plan is not defined|ConnectorOverlay has already been declared|is not defined|has already been declared/i,
      );
      expect(pageErrors, `Unexpected page errors:\n${pageErrors.join("\n\n")}`).toEqual([]);
      expect(consoleErrors, `Unexpected fatal console errors:\n${consoleErrors.join("\n\n")}`).toEqual([]);
    },
  };
}
