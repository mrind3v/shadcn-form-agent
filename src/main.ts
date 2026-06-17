import { loadConfig } from "./config.js";
import { logger, setLogLevel } from "./logger.js";
import { runAgent } from "./agent.js";

async function main(): Promise<void> {
  const config = loadConfig();
  setLogLevel(config.logLevel);
  logger.info("Starting browser automation agent...");

  // Phase 2 verification goal — NOT shadcn yet (Phase 3)
  const goal =
    process.argv.slice(2).join(" ") ||
    "Navigate to example.com and take a screenshot";

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
