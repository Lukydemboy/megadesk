import {
  pathInputByLabel,
  resetToBlank,
  selectByLabel,
} from "../support/helpers.js";

const FIXTURE_CWD = "/tmp/megadesk-e2e-settings-fixture";

describe("Settings", () => {
  before(async () => {
    await resetToBlank();
  });

  after(async () => {
    await resetToBlank();

    await $('button[title="Settings"]').click();
    await pathInputByLabel("Default working directory").clearValue();
    await selectByLabel("Startup layout").selectByAttribute("value", "last");
    await $(".primary-btn=Done").click();
  });

  it("changes the startup layout and UI theme, and keeps them across a reopen", async () => {
    await $('button[title="Settings"]').click();
    await expect($(".dialog-title")).toHaveText("Settings");

    await selectByLabel("Startup layout").selectByAttribute("value", "2");
    await selectByLabel("UI theme").selectByAttribute("value", "dark");

    const theme = await browser.execute(() => document.documentElement.dataset.theme);
    expect(theme).toBe("dark");

    await $(".primary-btn=Done").click();
    await expect($(".overlay")).not.toExist();

    await $('button[title="Settings"]').click();
    await expect(selectByLabel("Startup layout")).toHaveValue("2");
    await expect(selectByLabel("UI theme")).toHaveValue("dark");

    // Revert the theme now so it doesn't bleed into other specs.
    await selectByLabel("UI theme").selectByAttribute("value", "system");
    await $(".primary-btn=Done").click();
  });

  it("wires the default working directory into new agent creation", async () => {
    await $('button[title="Settings"]').click();
    await pathInputByLabel("Default working directory").setValue(FIXTURE_CWD);
    await $(".primary-btn=Done").click();

    await $('[data-testid="add-agent-button"]').click();
    await expect(pathInputByLabel("Working directory")).toHaveValue(FIXTURE_CWD);

    await $('[data-testid="agent-name-input"]').setValue("Settings CWD Probe");
    await $('[data-testid="agent-command-input"]').setValue("echo");
    await $('[data-testid="agent-args-input"]').setValue("cwd-probe");
    await $('[data-testid="agent-save-button"]').click();

    await expect($(".agent-name*=Settings CWD Probe")).toExist();
  });
});
