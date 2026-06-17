import {
  Agent,
  MaxTurnsExceededError,
  run,
  setDefaultOpenAIClient,
  setOpenAIAPI,
  setTracingDisabled,
  type RunItem,
} from "@openai/agents";
import OpenAI from "openai";
import { BrowserController } from "./browser.js";
import { loadConfig, type Config } from "./config.js";
import { logger } from "./logger.js";
import { createBrowserTools } from "./tools.js";

type AgentsOpenAIClient = Parameters<typeof setDefaultOpenAIClient>[0];

const SYSTEM_PROMPT = `You are a browser automation agent.
You control a VISIBLE browser window.
Workflow: (1) get_page_state to understand the page, (2) find_element to locate fields, (3) click_on_screen to focus, (4) send_keys to type.
ALWAYS take a screenshot before and after important actions.
If an element is not found, scroll down and retry.
CRITICAL: Do NOT submit forms. Only fill fields.
Use the accessibility tree (get_page_state) to identify elements by their labels.

Navigate to shadcn react-hook-form docs.
The form is a 'Bug Report' demo — look for 'Bug Title' and 'Description' fields.
Use get_page_state first to see the page structure.
Use find_element to locate each field by its accessible name.
Use click_on_screen to focus, then send_keys to type.
Take screenshots after each fill action.
CRITICAL: Do NOT click the Submit button.
If elements are not visible, scroll down to find them.

You MUST use tools for every action — never stop with text-only responses until the task is fully complete.
After filling both Bug Title and Description, take a final screenshot and confirm in your last message that both fields are filled and the form was NOT submitted.
Do not end your run with phrases like "let me", "I will", or "next I will" — only end after the work is done.`;

const MAX_CONTINUATION_ATTEMPTS = 2;
const CONTINUATION_PROMPT =
  "Continue the task from where you left off. Use tools now to click and type into Bug Title and Description. Do not respond with text only.";

function isIncompleteFinalOutput(output: string, goal: string): boolean {
  const lower = output.toLowerCase();
  const intentPatterns = [
    /\blet me\b/,
    /\bi will\b/,
    /\bi'll\b/,
    /\bnext i\b/,
    /\bi need to\b/,
    /\bnow i\b/,
    /\bgoing to\b/,
    /\babout to\b/,
  ];
  if (intentPatterns.some((p) => p.test(lower))) return true;
  if (/fill/i.test(goal)) {
    const hasCompletion = /\b(filled|completed|done|finished)\b/.test(lower);
    const mentionsBothFields =
      lower.includes("title") && lower.includes("description");
    if (!hasCompletion && !mentionsBothFields) return true;
  }
  return false;
}

/** Outcome of a single agent run, including final text and turn count when available. */
export type RunResult = {
  /** Agent's final message or serialized output. */
  finalOutput: string;
  /** Whether the run completed without hitting max turns or fatal errors. */
  success: boolean;
  /** Number of agent turns taken, when reported by the SDK. */
  iterations?: number;
};

function formatFinalOutput(output: unknown): string {
  if (output === undefined || output === null) {
    return "";
  }
  if (typeof output === "string") {
    return output;
  }
  return JSON.stringify(output);
}

function extractIterations(result: {
  rawResponses: unknown[];
  state?: { toJSON(): { currentTurn?: number } };
}): number | undefined {
  if (result.rawResponses.length > 0) {
    return result.rawResponses.length;
  }
  const turn = result.state?.toJSON().currentTurn;
  return turn !== undefined && turn > 0 ? turn : undefined;
}

function logRunItems(items: RunItem[]): void {
  for (const item of items) {
    switch (item.type) {
      case "tool_call_item": {
        const raw = item.rawItem;
        const name =
          raw && typeof raw === "object" && "name" in raw
            ? String(raw.name)
            : "unknown";
        const args =
          raw && typeof raw === "object" && "arguments" in raw
            ? String(raw.arguments ?? "")
            : "";
        logger.info(`Tool call: ${name}${args ? ` (${args})` : ""}`);
        break;
      }
      case "tool_call_output_item": {
        const output =
          item.rawItem && typeof item.rawItem === "object" && "output" in item.rawItem
            ? String(item.rawItem.output ?? "")
            : JSON.stringify(item.rawItem);
        logger.info(`Tool result: ${output.slice(0, 500)}`);
        break;
      }
      case "message_output_item":
        logger.debug(`Agent message: ${item.content}`);
        break;
      case "reasoning_item":
        logger.debug("Agent reasoning step recorded");
        break;
      default:
        logger.debug(`Run item: ${item.type}`);
    }
  }
}

function logMaxTurnsPartialProgress(
  error: MaxTurnsExceededError,
  maxTurns: number,
): void {
  logger.warn(`Max turns (${maxTurns}) exceeded: ${error.message}`);
  if (!error.state) {
    return;
  }

  const serialized = error.state.toJSON();
  logger.warn(
    `Partial progress: turn ${serialized.currentTurn}, agent "${serialized.currentAgent.name}"`,
  );

  const historyLength = Array.isArray(serialized.generatedItems)
    ? serialized.generatedItems.length
    : 0;
  if (historyLength > 0) {
    logger.warn(`Generated ${historyLength} item(s) before stopping`);
  }
}

function configureOpenAIClient(cfg: Config): void {
  setOpenAIAPI("chat_completions");
  setTracingDisabled(true);

  setDefaultOpenAIClient(
    new OpenAI({
      apiKey: cfg.openaiApiKey,
      baseURL: cfg.openaiBaseUrl,
      defaultHeaders: {
        "HTTP-Referer":
          process.env.OPENROUTER_SITE_URL ?? "http://localhost",
        "X-OpenRouter-Title":
          process.env.OPENROUTER_SITE_TITLE ?? "shadcn-form-agent",
      },
    }) as unknown as AgentsOpenAIClient,
  );
}

/**
 * Run the browser automation agent against a natural-language goal.
 * Launches Playwright, wires OpenAI/OpenRouter, and closes the browser when done.
 *
 * @param goal - Task description passed to the agent (e.g. form-filling instructions).
 * @param config - Optional config; defaults to {@link loadConfig} when omitted.
 * @returns Run result with final output, success flag, and optional iteration count.
 */
export async function runAgent(goal: string, config?: Config): Promise<RunResult> {
  const cfg = config ?? loadConfig();
  configureOpenAIClient(cfg);
  logger.info(`Agent goal: ${goal}`);

  const controller = new BrowserController(cfg);
  const tools = createBrowserTools(controller);
  const agent = new Agent({
    name: "BrowserAutomationAgent",
    instructions: SYSTEM_PROMPT,
    model: cfg.agentModel,
    tools,
  });

  const start = Date.now();
  let finalOutput = "";
  let totalIterations = 0;
  let input = goal;
  let continuationAttempts = 0;

  try {
    while (true) {
      const turnsRemaining = cfg.maxAgentIterations - totalIterations;
      if (turnsRemaining <= 0) {
        break;
      }

      let result;
      try {
        result = await run(agent, input, { maxTurns: turnsRemaining });
      } catch (error) {
        if (error instanceof MaxTurnsExceededError) {
          logMaxTurnsPartialProgress(error, cfg.maxAgentIterations);
          const segmentTurns = error.state?.toJSON().currentTurn;
          if (segmentTurns !== undefined) {
            totalIterations += segmentTurns;
          }
          return {
            finalOutput: error.message,
            success: false,
            iterations: totalIterations || segmentTurns,
          };
        }
        throw error;
      }

      logRunItems(result.newItems);

      finalOutput = formatFinalOutput(result.finalOutput);
      totalIterations += extractIterations(result) ?? 0;

      if (!isIncompleteFinalOutput(finalOutput, goal)) {
        break;
      }
      if (continuationAttempts >= MAX_CONTINUATION_ATTEMPTS) {
        break;
      }
      if (totalIterations >= cfg.maxAgentIterations) {
        break;
      }

      continuationAttempts += 1;
      logger.info(
        `Agent output incomplete; continuing (attempt ${continuationAttempts}/${MAX_CONTINUATION_ATTEMPTS})`,
      );
      input = CONTINUATION_PROMPT;
    }

    const elapsedMs = Date.now() - start;
    const success = !isIncompleteFinalOutput(finalOutput, goal);

    logger.info(
      `Agent finished in ${elapsedMs}ms (${totalIterations} turn(s))${success ? "" : " — incomplete"}`,
    );
    logger.info(`Final output: ${finalOutput}`);

    return {
      finalOutput,
      success,
      iterations: totalIterations || undefined,
    };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Agent run failed: ${message}`);
    return {
      finalOutput: message,
      success: false,
      iterations: totalIterations || undefined,
    };
  } finally {
    await controller.close();
  }
}
