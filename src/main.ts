import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { runAgent } from "./agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  logger.info("Starting browser automation agent...");

  const goal =
    process.argv.slice(2).join(" ") ||
    "Navigate to https://ui.shadcn.com/docs/forms/react-hook-form and fill in the Bug Title and Description fields. Do NOT submit the form.";

  const result = await runAgent(goal, config);
  if (result.success) {
    logger.success(`Agent completed: ${result.finalOutput}`);
  } else {
    logger.error(`Agent failed: ${result.finalOutput}`);
  }
  process.exit(result.success ? 0 : 1);
}

main().catch((error) => {
  logger.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
