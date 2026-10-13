#!/usr/bin/env node
/**
 * agy-auto — Antigravity CLI wrapper with forced auto-approve + account switch.
 */
import { spawn } from "node:child_process";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { resolveAgyBinary, runAgy } from "../src/agyRunner.js";
import { envWithAgyPath } from "../src/utils.js";
import {
  applyActiveProfileEnv,
  clearLiveAuth,
  listProfiles,
  removeAccount,
  saveAccount,
  switchAccount,
  whoami,
} from "../src/accounts.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

function printHelp() {
  console.log(`Antigravity Gemini 破甲 (Antigravity Gemini Armour Break) — agy auto-approve + account switch

Run:
  agy-auto <prompt>
  agy-auto -p <prompt>
  agy-auto --interactive [prompt]
  agy-auto --serve
  agy-auto --setup-settings          Always-proceed settings + global AGENTS.md → ~/.gemini/config/

Accounts (like switching cookies — no browser after first save):
  agy-auto account list
  agy-auto account whoami
  agy-auto account save <name>              Save CURRENT login as profile
  agy-auto account switch <name>            Restore profile (no browser)
  agy-auto account remove <name>
  agy-auto account clear-live               Wipe live login (prepare new browser login)
  agy-auto account add-key <name> <apiKey>  Save Gemini API key profile (no Google login)

Workflow for a 2nd Google account (one-time browser):
  1) agy-auto account save default
  2) agy-auto account clear-live
  3) agy                              # browser login as account B
  4) agy-auto account save work
  5) agy-auto account switch default  # instant switch, no browser

Options:
  --cwd <path>  --model <name>  --effort <level>  --agent <name>
  --continue / -c  --conversation <id>
  --output-format text|json|stream-json  --json
  --print-timeout <dur>  --timeout-ms <n>
`);
}

function parseArgs(argv) {
  const out = {
    promptParts: [],
    cwd: process.env.AGY_CWD || process.cwd(),
    model: undefined,
    effort: undefined,
    agent: undefined,
    continueLast: false,
    conversationId: undefined,
    outputFormat: "text",
    printTimeout: undefined,
    timeoutMs: undefined,
    interactive: false,
    serve: false,
    setupSettings: false,
    help: false,
    accountCmd: null,
    accountArgs: [],
  };

  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const next = () => argv[++i];
    switch (a) {
      case "-h":
      case "--help":
        out.help = true;
        break;
      case "account":
        out.accountCmd = next() || "list";
        out.accountArgs = argv.slice(i + 1);
        i = argv.length;
        break;
      case "-p":
      case "--print":
      case "--prompt":
        out.promptParts.push(next());
        break;
      case "-i":
      case "--interactive":
        out.interactive = true;
        break;
      case "--serve":
        out.serve = true;
        break;
      case "--setup-settings":
        out.setupSettings = true;
        break;
      case "--cwd":
        out.cwd = next();
        break;
      case "--model":
        out.model = next();
        break;
      case "--effort":
        out.effort = next();
        break;
      case "--agent":
        out.agent = next();
        break;
      case "-c":
      case "--continue":
        out.continueLast = true;
        break;
      case "--conversation":
        out.conversationId = next();
        break;
      case "--output-format":
        out.outputFormat = next();
        break;
      case "--json":
        out.outputFormat = "json";
        break;
      case "--print-timeout":
        out.printTimeout = next();
        break;
      case "--timeout-ms":
        out.timeoutMs = Number(next());
        break;
      default:
        if (a.startsWith("-")) throw new Error(`Unknown flag: ${a}`);
        out.promptParts.push(a);
        break;
    }
  }

  out.prompt = out.promptParts.filter(Boolean).join(" ").trim();
  return out;
}

function handleAccount(cmd, args) {
  switch (cmd) {
    case "list":
    case "ls": {
      const rows = listProfiles();
      if (!rows.length) {
        console.log("(no saved accounts yet — run: agy-auto account save <name>)");
        return;
      }
      for (const r of rows) {
        const mark = r.active ? "*" : " ";
        console.log(
          `${mark} ${r.name}\ttype=${r.type}\temail=${r.email || "-"}\tsaved=${r.savedAt || "-"}`
        );
      }
      return;
    }
    case "whoami":
    case "status":
      console.log(JSON.stringify(whoami(), null, 2));
      return;
    case "save": {
      const name = args[0];
      if (!name) throw new Error("usage: account save <name>");
      const r = saveAccount(name);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "switch":
    case "use": {
      const name = args[0];
      if (!name) throw new Error("usage: account switch <name>");
      const r = switchAccount(name);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    case "remove":
    case "rm":
    case "delete": {
      const name = args[0];
      if (!name) throw new Error("usage: account remove <name>");
      console.log(JSON.stringify(removeAccount(name), null, 2));
      return;
    }
    case "clear-live":
    case "logout-live": {
      console.log(JSON.stringify(clearLiveAuth(), null, 2));
      console.log("Live auth cleared. Run `agy` once if you need to login a NEW Google account.");
      return;
    }
    case "add-key":
    case "save-key": {
      const name = args[0];
      const key = args[1];
      if (!name || !key) throw new Error("usage: account add-key <name> <GEMINI_API_KEY>");
      const r = saveAccount(name, { asApiKey: true, apiKey: key });
      // also activate key mode immediately
      switchAccount(name);
      console.log(JSON.stringify(r, null, 2));
      return;
    }
    default:
      throw new Error(`unknown account command: ${cmd}`);
  }
}

async function main() {
  const opts = parseArgs(process.argv.slice(2));
  if (opts.help) {
    printHelp();
    return;
  }

  if (opts.accountCmd) {
    handleAccount(opts.accountCmd, opts.accountArgs);
    return;
  }

  if (opts.setupSettings) {
    const { setupSettings } = await import("../scripts/setup-settings.js");
    setupSettings();
    return;
  }

  if (opts.serve) {
    process.env.AGY_CWD = opts.cwd;
    await import("../src/server.js");
    return;
  }

  const bin = resolveAgyBinary();
  const env = applyActiveProfileEnv(process.env);

  if (opts.interactive) {
    const args = ["--dangerously-skip-permissions"];
    if (opts.model) args.push("--model", opts.model);
    if (opts.effort) args.push("--effort", opts.effort);
    if (opts.agent) args.push("--agent", opts.agent);
    if (opts.continueLast) args.push("--continue");
    if (opts.conversationId) args.push("--conversation", opts.conversationId);
    if (opts.prompt) args.push("--prompt-interactive", opts.prompt);

    const child = spawn(bin, args, {
      cwd: opts.cwd,
      stdio: "inherit",
      env: envWithAgyPath(env, path.dirname(bin)),
    });
    child.on("exit", (code) => process.exit(code ?? 1));
    return;
  }

  if (!opts.prompt) {
    printHelp();
    process.exit(1);
  }

  const result = await runAgy({
    prompt: opts.prompt,
    cwd: opts.cwd,
    model: opts.model,
    effort: opts.effort,
    agent: opts.agent,
    conversationId: opts.conversationId,
    continueLast: opts.continueLast,
    outputFormat: opts.outputFormat,
    printTimeout: opts.printTimeout,
    timeoutMs: opts.timeoutMs,
  });

  if (opts.outputFormat === "json") {
    process.stdout.write(result.stdout.trim() + "\n");
  } else if (opts.outputFormat === "stream-json") {
    process.stdout.write(result.stdout);
  } else {
    process.stdout.write((result.response ?? result.stdout).trimEnd() + "\n");
  }
  if (result.stderr) process.stderr.write(result.stderr);
}

main().catch((err) => {
  console.error(err.message || err);
  if (err.result?.stderr) process.stderr.write(err.result.stderr);
  process.exit(1);
});
