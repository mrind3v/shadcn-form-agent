import pc from "picocolors";
import type { LogLevel } from "./types.js";

const LOG_LEVELS: Record<LogLevel, number> = {
  debug: 0,
  info: 1,
  warn: 2,
  error: 3,
};

let currentLevel: LogLevel = "info";

/** Set the minimum log level emitted to the console. */
export function setLogLevel(level: LogLevel): void {
  currentLevel = level;
}

function shouldLog(level: LogLevel): boolean {
  return LOG_LEVELS[level] >= LOG_LEVELS[currentLevel];
}

function formatMessage(level: string, message: string): string {
  const timestamp = new Date().toISOString();
  return `[${timestamp}] ${level} ${message}`;
}

function truncateBase64InString(text: string): string {
  const base64Pattern = /([A-Za-z0-9+/]{50,}={0,2})/g;
  return text.replace(base64Pattern, (match) => {
    if (match.length <= 50) return match;
    return `${match.slice(0, 50)}...`;
  });
}

function log(level: LogLevel, colorFn: (s: string) => string, label: string, message: string): void {
  if (!shouldLog(level)) return;
  const formatted = truncateBase64InString(formatMessage(colorFn(label), message));
  console.log(formatted);
}

/** Picocolors-backed console logger with level filtering and base64 truncation. */
export const logger = {
  /** Log a debug message (gray). */
  debug(message: string): void {
    log("debug", pc.gray, "DEBUG", message);
  },
  /** Log an info message (blue). */
  info(message: string): void {
    log("info", pc.blue, "INFO", message);
  },
  /** Log a warning message (yellow). */
  warn(message: string): void {
    log("warn", pc.yellow, "WARN", message);
  },
  /** Log an error message (red). */
  error(message: string): void {
    log("error", pc.red, "ERROR", message);
  },
  /** Log a success message (green, info level). */
  success(message: string): void {
    log("info", pc.green, "SUCCESS", message);
  },
};
