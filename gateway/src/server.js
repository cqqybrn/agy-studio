#!/usr/bin/env node
import http from "node:http";
import { URL } from "node:url";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  extractPromptFromOpenAIMessages,
  resolveAgyBinary,
  runAgy,
  runAgyStream,
  abortRun,
  listActiveRuns,
  listAgents,
  readTranscript,
  deleteConversationArtifacts,
  listOnDiskConversations,
} from "./agyRunner.js";
import {
  listProfiles,
  saveAccount,
  switchAccount,
  removeAccount,
  clearLiveAuth,
  beginAddAccount,
  startCliLogin,
  whoami,
} from "./accounts.js";
import { startBrowserOAuth, finishBrowserOAuth, getOAuthHint, getOAuthStatus } from "./oauthLogin.js";
import {
  getPrefs,
  listModels,
  resolveDefaultModel,
  resolveDefaultAgent,
  setPrefs,
} from "./models.js";
import { getUsage, recordLocalUsage, fetchAllAccountsQuotas, invalidateUsageCache } from "./usage.js";
import { ensureGlobalRules } from "./ensureGlobalRules.js";
const PORT = Number(process.env.PORT || 8787);
const HOST = process.env.HOST || "127.0.0.1";
const API_KEY = process.env.AGY_API_KEY || "";
const DEFAULT_CWD = process.env.AGY_CWD || process.cwd();

const WEB_DIR = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "web");
const MIME = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
};

const SSE_HEADERS = {
  "Content-Type": "text/event-stream; charset=utf-8",
  "Cache-Control": "no-cache, no-transform",
  Connection: "keep-alive",
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
  "X-Accel-Buffering": "no",
};

// Stream runs outlive their SSE connection: a page refresh re-attaches via
// GET /v1/agent/stream/<run_id>?after=<seq> instead of killing agy.
const STREAM_BUFFER_MAX = 5000;
const STREAM_KEEP_MS = 15 * 60 * 1000;
const streamRuns = new Map();

function writeSse(res, event, data) {
  if (res.writableEnded || res.destroyed) return;
  if (event) res.write(`event: ${event}\n`);
  res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function publishRunEvent(run, event, data) {
  const payload = { ...data, seq: ++run.seq, ts: Date.now() };
  const { raw, ...slim } = payload;
  run.events.push({ event, data: slim });
  if (run.events.length > STREAM_BUFFER_MAX) run.events.splice(0, run.events.length - STREAM_BUFFER_MAX);
  for (const c of run.clients) writeSse(c, event, payload);
}

function closeStreamRun(run) {
  run.done = true;
  for (const c of run.clients) if (!c.writableEnded) c.end();
  run.clients.clear();
  setTimeout(() => streamRuns.delete(run.id), STREAM_KEEP_MS).unref?.();
}

setInterval(() => {
  for (const run of streamRuns.values()) {
    for (const c of run.clients) if (!c.writableEnded && !c.destroyed) c.write(": ping\n\n");
  }
}, 25000).unref?.();

const UPLOAD_MAX_BYTES = 25 * 1024 * 1024;
const UPLOAD_ALLOWED_EXT = new Set([
  ".jpg", ".jpeg", ".png", ".gif", ".webp", ".bmp", ".svg",
  ".md", ".markdown", ".txt", ".log", ".csv", ".json", ".xml", ".html", ".htm",
  ".pdf", ".doc", ".docx", ".xls", ".xlsx", ".rtf", ".yaml", ".yml",
]);

function safeUploadName(name) {
  const base = path.basename(String(name || "file")).replace(/[^\w.\u4e00-\u9fff()\-+\[\]]+/g, "_");
  return (base || "file").slice(0, 120);
}

function saveUpload({ filename, contentBase64, cwd, mime } = {}) {
  if (!contentBase64 || typeof contentBase64 !== "string") {
    return { ok: false, error: "content_base64 required" };
  }
  const raw = contentBase64.replace(/^data:[^;]+;base64,/, "");
  let buf;
  try {
    buf = Buffer.from(raw, "base64");
  } catch {
    return { ok: false, error: "invalid base64" };
  }
  if (!buf.length) return { ok: false, error: "empty file" };
  if (buf.length > UPLOAD_MAX_BYTES) return { ok: false, error: `file too large (max ${UPLOAD_MAX_BYTES} bytes)` };

  const safe = safeUploadName(filename);
  const ext = path.extname(safe).toLowerCase();
  if (!UPLOAD_ALLOWED_EXT.has(ext)) {
    return { ok: false, error: `unsupported file type: ${ext || "(none)"}` };
  }

  const root = path.resolve(cwd || DEFAULT_CWD);
  const dir = path.join(root, ".agy-uploads");
  fs.mkdirSync(dir, { recursive: true });
  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const outName = `${stamp}_${safe}`;
  const outPath = path.join(dir, outName);
  fs.writeFileSync(outPath, buf);
  return {
    ok: true,
    path: outPath,
    name: safe,
    size: buf.length,
    mime: mime || null,
    ext,
  };
}

function tryServeStatic(req, res, pathname) {
  if (req.method !== "GET") return false;
  const rel = pathname === "/" || pathname === "" ? "/index.html" : pathname;
  const filePath = path.normalize(path.join(WEB_DIR, rel));
  if (!filePath.startsWith(WEB_DIR) || !fs.existsSync(filePath) || !fs.statSync(filePath).isFile()) {
    return false;
  }
  const ext = path.extname(filePath).toLowerCase();
  const body = fs.readFileSync(filePath);
  res.writeHead(200, {
    "Content-Type": MIME[ext] || "application/octet-stream",
    "Access-Control-Allow-Origin": "*",
    "Cache-Control": "no-store, no-cache, must-revalidate, max-age=0",
    "Pragma": "no-cache",
    "Expires": "0",
    "Content-Length": body.length,
  });
  res.end(body);
  return true;
}

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    "Content-Type": "application/json; charset=utf-8",
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Headers": "Content-Type, Authorization, x-api-key",
    "Access-Control-Allow-Methods": "GET, POST, PUT, DELETE, OPTIONS",
    "Content-Length": Buffer.byteLength(data),
  });
  res.end(data);
}

/** Safe wrapper — never throws; returns null on error. */
function safeWhoamiEmail() {
  try {
    return whoami()?.email || null;
  } catch {
    return null;
  }
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    req.on("data", (c) => chunks.push(c));
    req.on("end", () => {
      const raw = Buffer.concat(chunks).toString("utf8");
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch (err) {
        reject(Object.assign(new Error("Invalid JSON body"), { cause: err }));
      }
    });
    req.on("error", reject);
  });
}

function authOk(req) {
  if (!API_KEY) return true;
  const h = req.headers.authorization || "";
  const key = h.startsWith("Bearer ") ? h.slice(7) : req.headers["x-api-key"];
  return key === API_KEY;
}

function bad(msg) {
  return Object.assign(new Error(msg), { code: "BAD_REQUEST" });
}

function listWindowsDrives() {
  const drives = [];
  for (let i = 65; i <= 90; i++) {
    const letter = String.fromCharCode(i);
    const root = `${letter}:\\`;
    try {
      if (fs.existsSync(root)) drives.push({ name: `${letter}:`, path: root, isDir: true });
    } catch {
      /* skip inaccessible */
    }
  }
  return drives;
}

/** Local folder browser for picking project cwd (Cursor / Antigravity style). */
function listFsDir(dir) {
  const home = os.homedir();
  const roots =
    process.platform === "win32"
      ? listWindowsDrives()
      : [{ name: "/", path: "/", isDir: true }];

  const raw = dir == null ? "" : String(dir).trim();
  if (!raw || raw === ":roots") {
    return { path: null, parent: null, home, roots, entries: roots, atRoots: true };
  }

  let resolved;
  try {
    resolved = path.resolve(raw);
  } catch {
    throw Object.assign(new Error("invalid path"), { code: "BAD_PATH", status: 400 });
  }
  if (!fs.existsSync(resolved)) {
    throw Object.assign(new Error("path not found"), { code: "NOT_FOUND", status: 404 });
  }
  let st;
  try {
    st = fs.statSync(resolved);
  } catch (err) {
    throw Object.assign(new Error(err.message || "cannot stat"), { code: "READ_DENIED", status: 403 });
  }
  if (!st.isDirectory()) {
    throw Object.assign(new Error("not a directory"), { code: "NOT_DIR", status: 400 });
  }

  let entries = [];
  try {
    entries = fs
      .readdirSync(resolved, { withFileTypes: true })
      .filter((e) => {
        try {
          return e.isDirectory();
        } catch {
          return false;
        }
      })
      .map((e) => ({
        name: e.name,
        path: path.join(resolved, e.name),
        isDir: true,
      }))
      .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: "base" }));
  } catch (err) {
    throw Object.assign(new Error(err.message || "cannot read directory"), {
      code: "READ_DENIED",
      status: 403,
    });
  }

  const parent = path.dirname(resolved);
  return {
    path: resolved,
    parent: parent !== resolved ? parent : null,
    home,
    roots,
    entries,
    atRoots: false,
  };
}

const CHAT_NO_TOOLS_PREFIX =
  "[Plain chat completion request] Do not call any tools, do not read or write files, do not run commands. " +
  "Answer directly in text, following the output format requested below exactly.";

function openaiChatResponse({ id, model, content, usage }) {
  return {
    id: id || `chatcmpl-agy-${Date.now()}`,
    object: "chat.completion",
    created: Math.floor(Date.now() / 1000),
    model: model || "antigravity",
    choices: [
      {
        index: 0,
        message: { role: "assistant", content: content || "" },
        finish_reason: "stop",
      },
    ],
    usage: {
      prompt_tokens: usage?.input_tokens ?? 0,
      completion_tokens: usage?.output_tokens ?? 0,
      total_tokens: usage?.total_tokens ?? 0,
    },
  };
}

const server = http.createServer(async (req, res) => {
  const url = new URL(req.url || "/", `http://${HOST}:${PORT}`);

  if (req.method === "OPTIONS") {
    return sendJson(res, 204, {});
  }

  // Static frontend (web/) — everything except API/health routes
  if (
    req.method === "GET" &&
    url.pathname !== "/health" &&
    !url.pathname.startsWith("/v1/") &&
    tryServeStatic(req, res, url.pathname)
  ) {
    return;
  }

  if (req.method === "GET" && (url.pathname === "/health" || url.pathname === "/")) {
    let account = null;
    try {
      account = whoami();
    } catch {
      account = null;
    }
    return sendJson(res, 200, {
      ok: true,
      service: "antigravity-gemini-armour-break",
      version: "1.4.0",
      capabilities: {
        autoApprove: true,
        streaming: true,
        subagents: true,
        parallelAgent: true,
        transcripts: true,
        thinking: {
          main_stream: false,
          subagent_transcript: true,
          thinking_tokens_usage: true,
          note: "CLI headless has no separate thought channel; subagent transcript.jsonl may include thinking text. Official SDK/IDE expose thoughts.",
        },
        credits: false,
        abort: true,
      },
      agy: resolveAgyBinary(),
      autoApprove: true,
      flag: "--dangerously-skip-permissions",
      mode: process.env.AGY_MODE || "accept-edits",
      defaultAgent: resolveDefaultAgent(getPrefs().defaultAgent),
      cwd: DEFAULT_CWD,
      prefs: getPrefs(),
      account,
    });
  }

  // Public-ish model list still respects API key if configured
  if (req.method === "GET" && url.pathname === "/v1/models") {
    if (!authOk(req)) return sendJson(res, 401, { error: { message: "Unauthorized" } });
    try {
      const data = listModels();
      const prefs = getPrefs();
      return sendJson(res, 200, {
        object: "list",
        default_model: prefs.defaultModel,
        default_agent: resolveDefaultAgent(prefs.defaultAgent),
        data,
      });
    } catch (err) {
      return sendJson(res, 500, { error: { message: err.message, code: "MODELS_FAILED" } });
    }
  }

  if (!authOk(req)) {
    return sendJson(res, 401, { error: { message: "Unauthorized" } });
  }

  try {
    // ---- prefs / default model ----
    if (req.method === "GET" && url.pathname === "/v1/prefs") {
      return sendJson(res, 200, getPrefs());
    }

    // ---- usage / quota ----
    if (req.method === "GET" && url.pathname === "/v1/usage") {
      const force = url.searchParams.get("refresh") === "1" ||
        url.searchParams.get("force") === "1";
      const usage = await getUsage({ force });
      return sendJson(res, 200, usage);
    }

    if (req.method === "PUT" && url.pathname === "/v1/prefs") {
      const body = await readBody(req);
      const prefs = setPrefs({
        defaultModel: body.defaultModel ?? body.default_model ?? undefined,
        defaultEffort: body.defaultEffort ?? body.default_effort ?? undefined,
        defaultCwd: body.defaultCwd ?? body.default_cwd ?? undefined,
        defaultAgent: body.defaultAgent ?? body.default_agent ?? undefined,
      });
      return sendJson(res, 200, { ok: true, prefs });
    }

    // ---- accounts ----
    if (req.method === "GET" && url.pathname === "/v1/accounts") {
      return sendJson(res, 200, { accounts: listProfiles(), whoami: whoami() });
    }

    if (req.method === "GET" && url.pathname === "/v1/accounts/quotas") {
      const force =
        url.searchParams.get("refresh") === "1" ||
        url.searchParams.get("force") === "1";
      const data = await fetchAllAccountsQuotas({ force });
      return sendJson(res, 200, data);
    }

    if (req.method === "GET" && url.pathname === "/v1/accounts/whoami") {
      return sendJson(res, 200, whoami());
    }

    if (req.method === "POST" && url.pathname === "/v1/accounts/save") {
      const body = await readBody(req);
      if (!body.name) throw bad("name required");
      if (body.type === "apikey" || body.api_key || body.apiKey) {
        const r = saveAccount(body.name, {
          asApiKey: true,
          apiKey: body.api_key || body.apiKey,
          note: body.note,
        });
        switchAccount(body.name);
        return sendJson(res, 200, { ok: true, ...r });
      }
      const r = saveAccount(body.name, { note: body.note });
      return sendJson(res, 200, { ok: true, ...r });
    }

    // One-click browser OAuth (preferred): open Google → paste code in WebUI
    if (req.method === "POST" && url.pathname === "/v1/accounts/oauth/start") {
      const body = await readBody(req).catch(() => ({}));
      const r = startBrowserOAuth({
        saveCurrentAs: body.saveCurrentAs || body.save_current_as,
        skipSaveCurrent: Boolean(body.skipSaveCurrent || body.skip_save_current),
        open: body.open !== false,
        auto: body.auto !== false,
      });
      return sendJson(res, 200, r);
    }

    if (req.method === "POST" && url.pathname === "/v1/accounts/oauth/finish") {
      const body = await readBody(req);
      const r = await finishBrowserOAuth({
        state: body.state,
        code: body.code,
        name: body.name,
      });
      return sendJson(res, 200, r);
    }

    if (req.method === "GET" && url.pathname === "/v1/accounts/oauth/hint") {
      return sendJson(res, 200, getOAuthHint());
    }

    if (req.method === "GET" && url.pathname === "/v1/accounts/oauth/status") {
      const state = url.searchParams.get("state") || "";
      return sendJson(res, 200, getOAuthStatus(state));
    }

    // Legacy: snapshot current → clear → open interactive agy (may require paste into CLI)
    if (req.method === "POST" && url.pathname === "/v1/accounts/add") {
      const body = await readBody(req).catch(() => ({}));
      // Prefer browser OAuth unless client asks for CLI
      if (body.cli === true || body.mode === "cli") {
        const r = beginAddAccount({
          saveCurrentAs: body.saveCurrentAs || body.save_current_as,
          skipSaveCurrent: Boolean(body.skipSaveCurrent || body.skip_save_current),
        });
        return sendJson(res, 200, r);
      }
      const r = startBrowserOAuth({
        saveCurrentAs: body.saveCurrentAs || body.save_current_as,
        skipSaveCurrent: Boolean(body.skipSaveCurrent || body.skip_save_current),
        open: body.open !== false,
      });
      return sendJson(res, 200, { ...r, mode: "browser" });
    }

    // Re-open CLI login without clearing (if user closed the window)
    if (req.method === "POST" && url.pathname === "/v1/accounts/login") {
      return sendJson(res, 200, { ok: true, ...startCliLogin() });
    }

    if (req.method === "POST" && url.pathname === "/v1/accounts/switch") {
      const body = await readBody(req);
      if (!body.name) throw bad("name required");
      const result = switchAccount(body.name);
      invalidateUsageCache();
      return sendJson(res, 200, { ok: true, ...result });
    }

    if (req.method === "POST" && url.pathname === "/v1/accounts/clear-live") {
      return sendJson(res, 200, { ok: true, ...clearLiveAuth() });
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/v1/accounts/")) {
      const name = decodeURIComponent(url.pathname.slice("/v1/accounts/".length));
      if (!name) throw bad("name required");
      if (name.includes("/") || name === "oauth" || name.startsWith("oauth")) {
        // avoid clashing with /v1/accounts/oauth/* ; also block junk names
        if (name.includes("/")) throw bad("invalid account name");
      }
      const r = removeAccount(name);
      invalidateUsageCache(name);
      return sendJson(res, 200, { ok: true, ...r });
    }

    // ---- agents / transcripts / runs ----
    if (req.method === "GET" && url.pathname === "/v1/agents") {
      const prefs = getPrefs();
      const cwd = url.searchParams.get("cwd") || prefs.defaultCwd || DEFAULT_CWD;
      return sendJson(res, 200, { agents: listAgents(cwd) });
    }

    if (req.method === "GET" && url.pathname === "/v1/runs") {
      return sendJson(res, 200, { runs: listActiveRuns() });
    }

    if (req.method === "POST" && url.pathname === "/v1/agent/abort") {
      const body = await readBody(req);
      const runId = body.run_id || body.runId;
      if (!runId) throw bad("run_id required");
      return sendJson(res, 200, abortRun(runId));
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/transcripts/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/transcripts/".length));
      if (!id) throw bad("conversation id required");
      const limit = Number(url.searchParams.get("limit") || 500);
      const includeThinking = url.searchParams.get("thinking") !== "0";
      const tail = url.searchParams.get("tail") === "1";
      const data = await readTranscript(id, { limit, includeThinking, tail });
      return sendJson(res, data.ok ? 200 : 404, data);
    }

    if (req.method === "GET" && url.pathname === "/v1/conversations") {
      const limit = Number(url.searchParams.get("limit") || 60);
      return sendJson(res, 200, { conversations: listOnDiskConversations({ limit }) });
    }

    // Purge brain/ + conversations/*.db residuals (and discovered subagent ids)
    if (req.method === "POST" && url.pathname === "/v1/conversations/purge") {
      const body = await readBody(req);
      const ids = body.conversation_ids || body.ids || body.conversation_id || body.conversationId;
      const list = Array.isArray(ids) ? ids : ids ? [ids] : [];
      if (!list.length) throw bad("conversation_ids required");
      return sendJson(res, 200, deleteConversationArtifacts(list));
    }

    if (req.method === "DELETE" && url.pathname.startsWith("/v1/conversations/")) {
      const id = decodeURIComponent(url.pathname.slice("/v1/conversations/".length));
      if (!id) throw bad("conversation id required");
      return sendJson(res, 200, deleteConversationArtifacts([id]));
    }

    // Browse local folders (for project picker)
    if (req.method === "GET" && url.pathname === "/v1/fs/list") {
      const dir = url.searchParams.get("path") || url.searchParams.get("dir") || "";
      try {
        return sendJson(res, 200, listFsDir(dir));
      } catch (err) {
        const status = err.status || 500;
        return sendJson(res, status, { error: { message: err.message, code: err.code || "FS_ERROR" } });
      }
    }

    // Upload attachments for chat (saved under cwd/.agy-uploads/)
    if (req.method === "POST" && url.pathname === "/v1/uploads") {
      const body = await readBody(req);
      const prefs = getPrefs();
      const cwd = body.cwd || prefs.defaultCwd || DEFAULT_CWD;
      const result = saveUpload({
        filename: body.filename || body.name,
        contentBase64: body.content_base64 || body.contentBase64 || body.data,
        cwd,
        mime: body.mime || body.content_type,
      });
      if (!result.ok) throw Object.assign(new Error(result.error || "upload failed"), { code: "BAD_REQUEST" });
      return sendJson(res, 200, result);
    }

    if (req.method === "GET" && url.pathname === "/v1/capabilities") {
      return sendJson(res, 200, {
        service: "antigravity-gemini-armour-break",
        version: "1.4.0",
        official_parity: {
          model_quotas_panel: true,
          model_selector: true,
          account_switch: "extended (multi-profile)",
          auto_approve: "forced via --dangerously-skip-permissions",
          streaming_steps: true,
          subagent_events: true,
          subagent_thinking_via_transcript: true,
          parallel_agent_default: "built-in default agent (same as desktop)",
          main_agent_thinking_stream: false,
          ai_credits_balance: false,
          interactive_agents_panel_kill: "partial (abort whole run only)",
        },
        endpoints: [
          "GET /health",
          "GET /v1/models",
          "GET|PUT /v1/prefs",
          "GET /v1/usage",
          "GET /v1/accounts",
          "POST /v1/accounts/save|switch|clear-live|add|login|oauth/start|oauth/finish",
          "GET /v1/accounts/oauth/hint|status",
          "DELETE /v1/accounts/:name",
          "GET /v1/agents",
          "GET /v1/runs",
          "POST /v1/agent",
          "POST /v1/agent/stream",
          "GET /v1/agent/stream/:run_id?after=:seq",
          "POST /v1/agent/abort",
          "GET /v1/transcripts/:id",
          "POST /v1/conversations/purge",
          "DELETE /v1/conversations/:id",
          "POST /v1/uploads",
          "GET /v1/fs/list",
          "POST /v1/chat/completions",
          "GET /v1/capabilities",
        ],
      });
    }

    // ---- agent run ----
    if (req.method === "POST" && url.pathname === "/v1/agent") {
      const body = await readBody(req);
      const prompt = body.prompt || body.input || body.message;
      if (!prompt) throw bad("prompt required");
      const model = resolveDefaultModel(body.model);
      const prefs = getPrefs();
      const agent = resolveDefaultAgent(body.agent);
      const result = await runAgy({
        prompt,
        cwd: body.cwd || prefs.defaultCwd || DEFAULT_CWD,
        model,
        effort: body.effort || prefs.defaultEffort,
        agent,
        conversationId: body.conversation_id || body.conversationId,
        continueLast: Boolean(body.continue),
        outputFormat: body.output_format || "json",
        printTimeout: body.print_timeout,
        timeoutMs: body.timeout_ms,
        mode: body.mode,
        extraArgs: body.extra_args,
      });
      try {
        recordLocalUsage({
          model,
          usage: result.usage,
          conversationId: result.conversationId,
          account: safeWhoamiEmail(),
        });
      } catch {
        /* ignore local analytics errors */
      }
      return sendJson(res, 200, {
        ok: true,
        response: result.response ?? result.stdout,
        conversation_id: result.conversationId,
        status: result.status,
        usage: result.usage,
        model: model || null,
        run_id: result.runId,
        permission_mode: result.permissionMode,
        stderr: result.stderr || undefined,
      });
    }

    // ---- SSE streaming agent (text / tool / subagent) ----
    if (req.method === "POST" && url.pathname === "/v1/agent/stream") {
      const body = await readBody(req);
      const prompt = body.prompt || body.input || body.message;
      if (!prompt) throw bad("prompt required");
      const model = resolveDefaultModel(body.model);
      const prefs = getPrefs();
      const agent = resolveDefaultAgent(body.agent);
      const runId =
        body.run_id ||
        `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;

      res.writeHead(200, SSE_HEADERS);

      const run = { id: runId, events: [], seq: 0, clients: new Set([res]), done: false };
      streamRuns.set(runId, run);
      res.on("close", () => run.clients.delete(res));
      const sendEvent = (event, data) => publishRunEvent(run, event, data);

      try {
        const summary = await runAgyStream(
          {
            runId,
            prompt,
            cwd: body.cwd || prefs.defaultCwd || DEFAULT_CWD,
            model,
            effort: body.effort || prefs.defaultEffort,
            agent,
            conversationId: body.conversation_id || body.conversationId,
            continueLast: Boolean(body.continue),
            printTimeout: body.print_timeout,
            timeoutMs: body.timeout_ms,
            mode: body.mode,
            extraArgs: body.extra_args,
          },
          (evt) => sendEvent(evt.type || "message", evt)
        );

        try {
          recordLocalUsage({
            model,
            usage: summary.usage,
            conversationId: summary.conversationId,
            account: (() => {
              try {
                return whoami()?.email || null;
              } catch {
                return null;
              }
            })(),
          });
        } catch {
          /* ignore */
        }

        sendEvent("done", {
          ok: true,
          run_id: summary.runId,
          conversation_id: summary.conversationId,
          status: summary.status,
          response: summary.response,
          usage: summary.usage,
          subagents: summary.subagents,
          model: model || null,
        });
      } catch (err) {
        sendEvent("error", {
          message: err.message,
          code: err.code || "INTERNAL",
          result: err.result
            ? {
                conversation_id: err.result.conversationId,
                status: err.result.status,
                response: err.result.response,
                usage: err.result.usage,
                subagents: err.result.subagents,
                stderr: err.result.stderr?.slice?.(0, 2000),
              }
            : undefined,
        });
      } finally {
        closeStreamRun(run);
      }
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/v1/agent/stream/")) {
      const runId = decodeURIComponent(url.pathname.slice("/v1/agent/stream/".length));
      const run = streamRuns.get(runId);
      if (!run) return sendJson(res, 404, { ok: false, error: "run not found", run_id: runId });
      const after = Number(url.searchParams.get("after") || 0);
      res.writeHead(200, SSE_HEADERS);
      writeSse(res, "reattached", { run_id: runId, done: run.done, latest_seq: run.seq });
      for (const e of run.events) if (e.data.seq > after) writeSse(res, e.event, e.data);
      if (run.done) {
        res.end();
        return;
      }
      run.clients.add(res);
      res.on("close", () => run.clients.delete(res));
      return;
    }

    if (
      req.method === "POST" &&
      (url.pathname === "/v1/chat/completions" || url.pathname === "/chat/completions")
    ) {
      const body = await readBody(req);
      let prompt =
        body.prompt || extractPromptFromOpenAIMessages(body.messages || []);
      if (!prompt) throw bad("messages or prompt required");
      if (body.no_tools ?? body.metadata?.no_tools ?? true) {
        prompt = `${CHAT_NO_TOOLS_PREFIX}\n\n${prompt}`;
      }
      const model = resolveDefaultModel(body.model);
      const prefs = getPrefs();
      const agent = resolveDefaultAgent(body.agent || body.metadata?.agent);
      const runId = `chat_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      const id = `chatcmpl-agy-${Date.now()}`;
      const created = Math.floor(Date.now() / 1000);
      const modelName = model || body.model || "antigravity";
      const stream = Boolean(body.stream);
      let streamed = "";
      const chunk = (delta, finish = null) =>
        `data: ${JSON.stringify({
          id,
          object: "chat.completion.chunk",
          created,
          model: modelName,
          choices: [{ index: 0, delta, finish_reason: finish }],
        })}\n\n`;
      if (stream) {
        res.writeHead(200, SSE_HEADERS);
        res.write(chunk({ role: "assistant", content: "" }));
      }
      let finished = false;
      res.on("close", () => {
        if (!finished) abortRun(runId);
      });
      const ping = stream ? setInterval(() => res.write(": ping\n\n"), 15000) : null;
      let summary;
      try {
        summary = await runAgyStream(
          {
            prompt,
            runId,
            stdinPrompt: true,
            cwd: body.cwd || body.metadata?.cwd || prefs.defaultCwd || DEFAULT_CWD,
            model,
            effort: body.effort || body.metadata?.effort || prefs.defaultEffort,
            agent,
            conversationId: body.conversation_id || body.metadata?.conversation_id,
            continueLast: Boolean(body.continue || body.metadata?.continue),
            printTimeout: body.print_timeout,
            timeoutMs: body.timeout_ms,
            mode: body.mode || body.metadata?.mode,
          },
          (evt) => {
            if (!stream || evt.type !== "text_delta" || !evt.text_delta) return;
            streamed += evt.text_delta;
            res.write(chunk({ content: evt.text_delta }));
          }
        );
      } catch (err) {
        finished = true;
        if (ping) clearInterval(ping);
        if (!stream) throw err;
        res.write(`data: ${JSON.stringify({ error: { message: err.message, code: err.code || "AGY_ERROR" } })}\n\n`);
        return res.end();
      }
      finished = true;
      if (ping) clearInterval(ping);
      try {
        recordLocalUsage({ model, usage: summary.usage, conversationId: summary.conversationId });
      } catch {
        /* ignore */
      }
      const content = summary.response ?? streamed;
      if (summary.status === "ERROR" && !content) {
        const message = summary.stderr?.trim().slice(0, 500) || "agy returned an error";
        if (!stream) return sendJson(res, 502, { error: { message, code: "AGY_ERROR" } });
        res.write(`data: ${JSON.stringify({ error: { message, code: "AGY_ERROR" } })}\n\n`);
        return res.end();
      }
      if (!stream) {
        return sendJson(res, 200, openaiChatResponse({ id, model: modelName, content, usage: summary.usage }));
      }
      if (content && content.length > streamed.length && content.startsWith(streamed)) {
        res.write(chunk({ content: content.slice(streamed.length) }));
      } else if (!streamed && content) {
        res.write(chunk({ content }));
      }
      res.write(chunk({}, "stop"));
      res.write("data: [DONE]\n\n");
      return res.end();
    }

    sendJson(res, 404, { error: { message: `Not found: ${url.pathname}` } });
  } catch (err) {
    const status =
      err.code === "AGY_TIMEOUT" ? 504 : err.code === "BAD_REQUEST" ? 400 : 500;
    sendJson(res, status, {
      error: {
        message: err.message,
        code: err.code || "INTERNAL",
        result: err.result
          ? {
              stderr: err.result.stderr,
              stdout: err.result.stdout?.slice?.(0, 2000),
              status: err.result.status,
              code: err.result.code,
            }
          : undefined,
      },
    });
  }
});

server.listen(PORT, HOST, () => {
  try {
    const rules = ensureGlobalRules();
    console.log(`[agy-auto] global rule: ${rules.path}${rules.updated ? " (updated)" : ""}`);
  } catch (err) {
    console.warn(`[agy-auto] failed to install global rule: ${err.message}`);
  }
  console.log(`[agy-auto] listening on http://${HOST}:${PORT}`);
  console.log(`[agy-auto] agy binary: ${resolveAgyBinary()}`);
  console.log(`[agy-auto] auto-approve: --dangerously-skip-permissions`);
  console.log(`[agy-auto] mode: ${process.env.AGY_MODE || "accept-edits"}`);
  console.log(`[agy-auto] default agent: ${resolveDefaultAgent(getPrefs().defaultAgent) || "(built-in)"}`);
  console.log(`[agy-auto] default cwd: ${DEFAULT_CWD}`);
  try {
    console.log(`[agy-auto] account: ${JSON.stringify(whoami())}`);
  } catch {
    /* ignore */
  }
  if (API_KEY) console.log(`[agy-auto] API key auth enabled`);
  else console.log(`[agy-auto] API key auth disabled (set AGY_API_KEY to enable)`);
  if (process.env.AGY_WSL_LISTEN !== "0") startWslListener();
});

/**
 * Extra listener on the Hyper-V "vEthernet (WSL)" address so WSL programs can call the
 * chat API (agy launched from WSL interop cannot read the Windows credential store).
 * Only WSL-subnet clients and the chat/models endpoints are allowed; the LAN never sees it.
 */
const WSL_PATHS = new Set(["/health", "/v1/models", "/v1/chat/completions", "/chat/completions"]);
let wslServer = null;
let wslBound = null;

function findWslInterface() {
  for (const [name, addrs] of Object.entries(os.networkInterfaces())) {
    if (!/wsl/i.test(name)) continue;
    const a = (addrs || []).find((x) => x.family === "IPv4" && !x.internal);
    if (a) return a;
  }
  return null;
}

const ipToInt = (ip) => ip.split(".").reduce((n, p) => (n << 8) + Number(p), 0) >>> 0;

function startWslListener() {
  const check = () => {
    const iface = findWslInterface();
    if ((iface?.address || null) === wslBound) return;
    if (wslServer) {
      wslServer.close();
      wslServer = null;
      wslBound = null;
    }
    if (!iface) return;
    const mask = ipToInt(iface.netmask);
    const net = ipToInt(iface.address) & mask;
    const handler = server.listeners("request")[0];
    const s = http.createServer((req, res) => {
      const remote = String(req.socket.remoteAddress || "").replace(/^::ffff:/, "");
      const pathname = new URL(req.url || "/", "http://wsl").pathname;
      if (!/^\d+\.\d+\.\d+\.\d+$/.test(remote) || (ipToInt(remote) & mask) !== net || !WSL_PATHS.has(pathname)) {
        res.writeHead(403, { "Content-Type": "application/json" });
        return res.end(JSON.stringify({ error: { message: "forbidden" } }));
      }
      handler(req, res);
    });
    s.on("error", (err) => console.log(`[agy-auto] WSL listener error: ${err.message}`));
    s.listen(PORT, iface.address, () => {
      wslServer = s;
      wslBound = iface.address;
      console.log(`[agy-auto] WSL listener on http://${iface.address}:${PORT} (chat API only, WSL subnet only)`);
    });
  };
  check();
  setInterval(check, 60_000).unref();
}
