if (!process.env.OPENAI_API_KEY) {
  process.env.OPENAI_API_KEY = "sk-test-browser-smoke";
}

import pc from "picocolors";
import { RunContext } from "@openai/agents";
import { BrowserController } from "./browser.js";
import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { createBrowserTools, type BrowserTool } from "./tools.js";

async function invokeTool(
  toolDef: BrowserTool,
  input: Record<string, unknown>,
): Promise<unknown> {
  const ctx = new RunContext();
  return toolDef.invoke(ctx, JSON.stringify(input));
}

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);

  logger.info(pc.cyan("Starting browser smoke test..."));

  const controller = new BrowserController(config);
  const tools = createBrowserTools(controller);
  const [
    openBrowser,
    navigateToUrl,
    takeScreenshot,
    clickOnScreen,
    sendKeys,
    scrollPage,
    doubleClick,
    findElement,
    getPageState,
  ] = tools;

  try {
    logger.info("1/9 open_browser");
    const openResult = await invokeTool(openBrowser, { headless: false });
    if (!openResult || typeof openResult !== "object") {
      throw new Error("open_browser returned unexpected result");
    }
    logger.info(`   Browser: ${JSON.stringify(openResult)}`);

    logger.info("2/9 navigate_to_url");
    const navResult = await invokeTool(navigateToUrl, {
      url: "https://example.com",
    });
    if (!navResult || typeof navResult !== "object" || !("title" in navResult)) {
      throw new Error("navigate_to_url returned unexpected result");
    }
    logger.info(`   Title: ${(navResult as { title: string }).title}`);

    logger.info("3/9 take_screenshot");
    const shotResult = await invokeTool(takeScreenshot, { name: "smoke-test" });
    if (
      !shotResult ||
      typeof shotResult !== "object" ||
      !("path" in shotResult) ||
      !("base64Length" in shotResult)
    ) {
      throw new Error("take_screenshot returned unexpected result");
    }
    const shot = shotResult as { path: string; base64Length: number };
    if (shot.base64Length <= 0) {
      throw new Error("Screenshot base64 was empty");
    }
    logger.info(`   Saved: ${shot.path} (base64 length: ${shot.base64Length})`);

    logger.info("4/9 find_element");
    const found = await invokeTool(findElement, {
      description: "Learn more",
    });
    if (!found || typeof found !== "object" || !("coords" in found)) {
      throw new Error('find_element did not find "Learn more" link on example.com');
    }
    const element = found as { coords: { x: number; y: number } };
    logger.info(`   Found at (${element.coords.x}, ${element.coords.y})`);

    const viewport = config.viewport;
    const centerX = Math.round(viewport.width / 2);
    const centerY = Math.round(viewport.height / 2);

    logger.info("5/9 click_on_screen (red highlight at page center)");
    const clickResult = await invokeTool(clickOnScreen, {
      x: centerX,
      y: centerY,
    });
    if (
      !clickResult ||
      typeof clickResult !== "object" ||
      !("x" in clickResult) ||
      !("y" in clickResult)
    ) {
      throw new Error(`click_on_screen returned unexpected result: ${String(clickResult)}`);
    }
    logger.info(`   Clicked: ${JSON.stringify(clickResult)}`);

    logger.info("6/9 scroll");
    const scrollDown = await invokeTool(scrollPage, { direction: "down", amount: 200 });
    const scrollUp = await invokeTool(scrollPage, { direction: "up", amount: 200 });
    logger.info(`   Scroll down/up: ${JSON.stringify({ scrollDown, scrollUp })}`);

    logger.info("7/9 double_click (page center)");
    const dblClickResult = await invokeTool(doubleClick, { x: centerX, y: centerY });
    logger.info(`   Double-clicked: ${JSON.stringify(dblClickResult)}`);

    logger.info("8/9 get_page_state");
    const pageState = await invokeTool(getPageState, {});
    if (
      !pageState ||
      typeof pageState !== "object" ||
      !("elements" in pageState) ||
      !Array.isArray((pageState as { elements: unknown[] }).elements)
    ) {
      throw new Error("get_page_state returned unexpected result");
    }
    const state = pageState as { url: string; title: string; elements: { role: string }[] };
    const hasLink = state.elements.some((el) => el.role === "link");
    if (!hasLink) {
      throw new Error("get_page_state did not include any link elements");
    }
    logger.info(
      `   Page state: ${state.elements.length} interactive element(s), url=${state.url}`,
    );

    logger.info("9/9 send_keys (no focused input — exercises keyboard API)");
    const keysResult = await invokeTool(sendKeys, { text: "test" });
    logger.info(`   send_keys: ${JSON.stringify(keysResult)}`);

    logger.info("Testing withRetry recovery");
    let retryAttempts = 0;
    await controller.withRetry("retry smoke test", async () => {
      retryAttempts += 1;
      if (retryAttempts < 2) {
        throw new Error("Simulated transient failure");
      }
      return "recovered";
    });
    if (retryAttempts !== 2) {
      throw new Error(`Expected 2 retry attempts, got ${retryAttempts}`);
    }
    logger.info(`   withRetry recovered after ${retryAttempts} attempt(s)`);

    await controller.close();
    logger.success(pc.green("Browser smoke test passed"));
    process.exit(0);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Browser smoke test failed: ${message}`);
    try {
      await controller.close();
    } catch {
      // ignore close errors during failure cleanup
    }
    process.exit(1);
  }
}

main();
