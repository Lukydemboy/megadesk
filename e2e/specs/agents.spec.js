import {
  createAgentViaTopbar,
  fillAgentForm,
  jsClick,
  jsDoubleClick,
  paneTabByName,
  resetToBlank,
  saveAgentForm,
  sidebarAgentRow,
} from "../support/helpers.js";

describe("Agent and tab management", () => {
  before(async () => {
    await resetToBlank();
  });

  after(async () => {
    await resetToBlank();
  });

  it("creates an agent and streams its output into a pane tab", async () => {
    await createAgentViaTopbar({
      name: "E2E Agent A",
      command: "echo",
      args: "agent-a-output",
    });

    await paneTabByName("E2E Agent A").waitForDisplayed();
    await expect(sidebarAgentRow("E2E Agent A")).toExist();

    const term = $('[data-testid="term-mount"]');
    await browser.waitUntil(async () => (await term.getText()).includes("agent-a-output"), {
      timeout: 15000,
      timeoutMsg: "expected the echoed text to appear in the terminal",
    });
  });

  it("adds a second tab via the pane actions menu and switches between tabs", async () => {
    await $('button[title="Pane actions"]').click();
    await $(".popmenu-item*=Add agent").click();

    await $("button=+ New agent…").waitForDisplayed();
    await $("button=+ New agent…").click();

    await $('[data-testid="agent-name-input"]').waitForDisplayed();
    await fillAgentForm({ name: "E2E Agent B", command: "echo", args: "agent-b-output" });
    await saveAgentForm();

    const term = $('[data-testid="term-mount"]');
    await browser.waitUntil(async () => (await term.getText()).includes("agent-b-output"), {
      timeout: 15000,
      timeoutMsg: "expected agent B's output once its tab is active",
    });

    await jsClick(paneTabByName("E2E Agent A"));
    await browser.waitUntil(async () => (await term.getText()).includes("agent-a-output"), {
      timeout: 15000,
      timeoutMsg: "expected agent A's scrollback after switching back to its tab",
    });

    await jsClick(paneTabByName("E2E Agent B"));
    await browser.waitUntil(async () => (await term.getText()).includes("agent-b-output"), {
      timeout: 15000,
      timeoutMsg: "expected agent B's scrollback after switching back to its tab",
    });
  });

  it("renames a tab via double-click", async () => {
    const input = $(".pane-tab-edit");
    // Retry the double-click until the rename input actually appears,
    // in case a beat is lost on a loaded CI runner.
    await browser.waitUntil(
      async () => {
        await jsDoubleClick(paneTabByName("E2E Agent B").$(".pane-tab-name"));
        return input.isDisplayed().catch(() => false);
      },
      { timeout: 10000, interval: 500, timeoutMsg: "expected the rename input to appear" },
    );
    await input.setValue("E2E Agent B Renamed");
    await browser.keys(["Enter"]);

    await expect(paneTabByName("E2E Agent B Renamed")).toExist();
    await expect(sidebarAgentRow("E2E Agent B Renamed")).toExist();
  });

  it("closes a tab while keeping the agent available in the sidebar", async () => {
    await paneTabByName("E2E Agent A").$(".pane-tab-x").click();

    await expect(paneTabByName("E2E Agent A")).not.toExist();
    await expect(sidebarAgentRow("E2E Agent A")).toExist();
  });

  it("reassigns an orphaned agent back onto the grid from the sidebar", async () => {
    await sidebarAgentRow("E2E Agent A").click();
    await expect(paneTabByName("E2E Agent A")).toExist();
  });

  it("stops and restarts the active terminal from the pane actions menu", async () => {
    await createAgentViaTopbar({ name: "E2E Agent Sleep", command: "sleep", args: "50" });

    const tab = paneTabByName("E2E Agent Sleep");
    await browser.waitUntil(
      async () => (await tab.$(".status-dot").getAttribute("class")).includes("on"),
      { timeout: 15000, timeoutMsg: "expected the sleep process to report running" },
    );

    await $('button[title="Pane actions"]').click();
    await $(".popmenu-item*=Stop this terminal").click();
    await browser.waitUntil(
      async () => (await tab.$(".status-dot").getAttribute("class")).includes("exited"),
      { timeout: 10000, timeoutMsg: "expected the terminal to report exited after Stop" },
    );

    await $('button[title="Pane actions"]').click();
    await $(".popmenu-item*=Restart this terminal").click();
    await browser.waitUntil(
      async () => {
        const cls = await tab.$(".status-dot").getAttribute("class");
        return cls.includes("on") && !cls.includes("exited");
      },
      { timeout: 10000, timeoutMsg: "expected the terminal to report running again after Restart" },
    );
  });
});
