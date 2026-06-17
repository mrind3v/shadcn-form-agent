import { mkdir } from "node:fs/promises";
import path from "node:path";
import {
  chromium,
  firefox,
  webkit,
  type Browser,
  type BrowserContext,
  type Page,
} from "playwright";
import type { Config } from "./config.js";
import { logger } from "./logger.js";
import type {
  ClickResult,
  ElementCoords,
  FillResult,
  FindElementResult,
  NavigateResult,
  OpenBrowserResult,
  PageState,
  PageStateElement,
  ParsedAriaElement,
  ScrollDirection,
  ScrollResult,
  ScreenshotResult,
} from "./types.js";

const RETRY_DELAYS_MS = [1000, 2000, 4000] as const;
const FILTERED_ROLES = new Set([
  "textbox",
  "button",
  "link",
  "combobox",
  "checkbox",
]);

/** Playwright-backed browser session with coordinate-driven interaction and ARIA parsing. */
export class BrowserController {
  private browser: Browser | null = null;
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private readonly config: Config;

  /** @param config - Runtime browser and viewport settings. */
  constructor(config: Config) {
    this.config = config;
  }

  /** Whether a page is currently open. */
  get isOpen(): boolean {
    return this.page !== null;
  }

  /**
   * Retry an async operation with exponential backoff and failure screenshot.
   *
   * @param operation - Label used in log messages.
   * @param fn - Operation to execute.
   * @param maxRetries - Override for config maxRetries.
   */
  async withRetry<T>(
    operation: string,
    fn: () => Promise<T>,
    maxRetries = this.config.maxRetries,
  ): Promise<T> {
    const attempts = maxRetries + 1;
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
      try {
        return await fn();
      } catch (error) {
        lastError = error;
        const message = error instanceof Error ? error.message : String(error);
        logger.warn(
          `${operation} failed (attempt ${attempt}/${attempts}): ${message}`,
        );

        if (attempt < attempts) {
          const delay = RETRY_DELAYS_MS[Math.min(attempt - 1, RETRY_DELAYS_MS.length - 1)];
          await sleep(delay);
        }
      }
    }

    if (this.page) {
      try {
        const evidence = await this.screenshot(`retry-failure-${Date.now()}`);
        logger.error(
          `${operation} failed after ${attempts} attempts. Screenshot: ${evidence.path}`,
        );
      } catch {
        logger.error(`${operation} failed after ${attempts} attempts (screenshot capture failed)`);
      }
    }

    throw lastError instanceof Error
      ? lastError
      : new Error(`${operation} failed after ${attempts} attempts`);
  }

  /**
   * Launch the configured browser engine and open a new page.
   *
   * @param headless - Override config headless flag; defaults to config value.
   */
  async launch(headless?: boolean): Promise<OpenBrowserResult> {
    if (this.page) {
      logger.warn("Browser already open — reusing existing session");
      return this.openBrowserResult(headless ?? this.config.headless);
    }

    const useHeadless = headless ?? this.config.headless;
    const browserType = this.config.browser;

    try {
      const launcher =
        browserType === "firefox"
          ? firefox
          : browserType === "webkit"
            ? webkit
            : chromium;

      this.browser = await launcher.launch({ headless: useHeadless });
      this.context = await this.browser.newContext({
        viewport: this.config.viewport,
      });
      this.page = await this.context.newPage();
      this.page.setDefaultTimeout(this.config.timeout);

      logger.info(
        `Browser launched (${browserType}, headless=${useHeadless}, viewport=${this.config.viewport.width}x${this.config.viewport.height})`,
      );

      return this.openBrowserResult(useHeadless);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      logger.error(
        `Failed to launch browser: ${message}. Try running: npx playwright install ${browserType}`,
      );
      throw error;
    }
  }

  /**
   * Navigate the active page to a URL and return the resolved location and title.
   *
   * @param url - Destination URL.
   */
  async navigate(url: string): Promise<NavigateResult> {
    const page = this.requirePage();
    return this.withRetry(`navigate to ${url}`, async () => {
      await page.goto(url, { waitUntil: "domcontentloaded" });
      const title = await page.title();
      logger.info(`Navigated to ${url} (title: "${title}")`);
      return { url: page.url(), title };
    });
  }

  /**
   * Capture a PNG screenshot to disk and return its path plus base64 payload.
   *
   * @param name - Optional filename stem (sanitized); timestamp used when omitted.
   */
  async screenshot(name?: string): Promise<ScreenshotResult> {
    const page = this.requirePage();
    const screenshotsDir = path.resolve(this.config.screenshotsDir);
    await mkdir(screenshotsDir, { recursive: true });

    const filename = name
      ? `${sanitizeFilename(name)}.png`
      : `screenshot-${Date.now()}.png`;
    const filePath = path.join(screenshotsDir, filename);

    const buffer = await page.screenshot({ path: filePath, type: "png" });
    const base64 = buffer.toString("base64");

    logger.debug(`Screenshot saved to ${filePath}`);
    return { path: filePath, base64 };
  }

  /**
   * Click at viewport coordinates after showing a red highlight overlay.
   *
   * @param x - Horizontal pixel coordinate.
   * @param y - Vertical pixel coordinate.
   * @param width - Optional highlight box width.
   * @param height - Optional highlight box height.
   */
  async click(
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): Promise<ClickResult> {
    const page = this.requirePage();
    await this.showHighlight(page, x, y, width, height);
    try {
      await page.mouse.click(x, y);
      logger.debug(`Clicked at (${x}, ${y})`);
      return { x, y };
    } finally {
      await this.removeHighlight(page).catch(() => {
        logger.debug("Highlight removal skipped (page may have navigated)");
      });
    }
  }

  /**
   * Double-click at viewport coordinates after showing a red highlight overlay.
   *
   * @param x - Horizontal pixel coordinate.
   * @param y - Vertical pixel coordinate.
   * @param width - Optional highlight box width.
   * @param height - Optional highlight box height.
   */
  async doubleClick(
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): Promise<ClickResult> {
    const page = this.requirePage();
    await this.showHighlight(page, x, y, width, height);
    try {
      await page.mouse.dblclick(x, y);
      logger.debug(`Double-clicked at (${x}, ${y})`);
      return { x, y };
    } finally {
      await this.removeHighlight(page).catch(() => {
        logger.debug("Highlight removal skipped (page may have navigated)");
      });
    }
  }

  /**
   * Type text into the focused input/textarea or fall back to keyboard.type.
   *
   * @param text - Characters to enter.
   */
  async fill(text: string): Promise<FillResult> {
    const page = this.requirePage();
    const filledViaActiveElement = await page.evaluate((value) => {
      const el = document.activeElement;
      if (el instanceof HTMLInputElement || el instanceof HTMLTextAreaElement) {
        el.focus();
        el.value = value;
        el.dispatchEvent(new Event("input", { bubbles: true }));
        el.dispatchEvent(new Event("change", { bubbles: true }));
        return true;
      }
      return false;
    }, text);

    if (!filledViaActiveElement) {
      await page.keyboard.type(text);
    }

    logger.debug(`Typed ${text.length} character(s)`);
    return { text };
  }

  /**
   * Scroll the page vertically by a pixel amount.
   *
   * @param direction - `"up"` or `"down"`.
   * @param amount - Pixels to scroll; defaults to 500.
   */
  async scroll(
    direction: ScrollDirection,
    amount = 500,
  ): Promise<ScrollResult> {
    const page = this.requirePage();
    const delta = direction === "down" ? amount : -amount;
    await page.mouse.wheel(0, delta);
    logger.debug(`Scrolled ${direction} by ${amount}px`);
    return { direction, amount };
  }

  /**
   * Find an interactive element by accessible name, scrolling if needed.
   *
   * @param description - Label to match (exact or partial).
   * @returns Element metadata and center coordinates, or null if not found.
   */
  async findElement(description: string): Promise<FindElementResult | null> {
    const page = this.requirePage();
    let match = await this.matchElementInSnapshot(page, description);
    if (match) {
      match = await this.resolveElementMatch(page, description, match);
      if (match) {
        return this.toFindElementResult(description, match);
      }
      return null;
    }

    for (let scrollAttempt = 1; scrollAttempt <= 2; scrollAttempt++) {
      logger.debug(
        `Element "${description}" not found — scrolling down 500px (attempt ${scrollAttempt}/2)`,
      );
      await page.mouse.wheel(0, 500);
      await page.waitForTimeout(300);

      match = await this.matchElementInSnapshot(page, description);
      if (match) {
        match = await this.resolveElementMatch(page, description, match);
        if (match) {
          return this.toFindElementResult(description, match);
        }
        return null;
      }
    }

    logger.warn(`Element not found: "${description}"`);
    return null;
  }

  /** Return a filtered accessibility snapshot of interactive page elements. */
  async getPageState(): Promise<PageState> {
    const page = this.requirePage();
    const snapshot = await page.ariaSnapshot({ boxes: true });
    const parsed = parseAriaSnapshot(snapshot);
    const elements: PageStateElement[] = parsed
      .filter((el) => FILTERED_ROLES.has(el.role))
      .map((el) => ({
        role: el.role,
        name: el.name,
        ...(el.box ? { box: el.box } : {}),
      }));

    return {
      url: page.url(),
      title: await page.title(),
      elements,
    };
  }

  /** Close the browser context and release Playwright resources. */
  async close(): Promise<void> {
    if (this.context) {
      await this.context.close();
    } else if (this.browser) {
      await this.browser.close();
    }
    this.page = null;
    this.context = null;
    this.browser = null;
    logger.info("Browser closed");
  }

  private requirePage(): Page {
    if (!this.page) {
      throw new Error("Browser is not open. Call launch() first.");
    }
    return this.page;
  }

  private openBrowserResult(headless: boolean): OpenBrowserResult {
    return {
      browser: this.config.browser,
      headless,
      viewport: { ...this.config.viewport },
    };
  }

  /** Whether a bounding box extends outside the configured viewport. */
  private isBoxOffscreen(box: ElementCoords): boolean {
    const { height } = this.config.viewport;
    return box.y < 0 || box.y + box.height > height;
  }

  /**
   * Scroll the page so the element box is vertically centered in the viewport.
   *
   * @param page - Active Playwright page.
   * @param box - Element bounding box from an ARIA snapshot.
   */
  private async scrollBoxIntoView(
    page: Page,
    box: ElementCoords,
  ): Promise<void> {
    const { height } = this.config.viewport;
    const scrollDelta = Math.round(box.y - (height - box.height) / 2);
    if (scrollDelta !== 0) {
      await page.evaluate((delta) => window.scrollBy(0, delta), scrollDelta);
    }
    await page.waitForTimeout(300);
  }

  /**
   * Ensure a matched element is on-screen; scroll and re-snapshot when needed.
   *
   * @param page - Active Playwright page.
   * @param description - Label used to re-locate the element after scrolling.
   * @param match - Initial ARIA snapshot match.
   * @returns Updated match with viewport coordinates, or null if lost after scroll.
   */
  private async resolveElementMatch(
    page: Page,
    description: string,
    match: ParsedAriaElement,
  ): Promise<ParsedAriaElement | null> {
    if (!match.box || !this.isBoxOffscreen(match.box)) {
      return match;
    }

    logger.debug(
      `Element "${description}" is offscreen (box y=${match.box.y}) — scrolling into view`,
    );
    await this.scrollBoxIntoView(page, match.box);
    const refreshed = await this.matchElementInSnapshot(page, description);
    if (!refreshed) {
      logger.debug(
        `Element "${description}" not found after scroll into view`,
      );
      return null;
    }
    return refreshed;
  }

  private async matchElementInSnapshot(
    page: Page,
    description: string,
  ): Promise<ParsedAriaElement | null> {
    const snapshot = await page.ariaSnapshot({ boxes: true });
    const elements = parseAriaSnapshot(snapshot);
    const query = description.toLowerCase().trim();

    const exactMatch = elements.find(
      (el) => el.name.toLowerCase().trim() === query,
    );
    if (exactMatch) {
      return exactMatch;
    }

    const partialMatch = elements.find((el) =>
      el.name.toLowerCase().includes(query),
    );
    if (partialMatch) {
      return partialMatch;
    }

    if (query.includes("title")) {
      const titleMatch = elements.find(
        (el) =>
          el.role === "textbox" && el.name.toLowerCase().includes("title"),
      );
      if (titleMatch) {
        return titleMatch;
      }
    }

    if (query.includes("description")) {
      const descriptionMatch = elements.find(
        (el) =>
          (el.role === "textbox" || el.role === "textarea") &&
          el.name.toLowerCase().includes("description"),
      );
      if (descriptionMatch) {
        return descriptionMatch;
      }
    }

    return null;
  }

  private toFindElementResult(
    description: string,
    element: ParsedAriaElement,
  ): FindElementResult {
    const coords = element.box ?? { x: 0, y: 0, width: 0, height: 0 };
    const centerX = Math.round(coords.x + coords.width / 2);
    const centerY = Math.round(coords.y + coords.height / 2);

    return {
      description,
      role: element.role,
      name: element.name,
      coords: {
        x: centerX,
        y: centerY,
        width: coords.width,
        height: coords.height,
      },
    };
  }

  private async showHighlight(
    page: Page,
    x: number,
    y: number,
    width?: number,
    height?: number,
  ): Promise<void> {
    await page.evaluate(
      ({ px, py, w, h }) => {
        const existing = document.getElementById("__agent-highlight__");
        existing?.remove();

        const div = document.createElement("div");
        div.id = "__agent-highlight__";
        div.style.position = "fixed";
        div.style.border = "2px solid red";
        div.style.pointerEvents = "none";
        div.style.zIndex = "2147483647";
        div.style.boxSizing = "border-box";

        if (w && h && w > 0 && h > 0) {
          div.style.left = `${px - w / 2}px`;
          div.style.top = `${py - h / 2}px`;
          div.style.width = `${w}px`;
          div.style.height = `${h}px`;
          div.style.backgroundColor = "rgba(255, 0, 0, 0.1)";
        } else {
          div.style.left = `${px - 12}px`;
          div.style.top = `${py - 12}px`;
          div.style.width = "24px";
          div.style.height = "24px";
          div.style.borderRadius = "50%";
          div.style.backgroundColor = "rgba(255, 0, 0, 0.25)";
        }

        document.body.appendChild(div);
      },
      { px: x, py: y, w: width ?? 0, h: height ?? 0 },
    );
    await page.waitForTimeout(1000);
  }

  private async removeHighlight(page: Page): Promise<void> {
    await page.evaluate(() => {
      document.getElementById("__agent-highlight__")?.remove();
    });
  }
}

/**
 * Parse Playwright ARIA snapshot lines into structured elements with optional bounding boxes.
 *
 * @param snapshot - Raw multiline string from `page.ariaSnapshot()`.
 */
export function parseAriaSnapshot(snapshot: string): ParsedAriaElement[] {
  const elements: ParsedAriaElement[] = [];
  const lines = snapshot.split("\n");

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed.startsWith("-")) continue;

    const roleMatch = trimmed.match(/^-\s+(\w+)/);
    if (!roleMatch) continue;

    const role = roleMatch[1].toLowerCase();
    const nameMatch = trimmed.match(/"([^"]*)"/);
    const name = nameMatch?.[1] ?? "";

    const boxMatch = trimmed.match(/\[box=([-\d.]+),([-\d.]+),([-\d.]+),([-\d.]+)\]/);
    const box: ElementCoords | undefined = boxMatch
      ? {
          x: Number(boxMatch[1]),
          y: Number(boxMatch[2]),
          width: Number(boxMatch[3]),
          height: Number(boxMatch[4]),
        }
      : undefined;

    elements.push({ role, name, box, raw: trimmed });
  }

  return elements;
}

function sanitizeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]+/g, "-").replace(/^-+|-+$/g, "");
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
