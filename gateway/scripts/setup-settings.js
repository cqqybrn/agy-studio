import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const SETTINGS_DIR = path.join(os.homedir(), ".gemini", "antigravity-cli");
const SETTINGS_PATH = path.join(SETTINGS_DIR, "settings.json");

/**
 * Persist always-proceed so interactive /config matches auto-approve intent.
 * Headless print mode still needs --dangerously-skip-permissions (official).
 */
export function setupSettings() {
  fs.mkdirSync(SETTINGS_DIR, { recursive: true });

  let existing = {};
  if (fs.existsSync(SETTINGS_PATH)) {
    try {
      existing = JSON.parse(fs.readFileSync(SETTINGS_PATH, "utf8"));
    } catch {
      existing = {};
    }
  }

  const next = {
    ...existing,
    toolPermission: "always-proceed",
    artifactReviewPolicy: "always-proceed",
    // Match IDE “Agent Non-Workspace File Access” so headless can touch paths outside cwd
    allowNonWorkspaceAccess: true,
  };

  fs.writeFileSync(SETTINGS_PATH, JSON.stringify(next, null, 2) + "\n", "utf8");
  console.log(`[agy-auto] wrote ${SETTINGS_PATH}`);
  console.log(`[agy-auto] toolPermission=${next.toolPermission}`);
  console.log(`[agy-auto] artifactReviewPolicy=${next.artifactReviewPolicy}`);
  console.log(`[agy-auto] allowNonWorkspaceAccess=${next.allowNonWorkspaceAccess}`);
  console.log(
    `[agy-auto] note: headless (-p) still requires --dangerously-skip-permissions (this wrapper always adds it)`
  );
  return SETTINGS_PATH;
}
