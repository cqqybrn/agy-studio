import { spawnSync, spawn } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { existsSync } from "node:fs";
import { readJson, writeJson, resolveAgyBinary as resolveAgyBinaryShared } from "./utils.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ACCOUNTS_DIR = path.join(ROOT, "accounts");
const ACTIVE_PATH = path.join(ACCOUNTS_DIR, "active.json");
const WINCRED_PS1 = path.join(ROOT, "scripts", "wincred.ps1");

const GEMINI_DIR = path.join(os.homedir(), ".gemini");
const OAUTH_CREDS = path.join(GEMINI_DIR, "oauth_creds.json");
const GOOGLE_ACCOUNTS = path.join(GEMINI_DIR, "google_accounts.json");
const AGY_SETTINGS = path.join(GEMINI_DIR, "antigravity-cli", "settings.json");
const AGY_OAUTH_FILE = path.join(
  GEMINI_DIR,
  "antigravity-cli",
  "antigravity-oauth-token"
);

function ensureDir(p) {
  fs.mkdirSync(p, { recursive: true });
}

let winCredReadCache = null;
let winCredReadCacheTime = 0;

function runWinCred(action, extra = {}) {
  if (action === "read" && winCredReadCache && Date.now() - winCredReadCacheTime < 3000) {
    return winCredReadCache;
  }

  const args = [
    "-NoProfile",
    "-ExecutionPolicy",
    "Bypass",
    "-File",
    WINCRED_PS1,
    "-Action",
    action,
  ];
  if (extra.blobB64) {
    args.push("-BlobBase64", extra.blobB64);
  }
  if (extra.username) {
    args.push("-UserName", extra.username);
  }
  const r = spawnSync("powershell.exe", args, {
    encoding: "utf8",
    windowsHide: true,
    timeout: 8000,
  });
  if (r.error) throw r.error;
  const out = (r.stdout || "").trim();
  const err = (r.stderr || "").trim();
  if (r.status !== 0) {
    throw new Error(`wincred ${action} failed: ${err || out || `exit ${r.status}`}`);
  }
  if (!out) throw new Error(`wincred ${action} returned empty output`);
  // PowerShell may emit BOM / warnings; take last JSON line
  const lines = out.split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  const jsonLine = lines[lines.length - 1] || out;
  const parsed = JSON.parse(jsonLine);

  if (action === "read") {
    winCredReadCache = parsed;
    winCredReadCacheTime = Date.now();
  } else {
    winCredReadCache = null;
    winCredReadCacheTime = 0;
  }
  return parsed;
}

export function decodeJwtEmail(idToken) {
  if (!idToken || typeof idToken !== "string") return null;
  const parts = idToken.split(".");
  if (parts.length < 2) return null;
  try {
    const payload = JSON.parse(
      Buffer.from(parts[1].replace(/-/g, "+").replace(/_/g, "/"), "base64").toString(
        "utf8"
      )
    );
    return payload.email || payload.preferred_username || null;
  } catch {
    return null;
  }
}

/** Parse live OAuth JSON stored inside Windows Credential Manager blob. */
function readWinCredOAuth() {
  try {
    const cred = runWinCred("read");
    if (!cred.exists || !cred.blobB64) return null;
    const text = Buffer.from(cred.blobB64, "base64").toString("utf8");
    const obj = JSON.parse(text);
    if (!obj || typeof obj !== "object") return null;
    return { cred, oauth: obj };
  } catch {
    return null;
  }
}

/**
 * Newer CLI logins often only write WinCred, not ~/.gemini/oauth_creds.json.
 * Mirror the blob into the files our UI / save path expect.
 */
export function syncLiveOAuthFilesFromWinCred(packedParam = null) {
  const packed = packedParam || readWinCredOAuth();
  if (!packed) return null;
  const { oauth } = packed;
  const email =
    decodeJwtEmail(oauth.id_token) ||
    decodeJwtEmail(oauth.token?.id_token) ||
    oauth.email ||
    null;

  ensureDir(GEMINI_DIR);
  writeJson(OAUTH_CREDS, oauth);
  if (email) {
    const ga = readJson(GOOGLE_ACCOUNTS, {}) || {};
    writeJson(GOOGLE_ACCOUNTS, { ...ga, active: email, old: ga.old || [] });
  }
  return { email, oauth };
}

export function currentEmail() {
  // Ground truth: live WinCred credential used by agy CLI
  const packed = readWinCredOAuth();
  if (packed?.oauth) {
    const liveEmail =
      decodeJwtEmail(packed.oauth.id_token) ||
      decodeJwtEmail(packed.oauth.token?.id_token) ||
      packed.oauth.email ||
      null;
    if (liveEmail) return liveEmail;
  }

  // Fallback: oauth_creds.json file
  const oauth = readJson(OAUTH_CREDS, {});
  const fromFile = decodeJwtEmail(oauth?.id_token) || decodeJwtEmail(oauth?.token?.id_token);
  if (fromFile) return fromFile;

  // Fallback: google_accounts.json file
  const ga = readJson(GOOGLE_ACCOUNTS, {});
  if (ga?.active) return ga.active;

  return null;
}

function profileDir(name) {
  const safe = String(name).trim().replace(/[^\w.@+-]+/g, "_");
  if (!safe) throw new Error("invalid account name");
  return path.join(ACCOUNTS_DIR, safe);
}

export function listProfiles() {
  ensureDir(ACCOUNTS_DIR);
  const active = readJson(ACTIVE_PATH, {})?.name || null;
  const names = fs
    .readdirSync(ACCOUNTS_DIR, { withFileTypes: true })
    .filter((d) => d.isDirectory())
    .map((d) => d.name)
    // Only real saved profiles (Chrome user-data dirs etc. must not appear)
    .filter((name) => {
      const dir = profileDir(name);
      return (
        fs.existsSync(path.join(dir, "meta.json")) ||
        fs.existsSync(path.join(dir, "wincred.b64")) ||
        fs.existsSync(path.join(dir, "api_key.txt"))
      );
    })
    .sort();
  return names.map((name) => {
    const meta = readJson(path.join(profileDir(name), "meta.json"), {});
    return {
      name,
      type: meta.type || "oauth",
      email: meta.email || null,
      savedAt: meta.savedAt || null,
      active: name === active,
    };
  });
}

export function getActive() {
  return readJson(ACTIVE_PATH, {})?.name || null;
}

export function setActive(name) {
  writeJson(ACTIVE_PATH, { name, switchedAt: new Date().toISOString() });
}

/**
 * Snapshot current live OAuth (WinCred + ~/.gemini files) into a named profile.
 * Like saving a "cookie jar" for later restore — no browser needed on switch.
 */
export function saveAccount(name, { asApiKey, apiKey, note } = {}) {
  ensureDir(ACCOUNTS_DIR);
  const dir = profileDir(name);
  ensureDir(dir);

  if (asApiKey || apiKey) {
    if (!apiKey) throw new Error("apiKey required for API-key profile");
    writeJson(path.join(dir, "meta.json"), {
      type: "apikey",
      email: null,
      note: note || null,
      savedAt: new Date().toISOString(),
    });
    // store key privately in profile (local machine only)
    fs.writeFileSync(path.join(dir, "api_key.txt"), String(apiKey).trim(), "utf8");
    setActive(name);
    return { name, type: "apikey", active: true };
  }

  const cred = runWinCred("read");
  if (!cred.exists || !cred.blobB64) {
    throw new Error(
      "No live Antigravity OAuth in Windows Credential Manager (gemini:antigravity). Run `agy` once to login, then save."
    );
  }

  // Ensure sidecar files exist even when CLI only wrote WinCred
  syncLiveOAuthFilesFromWinCred();
  const email = currentEmail();
  writeJson(path.join(dir, "meta.json"), {
    type: "oauth",
    email,
    username: cred.username || "antigravity",
    note: note || null,
    savedAt: new Date().toISOString(),
    blobSize: cred.blobSize,
  });
  fs.writeFileSync(path.join(dir, "wincred.b64"), cred.blobB64, "utf8");

  // Always snapshot oauth from live files (now synced) or directly from blob
  if (fs.existsSync(OAUTH_CREDS)) {
    fs.copyFileSync(OAUTH_CREDS, path.join(dir, "oauth_creds.json"));
  } else {
    try {
      const text = Buffer.from(cred.blobB64, "base64").toString("utf8");
      fs.writeFileSync(path.join(dir, "oauth_creds.json"), text, "utf8");
    } catch { /* ignore */ }
  }
  if (fs.existsSync(GOOGLE_ACCOUNTS)) {
    fs.copyFileSync(GOOGLE_ACCOUNTS, path.join(dir, "google_accounts.json"));
  } else if (email) {
    writeJson(path.join(dir, "google_accounts.json"), { active: email, old: [] });
  }
  if (fs.existsSync(AGY_OAUTH_FILE)) {
    fs.copyFileSync(AGY_OAUTH_FILE, path.join(dir, "antigravity-oauth-token"));
  }

  // remember settings snippet for oauth mode (no modelProvider=gemini)
  const settings = readJson(AGY_SETTINGS, {});
  writeJson(path.join(dir, "settings.snippet.json"), {
    toolPermission: settings.toolPermission || "always-proceed",
    artifactReviewPolicy: settings.artifactReviewPolicy || "always-proceed",
    // ensure account mode uses Google login, not API key
    clearModelProvider: true,
  });

  setActive(name);
  invalidateWhoamiCache();
  return { name, type: "oauth", email, active: true };
}

/**
 * Restore a saved profile into the live credential slots (no browser).
 */
export function switchAccount(name) {
  const dir = profileDir(name);
  if (!fs.existsSync(dir)) throw new Error(`account not found: ${name}`);
  const meta = readJson(path.join(dir, "meta.json"), {});

  if (meta.type === "apikey") {
    const keyPath = path.join(dir, "api_key.txt");
    if (!fs.existsSync(keyPath)) throw new Error(`missing api_key.txt for ${name}`);
    const apiKey = fs.readFileSync(keyPath, "utf8").trim();
    const settings = readJson(AGY_SETTINGS, {});
    writeJson(AGY_SETTINGS, {
      ...settings,
      modelProvider: "gemini",
      toolPermission: settings.toolPermission || "always-proceed",
      artifactReviewPolicy: settings.artifactReviewPolicy || "always-proceed",
    });
    // Persist key for subsequent shells of this tool via profile env file
    writeJson(path.join(ACCOUNTS_DIR, "runtime.env.json"), {
      GEMINI_API_KEY: apiKey,
      AGY_ACCOUNT: name,
      AGY_ACCOUNT_TYPE: "apikey",
    });
    setActive(name);
    invalidateWhoamiCache();
    return {
      name,
      type: "apikey",
      email: null,
      hint: "API key mode active. agy-auto will inject GEMINI_API_KEY automatically.",
    };
  }

  const b64Path = path.join(dir, "wincred.b64");
  if (!fs.existsSync(b64Path)) throw new Error(`missing wincred.b64 for ${name}`);
  const blobB64 = fs.readFileSync(b64Path, "utf8").trim();
  const username = meta.username || "antigravity";
  runWinCred("write", { blobB64, username });

  if (fs.existsSync(path.join(dir, "oauth_creds.json"))) {
    ensureDir(GEMINI_DIR);
    fs.copyFileSync(path.join(dir, "oauth_creds.json"), OAUTH_CREDS);
  }
  if (fs.existsSync(path.join(dir, "google_accounts.json"))) {
    fs.copyFileSync(path.join(dir, "google_accounts.json"), GOOGLE_ACCOUNTS);
  }
  if (fs.existsSync(path.join(dir, "antigravity-oauth-token"))) {
    ensureDir(path.dirname(AGY_OAUTH_FILE));
    fs.copyFileSync(
      path.join(dir, "antigravity-oauth-token"),
      AGY_OAUTH_FILE
    );
  }

  // Back to Google-account auth (remove API-key provider)
  const settings = readJson(AGY_SETTINGS, {});
  const next = { ...settings };
  delete next.modelProvider;
  next.toolPermission = next.toolPermission || "always-proceed";
  next.artifactReviewPolicy = next.artifactReviewPolicy || "always-proceed";
  writeJson(AGY_SETTINGS, next);

  writeJson(path.join(ACCOUNTS_DIR, "runtime.env.json"), {
    AGY_ACCOUNT: name,
    AGY_ACCOUNT_TYPE: "oauth",
  });
  // clear any lingering key from env file
  setActive(name);
  invalidateWhoamiCache();
  return {
    name,
    type: "oauth",
    email: meta.email || currentEmail(),
    hint: "OAuth restored to Windows Credential Manager. No browser needed.",
  };
}

export function removeAccount(name) {
  const dir = profileDir(name);
  if (!fs.existsSync(dir)) throw new Error(`account not found: ${name}`);
  let lastErr = null;
  for (let i = 0; i < 6; i++) {
    try {
      fs.rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 150 });
      lastErr = null;
      break;
    } catch (err) {
      lastErr = err;
      const until = Date.now() + 300;
      while (Date.now() < until) {
        /* brief wait for Chrome/AV lock release */
      }
    }
  }
  if (lastErr || fs.existsSync(dir)) {
    throw new Error(
      `无法删除「${name}」：${lastErr?.message || "目录仍被占用"}。若刚跑过授权，请先关掉弹出的 Chrome 再删。`
    );
  }
  const active = getActive();
  if (active === name) {
    if (fs.existsSync(ACTIVE_PATH)) fs.unlinkSync(ACTIVE_PATH);
    const runtime = path.join(ACCOUNTS_DIR, "runtime.env.json");
    if (fs.existsSync(runtime)) fs.unlinkSync(runtime);
    const remaining = listProfiles().filter((p) => p.name !== name);
    if (remaining.length > 0) {
      try {
        switchAccount(remaining[0].name);
      } catch { /* ignore */ }
    }
  }
  invalidateWhoamiCache();
  return { removed: name };
}

/**
 * Clear live OAuth so the NEXT `agy` interactive login can bind a new Google account.
 * Does not delete saved profiles.
 */
export function clearLiveAuth() {
  runWinCred("delete");
  for (const p of [OAUTH_CREDS, AGY_OAUTH_FILE]) {
    if (fs.existsSync(p)) fs.unlinkSync(p);
  }
  // keep google_accounts.json but mark empty-ish
  writeJson(GOOGLE_ACCOUNTS, { active: null, old: [] });
  invalidateWhoamiCache();
  return { cleared: true };
}

function resolveAgyBinaryLocal() {
  return resolveAgyBinaryShared();
}


/**
 * Open interactive `agy` in a new console so the browser OAuth flow can run.
 * Chrome will show already-signed-in Google accounts for one-click pick
 * (we cannot read Chrome cookies into Antigravity OAuth).
 */
export function startCliLogin() {
  // Keep interactive session auto-approved (same intent as headless wrapper)
  try {
    const settings = readJson(AGY_SETTINGS, {});
    writeJson(AGY_SETTINGS, {
      ...settings,
      toolPermission: "always-proceed",
      artifactReviewPolicy: "always-proceed",
      allowNonWorkspaceAccess: true,
    });
  } catch { /* ignore */ }

  const bin = resolveAgyBinaryLocal();
  if (process.platform === "win32") {
    const ps = `
$bin = ${JSON.stringify(bin)}
if (-not (Test-Path -LiteralPath $bin)) { throw "agy not found: $bin" }
# Interactive login window with auto-approve so permission prompts don't block
Start-Process -FilePath $bin -ArgumentList @('--dangerously-skip-permissions') -WorkingDirectory $env:USERPROFILE
`;
    const r = spawnSync(
      "powershell.exe",
      ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", ps],
      { encoding: "utf8", windowsHide: true }
    );
    if (r.status !== 0) {
      throw new Error((r.stderr || r.stdout || "failed to launch agy").trim());
    }
  } else {
    const child = spawn(bin, ["--dangerously-skip-permissions"], {
      detached: true,
      stdio: "ignore",
      cwd: os.homedir(),
      env: process.env,
    });
    child.unref();
  }
  return {
    started: true,
    binary: bin,
    autoApprove: true,
    hint: "在弹出的 CLI / 浏览器里用 Google 登录；Chrome 已登录的账号可直接点选。工具同意已默认 always-proceed。完成后前端会自动检测并保存。",
  };
}

/**
 * One-click path for adding another Google account:
 * 1) optionally snapshot current live login if not already saved
 * 2) clear live auth
 * 3) launch interactive agy login
 */
export function beginAddAccount({ saveCurrentAs, skipSaveCurrent = false } = {}) {
  const before = whoami();
  let savedCurrent = null;

  if (!skipSaveCurrent && before.wincredExists) {
    const email = before.email;
    const profiles = listProfiles();
    const already = email
      ? profiles.some((p) => p.email && p.email.toLowerCase() === String(email).toLowerCase())
      : Boolean(before.activeProfile && profiles.some((p) => p.name === before.activeProfile));
    if (!already || saveCurrentAs) {
      const name =
        (saveCurrentAs && String(saveCurrentAs).trim()) ||
        (email ? String(email).split("@")[0].replace(/[^\w.+-]+/g, "_") : null) ||
        before.activeProfile ||
        "default";
      try {
        savedCurrent = saveAccount(name);
      } catch (err) {
        // still proceed with login; surface warning
        savedCurrent = { error: err.message, attemptedName: name };
      }
    } else {
      savedCurrent = { skipped: true, reason: "already_saved", email };
    }
  }

  clearLiveAuth();
  const login = startCliLogin();
  return {
    ok: true,
    savedCurrent,
    login,
    beforeEmail: before.email || null,
    next: "完成浏览器登录后调用 POST /v1/accounts/save 保存新号",
  };
}

/** Suggest a profile name from live or explicit email. */
export function suggestProfileName(explicitEmail = null) {
  const email = explicitEmail || currentEmail();
  if (!email) return null;
  const base = email.split("@")[0].replace(/[^\w.+-]+/g, "_") || "account";
  const taken = new Set(listProfiles().map((p) => p.name.toLowerCase()));
  if (!taken.has(base.toLowerCase())) return base;
  for (let i = 2; i < 50; i++) {
    const n = `${base}${i}`;
    if (!taken.has(n.toLowerCase())) return n;
  }
  return `${base}_${Date.now().toString(36)}`;
}

let whoamiCache = null;
let whoamiCacheTime = 0;

export function invalidateWhoamiCache() {
  whoamiCache = null;
  whoamiCacheTime = 0;
}

export function whoami(force = false) {
  const now = Date.now();
  if (!force && whoamiCache && now - whoamiCacheTime < 5000) {
    return whoamiCache;
  }

  const packed = readWinCredOAuth();
  let email = null;
  if (packed?.oauth) {
    email =
      decodeJwtEmail(packed.oauth.id_token) ||
      decodeJwtEmail(packed.oauth.token?.id_token) ||
      packed.oauth.email ||
      null;
  }
  if (!email) {
    const oauth = readJson(OAUTH_CREDS, {});
    email = decodeJwtEmail(oauth?.id_token) || decodeJwtEmail(oauth?.token?.id_token);
  }
  if (!email) {
    const ga = readJson(GOOGLE_ACCOUNTS, {});
    email = ga?.active || null;
  }

  const wincredExists = Boolean(email || packed?.cred?.exists);
  if (packed?.oauth) {
    try {
      syncLiveOAuthFilesFromWinCred(packed);
    } catch { /* ignore */ }
  }

  const active = getActive();
  const runtime = readJson(path.join(ACCOUNTS_DIR, "runtime.env.json"), {});
  const profiles = listProfiles();
  const alreadySaved = email
    ? profiles.some((p) => p.email && p.email.toLowerCase() === email.toLowerCase())
    : false;
  const res = {
    activeProfile: active,
    email,
    wincredExists,
    accountType: runtime.AGY_ACCOUNT_TYPE || (active ? profiles.find((p) => p.name === active)?.type : null),
    suggestedName: email ? suggestProfileName(email) : null,
    alreadySaved,
  };
  whoamiCache = res;
  whoamiCacheTime = now;
  return res;
}

/**
 * Env overlays for the active profile (used by runner/server).
 */
export function getRuntimeEnv() {
  const runtime = readJson(path.join(ACCOUNTS_DIR, "runtime.env.json"), {});
  const env = {};
  if (runtime.GEMINI_API_KEY) env.GEMINI_API_KEY = runtime.GEMINI_API_KEY;
  if (runtime.AGY_ACCOUNT) env.AGY_ACCOUNT = runtime.AGY_ACCOUNT;
  return env;
}

export function applyActiveProfileEnv(baseEnv = process.env) {
  return { ...baseEnv, ...getRuntimeEnv() };
}

