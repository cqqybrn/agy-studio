import { spawn } from "node:child_process";
import { existsSync, createReadStream } from "node:fs";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import readline from "node:readline";
import { applyActiveProfileEnv } from "./accounts.js";
import { resolveAgyBinary as _resolveAgyBinaryShared, envWithAgyPath } from "./utils.js";

const DEFAULT_TIMEOUT_MS = Number(process.env.AGY_TIMEOUT_MS || 0);

/** @type {Map<string, { child: import('node:child_process').ChildProcess, startedAt: number }>} */
export const activeRuns = new Map();

export function resolveAgyBinary() {
  return _resolveAgyBinaryShared();
}

export function buildAgyArgs({
  prompt,
  cwd,
  model,
  effort,
  agent,
  conversationId,
  continueLast = false,
  outputFormat = "json",
  printTimeout,
  mode,
  extraArgs = [],
  stdinPrompt = false,
} = {}) {
  if (!prompt || !String(prompt).trim()) {
    throw new Error("prompt is required");
  }

  const args = stdinPrompt
    ? ["--input-format", "stream-json", "--dangerously-skip-permissions", "--output-format", "stream-json"]
    : ["--print", String(prompt), "--dangerously-skip-permissions", "--output-format", outputFormat];

  // accept-edits matches IDE “just do the edits” flow; still needs skip-permissions in print mode
  const execMode = mode || process.env.AGY_MODE || "accept-edits";
  if (execMode && execMode !== "off") {
    args.push("--mode", String(execMode));
  }

  if (model) args.push("--model", String(model));
  if (effort) args.push("--effort", String(effort));
  if (agent) args.push("--agent", String(agent));
  if (conversationId) args.push("--conversation", String(conversationId));
  if (continueLast) args.push("--continue");
  if (printTimeout != null && printTimeout !== "") {
    args.push("--print-timeout", String(printTimeout));
  }
  if (Array.isArray(extraArgs) && extraArgs.length) {
    args.push(...extraArgs.map(String));
  }

  return { args, cwd: cwd || process.cwd() };
}

function spawnAgy(options) {
  const bin = resolveAgyBinary();
  const { args, cwd } = buildAgyArgs(options);
  const env = applyActiveProfileEnv(process.env);
  const child = spawn(bin, args, {
    cwd,
    env: envWithAgyPath(env, path.dirname(bin)),
    windowsHide: true,
  });
  // Windows caps command lines at ~32K chars, so long prompts go through stdin as a stream-json "user" event.
  if (options.stdinPrompt) {
    child.stdin.on("error", () => {});
    child.stdin.end(JSON.stringify({ event: "user", message: { content: String(options.prompt) } }) + "\n", "utf8");
  }
  return { bin, args, cwd, child };
}

export function runAgy(options = {}) {
  const { bin, args, cwd, child } = spawnAgy(options);
  const timeoutMs =
    options.timeoutMs != null ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;
  const runId = options.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const entry = { child, startedAt: Date.now(), abortReason: null };
  activeRuns.set(runId, entry);

  return new Promise((resolve, reject) => {
    let stdout = "";
    let stderr = "";
    let killed = false;

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            killed = true;
            entry.abortReason = entry.abortReason || "timeout";
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {
                /* ignore */
              }
            }, 3000);
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString("utf8");
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString("utf8");
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      activeRuns.delete(runId);
      reject(
        Object.assign(new Error(`Failed to start agy: ${err.message}`), {
          code: "AGY_SPAWN_ERROR",
          bin,
          args,
          stderr,
          runId,
        })
      );
    });

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      activeRuns.delete(runId);

      let parsed = null;
      if (options.outputFormat === "json" || options.outputFormat == null) {
        const trimmed = stdout.trim();
        if (trimmed) {
          try {
            parsed = JSON.parse(trimmed);
          } catch {
            /* keep raw */
          }
        }
      }

      const wasAborted = entry.abortReason === "client" || entry.abortReason === "timeout" || killed;
      const result = {
        ok: code === 0 && !wasAborted,
        code,
        signal,
        killed: wasAborted,
        bin,
        args,
        cwd,
        stdout,
        stderr,
        parsed,
        runId,
        response:
          parsed?.response ??
          (options.outputFormat === "text" ? stdout.trim() : null),
        conversationId: parsed?.conversation_id ?? null,
        status: parsed?.status ?? null,
        usage: parsed?.usage ?? null,
        permissionMode: "always-proceed (--dangerously-skip-permissions)",
        host: os.hostname(),
      };

      if (wasAborted) {
        reject(
          Object.assign(
            new Error(
              entry.abortReason === "client"
                ? "run aborted by client"
                : `agy timed out after ${timeoutMs}ms`
            ),
            {
              code: entry.abortReason === "client" ? "AGY_ABORTED" : "AGY_TIMEOUT",
              result,
            }
          )
        );
        return;
      }

      if (code !== 0) {
        reject(
          Object.assign(
            new Error(
              `agy exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`
            ),
            { code: "AGY_EXIT", result }
          )
        );
        return;
      }

      resolve(result);
    });
  });
}

function isToolOutputText(text) {
  if (typeof text !== "string") return false;
  const t = text.trim();
  return (
    (t.startsWith("Created At:") &&
      (t.includes("The command exited with code") ||
        t.includes("Output:") ||
        t.includes("Completed At:"))) ||
    t.startsWith("Tool is running as a background task") ||
    t.startsWith("The following is a <SYSTEM_MESSAGE>")
  );
}

/**
 * Normalize agy stream-json events into frontend-friendly SSE payloads.
 */
export function normalizeStreamEvent(raw) {
  if (!raw || typeof raw !== "object") return null;
  if (raw.event === "init") {
    return {
      type: "init",
      conversation_id: raw.conversation_id,
      permission_mode: raw.init?.permission_mode,
      cwd: raw.init?.cwd,
      tools: raw.init?.tools,
      model: raw.init?.model,
      agent: raw.init?.agent,
      raw,
    };
  }
  if (raw.event === "result") {
    const r = raw.result || {};
    return {
      type: "result",
      conversation_id: r.conversation_id,
      status: r.status,
      response: r.response,
      usage: r.usage,
      duration_seconds: r.duration_seconds,
      error: r.error,
      raw,
    };
  }
  if (raw.event === "thought" || raw.event === "thinking") {
    return {
      type: "thinking",
      text_delta: raw.thought || raw.thinking || raw.text_delta || "",
      thinking: raw.thought || raw.thinking || raw.text_delta || "",
      raw,
    };
  }
  if (raw.event === "step_update" && raw.step_update) {
    const s = raw.step_update;
    const st = String(s.step_type || s.type || "").toLowerCase();
    const respText = s.text_delta ?? s.content ?? s.response ?? s.text ?? null;
    const isToolOutput = isToolOutputText(respText);

    const base = {
      type: "step",
      step_type: st,
      state: s.state,
      step_index: s.step_index,
      conversation_id: s.conversation_id,
      duration_seconds: s.duration_seconds,
      usage: s.usage,
      thinking: s.thinking || s.thought || null,
      content: respText,
      text_delta: respText,
      raw,
    };

    if (st === "thought" || st === "thinking") {
      return {
        ...base,
        type: "thinking",
        text_delta: s.thinking || s.thought || s.text_delta || s.content || "",
        thinking: s.thinking || s.thought || s.text_delta || s.content || "",
      };
    }
    if (
      !isToolOutput &&
      (st === "agent_response" ||
        st === "planner_response" ||
        st === "model_response" ||
        st === "text" ||
        (!st && respText != null)) &&
      respText != null
    ) {
      return { ...base, type: "text_delta", text_delta: respText, content: respText };
    }
    if (
      s.tool_name === "invoke_subagent" ||
      s.tool_info?.name === "invoke_subagent" ||
      st === "subagent" ||
      s.subagent_info
    ) {
      const toolInfo = s.tool_info || {};
      const args = toolInfo.args || toolInfo.arguments || toolInfo.parameters || toolInfo.input || {};
      let subs = s.subagent_info?.subagents || [];
      if (!subs.length) {
        let rawSubs = args.Subagents || args.subagents || args.agents;
        if (typeof rawSubs === "string") {
          try {
            rawSubs = JSON.parse(rawSubs);
          } catch {}
        }
        if (Array.isArray(rawSubs)) {
          subs = rawSubs.map((sa) => ({
            type_name: sa.TypeName || sa.type_name || "self",
            role: sa.Role || sa.role || "subagent",
            initial_prompt: sa.Prompt || sa.prompt || null,
            conversation_id: sa.conversation_id || null,
            workspace_uris: sa.Workspace ? [sa.Workspace] : [],
          }));
        }
      }
      return {
        ...base,
        type: "subagent",
        tool_name: "invoke_subagent",
        tool_info: toolInfo,
        subagents: subs.map((sa) => ({
          type_name: sa.type_name,
          role: sa.role,
          initial_prompt: sa.initial_prompt,
          conversation_id: sa.conversation_id,
          log_uri: sa.log_uri,
          workspace_uris: sa.workspace_uris,
          transcript_id: sa.conversation_id || null,
        })),
        subagent_info: s.subagent_info || { subagents: subs },
      };
    }
    if (st === "tool" || s.tool_name || s.tool_info) {
      return {
        ...base,
        type: "tool",
        tool_name: s.tool_name || s.tool_info?.name || null,
        tool_info: s.tool_info || null,
      };
    }
    if (st === "system_message") {
      return { ...base, type: "system", text_delta: s.text_delta || s.content || null };
    }
    if (st === "error_message") {
      return {
        ...base,
        type: "error_message",
        text_delta: s.text_delta || s.content || null,
        message: s.text_delta || s.content || s.error || "error_message",
      };
    }
    return base;
  }
  return { type: "raw", raw };
}

/**
 * Run agy with stream-json; call onEvent for each normalized event.
 * Returns final result summary.
 */
export function runAgyStream(options = {}, onEvent) {
  const runId =
    options.runId || `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
  const streamOpts = { ...options, outputFormat: "stream-json", runId };
  const { bin, args, cwd, child } = spawnAgy(streamOpts);
  const timeoutMs =
    options.timeoutMs != null ? Number(options.timeoutMs) : DEFAULT_TIMEOUT_MS;

  const entry = { child, startedAt: Date.now(), abortReason: null };
  activeRuns.set(runId, entry);

  return new Promise((resolve, reject) => {
    let stderr = "";
    let buffer = "";
    let killed = false;
    let finalResult = null;
    let conversationId = null;
    const subagents = new Map(); // id -> meta

    const emit = (evt) => {
      if (!evt) return;
      if (evt.conversation_id) conversationId = evt.conversation_id;
      if (evt.type === "subagent" && Array.isArray(evt.subagents)) {
        for (const sa of evt.subagents) {
          if (sa.conversation_id) subagents.set(sa.conversation_id, sa);
        }
      }
      if (evt.type === "result") finalResult = evt;
      try {
        onEvent?.({ ...evt, run_id: runId });
      } catch {
        /* ignore listener errors */
      }
    };

    emit({
      type: "run_started",
      run_id: runId,
      model: options.model || null,
      cwd,
      permission_mode: "always-proceed (--dangerously-skip-permissions)",
    });

    const timer =
      timeoutMs > 0
        ? setTimeout(() => {
            killed = true;
            entry.abortReason = entry.abortReason || "timeout";
            try {
              child.kill("SIGTERM");
            } catch {
              /* ignore */
            }
            setTimeout(() => {
              try {
                child.kill("SIGKILL");
              } catch {
                /* ignore */
              }
            }, 3000);
          }, timeoutMs)
        : null;

    child.stdout.on("data", (chunk) => {
      buffer += chunk.toString("utf8");
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() || "";
      for (const line of lines) {
        const t = line.trim();
        if (!t) continue;
        try {
          emit(normalizeStreamEvent(JSON.parse(t)));
        } catch {
          emit({ type: "parse_error", line: t.slice(0, 500) });
        }
      }
    });

    child.stderr.on("data", (chunk) => {
      const text = chunk.toString("utf8");
      stderr += text;
      emit({ type: "stderr", text });
    });

    child.on("error", (err) => {
      if (timer) clearTimeout(timer);
      activeRuns.delete(runId);
      reject(
        Object.assign(new Error(`Failed to start agy: ${err.message}`), {
          code: "AGY_SPAWN_ERROR",
          runId,
          stderr,
        })
      );
    });

    child.on("close", (code, signal) => {
      if (timer) clearTimeout(timer);
      // flush remaining buffer
      if (buffer.trim()) {
        try {
          emit(normalizeStreamEvent(JSON.parse(buffer.trim())));
        } catch {
          /* ignore */
        }
      }
      activeRuns.delete(runId);

      const wasAborted = entry.abortReason === "client" || entry.abortReason === "timeout";
      const summary = {
        ok: code === 0 && !wasAborted,
        code,
        signal,
        killed: wasAborted,
        runId,
        bin,
        args,
        cwd,
        stderr,
        conversationId:
          conversationId || finalResult?.conversation_id || null,
        status: finalResult?.status || (wasAborted ? "ABORTED" : code === 0 ? "SUCCESS" : "ERROR"),
        response: finalResult?.response || null,
        usage: finalResult?.usage || null,
        subagents: [...subagents.values()],
        permissionMode: "always-proceed (--dangerously-skip-permissions)",
      };

      emit({ type: "run_finished", ...summary });

      if (wasAborted) {
        reject(
          Object.assign(
            new Error(
              entry.abortReason === "client"
                ? "run aborted by client"
                : `agy timed out after ${timeoutMs}ms`
            ),
            {
              code: entry.abortReason === "client" ? "AGY_ABORTED" : "AGY_TIMEOUT",
              result: summary,
            }
          )
        );
        return;
      }
      if (code !== 0) {
        reject(
          Object.assign(
            new Error(
              `agy exited with code ${code}${stderr ? `: ${stderr.trim().slice(0, 500)}` : ""}`
            ),
            { code: "AGY_EXIT", result: summary }
          )
        );
        return;
      }
      resolve(summary);
    });
  });
}

export function abortRun(runId) {
  const entry = activeRuns.get(runId);
  if (!entry) return { ok: false, error: "run not found" };
  entry.abortReason = "client";
  const pid = entry.child?.pid;
  try {
    entry.child.kill("SIGTERM");
  } catch (err) {
    // fall through to tree kill on Windows
    if (process.platform !== "win32") return { ok: false, error: err.message };
  }
  // Windows: SIGTERM often leaves agy child processes alive — kill the tree
  if (process.platform === "win32" && pid) {
    try {
      spawn("taskkill", ["/pid", String(pid), "/T", "/F"], {
        windowsHide: true,
        stdio: "ignore",
      });
    } catch {
      /* ignore */
    }
  } else {
    setTimeout(() => {
      try {
        entry.child.kill("SIGKILL");
      } catch {
        /* ignore */
      }
    }, 2000);
  }
  return { ok: true, run_id: runId };
}

export function listActiveRuns() {
  return [...activeRuns.entries()].map(([id, e]) => ({
    run_id: id,
    startedAt: e.startedAt,
    pid: e.child?.pid || null,
  }));
}

export function extractPromptFromOpenAIMessages(messages = []) {
  const parts = [];
  for (const m of messages) {
    if (!m) continue;
    const role = m.role || "user";
    let content = m.content;
    if (Array.isArray(content)) {
      content = content
        .map((c) => {
          if (typeof c === "string") return c;
          if (c?.type === "text") return c.text || "";
          return "";
        })
        .filter(Boolean)
        .join("\n");
    }
    if (content == null) continue;
    parts.push(`${role}: ${String(content)}`);
  }
  return parts.join("\n\n");
}

/** Resolve transcript.jsonl path from conversation id or file:// URI */
export function resolveTranscriptPath(idOrUri) {
  if (!idOrUri) return null;
  let id = String(idOrUri);
  if (id.startsWith("file:")) {
    try {
      const u = new URL(id);
      let p = decodeURIComponent(u.pathname);
      if (process.platform === "win32" && /^\/[A-Za-z]:/.test(p)) p = p.slice(1);
      return p.replace(/\//g, path.sep);
    } catch {
      return null;
    }
  }
  // strip .jsonl path leftovers
  if (id.includes("transcript.jsonl")) {
    return resolveTranscriptPath(`file:///${id.replace(/\\/g, "/")}`);
  }
  const candidates = [
    path.join(
      os.homedir(),
      ".gemini",
      "antigravity-cli",
      "brain",
      id,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    ),
    path.join(
      os.homedir(),
      ".gemini",
      "antigravity",
      "brain",
      id,
      ".system_generated",
      "logs",
      "transcript.jsonl"
    ),
  ];
  for (const c of candidates) {
    if (existsSync(c)) return c;
  }
  return candidates[0]; // default expected path
}

export async function readTranscript(idOrUri, { limit = 500, includeThinking = true, tail = false } = {}) {
  const filePath = resolveTranscriptPath(idOrUri);
  if (!filePath || !existsSync(filePath)) {
    return {
      ok: false,
      error: "transcript not found",
      path: filePath,
      steps: [],
    };
  }
  const steps = [];
  let total = 0;
  const rl = readline.createInterface({
    input: createReadStream(filePath, { encoding: "utf8" }),
    crlfDelay: Infinity,
  });
  for await (const line of rl) {
    const t = line.trim();
    if (!t) continue;
    try {
      const row = JSON.parse(t);
      const step = {
        step_index: row.step_index,
        source: row.source,
        type: row.type,
        status: row.status,
        created_at: row.created_at,
        content: row.content || null,
        error: row.error || null,
        tool_calls: row.tool_calls || null,
      };
      if (includeThinking) step.thinking = row.thinking || null;
      total++;
      steps.push(step);
      if (steps.length > limit) {
        if (!tail) {
          steps.pop();
          break;
        }
        steps.shift();
      }
    } catch {
      /* skip bad line */
    }
  }
  return {
    ok: true,
    path: filePath,
    total,
    conversation_id: path.basename(path.dirname(path.dirname(path.dirname(filePath)))),
    steps,
    note: "Subagent transcripts often include `thinking` text; main CLI stream-json does not expose a separate thought channel.",
  };
}

const CONV_ID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function isConversationId(id) {
  return CONV_ID_RE.test(String(id || ""));
}

function geminiRoots() {
  const home = os.homedir();
  return [
    path.join(home, ".gemini", "antigravity-cli"),
    path.join(home, ".gemini", "antigravity"),
  ];
}

/** Collect related conversation UUIDs (e.g. subagents) referenced in a transcript. */
function relatedIdsFromTranscript(primaryId) {
  const related = new Set();
  const filePath = resolveTranscriptPath(primaryId);
  if (!filePath || !existsSync(filePath)) return related;
  let text = "";
  try {
    text = fs.readFileSync(filePath, "utf8");
  } catch {
    return related;
  }
  const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi;
  for (const m of text.matchAll(re)) {
    const id = m[0];
    if (id.toLowerCase() !== String(primaryId).toLowerCase()) related.add(id);
  }
  return related;
}

function removePath(target) {
  if (!existsSync(target)) return false;
  const st = fs.statSync(target);
  if (st.isDirectory()) fs.rmSync(target, { recursive: true, force: true });
  else fs.unlinkSync(target);
  return true;
}

/** Delete brain/ + conversations/*.db* artifacts for one conversation id. */
function deleteOneConversationArtifacts(id) {
  const removed = [];
  const missing = [];
  for (const root of geminiRoots()) {
    const brain = path.join(root, "brain", id);
    if (removePath(brain)) removed.push(brain);
    else missing.push(brain);

    const convDir = path.join(root, "conversations");
    for (const name of [`${id}.db`, `${id}.db-shm`, `${id}.db-wal`]) {
      const f = path.join(convDir, name);
      if (removePath(f)) removed.push(f);
    }
  }
  return { id, removed, missing };
}

/**
 * Stop is caller's job. This purges on-disk Antigravity residuals for the
 * given conversation id(s), including subagent ids discovered in transcripts.
 */
export function deleteConversationArtifacts(ids = []) {
  const input = [...new Set((Array.isArray(ids) ? ids : [ids]).map(String).filter(Boolean))];
  const queue = [];
  const errors = [];
  for (const id of input) {
    if (!isConversationId(id)) {
      errors.push({ id, error: "invalid conversation id" });
      continue;
    }
    queue.push(id);
    for (const rel of relatedIdsFromTranscript(id)) {
      if (isConversationId(rel)) queue.push(rel);
    }
  }
  const seen = new Set();
  const results = [];
  for (const id of queue) {
    const key = id.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    try {
      results.push(deleteOneConversationArtifacts(id));
    } catch (err) {
      errors.push({ id, error: err.message || String(err) });
    }
  }
  return {
    ok: errors.length === 0,
    purged: results,
    errors,
    count: results.reduce((n, r) => n + r.removed.length, 0),
  };
}

export function listOnDiskConversations({ limit = 60 } = {}) {
  const map = new Map();
  for (const root of geminiRoots()) {
    const brainDir = path.join(root, "brain");
    if (!existsSync(brainDir)) continue;
    let entries = [];
    try {
      entries = fs.readdirSync(brainDir);
    } catch {
      continue;
    }
    for (const id of entries) {
      if (!isConversationId(id) || map.has(id)) continue;
      const txPath = path.join(brainDir, id, ".system_generated", "logs", "transcript.jsonl");
      if (!existsSync(txPath)) continue;
      try {
        const st = fs.statSync(txPath);
        let title = "Conversation";
        let prompt = "";
        let createdAt = st.birthtimeMs || st.mtimeMs;
        const fd = fs.openSync(txPath, "r");
        const buf = Buffer.alloc(2048);
        const bytes = fs.readSync(fd, buf, 0, 2048, 0);
        fs.closeSync(fd);
        const firstLine = buf.toString("utf8", 0, bytes).split(/\r?\n/)[0];
        if (firstLine) {
          try {
            const row = JSON.parse(firstLine);
            if (row.created_at) createdAt = new Date(row.created_at).getTime();
            let c = row.content || "";
            const m = c.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
            if (m) c = m[1];
            c = c.replace(/<[^>]+>/g, "").trim();
            if (c) {
              prompt = c;
              title = c.length > 50 ? c.slice(0, 50) + "…" : c;
            }
          } catch {}
        }
        map.set(id, {
          id,
          conversation_id: id,
          title,
          prompt,
          createdAt,
          updatedAt: st.mtimeMs,
          path: txPath,
        });
      } catch {}
    }
  }
  return [...map.values()].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, limit);
}


function readAgentMd(dir) {
  const md = path.join(dir, "agent.md");
  if (!existsSync(md)) return null;
  const text = fs.readFileSync(md, "utf8");
  const name = path.basename(dir);
  let description = null;
  const fm = text.match(/^---\s*([\s\S]*?)\s*---/);
  if (fm) {
    const mName = fm[1].match(/name:\s*(.+)/);
    const mDesc = fm[1].match(/description:\s*(.+)/);
    if (mDesc) description = mDesc[1].trim();
    return {
      id: (mName?.[1] || name).trim(),
      name: (mName?.[1] || name).trim(),
      description,
      path: md,
    };
  }
  return { id: name, name, description: null, path: md };
}

export function listAgents(cwd = process.cwd()) {
  const agents = [
    {
      id: "default",
      name: "Default agent",
      description: "Built-in Antigravity default (same as desktop)",
      scope: "builtin",
    },
  ];
  const roots = [
    { root: path.join(cwd, ".agents", "agents"), scope: "workspace" },
    {
      root: path.join(os.homedir(), ".gemini", "config", "agents"),
      scope: "global",
    },
  ];
  for (const { root, scope } of roots) {
    if (!existsSync(root)) continue;
    for (const ent of fs.readdirSync(root, { withFileTypes: true })) {
      if (!ent.isDirectory()) continue;
      const a = readAgentMd(path.join(root, ent.name));
      if (a) agents.push({ ...a, scope });
    }
  }
  agents.sort((a, b) => {
    const score = (x) => (x.id === "default" ? 0 : 1);
    return score(a) - score(b) || String(a.name).localeCompare(String(b.name));
  });
  return agents;
}
