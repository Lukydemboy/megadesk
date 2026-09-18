import { createAgentViaTopbar, resetToBlank } from "../support/helpers.js";

describe("Layout presets and pane zoom", () => {
  beforeEach(async () => {
    await resetToBlank();
  });

  it("reshapes the grid via the topbar layout presets", async () => {
    await expect($$(".pane")).toBeElementsArrayOfSize(1);

    await $('button[title="2-pane layout"]').click();
    await expect($$(".pane")).toBeElementsArrayOfSize(2);

    await $('button[title="3-pane layout"]').click();
    await expect($$(".pane")).toBeElementsArrayOfSize(3);

    await $('button[title="4-pane layout"]').click();
    await expect($$(".pane")).toBeElementsArrayOfSize(4);

    await $('button[title="1-pane layout"]').click();
    await expect($$(".pane")).toBeElementsArrayOfSize(1);
  });

  it("zooms a pane to fill the grid via its actions menu, then restores it with Escape", async () => {
    // Zoom/unzoom only appear in a pane's actions menu once it holds an
    // agent — an empty pane only offers "Add agent…".
    await createAgentViaTopbar({ name: "Zoom Fixture", command: "sleep", args: "50" });
    await $('button[title="2-pane layout"]').click();
    await expect($$(".pane")).toBeElementsArrayOfSize(2);

    const firstPane = (await $$(".pane"))[0];
    await firstPane.$('button[title="Pane actions"]').click();
    await $(".popmenu-item*=Zoom this pane").click();

    await expect($(".grid.zoomed")).toExist();
    await expect($$(".pane")).toBeElementsArrayOfSize(1);

    await browser.keys(["Escape"]);

    await expect($(".grid.zoomed")).not.toExist();
    await expect($$(".pane")).toBeElementsArrayOfSize(2);
  });

  it("toggles zoom with the Ctrl+Enter shortcut", async () => {
    await $('button[title="2-pane layout"]').click();

    const firstPane = (await $$(".pane"))[0];
    // Opening the pane's actions menu focuses it (what the shortcut targets);
    // dismiss the menu without acting so the focus sticks without a side effect.
    await firstPane.$('button[title="Pane actions"]').click();
    await $(".brand").click();

    await browser.keys(["Control", "Enter"]);
    await expect($(".grid.zoomed")).toExist();

    await browser.keys(["Control", "Enter"]);
    await expect($(".grid.zoomed")).not.toExist();
  });
});
