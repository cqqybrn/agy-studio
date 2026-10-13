import { spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { applyActiveProfileEnv } from "./accounts.js";
import { resolveAgyBinary } from "./agyRunner.js";
import { readJson, writeJson, envWithAgyPath } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const PREFS_PATH = path.join(ROOT, "accounts", "prefs.json");


/**
 * Parse `agy models` output:
 *   gemini-3.8-flash-high\tGemini 3.8 Flash (High)
 */
export function listModels() {
  const bin = resolveAgyBinary();
  const env = applyActiveProfileEnv(process.env);
  const r = spawnSync(bin, ["models"], {
    encoding: "utf8",
    env: envWithAgyPath(env, path.dirname(bin)),
    windowsHide: true,
    timeout: 60_000,
  });
  if (r.error) throw r.error;
  const text = `${r.stdout || ""}\n${r.stderr || ""}`;
  const models = [];
  for (const line of text.split(/\r?\n/)) {
    const t = line.trim();
    if (!t || t.toLowerCase().includes("fetching")) continue;
    // id<TAB>label  or  id  spaces  label
    const m = t.match(/^([a-z0-9][\w.-]*)\s+(.+)$/i);
    if (!m) continue;
    const id = m[1];
    const label = m[2].trim();
    if (id === "Fetching") continue;
    models.push({
      id,
      object: "model",
      owned_by: "antigravity",
      label,
      // Official Models dropdown uses display_name like "Claude Sonnet 4.6 (Thinking)"
      display_name: label,
      // Group for UI: matches official quota panel groups
      group:
        id.startsWith("gemini")
          ? "Gemini Models"
          : id.startsWith("claude") || id.startsWith("gpt")
            ? "Claude and GPT models"
            : "Other",
    });
  }
  // de-dupe by id
  const seen = new Set();
  const uniq = [];
  for (const m of models) {
    if (seen.has(m.id)) continue;
    seen.add(m.id);
    uniq.push(m);
  }
  return uniq;
}

export function getPrefs() {
  return readJson(PREFS_PATH, {
    defaultModel: null,
    defaultEffort: null,
    defaultCwd: null,
    defaultAgent: null,
  });
}

export function setPrefs(patch = {}) {
  const cur = getPrefs();
  const next = {
    ...cur,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  writeJson(PREFS_PATH, next);
  return next;
}

export function resolveDefaultModel(explicit) {
  if (explicit && !["antigravity", "agy", "default"].includes(explicit)) {
    return explicit;
  }
  return getPrefs().defaultModel || "gemini-3.8-flash-high";
}

/**
 * Prefer explicit agent → prefs → AGY_DEFAULT_AGENT → built-in default agent
 * (no --agent flag, same as the Antigravity desktop app).
 * Pass "default"/"builtin"/"-" to force the built-in default agent.
 */
export function resolveDefaultAgent(explicit) {
  const raw =
    explicit !== undefined && explicit !== null
      ? String(explicit).trim()
      : "";
  if (raw === "default" || raw === "builtin" || raw === "-") return undefined;
  if (raw && raw !== "agy" && raw !== "antigravity") return raw;
  const pref = getPrefs().defaultAgent;
  if (pref === "default" || pref === "builtin" || pref === "-") return undefined;
  if (pref && String(pref).trim()) return String(pref).trim();
  const env = (process.env.AGY_DEFAULT_AGENT || "").trim();
  if (env === "default" || env === "builtin" || env === "-") return undefined;
  if (env) return env;
  return undefined;
}
