# Architecture

How **shadcn-form-agent** wires a CLI, an LLM agent, Playwright, and the shadcn form demo into a coordinate-driven automation flow.

## Overview

```
┌─────────────┐     ┌──────────────────┐     ┌─────────────────────┐     ┌────────────────────┐
│  CLI        │     │  Agent           │     │  BrowserController  │     │  shadcn docs page  │
│  main.ts    │────▶│  agent.ts        │────▶│  browser.ts         │────▶│  (Bug Report form) │
│  argv goal  │     │  @openai/agents  │     │  Playwright         │     │                    │
└─────────────┘     └────────┬─────────┘     └──────────┬──────────┘     └────────────────────┘
                             │                            │
                             │  tools.ts                  │  aria snapshot
                             │  (9 coordinate tools)      │  mouse / keyboard
                             ▼                            ▼
                      ┌──────────────┐            ┌──────────────┐
                      │  OpenRouter  │            │ screenshots/ │
                      │  (LLM API)   │            │ + base64     │
                      └──────────────┘            └──────────────┘
```

The CLI passes a natural-language **goal** to the agent. The agent calls browser **tools** that operate on x/y coordinates and filtered accessibility trees. The browser drives a real page; screenshots provide visual evidence for the agent and on disk.

## Components

### `src/main.ts`

CLI entry point. Loads config, sets log level, reads an optional goal from `process.argv`, and defaults to the shadcn Bug Report form task. Exits `0` on success, `1` on failure.

### `src/agent.ts`

Orchestrates the OpenAI Agents SDK:

- Configures the OpenAI client for OpenRouter (`chat_completions`, tracing disabled)
- Builds a `BrowserAutomationAgent` with the system prompt and nine browser tools
- Runs `run(agent, goal, { maxTurns })` and logs tool calls at debug level
- Handles `MaxTurnsExceededError` with partial-progress warnings
- Always closes the browser in `finally`

### `src/browser.ts`

`BrowserController` wraps Playwright:

- **Launch** — chromium/firefox/webkit, viewport, headless flag, default timeout
- **Navigate** — `goto` with retry wrapper
- **Screenshot** — PNG to `screenshotsDir` plus base64 buffer
- **Click / double-click** — mouse at coordinates with red highlight overlay
- **Fill** — types into focused input/textarea or falls back to `keyboard.type`
- **Scroll** — mouse wheel up/down
- **findElement** — parses aria snapshot, matches by label, scrolls up to 2× if missing
- **getPageState** — filtered aria tree (interactive roles only)
- **withRetry** — exponential backoff on transient failures

Also exports `parseAriaSnapshot` for testing aria line parsing.

### `src/tools.ts`

Defines nine agent tools via `@openai/agents` `tool()`:

| Tool | Purpose |
|------|---------|
| `open_browser` | Launch headed/headless browser |
| `navigate_to_url` | Go to URL |
| `take_screenshot` | Capture PNG; returns path + base64 metadata |
| `click_on_screen` | Click at (x, y) with highlight |
| `double_click` | Double-click at (x, y) |
| `send_keys` | Type into focused element |
| `scroll` | Wheel scroll up/down |
| `find_element` | Locate by accessible name → center coordinates |
| `get_page_state` | Filtered a11y snapshot |

### `src/config.ts`

Loads `.env` via dotenv, maps environment variables to a Zod schema, and exports `loadConfig()`. Supports runtime overrides for tests.

### `src/logger.ts`

picocolors-based logger with levels (`debug`–`error`), ISO timestamps, and automatic base64 truncation in log lines.

### `src/types.ts`

Shared interfaces: coordinates, screenshot/navigate/click results, page state, log level, browser type.

### `src/test-browser.ts`

Smoke test that invokes every tool directly (no LLM). Uses a dummy API key if none is set. Verifies `withRetry` recovery.

## Data flow

1. **Startup** — `loadConfig()` reads env → `main.ts` sets log level and goal string.
2. **Agent init** — `configureOpenAIClient()` points the Agents SDK at OpenRouter; `BrowserController` is constructed but not yet launched.
3. **Agent loop** — LLM receives goal + system prompt → emits tool calls → `tools.ts` delegates to `BrowserController`.
4. **Page understanding** — `get_page_state` returns `{ url, title, elements[] }` from a filtered aria snapshot.
5. **Element location** — `find_element` parses the full aria snapshot, matches exact/partial names (with heuristics for "title" and "description"), returns center `(x, y)` and box dimensions.
6. **Interaction** — `click_on_screen` shows a red highlight, clicks, removes highlight; `send_keys` fills the focused field.
7. **Evidence** — `take_screenshot` writes PNG + returns base64 length to the agent.
8. **Shutdown** — `controller.close()` runs whether the agent succeeds or fails.

## Design decisions

### 1. Playwright direct API, not MCP browser tools

Playwright runs in-process via the Node.js API. This keeps latency low, avoids MCP transport overhead, and matches the project's coordinate-driven workflow (`.cursorrules`). The agent never uses DOM selectors—only coordinates from aria boxes.

### 2. OpenAI Agents SDK (0.0.x)

The `@openai/agents` package provides a structured tool-calling loop with Zod-validated parameters. Pinned to 0.0.x per project policy. Chat completions mode is used for OpenRouter compatibility.

### 3. picocolors for logging

Terminal output uses picocolors instead of winston or other logging frameworks—minimal dependency, colored levels, and base64 truncation for readable logs.

### 4. Coordinate-based tools

Tools expose `click_on_screen(x, y)` and `find_element(description)` rather than CSS/XPath selectors. The LLM reasons over accessibility names and pixel centers, which generalizes across pages without brittle selectors.

### 5. Hybrid screenshots

Every screenshot is **dual-output**: saved to `./screenshots/` on disk for human inspection, and encoded as base64 in the controller (exposed to the agent via `base64Length` / preview in tool responses). Logs truncate long base64 strings.

### 6. Filtered accessibility tree

`get_page_state` filters the aria snapshot to interactive roles only: `textbox`, `button`, `link`, `combobox`, `checkbox`. This reduces token noise while preserving enough structure to locate form fields by label.

## Retry strategy

Browser operations wrapped in `withRetry` use delays of **1s → 2s → 4s** between attempts (`RETRY_DELAYS_MS = [1000, 2000, 4000]`). Default `maxRetries` is 3 (4 total attempts). On final failure, a diagnostic screenshot is captured when possible.

`find_element` has a separate scroll retry: up to 2 scroll-down attempts (500px each, 300ms pause) before returning `null`.

## Visual feedback

Before each click or double-click, `showHighlight` injects a fixed-position red overlay (`#__agent-highlight__`):

- **With element box** — red border rectangle with light red fill, sized to the element
- **Point click** — 24px red circle at the coordinate

The highlight stays visible for **1 second**, then is removed after the click completes.

## Request lifecycle: shadcn form fill

Typical sequence for the default goal (Bug Report demo on shadcn docs):

```
1. open_browser          → headed Chromium at 1280×720
2. navigate_to_url       → https://ui.shadcn.com/docs/forms/react-hook-form
3. get_page_state        → list textboxes/buttons (may need scroll)
4. take_screenshot       → baseline page capture
5. find_element          → "Bug Title" → (x, y) center
6. click_on_screen       → focus title field (red highlight)
7. send_keys             → type title text
8. take_screenshot       → verify title filled
9. find_element          → "Description" → (x, y)
10. click_on_screen      → focus description
11. send_keys            → type description
12. take_screenshot      → verify both fields
13. (agent completes)    → does NOT click Submit
```

If elements are below the fold, the agent or `find_element` scrolls down and retries. The system prompt explicitly forbids form submission.

## Error handling

| Error source | Behavior | User-visible signal |
|--------------|----------|---------------------|
| Missing/invalid API key | Zod parse fails at `loadConfig()` | Process crash with validation message |
| Browser launch failure | Logged with `npx playwright install` hint | ERROR log, thrown to caller |
| Navigation timeout | `withRetry` × 4 with 1s/2s/4s delays | WARN per attempt, ERROR + screenshot on exhaustion |
| Element not found | `find_element` returns `null` after scroll retries | WARN log; agent decides next action |
| Tool execution error | Propagates to agent loop | DEBUG tool result or ERROR from agent |
| Max agent turns | `MaxTurnsExceededError` caught | WARN with partial turn count; exit code 1 |
| Unhandled exception | `main.ts` catch block | ERROR log; exit code 1 |
| Browser close | Always in `finally` | INFO "Browser closed" |

## Related docs

- [README.md](./README.md) — installation, configuration, and troubleshooting
