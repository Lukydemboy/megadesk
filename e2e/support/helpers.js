/**
 * Shared helpers for the E2E specs. Every spec file gets a brand-new app
 * process (WebdriverIO starts a fresh session per spec file), but they all
 * read/write the same on-disk config, so state can leak from one spec file
 * to the next. `resetToBlank` gives every spec a deterministic starting
 * point regardless of run order or a previous spec's cleanup having failed.
 */

export const sidebarAgentRow = (name) =>
  $(`//div[contains(@class,"agent-row")][.//div[@class="agent-name" and text()="${name}"]]`);

const paneTabXPath = (name) =>
  `//div[contains(@class,"pane-tab")][.//span[@class="pane-tab-name" and text()="${name}"]]`;

export const paneTabByName = (name) => $(paneTabXPath(name));

export const selectByLabel = (label) =>
  $(`//span[@class="field-label" and text()="${label}"]/following-sibling::select`);

export const textInputByLabel = (label) =>
  $(`//span[@class="field-label" and text()="${label}"]/following-sibling::input`);

export const pathInputByLabel = (label) =>
  $(
    `//span[@class="field-label" and text()="${label}"]/following-sibling::div[@class="field-row"]/input`,
  );

/**
 * Click/double-click a pane tab by resolving the XPath and dispatching the
 * event entirely inside the browser, instead of clicking through WebDriver
 * or passing an element handle into execute() (whose WebElement-reference
 * serialization is unreliable on this driver). Throws if no tab matches.
 */
export async function jsClickTabByName(name) {
  const found = await browser.execute((xp) => {
    const el = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    if (!el) return false;
    el.click();
    return true;
  }, paneTabXPath(name));
  if (!found) throw new Error(`jsClickTabByName: no tab named "${name}"`);
}

export async function jsDoubleClickTabName(name) {
  const found = await browser.execute((xp) => {
    const tab = document.evaluate(
      xp,
      document,
      null,
      XPathResult.FIRST_ORDERED_NODE_TYPE,
      null,
    ).singleNodeValue;
    const nameEl = tab?.querySelector(".pane-tab-name");
    if (!nameEl) return false;
    nameEl.dispatchEvent(new MouseEvent("dblclick", { bubbles: true, cancelable: true }));
    return true;
  }, paneTabXPath(name));
  if (!found) throw new Error(`jsDoubleClickTabName: no tab named "${name}"`);
}

/** Collapse the grid to a single pane. Also drops any zoom, since
 *  applyPreset() clears it. Safe to call from any layout/zoom state. */
export async function resetLayout() {
  await $('button[title="1-pane layout"]').click();
}

async function deleteAgentRow(row) {
  await row.waitForDisplayed();
  await row.$(".row-edit").click();
  const del = $(".danger-btn");
  await del.waitForDisplayed();
  await del.click();
  await row.waitForExist({ reverse: true, timeout: 15000 });
}

/**
 * Delete every agent currently in the sidebar, killing any pty they own.
 * Operates on the row handle directly rather than round-tripping through
 * its name, since re-querying by name races the row's own text rendering.
 */
export async function clearAllAgents() {
  for (let i = 0; i < 50; i++) {
    const rows = await $$(".agent-row");
    if (!rows.length) return;
    await deleteAgentRow(rows[0]);
  }
  throw new Error("clearAllAgents: still finding agents after 50 deletions");
}

export async function resetToBlank() {
  await resetLayout();
  await clearAllAgents();
}

/** Fill the currently-open Agent dialog's fields. Doesn't save or open it. */
export async function fillAgentForm({ name, command, args, cwd } = {}) {
  if (name !== undefined) await $('[data-testid="agent-name-input"]').setValue(name);
  if (command !== undefined) await $('[data-testid="agent-command-input"]').setValue(command);
  if (args !== undefined) await $('[data-testid="agent-args-input"]').setValue(args);
  if (cwd !== undefined) await pathInputByLabel("Working directory").setValue(cwd);
}

export async function saveAgentForm() {
  await $('[data-testid="agent-save-button"]').click();
}

/** Open the Agent dialog from the topbar's "+ Agent" button, fill it in,
 *  and save. With no focused/empty pane this lands in the first pane. */
export async function createAgentViaTopbar(fields) {
  await $('[data-testid="add-agent-button"]').click();
  await $('[data-testid="agent-name-input"]').waitForDisplayed();
  await fillAgentForm(fields);
  await saveAgentForm();
}
