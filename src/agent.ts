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
If elements are not visible, scroll down to find them.`;

export type RunResult = {
  finalOutput: string;
  success: boolean;
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
        logger.debug(`Tool call: ${name}${args ? ` (${args})` : ""}`);
        break;
      }
      case "tool_call_output_item": {
        const output =
          item.rawItem && typeof item.rawItem === "object" && "output" in item.rawItem
            ? String(item.rawItem.output ?? "")
            : JSON.stringify(item.rawItem);
        logger.debug(`Tool result: ${output.slice(0, 500)}`);
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

  try {
    const result = await run(agent, goal, { maxTurns: cfg.maxAgentIterations });

    logRunItems(result.newItems);

    const finalOutput = formatFinalOutput(result.finalOutput);
    const elapsedMs = Date.now() - start;
    const iterations = extractIterations(result);

    logger.info(
      `Agent finished in ${elapsedMs}ms${iterations !== undefined ? ` (${iterations} turn(s))` : ""}`,
    );
    logger.info(`Final output: ${finalOutput}`);

    return {
      finalOutput,
      success: true,
      iterations,
    };
  } catch (error) {
    if (error instanceof MaxTurnsExceededError) {
      logMaxTurnsPartialProgress(error, cfg.maxAgentIterations);
      return {
        finalOutput: error.message,
        success: false,
        iterations: error.state?.toJSON().currentTurn,
      };
    }

    const message = error instanceof Error ? error.message : String(error);
    logger.error(`Agent run failed: ${message}`);
    return {
      finalOutput: message,
      success: false,
    };
  } finally {
    await controller.close();
  }
}
