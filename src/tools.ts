import { tool } from "@openai/agents";
import { z } from "zod";
import type { BrowserController } from "./browser.js";

export function createBrowserTools(controller: BrowserController) {
  const openBrowser = tool({
    name: "open_browser",
    description: "Launch the browser. Defaults to headed mode unless headless is true.",
    parameters: z.object({
      headless: z.boolean().nullable(),
    }),
    execute: async (input) => {
      return controller.launch(input.headless ?? undefined);
    },
  });

  const navigateToUrl = tool({
    name: "navigate_to_url",
    description: "Navigate the browser to a URL.",
    parameters: z.object({
      url: z.string().url(),
    }),
    execute: async (input) => {
      return controller.navigate(input.url);
    },
  });

  const takeScreenshot = tool({
    name: "take_screenshot",
    description: "Capture a screenshot of the current page and save it to disk.",
    parameters: z.object({
      name: z.string().nullable(),
    }),
    execute: async (input) => {
      const result = await controller.screenshot(input.name ?? undefined);
      return {
        path: result.path,
        base64Preview: `${result.base64.slice(0, 50)}...`,
        base64Length: result.base64.length,
      };
    },
  });

  const clickOnScreen = tool({
    name: "click_on_screen",
    description: "Click at screen coordinates (x, y). Shows a red highlight before clicking.",
    parameters: z.object({
      x: z.number(),
      y: z.number(),
    }),
    execute: async (input) => {
      return controller.click(input.x, input.y);
    },
  });

  const sendKeys = tool({
    name: "send_keys",
    description: "Type text into the currently focused element using the keyboard.",
    parameters: z.object({
      text: z.string(),
    }),
    execute: async (input) => {
      return controller.fill(input.text);
    },
  });

  const scrollPage = tool({
    name: "scroll",
    description: "Scroll the page up or down by a pixel amount.",
    parameters: z.object({
      direction: z.enum(["up", "down"]),
      amount: z.number().nullable(),
    }),
    execute: async (input) => {
      return controller.scroll(input.direction, input.amount ?? undefined);
    },
  });

  const doubleClick = tool({
    name: "double_click",
    description: "Double-click at screen coordinates (x, y). Shows a red highlight before clicking.",
    parameters: z.object({
      x: z.number(),
      y: z.number(),
    }),
    execute: async (input) => {
      return controller.doubleClick(input.x, input.y);
    },
  });

  const findElement = tool({
    name: "find_element",
    description:
      "Find an element on the page by accessible name (exact or partial label match). Returns coordinates or null.",
    parameters: z.object({
      description: z.string(),
    }),
    execute: async (input) => {
      return controller.findElement(input.description);
    },
  });

  const getPageState = tool({
    name: "get_page_state",
    description:
      "Get a filtered accessibility snapshot of interactive elements (textbox, button, link, combobox, checkbox).",
    parameters: z.object({}),
    execute: async () => {
      return controller.getPageState();
    },
  });

  return [
    openBrowser,
    navigateToUrl,
    takeScreenshot,
    clickOnScreen,
    sendKeys,
    scrollPage,
    doubleClick,
    findElement,
    getPageState,
  ];
}

export type BrowserTool = ReturnType<typeof createBrowserTools>[number];
