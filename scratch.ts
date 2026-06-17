import { BrowserController } from "./src/browser.js";
import { loadConfig } from "./src/config.js";

async function run() {
  const cfg = loadConfig();
  const bc = new BrowserController(cfg);
  await bc.launch(true);
  await bc.navigate("https://ui.shadcn.com/docs/forms/react-hook-form");
  
  await new Promise(r => setTimeout(r, 2000));
  
  const state = await bc.getPageState();
  console.log("----- PAGE STATE (INITIAL) -----");
  const bugTitleInitial = state.elements.find(el => el.name === "Bug Title");
  console.log("Bug Title Initial:", JSON.stringify(bugTitleInitial));
  
  await bc.scroll("down", 200);
  await new Promise(r => setTimeout(r, 1000));
  
  const stateAfterScroll = await bc.getPageState();
  console.log("----- PAGE STATE (AFTER SCROLL) -----");
  const bugTitleAfterScroll = stateAfterScroll.elements.find(el => el.name === "Bug Title");
  console.log("Bug Title After Scroll:", JSON.stringify(bugTitleAfterScroll));
  
  await bc.close();
}
run();
