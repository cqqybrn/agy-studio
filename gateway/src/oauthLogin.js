import crypto from "node:crypto";
import { spawn, spawnSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  saveAccount,
  syncLiveOAuthFilesFromWinCred,
  whoami,
  listProfiles,
  decodeJwtEmail,
  suggestProfileName,
  invalidateWhoamiCache,
} from "./accounts.js";
import { readJson, writeJson, resolveAgyBinary, extractOauthClientFromBinary } from "./utils.js";
import { proxyFetch } from "./httpProxy.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, "..");
const WINCRED_PS1 = path.join(ROOT, "scripts", "wincred.ps1");
const OAUTH_CLIENT_CACHE = path.join(ROOT, "accounts", "oauth-client.json");

const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
/** Official Antigravity redirect — shows a code page (no localhost loopback registered). */
const REDIRECT_URI = "https://antigravity.google/oauth-callback";

const SCOPES = [
  "https://www.googleapis.com/auth/cloud-platform",
  "https://www.googleapis.com/auth/userinfo.email",
  "https://www.googleapis.com/auth/userinfo.profile",
  "https://www.googleapis.com/auth/cclog",
  "https://www.googleapis.com/auth/experimentsandconfigs",
  "openid",
].join(" ");

/**
 * @typedef {object} OAuthSession
 * @property {string} verifier
 * @property {string} challenge
 * @property {number} createdAt
 * @property {string|null} beforeEmail
 * @property {string} status
 * @property {string|null} error
 * @property {object|null} result
 * @property {string|null} authUrl
 */

/** @type {Map<string, OAuthSession>} */
const pending = new Map();

function resolveOauthClient() {
  const fromEnv = {
    client_id: process.env.AGY_OAUTH_CLIENT_ID,
    client_secret: process.env.AGY_OAUTH_CLIENT_SECRET,
  };
  if (fromEnv.client_id && fromEnv.client_secret) return fromEnv;

  const fromFile = readJson(OAUTH_CLIENT_CACHE, null);
  if (
    fromFile?.client_id &&
    fromFile?.client_secret &&
    /^GOCSPX-[A-Za-z0-9_-]{28}$/.test(fromFile.client_secret)
  ) {
    return fromFile;
  }

  const exe = resolveAgyBinary();
  if (exe) {
    const extracted = extractOauthClientFromBinary(exe);
    if (extracted) {
      try {
        writeJson(OAUTH_CLIENT_CACHE, extracted);
      } catch {
        /* optional */
      }
      return extracted;
    }
  }
  throw new Error("无法解析 Antigravity OAuth client，请确认已安装 agy");
}

function b64url(buf) {
  return Buffer.from(buf)
    .toString("base64")
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/g, "");
}

function makePkce() {
  const verifier = b64url(crypto.randomBytes(32));
  const challenge = b64url(crypto.createHash("sha256").update(verifier).digest());
  return { verifier, challenge };
}

function openSystemBrowser(url) {
  if (process.platform === "win32") {
    const safeUrl = String(url).replace(/'/g, "''");
    spawn(
      "powershell.exe",
      ["-NoProfile", "-NonInteractive", "-Command", `Start-Process '${safeUrl}'`],
      { detached: true, stdio: "ignore", windowsHide: true }
    ).unref();
  } else if (process.platform === "darwin") {
    spawn("open", [url], { detached: true, stdio: "ignore" }).unref();
  } else {
    spawn("xdg-open", [url], { detached: true, stdio: "ignore" }).unref();
  }
}

function writeWinCredBlob(blobB64, username = "antigravity") {
  const r = spawnSync(
    "powershell.exe",
    [
      "-NoProfile",
      "-ExecutionPolicy",
      "Bypass",
      "-File",
      WINCRED_PS1,
      "-Action",
      "write",
      "-BlobBase64",
      blobB64,
      "-UserName",
      username,
    ],
    { encoding: "utf8", windowsHide: true, maxBuffer: 10 * 1024 * 1024 }
  );
  if (r.status !== 0) {
    throw new Error((r.stderr || r.stdout || "CredWrite failed").trim());
  }
}

function purgeStalePending() {
  const now = Date.now();
  for (const [k, v] of pending) {
    if (now - v.createdAt > 15 * 60 * 1000) {
      pending.delete(k);
    }
  }
}

function snapshotCurrentIfNeeded({ saveCurrentAs, skipSaveCurrent }) {
  const before = whoami();
  let savedCurrent = null;
  if (!skipSaveCurrent && before.wincredExists) {
    const email = before.email;
    const profiles = listProfiles();
    const already = email
      ? profiles.some((p) => p.email && p.email.toLowerCase() === String(email).toLowerCase())
      : Boolean(before.activeProfile);
    if (!already || saveCurrentAs) {
      const name =
        (saveCurrentAs && String(saveCurrentAs).trim()) ||
        (email ? String(email).split("@")[0].replace(/[^\w.+-]+/g, "_") : null) ||
        before.activeProfile ||
        "default";
      try {
        savedCurrent = saveAccount(name);
      } catch (err) {
        savedCurrent = { error: err.message, attemptedName: name };
      }
    } else {
      savedCurrent = { skipped: true, reason: "already_saved", email };
    }
  }
  return { before, savedCurrent };
}

/**
 * Extract clean OAuth authorization code from text (raw code, full callback URL, or copied page snippet).
 */
export function extractCodeFromText(text) {
  if (!text) return null;
  const str = String(text).trim();

  // 1) URL with code query param: ?code=... or &code=... or #code=...
  const urlParamMatch = str.match(/[?&#]code=([^&#\s]+)/i);
  if (urlParamMatch?.[1]) {
    try {
      return decodeURIComponent(urlParamMatch[1]).trim();
    } catch {
      return urlParamMatch[1].trim();
    }
  }

  // 2) Callback URL without scheme or full URL
  if (/oauth-callback/i.test(str)) {
    try {
      const raw = /^(https?:)?\/\//i.test(str) ? str : `https://${str.replace(/^\/+/, "")}`;
      const u = new URL(raw);
      const code = u.searchParams.get("code");
      if (code) return code.trim();
    } catch {
      /* ignore */
    }
  }

  // 3) Explicit code patterns: e.g. "Paste this code...", "4/0A..."
  const labeled =
    str.match(/Paste this code[\s\S]{0,120}?((?:4\/|1\/)[0-9A-Za-z\-_]{20,})/i) ||
    str.match(/authorization code[:\s]+([A-Za-z0-9_/\-.+]{20,})/i) ||
    str.match(/授权码[:\s：]+([A-Za-z0-9_/\-.+]{20,})/i);
  if (labeled?.[1]) return labeled[1].replace(/[.,;]+$/, "").trim();

  // 4) Google auth code starting with 4/ or 1/
  const googleMatch = str.match(/\b([41]\/[0-9A-Za-z\-_]{20,})\b/);
  if (googleMatch?.[1]) return googleMatch[1].trim();

  // 5) Clean standalone code token (at least 20 chars, no http prefix, valid base64/url chars)
  const cleaned = str.replace(/\s+/g, "");
  if (cleaned.length >= 20 && !/^https?:\/\//i.test(cleaned) && /^[A-Za-z0-9_/\-.+=]+$/.test(cleaned)) {
    return cleaned;
  }

  return null;
}

/**
 * Start browser OAuth flow: generates PKCE pair and authorization URL.
 * Automatically snapshots current account and opens browser if open is true.
 */
export function startBrowserOAuth({
  saveCurrentAs,
  skipSaveCurrent = false,
  open = true,
} = {}) {
  purgeStalePending();

  const { client_id } = resolveOauthClient();
  const { verifier, challenge } = makePkce();
  const state = b64url(crypto.randomBytes(16));

  const url = new URL(AUTH_URL);
  url.searchParams.set("access_type", "offline");
  url.searchParams.set("client_id", client_id);
  url.searchParams.set("code_challenge", challenge);
  url.searchParams.set("code_challenge_method", "S256");
  url.searchParams.set("prompt", "select_account consent");
  url.searchParams.set("redirect_uri", REDIRECT_URI);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("scope", SCOPES);
  url.searchParams.set("state", state);

  /** @type {OAuthSession} */
  const session = {
    verifier,
    challenge,
    createdAt: Date.now(),
    beforeEmail: null,
    status: "waiting_code",
    error: null,
    result: null,
    authUrl: url.toString(),
  };
  pending.set(state, session);

  // Snapshot current account
  try {
    const { before } = snapshotCurrentIfNeeded({ saveCurrentAs, skipSaveCurrent });
    session.beforeEmail = before?.email || null;
  } catch {
    /* ignore */
  }

  // Open browser window if requested
  if (open) {
    try {
      openSystemBrowser(url.toString());
    } catch {
      /* ignore */
    }
  }

  return {
    ok: true,
    state,
    authUrl: url.toString(),
    redirectUri: REDIRECT_URI,
    hint: "请在打开的页面登录授权，并复制返回的授权码粘贴回此处提交。",
  };
}

export function getOAuthStatus(state) {
  purgeStalePending();
  const session = state ? pending.get(state) : null;
  if (!session) {
    return { ok: false, status: "missing", error: "会话不存在或已结束" };
  }
  return {
    ok: true,
    state,
    status: session.status,
    error: session.error || null,
    result: session.result,
    beforeEmail: session.beforeEmail,
  };
}

function buildCredBlobFromTokenResponse(data) {
  const expiry = new Date(Date.now() + Number(data.expires_in || 3600) * 1000).toISOString();
  return {
    token: {
      access_token: data.access_token,
      token_type: data.token_type || "Bearer",
      refresh_token: data.refresh_token,
      expiry,
    },
    auth_method: "consumer",
    id_token: data.id_token || null,
  };
}

/**
 * Exchange authorization code and save as a named profile.
 */
export async function finishBrowserOAuth({ state, code, name } = {}) {
  if (!code || typeof code !== "string") {
    throw Object.assign(new Error("请先输入或粘贴授权码"), { code: "BAD_REQUEST" });
  }
  const extracted = extractCodeFromText(code);
  const cleaned = (extracted || code).trim().replace(/\s+/g, "");
  if (!cleaned) throw Object.assign(new Error("授权码为空，请重新粘贴"), { code: "BAD_REQUEST" });

  purgeStalePending();
  let session = state ? pending.get(state) : null;
  let sessionKey = state;
  if (!session && pending.size === 1) {
    sessionKey = [...pending.keys()][0];
    session = pending.get(sessionKey);
  }
  if (!session) {
    throw Object.assign(new Error("登录会话已过期或不存在，请重新点击「添加账号」"), {
      code: "SESSION_EXPIRED",
    });
  }

  const { client_id, client_secret } = resolveOauthClient();
  const body = new URLSearchParams({
    client_id,
    client_secret,
    code: cleaned,
    code_verifier: session.verifier,
    grant_type: "authorization_code",
    redirect_uri: REDIRECT_URI,
  });

  let res;
  let raw = "";
  try {
    res = await proxyFetch(TOKEN_URL, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: body.toString(),
      timeoutMs: 30000,
    });
    raw = await res.text();
  } catch (netErr) {
    throw Object.assign(new Error(`连接 Google 换票服务器失败：${netErr.message}，请检查网络或系统代理 (127.0.0.1:10809)`), {
      code: "NETWORK_ERROR",
    });
  }

  if (!res.ok) {
    let detail = "";
    try {
      const errJson = JSON.parse(raw);
      detail = errJson.error_description || errJson.error || "";
    } catch {
      detail = raw.slice(0, 200);
    }

    let userHint = `换取 Token 失败 (HTTP ${res.status})`;
    if (detail) userHint += `：${detail}`;
    if (raw.includes("invalid_grant")) {
      userHint += "。提示：授权码是一次性的且有效期较短，已失效或已被使用；请重新点击「添加账号」打开授权页并复制最新的授权码。";
    }
    throw Object.assign(new Error(userHint), {
      code: "TOKEN_EXCHANGE_FAILED",
    });
  }

  let data;
  try {
    data = JSON.parse(raw);
  } catch {
    throw Object.assign(new Error("Google Token 响应格式异常"), {
      code: "TOKEN_PARSE_FAILED",
    });
  }

  if (!data.access_token) {
    throw Object.assign(new Error("Google 响应中未包含 access_token"), {
      code: "TOKEN_EXCHANGE_FAILED",
    });
  }

  const blobObj = buildCredBlobFromTokenResponse(data);
  const blobB64 = Buffer.from(JSON.stringify(blobObj), "utf8").toString("base64");
  writeWinCredBlob(blobB64);
  syncLiveOAuthFilesFromWinCred();
  invalidateWhoamiCache();

  const emailFromToken = decodeJwtEmail(data.id_token);
  const w = whoami(true);
  const effectiveEmail = emailFromToken || w.email;

  const existingWithSameEmail = effectiveEmail
    ? listProfiles().find((p) => p.email && p.email.toLowerCase() === effectiveEmail.toLowerCase())
    : null;
  const profileName =
    (name && String(name).trim()) ||
    (existingWithSameEmail ? existingWithSameEmail.name : null) ||
    suggestProfileName(effectiveEmail) ||
    (effectiveEmail ? effectiveEmail.split("@")[0] : "account");

  const saved = saveAccount(profileName);
  session.status = "done";
  session.result = { ok: true, ...saved };

  // Remove used session
  pending.delete(sessionKey);

  return {
    ok: true,
    ...saved,
    hint: "已成功写入凭据并保存档案，可直接切换使用。",
  };
}

export function getOAuthHint() {
  return {
    redirectUri: REDIRECT_URI,
    note: "在浏览器中登录授权后，复制页面上的授权码并粘贴回此处提交。",
  };
}
