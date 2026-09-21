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

/**
 * Poll a tab's status-dot class entirely inside the browser via
 * requestAnimationFrame, instead of WebDriver round-tripping out to Node
 * and back on every check. A plain browser.waitUntil() calling
 * getAttribute() repeatedly never observed this dot turn "on" even with a
 * generous timeout, while a screenshot taken moments after the timeout
 * fired showed it already correct — consistent with the frequent
 * WebDriver polling itself starving the single-process, software-rendered
 * webview of the tick it needs to actually paint the class change.
 */
export async function waitForTabStatusClass(name, cls, timeoutMs) {
  return browser.execute(
    (xp, wantedClass, timeout) =>
      new Promise((resolve) => {
        const deadline = Date.now() + timeout;
        const check = () => {
          const tab = document.evaluate(
            xp,
            document,
            null,
            XPathResult.FIRST_ORDERED_NODE_TYPE,
            null,
          ).singleNodeValue;
          const dot = tab?.querySelector(".status-dot");
          if (dot?.className.includes(wantedClass)) return resolve(true);
          if (Date.now() > deadline) return resolve(false);
          requestAnimationFrame(check);
        };
        check();
      }),
    paneTabXPath(name),
    cls,
    timeoutMs,
  );
}

/**
 * Read an element's text via the DOM instead of WebDriver's getText().
 * WebKitGTK implements "Get Element Text" with its own atom
 * (Source/WebKit/UIProcess/Automation/atoms/utils.js) whose overflow check
 * is a self-described partial port of Selenium's: it treats *any*
 * `overflow: hidden` element as overflowing its container, and then calls
 * the subtree hidden when every child is "overflowed or otherwise hidden"
 * -- which for a text-node child is unconditionally true. So any
 * ellipsis-truncated element whose children are just text (.agent-name,
 * .pane-branch, .pane-tab-name) reads back as "" through getText(), even
 * while it's plainly visible and waitForDisplayed() (which uses the
 * browser's own checkVisibility()) is happy with it.
 */
export async function textOf(el) {
  // execute() only accepts an already-resolved element; awaiting a `$()`
  // chain yields one (or throws a useful "not found" if it isn't there).
  return browser.execute((e) => e.textContent ?? "", await el);
}

export const selectByLabel = (label) =>
  $(`//span[@class="field-label" and text()="${label}"]/following-sibling::select`);

export const textInputByLabel = (label) =>
  $(`//span[@class="field-label" and text()="${label}"]/following-sibling::input`);

export const pathInputByLabel = (label) =>
  $(
    `//span[@class="field-label" and text()="${label}"]/following-sibling::div[@class="field-row"]/input`,
  );

/** Collapse the grid to a single pane. Also drops any zoom, since
 *  applyPreset() clears it. Safe to call from any layout/zoom state. */
export async function resetLayout() {
  await $('button[title="1-pane layout"]').click();
}

async function deleteAgentRow(row, rowCountBefore) {
  await row.waitForDisplayed();
  await row.$(".row-edit").click();
  const del = $(".danger-btn");
  await del.waitForDisplayed();
  await del.click();
  // Not `row.waitForExist({ reverse: true })`: on an element that came from
  // `$$`, WebdriverIO's isExisting() re-runs the *selector* against the
  // parent and answers "does anything match", so it would only turn false
  // once every .agent-row is gone -- i.e. it hangs whenever there are two
  // or more agents to delete. Watch the row count instead.
  await browser.waitUntil(async () => (await $$(".agent-row")).length < rowCountBefore, {
    timeout: 30000,
    timeoutMsg: `expected the sidebar to drop below ${rowCountBefore} agent rows after delete`,
  });
}

/** Delete every agent currently in the sidebar, killing any pty they own. */
export async function clearAllAgents() {
  for (let i = 0; i < 50; i++) {
    const rows = await $$(".agent-row");
    if (!rows.length) return;
    await deleteAgentRow(rows[0], rows.length);
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
