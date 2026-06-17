import { config as loadDotenv } from "dotenv";
import { z } from "zod";
import type { BrowserType, LogLevel } from "./types.js";

loadDotenv();

const DEFAULT_OPENAI_BASE_URL = "https://openrouter.ai/api/v1";
const DEFAULT_AGENT_MODEL = "openai/gpt-4o-mini:exacto";

const ConfigSchema = z.object({
  openaiApiKey: z.string().min(1),
  openaiBaseUrl: z.string().url().default(DEFAULT_OPENAI_BASE_URL),
  agentModel: z.string().min(1).default(DEFAULT_AGENT_MODEL),
  browser: z.enum(["chromium", "firefox", "webkit"]).default("chromium"),
  headless: z.boolean().default(false),
  viewport: z
    .object({
      width: z.number().int().positive().default(1280),
      height: z.number().int().positive().default(720),
    })
    .default({ width: 1280, height: 720 }),
  timeout: z.number().int().positive().default(30000),
  logLevel: z.enum(["debug", "info", "warn", "error"]).default("info"),
  maxRetries: z.number().int().min(0).default(3),
  maxAgentIterations: z.number().int().positive().default(15),
  screenshotsDir: z.string().default("./screenshots"),
});

export type Config = z.infer<typeof ConfigSchema>;

function parseBoolean(value: string | undefined, fallback: boolean): boolean {
  if (value === undefined || value === "") return fallback;
  const normalized = value.toLowerCase();
  if (["1", "true", "yes", "on"].includes(normalized)) return true;
  if (["0", "false", "no", "off"].includes(normalized)) return false;
  return fallback;
}

function parseBrowser(value: string | undefined): BrowserType {
  if (value === "firefox" || value === "webkit" || value === "chromium") {
    return value;
  }
  return "chromium";
}

function parseLogLevel(value: string | undefined): LogLevel {
  if (
    value === "debug" ||
    value === "info" ||
    value === "warn" ||
    value === "error"
  ) {
    return value;
  }
  return "info";
}

export function loadConfig(overrides?: Partial<Config>): Config {
  const raw = {
    openaiApiKey:
      process.env.OPENROUTER_API_KEY ?? process.env.OPENAI_API_KEY ?? "",
    openaiBaseUrl: process.env.OPENAI_BASE_URL ?? DEFAULT_OPENAI_BASE_URL,
    agentModel: process.env.OPENROUTER_MODEL ?? DEFAULT_AGENT_MODEL,
    browser: parseBrowser(process.env.BROWSER),
    headless: parseBoolean(process.env.BROWSER_HEADLESS, false),
    viewport: {
      width: Number(process.env.BROWSER_VIEWPORT_WIDTH ?? 1280),
      height: Number(process.env.BROWSER_VIEWPORT_HEIGHT ?? 720),
    },
    timeout: Number(process.env.BROWSER_TIMEOUT ?? 30000),
    logLevel: parseLogLevel(process.env.LOG_LEVEL),
    maxRetries: Number(process.env.MAX_RETRIES ?? 3),
    maxAgentIterations: Number(process.env.MAX_AGENT_ITERATIONS ?? 15),
    screenshotsDir: process.env.SCREENSHOTS_DIR ?? "./screenshots",
    ...overrides,
  };

  return ConfigSchema.parse(raw);
}
