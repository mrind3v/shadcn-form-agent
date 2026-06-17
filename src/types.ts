export type ScrollDirection = "up" | "down";

export interface ElementCoords {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface ScreenshotResult {
  path: string;
  base64: string;
}

export interface NavigateResult {
  url: string;
  title: string;
}

export interface ClickResult {
  x: number;
  y: number;
}

export interface FillResult {
  text: string;
}

export interface ScrollResult {
  direction: ScrollDirection;
  amount: number;
}

export interface FindElementResult {
  description: string;
  role: string;
  name: string;
  coords: ElementCoords;
}

export interface PageStateElement {
  role: string;
  name: string;
  box?: ElementCoords;
}

export interface PageState {
  url: string;
  title: string;
  elements: PageStateElement[];
}

export interface OpenBrowserResult {
  browser: string;
  headless: boolean;
  viewport: { width: number; height: number };
}

export type LogLevel = "debug" | "info" | "warn" | "error";

export type BrowserType = "chromium" | "firefox" | "webkit";

export interface ParsedAriaElement {
  role: string;
  name: string;
  box?: ElementCoords;
  raw: string;
}
