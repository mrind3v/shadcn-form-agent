# shadcn-form-agent

An AI browser agent that fills the shadcn/ui React Hook Form demo using **coordinate-driven** Playwright automation. The agent navigates by screen coordinates and accessibility labels—not CSS selectors—and **never submits** the form.

See [ARCHITECTURE.md](./ARCHITECTURE.md) for system design, data flow, and design decisions.

## Prerequisites

- **Node.js 20+**
- **OpenRouter or OpenAI API key** — OpenRouter is the default provider (`https://openrouter.ai/api/v1`)
- **Playwright browsers** — install after `npm install`:

```bash
npx playwright install
```

## Installation

```bash
git clone <repo-url>
cd shadcn-form-agent
npm install
npx playwright install
```

## Configuration

Copy the example environment file and set your API key:

```bash
cp .env.example .env
```

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `OPENROUTER_API_KEY` | Yes* | — | Primary API key for OpenRouter |
| `OPENAI_API_KEY` | Yes* | — | Fallback if `OPENROUTER_API_KEY` is unset |
| `OPENROUTER_MODEL` | No | `openai/gpt-4o-mini:exacto` | Model ID sent to the provider |
| `OPENAI_BASE_URL` | No | `https://openrouter.ai/api/v1` | OpenAI-compatible API base URL |
| `OPENROUTER_SITE_URL` | No | `http://localhost` | OpenRouter HTTP-Referer header |
| `OPENROUTER_SITE_TITLE` | No | `shadcn-form-agent` | OpenRouter X-Title header |
| `LOG_LEVEL` | No | `info` | `debug`, `info`, `warn`, or `error` |
| `BROWSER` | No | `chromium` | `chromium`, `firefox`, or `webkit` |
| `BROWSER_HEADLESS` | No | `false` | `true`/`false` — headed mode is the default |
| `BROWSER_VIEWPORT_WIDTH` | No | `1280` | Browser viewport width in pixels |
| `BROWSER_VIEWPORT_HEIGHT` | No | `720` | Browser viewport height in pixels |
| `BROWSER_TIMEOUT` | No | `30000` | Playwright default timeout (ms) |
| `MAX_RETRIES` | No | `3` | Retries per browser operation |
| `MAX_AGENT_ITERATIONS` | No | `15` | Max agent turns per run |
| `SCREENSHOTS_DIR` | No | `./screenshots` | Directory for saved PNG screenshots |

\*At least one of `OPENROUTER_API_KEY` or `OPENAI_API_KEY` must be set.

## Run

**Default shadcn form task** (headed browser):

```bash
npm run dev
```

This opens a visible browser, navigates to the shadcn React Hook Form docs, and fills the Bug Title and Description fields without submitting.

**Custom goal via CLI:**

```bash
npm run dev -- Navigate to https://example.com and take a screenshot
```

**Browser smoke test** (exercises all tools without the LLM):

```bash
npm run test:browser
```

## Expected output

- **Colored terminal logs** via [picocolors](https://github.com/alexeyraspopov/picocolors) — blue INFO, yellow WARN, red ERROR, green SUCCESS
- **Screenshots** saved under `./screenshots/` (gitignored)
- **Base64 image data** returned from `take_screenshot` tool calls (`base64Length` in tool output; full base64 truncated in logs)

On success you will see a green `SUCCESS` line with the agent's final output. On failure the process exits with code `1`.

## Project structure

```
shadcn-form-agent/
├── src/
│   ├── main.ts          # CLI entry — loads config, runs agent with goal from argv
│   ├── agent.ts         # OpenAI Agents SDK orchestration and system prompt
│   ├── browser.ts       # Playwright controller — clicks, scroll, a11y snapshot
│   ├── tools.ts         # Agent tool definitions (open_browser, find_element, …)
│   ├── config.ts        # Zod-validated env config
│   ├── logger.ts        # picocolors terminal logger
│   ├── types.ts         # Shared TypeScript interfaces
│   └── test-browser.ts  # Smoke test for browser tools (no LLM)
├── screenshots/         # Runtime screenshots (gitignored)
├── .env.example         # Environment template
├── ARCHITECTURE.md      # System design and data flow
├── package.json
└── tsconfig.json
```

## Tech stack

| Technology | Role | Why |
|------------|------|-----|
| **TypeScript** | Language | Type safety across agent, browser, and config layers |
| **@openai/agents** (0.0.x) | Agent runtime | Tool-calling loop with structured parameters (pinned to 0.0.x) |
| **OpenAI SDK** | HTTP client | OpenRouter-compatible chat completions API |
| **Playwright** | Browser automation | Direct Node.js control, aria snapshots, coordinate clicks |
| **Zod** | Config validation | Fail fast on invalid env values at startup |
| **picocolors** | Logging | Lightweight colored terminal output without winston |
| **tsx** | Dev runner | Run TypeScript without a separate build step |

## Troubleshooting

| Symptom | Fix |
|---------|-----|
| `Executable doesn't exist` / browser won't launch | Run `npx playwright install` (or `npx playwright install chromium`) |
| `openaiApiKey` validation error / 401 from API | Set `OPENROUTER_API_KEY` or `OPENAI_API_KEY` in `.env` |
| Navigation or action timeouts | Increase `BROWSER_TIMEOUT` (default 30000 ms) |
| `Element not found` in logs | The page may need scrolling — the agent retries with scroll; run headed to watch behavior |
| Browser window not visible | Set `BROWSER_HEADLESS=false` (this is already the default) |
| Agent stops early with max turns | Increase `MAX_AGENT_ITERATIONS` (default 15) |

## License

Private project — see repository for license details.
