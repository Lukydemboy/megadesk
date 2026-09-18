import { execSync } from "node:child_process";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { createAgentViaTopbar, resetToBlank } from "../support/helpers.js";

function git(cwd, args) {
  execSync(`git ${args}`, { cwd, stdio: "pipe" });
}

const branchRow = (name) =>
  $(
    `//div[contains(@class,"branch-row")][.//div[contains(@class,"branch-name")][contains(text(),"${name}")]]`,
  );

describe("Git branches", () => {
  let repoDir;

  before(async () => {
    // A disposable fixture repo, not the megadesk checkout itself — so this
    // suite can freely check out and delete branches without touching
    // whatever a developer has checked out locally.
    repoDir = mkdtempSync(path.join(tmpdir(), "megadesk-e2e-branches-"));
    git(repoDir, "init -q -b main");
    git(repoDir, 'config user.email "e2e@example.com"');
    git(repoDir, 'config user.name "E2E"');
    git(repoDir, "commit --allow-empty -q -m main-commit");
    git(repoDir, "checkout -q -b feature-one");
    git(repoDir, "commit --allow-empty -q -m feature-one-commit");
    git(repoDir, "checkout -q main");

    await resetToBlank();
    await createAgentViaTopbar({
      name: "Branch Fixture Agent",
      command: "echo",
      args: "branch-fixture-ready",
      cwd: repoDir,
    });
  });

  after(async () => {
    await resetToBlank();
    rmSync(repoDir, { recursive: true, force: true });
  });

  it("shows the current branch in the pane header and switches via its menu", async () => {
    const branchBtn = $(".pane-branch");
    await branchBtn.waitForDisplayed({ timeout: 10000 });
    await browser.waitUntil(async () => (await branchBtn.getText()).includes("main"), {
      timeout: 20000,
      timeoutMsg: 'expected the pane branch chip to show "main"',
    });

    await branchBtn.click();
    await $(".popmenu-item*=feature-one").waitForDisplayed();
    await $(".popmenu-item*=feature-one").click();

    await browser.waitUntil(async () => (await branchBtn.getText()).includes("feature-one"), {
      timeout: 20000,
      timeoutMsg: 'expected the pane branch chip to switch to "feature-one"',
    });
  });

  it("manages branches from the Manage branches dialog", async () => {
    await $(".pane-branch").click();
    await $(".popmenu-item*=Manage branches").click();

    await expect($(".dialog-title")).toHaveText("Manage branches");
    await browser.waitUntil(async () => (await $$(".branch-name")).length >= 2, {
      timeout: 10000,
      timeoutMsg: "expected both fixture branches to be listed",
    });

    // feature-one is currently checked out (from the previous test); check
    // main back out to exercise the checkout button.
    await $('button[title=\'Check out "main"\']').click();
    await browser.waitUntil(
      async () => !(await $('button[title=\'Check out "main"\']').isExisting()),
      { timeout: 10000, timeoutMsg: 'expected "main" to become the checked-out branch' },
    );
    await expect($('button[title="Already checked out"]')).toExist();

    // Delete feature-one: first click arms the confirmation, second commits it.
    await branchRow("feature-one").$('button[title=\'Delete "feature-one"\']').click();
    await expect(branchRow("feature-one").$('button[title="Click again to confirm"]')).toExist();
    await branchRow("feature-one").$('button[title="Click again to confirm"]').click();
    await browser.waitUntil(async () => !(await branchRow("feature-one").isExisting()), {
      timeout: 10000,
      timeoutMsg: 'expected the "feature-one" row to disappear after delete',
    });

    // No remote is configured on this fixture repo, so both actions should
    // fall back to a toast instead of trying to open a browser.
    await branchRow("main").$('button[title="Open branch in source"]').click();
    await expect($(".toast-msg=No recognized remote to open this branch in")).toExist();

    await branchRow("main").$('button[title="Create pull request"]').click();
    await expect($(".toast-msg=No recognized remote to open a PR on")).toExist();

    await $(".primary-btn=Done").click();
  });
});
