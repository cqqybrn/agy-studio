import { spawnSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { whoami, getActive, listProfiles } from "./accounts.js";
import { readJson, writeJson, resolveAgyBinary, extractOauthClientFromBinary } from "./utils.js";
import { proxyFetch } from "./httpProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const ACCOUNTS_DIR = path.join(ROOT, "accounts");
const WINCRED_PS1 = path.join(ROOT, "scripts", "wincred.ps1");
const CACHE_PATH = path.join(ACCOUNTS_DIR, "usage-cache.json");
const LOCAL_USAGE_PATH = path.join(ACCOUNTS_DIR, "local-usage.json");

const TOKEN_URL = "https://oauth2.googleapis.com/token";
const QUOTA_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:retrieveUserQuotaSummary";
const LOAD_CODE_ASSIST_URL =
  "https://daily-cloudcode-pa.googleapis.com/v1internal:loadCodeAssist";

const OAUTH_CLIENT_CACHE = path.join(ACCOUNTS_DIR, "oauth-client.json");

const OAUTH_CREDS = path.join(os.homedir(), ".gemini", "oauth_creds.json");
const AGY_OAUTH_FILE = path.join(
  os.homedir(),
  ".gemini",
  "antigravity-cli",
  "antigravity-oauth-token"
);

const memoryTokens = new Map(); // profileName -> { accessToken, expiresAtMs }
let oauthClientCache = null;


function resolveOauthClient() {
  if (oauthClientCache) return oauthClientCache;

  const fromEnv = {
    client_id: process.env.AGY_OAUTH_CLIENT_ID,
    client_secret: process.env.AGY_OAUTH_CLIENT_SECRET,
  };
  if (fromEnv.client_id && fromEnv.client_secret) {
    oauthClientCache = fromEnv;
    return oauthClientCache;
  }

  const fromFile = readJson(OAUTH_CLIENT_CACHE, null);
  if (fromFile?.client_id && fromFile?.client_secret) {
    oauthClientCache = fromFile;
    return oauthClientCache;
  }

  const exe = resolveAgyBinary();
  if (exe) {
    const extracted = extractOauthClientFromBinary(exe);
    if (extracted) {
      try {
        writeJson(OAUTH_CLIENT_CACHE, extracted);
      } catch {
        /* cache optional */
      }
      oauthClientCache = extracted;
      return oauthClientCache;
    }
  }

  throw new Error(
    "OAuth client missing — set AGY_OAUTH_CLIENT_ID / AGY_OAUTH_CLIENT_SECRET, or install agy so credentials can be read from the binary"
  );
}

function runWinCredRead() {
  const r = spawnSync(
    "powershell.exe",
    ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", WINCRED_PS1, "-Action", "read"],
    { encoding: "utf8", windowsHide: true }
  );
  if (r.status !== 0) return null;
  const lines = (r.stdout || "").split(/\r?\n/).filter((l) => l.trim().startsWith("{"));
  if (!lines.length) return null;
  try {
    return JSON.parse(lines[lines.length - 1]);
  } catch {
    return null;
  }
}

function parseCredentialBlob(blobB64) {
  if (!blobB64) return null;
  const buf = Buffer.from(blobB64, "base64");
  for (const enc of ["utf8", "utf16le"]) {
    let text = buf.toString(enc).replace(/\u0000/g, "").trim();
    if (!text) continue;
    const prefix = "go-keyring-base64:";
    if (text.startsWith(prefix)) {
      try {
        text = Buffer.from(text.slice(prefix.length), "base64").toString("utf8");
      } catch {
        continue;
      }
    }
    try {
      return JSON.parse(text.replace(/^\uFEFF/, ""));
    } catch {
      /* next */
    }
  }
  return null;
}

function normalizeTokenPayload(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.token && typeof raw.token === "object") {
    return {
      access_token: raw.token.access_token,
      refresh_token: raw.token.refresh_token,
      expiry: raw.token.expiry || raw.token.expires_at || null,
    };
  }
  if (raw.access_token || raw.refresh_token) {
    let expiry = null;
    if (raw.expiry_date) expiry = new Date(Number(raw.expiry_date)).toISOString();
    else if (raw.expiry) expiry = raw.expiry;
    return {
      access_token: raw.access_token,
      refresh_token: raw.refresh_token,
      expiry,
    };
  }
  return null;
}

function loadStoredToken() {
  const cred = runWinCredRead();
  if (cred?.blobB64) {
    const parsed = normalizeTokenPayload(parseCredentialBlob(cred.blobB64));
    if (parsed?.access_token || parsed?.refresh_token) return parsed;
  }
  for (const p of [AGY_OAUTH_FILE, OAUTH_CREDS]) {
    const parsed = normalizeTokenPayload(readJson(p, null));
    if (parsed?.access_token || parsed?.refresh_token) return parsed;
  }
  return null;
}


async function refreshAccessToken(refreshToken) {
  const { client_id, client_secret } = resolveOauthClient();
  const body = new URLSearchParams({
    client_id,
    client_secret,
    refresh_token: refreshToken,
    grant_type: "refresh_token",
  });
  const res = await proxyFetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) {
    const t = await res.text().catch(() => "");
    throw new Error(`token refresh failed: ${res.status} ${t.slice(0, 200)}`);
  }
  const data = await res.json();
  return {
    accessToken: data.access_token,
    expiresAtMs: Date.now() + Number(data.expires_in || 3600) * 1000,
  };
}

export function invalidateUsageCache(name = null) {
  if (name) {
    memoryTokens.delete(name);
    try {
      const p = path.join(ACCOUNTS_DIR, name, "quota-cache.json");
      if (fs.existsSync(p)) fs.unlinkSync(p);
      const u = path.join(ACCOUNTS_DIR, name, "usage-cache.json");
      if (fs.existsSync(u)) fs.unlinkSync(u);
    } catch {}
  } else {
    memoryTokens.clear();
    try {
      if (fs.existsSync(CACHE_PATH)) fs.unlinkSync(CACHE_PATH);
    } catch {}
  }
}

async function resolveAccessToken(profileName = null) {
  const name = profileName || getActive() || "__live__";
  const mem = memoryTokens.get(name);
  if (mem && Date.now() < mem.expiresAtMs - 60_000) {
    return mem.accessToken;
  }

  let stored = null;
  if (profileName) {
    const credsPath = path.join(ACCOUNTS_DIR, profileName, "oauth_creds.json");
    if (fs.existsSync(credsPath)) {
      stored = normalizeTokenPayload(readJson(credsPath, null));
    }
    if (!stored) {
      const wincredPath = path.join(ACCOUNTS_DIR, profileName, "wincred.b64");
      if (fs.existsSync(wincredPath)) {
        try {
          const b64 = fs.readFileSync(wincredPath, "utf8").trim();
          stored = normalizeTokenPayload(parseCredentialBlob(b64));
        } catch {}
      }
    }
  }

  if (!stored) {
    stored = loadStoredToken();
  }
  if (!stored) throw new Error("no OAuth token found — login with agy first");

  if (stored.expiry) {
    const expMs = Date.parse(stored.expiry);
    if (stored.access_token && Number.isFinite(expMs) && expMs - Date.now() > 60_000) {
      memoryTokens.set(name, { accessToken: stored.access_token, expiresAtMs: expMs });
      return stored.access_token;
    }
  }

  if (stored.refresh_token) {
    const refreshed = await refreshAccessToken(stored.refresh_token);
    memoryTokens.set(name, refreshed);
    return refreshed.accessToken;
  }
  if (stored.access_token) return stored.access_token;
  throw new Error("OAuth token unusable");
}

async function postCloudCode(url, accessToken, body) {
  const res = await proxyFetch(url, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": `antigravity/1.2.11 ${process.platform}/${process.arch}`,
    },
    body: JSON.stringify(body ?? {}),
  });
  const text = await res.text();
  let json = null;
  try {
    json = text ? JSON.parse(text) : null;
  } catch {
    json = null;
  }
  if (!res.ok) {
    const err = new Error(`Cloud Code ${res.status}: ${text.slice(0, 300) || res.statusText}`);
    err.status = res.status;
    throw err;
  }
  return json;
}

function resetInSeconds(resetTime) {
  if (!resetTime) return null;
  const ms = Date.parse(resetTime);
  if (!Number.isFinite(ms)) return null;
  return Math.max(0, Math.floor((ms - Date.now()) / 1000));
}

function formatResetsIn(seconds) {
  if (seconds == null) return null;
  const minutes = Math.floor(seconds / 60);
  if (minutes >= 24 * 60) {
    const d = Math.floor(minutes / (24 * 60));
    const h = Math.floor((minutes % (24 * 60)) / 60);
    return h ? `${d}d ${h}h` : `${d}d`;
  }
  if (minutes >= 60) return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  return `${minutes}m`;
}

/**
 * Enrich official retrieveUserQuotaSummary payload for frontend,
 * preserving official displayName / bucketId / window 1:1.
 *
 * Official Models UI:
 *   Gemini Models
 *     Weekly Limit Remaining
 *     Five Hour Limit Remaining
 *   Claude and GPT models
 *     Weekly Limit Remaining
 *     Five Hour Limit Remaining
 *
 * Official statusline quota map keys: gemini-weekly, gemini-5h, 3p-weekly, 3p-5h
 */
function buildOfficialUsage(raw, { project, tier, account } = {}) {
  const groupsIn = Array.isArray(raw?.groups) ? raw.groups : [];
  const panelGroups = [];
  const quota = {}; // statusline shape
  const groupsCompat = []; // older camelCase helper

  for (const g of groupsIn) {
    const buckets = [];
    const compat = {
      id: null,
      name: g.displayName || null,
      description: g.description || null,
      models: [],
      weekly: null,
      five_hour: null,
      session: null,
    };

    const desc = g.description || "";
    const m = desc.match(/Models within this group:\s*(.+)$/i);
    if (m) {
      compat.models = m[1].split(",").map((s) => s.trim()).filter(Boolean);
    }
    const dn = String(g.displayName || "").toLowerCase();
    if (dn.includes("gemini")) compat.id = "gemini";
    else if (dn.includes("claude") || dn.includes("gpt")) compat.id = "claude_gpt";

    for (const b of g.buckets || []) {
      const frac =
        typeof b.remainingFraction === "number"
          ? b.remainingFraction
          : Number(b.remainingFraction);
      const remainingFraction = Number.isFinite(frac) ? frac : null;
      const rawPct =
        remainingFraction == null
          ? null
          : Math.round(Math.max(0, Math.min(1, remainingFraction)) * 1000) / 10;
      const disabled = Boolean(b.disabled);
      // If disabled (e.g. 5h limit disabled because weekly limit was reached), effective remaining percent is 0
      const remainingPercent = disabled ? 0 : rawPct;
      const usedPercent =
        remainingPercent == null ? null : Math.round((100 - remainingPercent) * 10) / 10;
      const resetTime = b.resetTime || null;
      const reset_in_seconds = resetInSeconds(resetTime);

      const enriched = {
        // --- official fields (unchanged names) ---
        bucketId: b.bucketId,
        displayName: b.displayName, // "Weekly Limit Remaining" | "Five Hour Limit Remaining"
        window: b.window, // "weekly" | "5h"
        resetTime,
        description: b.description || null,
        remainingFraction,
        disabled,
        // --- frontend helpers (additive) ---
        remainingPercent,
        rawRemainingPercent: rawPct,
        usedPercent,
        reset_in_seconds,
        resetsIn: formatResetsIn(reset_in_seconds),
      };
      buckets.push(enriched);

      if (b.bucketId) {
        quota[b.bucketId] = {
          remaining_fraction: remainingFraction,
          reset_time: resetTime,
          reset_in_seconds,
          display_name: b.displayName,
          window: b.window,
          disabled,
        };
      }

      if (b.window === "weekly" || String(b.bucketId || "").includes("weekly")) {
        compat.weekly = enriched;
      }
      if (b.window === "5h" || String(b.bucketId || "").endsWith("-5h")) {
        compat.five_hour = enriched;
        compat.session = enriched; // alias
      }
    }

    panelGroups.push({
      displayName: g.displayName, // "Gemini Models" | "Claude and GPT models"
      description: g.description || null,
      buckets,
    });
    groupsCompat.push(compat);
  }

  const planTier =
    tier?.currentTier?.name ||
    tier?.currentTier?.id ||
    tier?.paidTier?.[0]?.name ||
    null;

  return {
    ok: true,
    // Official /usage panel (Models docs + CLI /usage)
    panel: {
      title: "Model Quotas",
      description: raw?.description || null,
      groups: panelGroups,
    },
    // Official statusline `quota` map
    // https://www.antigravity.google/docs/cli/statusline
    quota,
    // Identity (statusline fields)
    email: account?.email || null,
    plan_tier: planTier,
    project: project || null,
    product: "antigravity",
    // Compat for earlier frontend draft
    groups: groupsCompat,
    raw: {
      groups: groupsIn,
      description: raw?.description || null,
    },
  };
}

export function recordLocalUsage({ model, usage, conversationId, account } = {}) {
  if (!usage) return;
  const store = readJson(LOCAL_USAGE_PATH, {
    total: {
      input_tokens: 0,
      output_tokens: 0,
      thinking_tokens: 0,
      cache_read_tokens: 0,
      total_tokens: 0,
      requests: 0,
    },
    byDay: {},
    recent: [],
  });
  const day = new Date().toISOString().slice(0, 10);
  const add = (obj) => {
    obj.input_tokens = (obj.input_tokens || 0) + (usage.input_tokens || 0);
    obj.output_tokens = (obj.output_tokens || 0) + (usage.output_tokens || 0);
    obj.thinking_tokens = (obj.thinking_tokens || 0) + (usage.thinking_tokens || 0);
    obj.cache_read_tokens =
      (obj.cache_read_tokens || 0) + (usage.cache_read_tokens || 0);
    obj.total_tokens = (obj.total_tokens || 0) + (usage.total_tokens || 0);
    obj.requests = (obj.requests || 0) + 1;
  };
  add(store.total);
  store.byDay[day] = store.byDay[day] || {
    input_tokens: 0,
    output_tokens: 0,
    thinking_tokens: 0,
    cache_read_tokens: 0,
    total_tokens: 0,
    requests: 0,
  };
  add(store.byDay[day]);
  store.recent.unshift({
    at: new Date().toISOString(),
    model: model || null,
    account: account || null,
    conversation_id: conversationId || null,
    usage,
  });
  store.recent = store.recent.slice(0, 50);
  writeJson(LOCAL_USAGE_PATH, store);
  return store;
}

export function getLocalUsage() {
  const store = readJson(LOCAL_USAGE_PATH, null);
  if (!store) {
    return {
      total: {
        input_tokens: 0,
        output_tokens: 0,
        thinking_tokens: 0,
        cache_read_tokens: 0,
        total_tokens: 0,
        requests: 0,
      },
      today: null,
      recent: [],
    };
  }
  const day = new Date().toISOString().slice(0, 10);
  return {
    total: store.total,
    today: store.byDay?.[day] || null,
    byDay: store.byDay || {},
    recent: store.recent || [],
  };
}

export async function fetchQuota({ force = false, maxAgeMs = 60_000 } = {}) {
  let account = null;
  try {
    account = whoami();
  } catch {
    account = null;
  }
  const activeName = account?.activeProfile || getActive();

  if (
    account?.accountType === "apikey" ||
    (activeName && readJson(path.join(ACCOUNTS_DIR, activeName, "meta.json"), {})?.type === "apikey")
  ) {
    return {
      ok: true,
      is_apikey: true,
      panel: {
        title: "Gemini API Key",
        description: "当前处于 Gemini API Key 模式，不消耗 Google Cloud Code 个人周配额。",
        groups: [],
      },
      quota: {},
      email: null,
      plan_tier: "API Key",
      project: null,
      product: "antigravity",
      groups: [],
      fetchedAt: new Date().toISOString(),
      cached: false,
      account,
      local: getLocalUsage(),
      credits: {
        note: "API Key 模式下由 Google AI Studio 直接计费",
        balance: null,
        available: false,
      },
    };
  }

  const cachePath = activeName ? path.join(ACCOUNTS_DIR, activeName, "usage-cache.json") : CACHE_PATH;
  const cached = readJson(cachePath, null);
  if (!force && cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) {
    return { ...cached, cached: true };
  }

  const accessToken = await resolveAccessToken(activeName);

  let tier = null;
  let project = null;
  try {
    tier = await postCloudCode(LOAD_CODE_ASSIST_URL, accessToken, {
      metadata: { ideType: "ANTIGRAVITY" },
    });
    project = tier?.cloudaicompanionProject || null;
  } catch {
    /* optional */
  }

  let raw = null;
  let lastErr = null;
  for (const body of project ? [{ project }, {}] : [{}]) {
    try {
      raw = await postCloudCode(QUOTA_URL, accessToken, body);
      if (raw) break;
    } catch (err) {
      lastErr = err;
    }
  }
  if (!raw) {
    if (cached) return { ...cached, cached: true, stale: true, error: lastErr?.message };
    throw lastErr || new Error("quota fetch failed");
  }

  const shaped = buildOfficialUsage(raw, { project, tier, account });
  const result = {
    ...shaped,
    fetchedAt: new Date().toISOString(),
    cached: false,
    account,
    local: getLocalUsage(),
    credits: {
      note: "AI Credits are separate from Model Quotas (see official /credits). Baseline quotas above are /usage.",
      balance: null,
      available: false,
    },
  };
  try {
    writeJson(cachePath, result);
    writeJson(CACHE_PATH, result);
  } catch {}
  return result;
}

export async function fetchAccountQuota(name, { force = false, maxAgeMs = 60_000 } = {}) {
  const profileDir = path.join(ACCOUNTS_DIR, name);
  const cacheFile = path.join(profileDir, "quota-cache.json");
  const meta = readJson(path.join(profileDir, "meta.json"), {});

  if (meta.type === "apikey") {
    return {
      name,
      type: "apikey",
      is_apikey: true,
      email: null,
      geminiWeekly: null,
      claudeWeekly: null,
      gemini5h: null,
      claude5h: null,
      planTier: "API Key",
      fetchedAt: new Date().toISOString(),
      error: null,
    };
  }

  if (!force && fs.existsSync(cacheFile)) {
    const cached = readJson(cacheFile, null);
    if (cached?.fetchedAt && Date.now() - Date.parse(cached.fetchedAt) < maxAgeMs) {
      return { ...cached, cached: true };
    }
  }

  let accessToken = null;
  try {
    accessToken = await resolveAccessToken(name);
  } catch (err) {
    return {
      name,
      type: "oauth",
      email: meta.email || null,
      geminiWeekly: null,
      claudeWeekly: null,
      gemini5h: null,
      claude5h: null,
      error: err.message,
      fetchedAt: new Date().toISOString(),
    };
  }

  let raw = null;
  try {
    raw = await postCloudCode(QUOTA_URL, accessToken, {});
  } catch (err) {
    // If token was rejected, drop from memory cache and try refreshing once
    memoryTokens.delete(name);
    try {
      accessToken = await resolveAccessToken(name);
      raw = await postCloudCode(QUOTA_URL, accessToken, {});
    } catch (retryErr) {
      return {
        name,
        type: "oauth",
        email: meta.email || null,
        geminiWeekly: null,
        claudeWeekly: null,
        gemini5h: null,
        claude5h: null,
        error: retryErr.message,
        fetchedAt: new Date().toISOString(),
      };
    }
  }

  let geminiWeekly = null;
  let claudeWeekly = null;
  let gemini5h = null;
  let claude5h = null;

  for (const g of raw?.groups || []) {
    const isGemini = /gemini/i.test(g.displayName || "");
    const is3p = /claude|gpt/i.test(g.displayName || "");
    for (const b of g.buckets || []) {
      const isW = /weekly/i.test(b.window || b.bucketId || "");
      const is5 = /5h/i.test(b.window || b.bucketId || "") || /five/i.test(b.displayName || "");
      const frac = typeof b.remainingFraction === "number" ? b.remainingFraction : Number(b.remainingFraction);
      const rawPct = Number.isFinite(frac) ? Math.round(Math.max(0, Math.min(1, frac)) * 1000) / 10 : null;
      const disabled = Boolean(b.disabled);
      const remainingPercent = disabled ? 0 : rawPct;
      const usedPercent = remainingPercent == null ? null : Math.round((100 - remainingPercent) * 10) / 10;
      const resetSecs = resetInSeconds(b.resetTime);
      const bucketSummary = {
        bucketId: b.bucketId,
        displayName: b.displayName,
        window: b.window,
        disabled,
        remainingPercent,
        usedPercent,
        rawRemainingPercent: rawPct,
        resetTime: b.resetTime,
        resetsIn: formatResetsIn(resetSecs),
        description: b.description || null,
      };

      if (isGemini && isW) geminiWeekly = bucketSummary;
      if (isGemini && is5) gemini5h = bucketSummary;
      if (is3p && isW) claudeWeekly = bucketSummary;
      if (is3p && is5) claude5h = bucketSummary;
    }
  }

  let email = meta.email || null;
  if (!email) {
    const credsPath = path.join(profileDir, "oauth_creds.json");
    if (fs.existsSync(credsPath)) {
      const creds = readJson(credsPath, {});
      if (creds.id_token) {
        try {
          const payload = JSON.parse(Buffer.from(creds.id_token.split(".")[1], "base64").toString("utf8"));
          email = payload.email || null;
        } catch {}
      }
    }
  }

  const result = {
    name,
    type: "oauth",
    email,
    geminiWeekly,
    claudeWeekly,
    gemini5h,
    claude5h,
    fetchedAt: new Date().toISOString(),
    error: null,
  };

  try {
    writeJson(cacheFile, result);
  } catch {}

  return result;
}

export async function fetchAllAccountsQuotas({ force = false } = {}) {
  const profiles = listProfiles();
  const results = await Promise.allSettled(
    profiles.map((p) => fetchAccountQuota(p.name, { force }))
  );
  const quotas = {};
  for (let i = 0; i < profiles.length; i++) {
    const name = profiles[i].name;
    const res = results[i];
    if (res.status === "fulfilled") {
      quotas[name] = res.value;
    } else {
      quotas[name] = {
        name,
        error: res.reason?.message || "配额获取失败",
        fetchedAt: new Date().toISOString(),
      };
    }
  }
  return { ok: true, quotas };
}

export async function getUsage(opts = {}) {
  return fetchQuota(opts);
}
