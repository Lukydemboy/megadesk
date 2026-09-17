import { createAgentViaTopbar, deleteAgentByName, resetToBlank } from "../support/helpers.js";

describe("Command palette", () => {
  before(async () => {
    await resetToBlank();
    await createAgentViaTopbar({
      name: "Palette Target Zulu",
      command: "echo",
      args: "zulu-output",
    });
    await createAgentViaTopbar({
      name: "Palette Other Yankee",
      command: "echo",
      args: "yankee-output",
    });
  });

  after(async () => {
    await deleteAgentByName("Palette Target Zulu");
    await deleteAgentByName("Palette Other Yankee");
  });

  it("opens with Ctrl+K, fuzzy-filters agents, and closes with Escape", async () => {
    await browser.keys(["Control", "k"]);
    await expect($(".palette-overlay")).toExist();

    await $(".palette-input").setValue("ptz");

    await expect($(".palette-row*=Palette Target Zulu")).toExist();
    await expect($(".palette-row*=Palette Other Yankee")).not.toExist();

    await browser.keys(["Escape"]);
    await expect($(".palette-overlay")).not.toExist();
  });

  it("jumps to and activates the selected agent on Enter", async () => {
    await browser.keys(["Control", "k"]);
    await $(".palette-input").setValue("Zulu");
    await expect($$(".palette-row")).toBeElementsArrayOfSize(1);

    await browser.keys(["Enter"]);
    await expect($(".palette-overlay")).not.toExist();

    const term = $('[data-testid="term-mount"]');
    await browser.waitUntil(async () => (await term.getText()).includes("zulu-output"), {
      timeout: 10000,
      timeoutMsg: "expected the palette selection to reveal the Zulu agent's terminal",
    });
  });
});
