import path from "node:path";
import { screenshotsDir } from "../wdio.conf.js";
import { resetToBlank } from "../support/helpers.js";

describe("Megadesk smoke test", () => {
  before(async () => {
    // Other spec files share this same on-disk config across the suite run;
    // start from a known-blank state regardless of what ran before this file.
    await resetToBlank();
  });

  it("launches and renders the topbar", async () => {
    const brand = await $(".brand");
    await expect(brand).toHaveText("Megadesk");
  });

  it("spawns a real agent and streams its output into the terminal", async () => {
    const addAgentButton = await $('[data-testid="add-agent-button"]');
    await addAgentButton.click();

    const commandInput = await $('[data-testid="agent-command-input"]');
    await commandInput.waitForDisplayed();
    await commandInput.setValue("echo");

    const argsInput = await $('[data-testid="agent-args-input"]');
    await argsInput.setValue("hello-e2e-test");

    const saveButton = await $('[data-testid="agent-save-button"]');
    await saveButton.click();

    const termMount = await $('[data-testid="term-mount"]');
    await termMount.waitForDisplayed();

    // The agent runs through a real PTY (portable-pty + the login shell), so
    // this exercises the whole pipeline: Rust process spawn -> pty output
    // events -> xterm rendering in the DOM.
    await browser.waitUntil(
      async () => (await termMount.getText()).includes("hello-e2e-test"),
      {
        timeout: 15000,
        timeoutMsg: "expected the echoed text to appear in the terminal",
      },
    );

    await browser.saveScreenshot(
      path.join(screenshotsDir, "agent-output.png"),
    );
  });
});
