import { spawn } from "node:child_process";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

// The compiled debug binary that `tauri-driver` launches and drives directly
// (no browser involved — it speaks WebDriver over the app's WKWebView/WebKitGTK).
const appBinary =
  process.env.E2E_APP_BINARY ??
  path.resolve(__dirname, "../src-tauri/target/debug/app");

// CI runs this headless (Xvfb), so screenshots are the only way to see what
// the test actually saw — uploaded as a workflow artifact by the E2E job.
export const screenshotsDir = path.resolve(__dirname, "screenshots");
mkdirSync(screenshotsDir, { recursive: true });

let tauriDriver;

export const config = {
  runner: "local",
  // tauri-driver listens on this address by default; WebdriverIO needs it
  // spelled out explicitly since these capabilities have no browserName.
  hostname: "127.0.0.1",
  port: 4444,
  specs: ["./specs/**/*.spec.js"],
  maxInstances: 1,
  capabilities: [
    {
      "tauri:options": {
        application: appBinary,
      },
    },
  ],
  logLevel: "warn",
  framework: "mocha",
  reporters: ["spec"],
  mochaOpts: {
    ui: "bdd",
    timeout: 60000,
  },

  // tauri-driver proxies WebDriver requests to the app's native webview driver
  // (WebKitWebDriver on Linux); it must be up before the session starts.
  beforeSession: () => {
    tauriDriver = spawn(process.env.TAURI_DRIVER_BIN ?? "tauri-driver", [], {
      stdio: [null, process.stdout, process.stderr],
    });
  },

  afterSession: () => {
    tauriDriver?.kill();
  },

  afterTest: async (test, _context, { passed }) => {
    if (passed) return;
    const name = `${test.parent} -- ${test.title}`.replace(/[^\w-]+/g, "_");
    await browser.saveScreenshot(path.join(screenshotsDir, `FAILED-${name}.png`));
  },
};
