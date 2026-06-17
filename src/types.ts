/** Vertical scroll direction for page scrolling. */
export type ScrollDirection = "up" | "down";

/** Bounding box or click target in viewport pixels. */
export interface ElementCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

/** Screenshot file path and base64-encoded PNG data. */
export interface ScreenshotResult {
  path: string;
  base64: string;
}

/** Result of navigating to a URL. */
export interface NavigateResult {
  url: string;
  title: string;
}

/** Result of a single click at coordinates. */
export interface ClickResult {
  x: number;
  y: number;
}

/** Result of typing text into the focused field. */
export interface FillResult {
  text: string;
}

/** Result of a scroll action. */
export interface ScrollResult {
  direction: ScrollDirection;
  amount: number;
}

/** Element located by accessible name with center coordinates for clicking. */
export interface FindElementResult {
  description: string;
  role: string;
  name: string;
  coords: ElementCoords;
}

/** One interactive element in a filtered page state snapshot. */
export interface PageStateElement {
  role: string;
  name: string;
  box?: ElementCoords;
}

/** Filtered accessibility overview of the current page. */
export interface PageState {
  url: string;
  title: string;
  elements: PageStateElement[];
}

/** Metadata returned when the browser is launched. */
export interface OpenBrowserResult {
  browser: string;
  headless: boolean;
  viewport: { width: number; height: number };
}

/** Minimum severity level emitted by the logger. */
export type LogLevel = "debug" | "info" | "warn" | "error";

/** Playwright browser engine identifier. */
export type BrowserType = "chromium" | "firefox" | "webkit";

/** Parsed line from an ARIA accessibility snapshot. */
export interface ParsedAriaElement {
  role: string;
  name: string;
  box?: ElementCoords;
  raw: string;
}
