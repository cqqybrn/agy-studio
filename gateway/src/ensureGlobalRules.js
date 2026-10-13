import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
/** Monorepo root (rules live in ../rules, shared with WebUI). */
const REPO_ROOT = path.resolve(__dirname, "..", "..");
const BUNDLED = path.join(REPO_ROOT, "rules", "global", "AGENTS.md");
const GLOBAL_MD = path.join(os.homedir(), ".gemini", "config", "AGENTS.md");

/**
 * Install / refresh bundled global Antigravity rule (~/.gemini/config/AGENTS.md).
 * Same discovery path as IDE global rules; agy Studio / CLI inherit on spawn.
 */
export function ensureGlobalRules() {
  if (!fs.existsSync(BUNDLED)) {
    return { ok: false, error: `missing bundled global rule: ${BUNDLED}` };
  }
  fs.mkdirSync(path.dirname(GLOBAL_MD), { recursive: true });
  const src = fs.readFileSync(BUNDLED, "utf8");
  let prev = null;
  try {
    prev = fs.readFileSync(GLOBAL_MD, "utf8");
  } catch {
    prev = null;
  }
  if (prev !== src) {
    const tmp = path.join(path.dirname(GLOBAL_MD), `.AGENTS.${Date.now()}.tmp`);
    fs.writeFileSync(tmp, src, "utf8");
    fs.renameSync(tmp, GLOBAL_MD);
  }
  return { ok: true, path: GLOBAL_MD, updated: prev !== src };
}
