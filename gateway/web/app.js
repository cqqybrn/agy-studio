/* Antigravity 破甲 — web console (docs/API.md) */
(() => {
  "use strict";

  // ==========================================================
  // Utils
  // ==========================================================
  const $ = (sel, root = document) => root.querySelector(sel);
  const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

  const ICONS = {
    plus: '<path d="M12 5v14M5 12h14"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.5-3.5"/>',
    panel: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M9.5 4v16"/>',
    settings: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    sliders: '<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>',
    chevDown: '<path d="m6 9 6 6 6-6"/>',
    chevRight: '<path d="m9 6 6 6-6 6"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    arrowUp: '<path d="M12 19V5M5 12l7-7 7 7"/>',
    stop: '<rect x="6" y="6" width="12" height="12" rx="2.5"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2.5"/><path d="M5 15H4.5A2.5 2.5 0 0 1 2 12.5v-8A2.5 2.5 0 0 1 4.5 2h8A2.5 2.5 0 0 1 15 4.5V5"/>',
    folder: '<path d="M3 7.5A2.5 2.5 0 0 1 5.5 5h3.3a2 2 0 0 1 1.6.8l1 1.4a2 2 0 0 0 1.6.8h5.5A2.5 2.5 0 0 1 21 10.5v6a2.5 2.5 0 0 1-2.5 2.5h-13A2.5 2.5 0 0 1 3 16.5z"/>',
    terminal: '<path d="m5 17 5-5-5-5M12 19h7"/>',
    file: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/>',
    filePlus: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5M12 11v6M9 14h6"/>',
    pencil: '<path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L8 18l-4 1 1-4z"/>',
    eye: '<path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12z"/><circle cx="12" cy="12" r="3"/>',
    globe: '<circle cx="12" cy="12" r="9"/><path d="M3 12h18M12 3a14 14 0 0 1 0 18M12 3a14 14 0 0 0 0 18"/>',
    bot: '<rect x="4" y="8" width="16" height="12" rx="3"/><path d="M12 4v4M9 13v1.5M15 13v1.5"/><circle cx="12" cy="3.5" r="1"/>',
    sparkle: '<path d="M12 3c.4 4.6 2.4 6.6 7 7-4.6.4-6.6 2.4-7 7-.4-4.6-2.4-6.6-7-7 4.6-.4 6.6-2.4 7-7z"/>',
    alert: '<circle cx="12" cy="12" r="9"/><path d="M12 8v4.5M12 16h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/>',
    refresh: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    trash: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a2 2 0 0 0 2 2h6a2 2 0 0 0 2-2l1-12M9 7V4h6v3"/>',
    star: '<path d="m12 3 2.7 5.6 6.1.9-4.4 4.3 1 6.1L12 17l-5.4 2.9 1-6.1L3.2 9.5l6.1-.9z"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    zap: '<path d="M13 2 4 14h7l-1 8 9-12h-7z"/>',
    layers: '<path d="m12 3 9 5-9 5-9-5z"/><path d="m3 13 9 5 9-5"/>',
    paperclip: '<path d="m21.4 11.6-8.8 8.8a5 5 0 0 1-7.1-7.1l9.2-9.2a3.2 3.2 0 0 1 4.5 4.5l-9.2 9.2a1.4 1.4 0 0 1-2-2l8.1-8.1"/>',
    key: '<circle cx="8" cy="15" r="4"/><path d="m11 12 9-9M17 6l3 3"/>',
    bulb: '<path d="M9 18h6M10 21h4M12 3a6 6 0 0 0-3.5 10.9c.6.5 1 1.2 1 2V16h5v-.1c0-.8.4-1.5 1-2A6 6 0 0 0 12 3z"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    tool: '<path d="M14.7 6.3a4 4 0 0 0-5.4 5.4L3 18l3 3 6.3-6.3a4 4 0 0 0 5.4-5.4l-2.5 2.5-2.1-.4-.4-2.1z"/>',
    message: '<path d="M20 15a2 2 0 0 1-2 2H8l-4 4V6a2 2 0 0 1 2-2h12a2 2 0 0 1 2 2z"/>',
    image: '<rect x="3" y="4" width="18" height="16" rx="2.5"/><circle cx="9" cy="10" r="2"/><path d="m21 16-5-5-9 9"/>',
    git: '<circle cx="6" cy="6" r="2.5"/><circle cx="6" cy="18" r="2.5"/><circle cx="18" cy="9" r="2.5"/><path d="M6 8.5v7M18 11.5c0 3-3 4-7.5 5"/>',
    minus: '<path d="M6 12h12"/>',
    external: '<path d="M14 4h6v6M20 4l-9 9M18 14v4a2 2 0 0 1-2 2H6a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h4"/>',
    edit: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
    rotate: '<path d="M4 12a8 8 0 0 1 13.7-5.7L20 8.5"/><path d="M20 4v4.5h-4.5M20 12a8 8 0 0 1-13.7 5.7L4 15.5"/><path d="M4 20v-4.5h4.5"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/>',
    moon: '<path d="M21 14.5A8.5 8.5 0 0 1 9.5 3a7 7 0 1 0 11.5 11.5z"/>',
    monitor: '<rect x="3" y="4" width="18" height="12" rx="2"/><path d="M8 20h8M12 16v4"/>',
    brain: '<path d="M12 5a3 3 0 0 0-3-3 3 3 0 0 0-3 3 3 3 0 0 0-2 2.8 3 3 0 0 0 1 2.8 3 3 0 0 0-1 2.9 3 3 0 0 0 2 2.8 3 3 0 0 0 3 2.7 3 3 0 0 0 3-2 3 3 0 0 0 3 2 3 3 0 0 0 3-2.7 3 3 0 0 0 2-2.8 3 3 0 0 0-1-2.9 3 3 0 0 0 1-2.8 3 3 0 0 0-2-2.8 3 3 0 0 0-3-3 3 3 0 0 0-3 3z"/><path d="M12 2v20"/>',
  };

  function iconHTML(name, cls = "") {
    return `<svg class="i ${cls}" viewBox="0 0 24 24" aria-hidden="true">${ICONS[name] || ICONS.sparkle}</svg>`;
  }
  function icon(name, cls = "") {
    const t = document.createElement("template");
    t.innerHTML = iconHTML(name, cls);
    return t.content.firstChild;
  }
  function logoEl(cls = "logo") {
    const t = document.createElement("template");
    t.innerHTML = `<svg class="${cls}"><use href="#agLogo"/></svg>`;
    return t.content.firstChild;
  }
  function hydrateIcons(root = document) {
    for (const el of $$("i[data-i]", root)) el.replaceWith(icon(el.dataset.i, el.className));
  }

  function h(tag, attrs, ...kids) {
    const el = document.createElement(tag);
    if (attrs) {
      for (const [k, v] of Object.entries(attrs)) {
        if (v == null || v === false) continue;
        if (k === "class") el.className = v;
        else if (k === "text") el.textContent = v;
        else if (k === "html") el.innerHTML = v;
        else if (k === "value") el.value = v;
        else if (k === "checked") el.checked = !!v;
        else if (k.startsWith("on") && typeof v === "function") el.addEventListener(k.slice(2), v);
        else el.setAttribute(k, v === true ? "" : v);
      }
    }
    for (const kid of kids.flat(Infinity)) {
      if (kid == null || typeof kid === "boolean") continue;
      el.appendChild(typeof kid === "string" || typeof kid === "number" ? document.createTextNode(String(kid)) : kid);
    }
    return el;
  }

  const esc = (s) => String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));

  const LS = {
    get(k, d) {
      const raw = localStorage.getItem(k);
      if (raw == null) return d;
      try { return JSON.parse(raw); } catch { return raw; }
    },
    set(k, v) {
      try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* quota */ }
    },
  };

  const uid = (p = "") => p + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
  const isImageExt = (ext) => /^(jpe?g|png|gif|webp|bmp|svg)$/i.test(String(ext || "").replace(/^\./, ""));

  function cleanUserPrompt(raw) {
    if (!raw || typeof raw !== "string") return "";
    let s = raw.trim();
    const m = s.match(/<USER_REQUEST>([\s\S]*?)<\/USER_REQUEST>/i);
    if (m && m[1]) return m[1].trim();
    return s
      .replace(/<ADDITIONAL_METADATA>[\s\S]*?<\/ADDITIONAL_METADATA>/gi, "")
      .replace(/<USER_SETTINGS_CHANGE>[\s\S]*?<\/USER_SETTINGS_CHANGE>/gi, "")
      .replace(/<CONTEXT_SUMMARY>[\s\S]*?<\/CONTEXT_SUMMARY>/gi, "")
      .replace(/<system_instructions>[\s\S]*?<\/system_instructions>/gi, "")
      .trim();
  }

  function fmtNum(n) {
    if (n == null || Number.isNaN(+n)) return "—";
    n = +n;
    if (Math.abs(n) >= 1e6) return (n / 1e6).toFixed(n >= 1e7 ? 0 : 1) + "M";
    if (Math.abs(n) >= 1e4) return (n / 1e3).toFixed(n >= 1e5 ? 0 : 1) + "k";
    return n.toLocaleString();
  }
  function fmtDur(ms) {
    if (ms == null || ms < 0 || !Number.isFinite(+ms)) return "";
    const s = +ms / 1000;
    if (s < 60) return `${s < 10 ? s.toFixed(1) : Math.round(s)}s`;
    const m = Math.floor(s / 60);
    if (m < 60) return `${m}m ${String(Math.floor(s % 60)).padStart(2, "0")}s`;
    return `${Math.floor(m / 60)}h ${String(m % 60).padStart(2, "0")}m`;
  }
  function fmtSecs(sec) {
    if (sec == null) return "";
    sec = Math.max(0, Math.round(sec));
    if (sec >= 86400) return `${Math.floor(sec / 86400)}d ${Math.floor((sec % 86400) / 3600)}h`;
    if (sec >= 3600) return `${Math.floor(sec / 3600)}h ${Math.floor((sec % 3600) / 60)}m`;
    if (sec >= 60) return `${Math.floor(sec / 60)}m`;
    return `${sec}s`;
  }
  const fmtTime = (t) => new Date(t).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  const fmtDateTime = (t) => new Date(t).toLocaleString([], { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" });
  const baseName = (p) => { const s = String(p ?? "").replace(/[\\/]+$/, ""); return s.split(/[\\/]/).pop() || s; };
  const oneLine = (s, n = 160) => { const t = String(s ?? "").replace(/\s+/g, " ").trim(); return t.length > n ? t.slice(0, n - 1) + "…" : t; };
  const humanize = (s) => { const t = String(s ?? "").replace(/^STEP_TYPE_|^CORTEX_STEP_TYPE_/i, "").replace(/[_-]+/g, " ").trim().toLowerCase(); return t ? t[0].toUpperCase() + t.slice(1) : ""; };
  const shortId = (id) => String(id || "").slice(0, 8);

  async function copyText(text, msg = "已复制") {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      const ta = h("textarea", { style: "position:fixed;opacity:0" });
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand("copy");
      ta.remove();
    }
    toast(msg);
  }

  function toast(msg, isErr = false) {
    const el = h("div", { class: "toast" + (isErr ? " err" : "") }, icon(isErr ? "alert" : "check"), h("span", { text: msg }));
    $("#toastWrap").appendChild(el);
    setTimeout(() => { el.classList.add("out"); setTimeout(() => el.remove(), 300); }, isErr ? 5200 : 3200);
  }

  function parseMaybeJSON(x) {
    if (typeof x !== "string") return x;
    const t = x.trim();
    if ((t.startsWith("{") && t.endsWith("}")) || (t.startsWith("[") && t.endsWith("]"))) {
      try { return JSON.parse(t); } catch { /* keep */ }
    }
    return x;
  }
  function pretty(x, max = 30000) {
    if (x == null) return "";
    const v = parseMaybeJSON(x);
    const s = typeof v === "string" ? v : JSON.stringify(v, null, 2);
    return s.length > max ? s.slice(0, max) + `\n… (${fmtNum(s.length - max)} more chars)` : s;
  }
  function unwrapVal(v) {
    if (v == null) return null;
    if (typeof v !== "string") return v;
    let s = v.trim();
    for (let i = 0; i < 3; i++) {
      if ((s.startsWith('"') && s.endsWith('"')) || (s.startsWith("'") && s.endsWith("'"))) {
        try {
          const p = JSON.parse(s.startsWith("'") ? `"${s.slice(1, -1).replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"` : s);
          if (typeof p === "string") { s = p.trim(); continue; }
          return p;
        } catch {
          s = s.slice(1, -1).trim();
        }
      } else break;
    }
    return s;
  }
  function pick(obj, keys) {
    if (!obj || typeof obj !== "object") return null;
    const norm = (k) => k.toLowerCase().replace(/[_-]/g, "");
    const map = {};
    for (const k of Object.keys(obj)) map[norm(k)] = obj[k];
    for (const k of keys) {
      const v = unwrapVal(map[norm(k)]);
      if (v != null && v !== "") return v;
    }
    return null;
  }
  function zhToolLabel(en) {
    const s = String(en || "").trim();
    if (!s) return "";
    const map = [
      [/^list(ing)?\b/i, "列出"],
      [/^analyz(?:ing|e|ed)?\b/i, "分析"],
      [/^read(ing)?\b/i, "读取"],
      [/^view(ing)?\b/i, "查看"],
      [/^check(ing)?\b/i, "检查"],
      [/^search(ing)?\b/i, "搜索"],
      [/^edit(ing)?\b/i, "修改"],
      [/^replac(?:ing|e|ed)?\b/i, "修改"],
      [/^creat(?:ing|e|ed)?\b/i, "创建"],
      [/^writ(?:ing|e|es|ten)?\b/i, "写入"],
      [/^delet(?:ing|e|ed)?\b/i, "删除"],
      [/^clean(?:ing|ed)?\b/i, "清理"],
      [/^explor(?:ing|e|ed)?\b/i, "查看"],
      [/^scann(?:ing|ed)?\b/i, "扫描"],
      [/^test(?:ing|ed)?\b/i, "测试"],
      [/^inspect(?:ing|ed)?\b/i, "检查"],
      [/^runn?ing\b/i, "执行"],
      [/^ran\b/i, "执行"],
      [/^execut(?:ing|e|ed)?\b/i, "执行"],
      [/^invok(?:ing|e|ed)?\b/i, "启动"],
      [/^spawn(?:ing|ed)?\b/i, "启动"],
    ];
    let out = s;
    for (const [re, zh] of map) {
      if (re.test(out)) {
        out = out.replace(re, zh);
        break;
      }
    }
    return polishPhrase(out);
  }
  function polishPhrase(s) {
    return String(s || "")
      .replace(/\bC\s*drive\b/gi, "C 盘")
      .replace(/\bD\s*drive\b/gi, "D 盘")
      .replace(/\bdrive capacity\b/gi, "盘容量")
      .replace(/\bdrive space\b/gi, "盘空间")
      .replace(/\buser (home )?directory\b/gi, "用户目录")
      .replace(/\bdirectory\b/gi, "目录")
      .replace(/\bfolder\b/gi, "文件夹")
      .replace(/\bcapacity\b/gi, "容量")
      .replace(/\bspace\b/gi, "空间")
      .replace(/\bcommand runner\b/gi, "命令环境")
      .replace(/\benvironment variable\b/gi, "环境变量")
      .replace(/\s+/g, " ")
      .trim();
  }
  /** Official-style one-line phrase: 「检查 C 盘容量」not run_command / raw argv. */
  function humanToolPhrase(meta, fallbackVerb, fallbackTarget) {
    const full = zhToolLabel(meta);
    if (full) return { phrase: full, verb: full, target: null };
    const t = fallbackTarget ? polishPhrase(String(fallbackTarget)) : null;
    return {
      phrase: t ? `${fallbackVerb} ${t}` : fallbackVerb,
      verb: fallbackVerb,
      target: t,
    };
  }
  function pathHintFromCmd(cmd) {
    const c = String(cmd || "");
    // Windows path — never treat /1GB style unit math as a path
    const win = c.match(/[A-Za-z]:\\(?:[^\\/:*?"<>|\s'"\\]+\\)*[^\\/:*?"<>|\s'"\\]*/);
    if (win) {
      const name = baseName(win[0].replace(/["']+$/, ""));
      if (name && !/^\d+(\.\d+)?(GB|MB|KB|TB|B)$/i.test(name)) return name;
    }
    const unix = c.match(/(?:^|[\s"'=(])(\/(?:Users|home|tmp|var|etc|opt|mnt|Volumes|root)(?:\/[\w.-]+)+)/);
    if (unix) return baseName(unix[1]);
    const psDrive = c.match(/Get-PSDrive\s+(?:-Name\s+)?([A-Za-z])\b/i);
    if (psDrive) return `${psDrive[1].toUpperCase()} 盘`;
    if (/PSDrive|disk|drive|容量|空间|Used|Free/i.test(c)) {
      const letter = c.match(/\b([A-Za-z]):(?![\\/])/);
      if (letter) return `${letter[1].toUpperCase()} 盘`;
    }
    return null;
  }
  /** Shell without toolAction: infer human label — never show raw argv as the row. */
  function inferShellLabel(cmd) {
    const c = String(cmd || "");
    const hint = pathHintFromCmd(c);
    // Get-PSDrive / size checks are "检查", not "列出"
    if (/Get-PSDrive|Measure-Object|\.Length|\bdu\b|sizeof|Used\/1GB|Free\/1GB|1GB|占用|disk/i.test(c))
      return { ...humanToolPhrase(null, "检查", hint || "占用"), icon: "search" };
    if (/Get-ChildItem|\bdir\b|\bls\b|\btree\b/i.test(c))
      return { ...humanToolPhrase(null, "列出", hint || "目录"), icon: "folder" };
    if (/Get-Content|\btype\b|\bcat\b|\bhead\b|\btail\b|Select-String/i.test(c))
      return { ...humanToolPhrase(null, "读取", hint), icon: "eye" };
    if (/Remove-Item|\brm\b|\bdel\b|\brd\b|Clear-RecycleBin|rimraf/i.test(c))
      return { ...humanToolPhrase(null, "删除", hint), icon: "tool" };
    if (/Copy-Item|Move-Item|\bcp\b|\bmv\b|robocopy/i.test(c))
      return { ...humanToolPhrase(null, "整理", hint), icon: "folder" };
    if (/npm\b|pip\b|pnpm\b|yarn\b|cargo\b|go\b|dotnet\b/i.test(c))
      return { ...humanToolPhrase(null, "执行", oneLine(c.replace(/\s+/g, " "), 48)), icon: "terminal" };
    return { ...humanToolPhrase(null, "执行操作", hint), icon: "tool" };
  }
  /** Stream tool_info may put args under parameters / args / or flat on the object. */
  function extractToolParams(info) {
    if (info == null) return null;
    const obj = typeof info === "string" ? parseMaybeJSON(info) : info;
    if (!obj || typeof obj !== "object") return obj;
    if (obj.parameters != null) return obj.parameters;
    if (obj.args != null) return obj.args;
    if (obj.arguments != null) return obj.arguments;
    if (obj.input != null) return obj.input;
    return obj;
  }

  // ==========================================================
  // Config / API
  // ==========================================================
  const defaultBase = location.protocol.startsWith("http") ? location.origin : "http://127.0.0.1:8787";
  const cfg = {
    base: LS.get("agy.base", "") || "",
    apiKey: LS.get("agy.apiKey", "") || "",
    stream: LS.get("agy.stream", true) !== false,
  };
  const baseUrl = () => (cfg.base || defaultBase).replace(/\/+$/, "");
  const apiUrl = (p) => baseUrl() + p;

  function headers(json) {
    const hd = {};
    if (json) hd["Content-Type"] = "application/json";
    if (cfg.apiKey) hd.Authorization = `Bearer ${cfg.apiKey}`;
    return hd;
  }

  function apiError(res, data) {
    const e = data?.error;
    const msg = (typeof e === "string" ? e : e?.message) || `${res.status} ${res.statusText}`;
    return Object.assign(new Error(msg), { status: res.status, code: e?.code, detail: e?.result, data });
  }

  async function api(path, { method = "GET", body, timeoutMs = 30000, signal } = {}) {
    const ctrl = new AbortController();
    const timer = timeoutMs > 0 ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
    if (signal) signal.addEventListener("abort", () => ctrl.abort(), { once: true });
    try {
      const res = await fetch(apiUrl(path), {
        method,
        headers: headers(body !== undefined),
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw apiError(res, data);
      return data;
    } catch (err) {
      if (err.name === "AbortError") throw Object.assign(new Error(signal?.aborted ? "已取消" : "请求超时"), { code: "ABORTED" });
      throw err;
    } finally {
      if (timer) clearTimeout(timer);
    }
  }

  // ==========================================================
  // Markdown (safe subset: everything escaped first)
  // ==========================================================
  const RE_FENCE = /^\s{0,3}(`{3,}|~{3,})\s*([\w+#.-]*)/;
  const RE_LI = /^(\s*)([-*+]|\d{1,3}[.)])\s+(.*)$/;
  const RE_HR = /^\s{0,3}([-*_])(?:\s*\1){2,}\s*$/;
  const RE_H = /^\s{0,3}(#{1,6})\s+(.*?)\s*#*\s*$/;
  const RE_TSEP = /^\s*\|?\s*:?-+:?\s*(\|\s*:?-+:?\s*)+\|?\s*$/;
  const RE_QUOTE = /^\s{0,3}>/;

  function mdInline(s) {
    const store = [];
    const keep = (html) => `\u0000${store.push(html) - 1}\u0000`;
    let t = String(s);
    t = t.replace(/`([^`\n]+)`/g, (_, c) => keep(`<code>${esc(c)}</code>`));
    t = t.replace(/\[([^\]\n]+)\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g, (m, label, url) =>
      /^(https?:|mailto:|#)/i.test(url) ? keep(`<a href="${esc(url)}" target="_blank" rel="noopener noreferrer">${esc(label)}</a>`) : m);
    t = t.replace(/\bhttps?:\/\/[^\s<>()\u0000]+[^\s<>().,;:!?'"\u0000]/g, (u) =>
      keep(`<a href="${esc(u)}" target="_blank" rel="noopener noreferrer">${esc(u)}</a>`));
    t = esc(t);
    t = t.replace(/\*\*([^*\n]+?)\*\*/g, "<strong>$1</strong>").replace(/__([^_\n]+?)__/g, "<strong>$1</strong>");
    t = t.replace(/(^|[^*\w])\*(?!\s)([^*\n]+?)\*(?!\w)/g, "$1<em>$2</em>");
    t = t.replace(/(^|[^_\w])_(?!\s)([^_\n]+?)_(?!\w)/g, "$1<em>$2</em>");
    t = t.replace(/~~([^~\n]+?)~~/g, "<del>$1</del>");
    return t.replace(/\u0000(\d+)\u0000/g, (_, i) => store[+i]);
  }

  function codeBlockHTML(code, lang) {
    return `<div class="codeblock"><div class="cb-head"><span>${esc(lang || "text")}</span>` +
      `<button class="cb-copy" type="button">${iconHTML("copy")}<span>Copy</span></button></div>` +
      `<pre><code>${esc(code)}</code></pre></div>`;
  }

  function mdList(lines) {
    const first = lines.find((l) => RE_LI.test(l));
    const m0 = first.match(RE_LI);
    const base = m0[1].length;
    const offset = base + m0[2].length + 1;
    const ordered = /\d/.test(m0[2]);
    const start = ordered ? parseInt(m0[2], 10) : 1;
    const items = [];
    const strip = new RegExp(`^ {0,${offset}}`);
    for (const l of lines) {
      const m = l.match(RE_LI);
      if (m && m[1].length <= base + 1) { items.push([m[3]]); continue; }
      if (items.length) items[items.length - 1].push(l.replace(/\t/g, "    ").replace(strip, ""));
    }
    const body = items.map(([head, ...rest]) => {
      const task = head.match(/^\[( |x|X)\]\s+(.*)$/);
      const label = task ? `${task[1].trim() ? "☑" : "☐"} ${mdInline(task[2])}` : mdInline(head);
      return `<li>${label}${rest.join("").trim() ? mdBlocks(rest) : ""}</li>`;
    }).join("");
    return ordered ? `<ol${start !== 1 ? ` start="${start}"` : ""}>${body}</ol>` : `<ul>${body}</ul>`;
  }

  function mdBlocks(lines) {
    const out = [];
    let i = 0;
    const isTable = (k) => lines[k].includes("|") && k + 1 < lines.length && RE_TSEP.test(lines[k + 1]);
    const isStart = (k) => RE_FENCE.test(lines[k]) || RE_H.test(lines[k]) || RE_HR.test(lines[k]) || RE_QUOTE.test(lines[k]) || RE_LI.test(lines[k]) || isTable(k);
    while (i < lines.length) {
      const line = lines[i];
      let m;
      if (!line.trim()) { i++; continue; }
      if ((m = line.match(RE_FENCE))) {
        const fence = m[1];
        const buf = [];
        i++;
        while (i < lines.length && !lines[i].trim().startsWith(fence)) buf.push(lines[i++]);
        i++;
        out.push(codeBlockHTML(buf.join("\n"), m[2]));
        continue;
      }
      if ((m = line.match(RE_H))) { const n = m[1].length; out.push(`<h${n}>${mdInline(m[2])}</h${n}>`); i++; continue; }
      if (RE_HR.test(line)) { out.push("<hr>"); i++; continue; }
      if (RE_QUOTE.test(line)) {
        const buf = [];
        while (i < lines.length && RE_QUOTE.test(lines[i])) buf.push(lines[i++].replace(/^\s{0,3}>\s?/, ""));
        out.push(`<blockquote>${mdBlocks(buf)}</blockquote>`);
        continue;
      }
      if (isTable(i)) {
        const split = (l) => l.trim().replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
        const head = split(line);
        const aligns = split(lines[i + 1]).map((c) => (c.startsWith(":") && c.endsWith(":") ? "center" : c.endsWith(":") ? "right" : ""));
        i += 2;
        const rows = [];
        while (i < lines.length && lines[i].includes("|") && lines[i].trim()) rows.push(split(lines[i++]));
        const cell = (tag, c, k) => `<${tag}${aligns[k] ? ` style="text-align:${aligns[k]}"` : ""}>${mdInline(c)}</${tag}>`;
        out.push(`<table><thead><tr>${head.map((c, k) => cell("th", c, k)).join("")}</tr></thead><tbody>` +
          rows.map((r) => `<tr>${head.map((_, k) => cell("td", r[k] ?? "", k)).join("")}</tr>`).join("") + "</tbody></table>");
        continue;
      }
      if (RE_LI.test(line)) {
        const buf = [];
        while (i < lines.length) {
          const l = lines[i];
          if (RE_LI.test(l) || (buf.length && /^\s+\S/.test(l))) { buf.push(l); i++; continue; }
          if (!l.trim() && i + 1 < lines.length && (RE_LI.test(lines[i + 1]) || /^\s{2,}\S/.test(lines[i + 1]))) { i++; continue; }
          break;
        }
        out.push(mdList(buf));
        continue;
      }
      const buf = [line];
      i++;
      while (i < lines.length && lines[i].trim() && !isStart(i)) buf.push(lines[i++]);
      out.push(`<p>${buf.map(mdInline).join("<br>")}</p>`);
    }
    return out.join("");
  }

  const md = (src) => (src ? mdBlocks(String(src).replace(/\r\n?/g, "\n").split("\n")) : "");

  // ==========================================================
  // Theme
  // ==========================================================
  const THEME_OPTS = [
    { v: "light", l: "亮色", icon: "sun", d: "日光纸面" },
    { v: "dark", l: "暗色", icon: "moon", d: "深空控制台" },
    { v: "system", l: "系统", icon: "monitor", d: "跟随系统" },
  ];
  const themePref = () => {
    const v = LS.get("agy.theme", "system");
    return v === "light" || v === "dark" || v === "system" ? v : "system";
  };
  const systemTheme = () => (matchMedia("(prefers-color-scheme: light)").matches ? "light" : "dark");
  const resolvedTheme = (pref = themePref()) => (pref === "system" ? systemTheme() : pref);
  function applyTheme(pref = themePref()) {
    const theme = resolvedTheme(pref);
    document.documentElement.dataset.theme = theme;
    document.documentElement.style.colorScheme = theme;
    const meta = document.querySelector('meta[name="color-scheme"]');
    if (meta) meta.content = theme === "light" ? "light dark" : "dark light";
    syncThemeBtn();
  }
  function setThemePref(pref) {
    LS.set("agy.theme", pref);
    applyTheme(pref);
    if (state.drawer === "settings") renderSettings();
  }
  function syncThemeBtn() {
    const btn = $("#btnTheme");
    if (!btn) return;
    const theme = resolvedTheme();
    const next = theme === "light" ? "dark" : "light";
    btn.title = next === "light" ? "切换到亮色" : "切换到暗色";
    btn.replaceChildren(icon(theme === "light" ? "moon" : "sun"));
  }
  function cycleThemeQuick() {
    // Quick toggle flips between light/dark (pins preference, leaves system)
    setThemePref(resolvedTheme() === "light" ? "dark" : "light");
  }
  applyTheme();
  try {
    matchMedia("(prefers-color-scheme: light)").addEventListener("change", () => {
      if (themePref() === "system") applyTheme("system");
    });
  } catch { /* older browsers */ }

  // ==========================================================
  // State
  // ==========================================================
  const state = {
    health: null,
    caps: null,
    connected: false,
    models: [],
    prefs: {},
    usage: LS.get("agy.usage", null),
    usageErr: null,
    usageLoading: false,
    accountQuotas: LS.get("agy.accountQuotas", {}) || {},
    accountQuotasLoading: false,
    runs: [],
    model: LS.get("agy.model", null) || null,
    cwd: LS.get("agy.cwd", "") || "",
    recentCwds: LS.get("agy.recentCwds", []) || [],
    projCollapsed: LS.get("agy.projCollapsed", {}) || {},
    printTimeout: LS.get("agy.printTimeout", "") || "",
    timeoutMin: LS.get("agy.timeoutMin", "") || "",
    continueNext: false,
    convs: [],
    activeId: LS.get("agy.activeConv", null),
    live: new Map(), // conv.id -> { runId, ctrl, mode, stopping }
    attachments: [], // pending composer files [{id,name,path,size,ext,mime,previewUrl?}]
    search: "",
    modelFilter: "",
    drawer: null,
  };

  function normPath(p) {
    const s = String(p || "").trim();
    if (!s) return "";
    const clean = s.replace(/\//g, "\\");
    return (clean.length > 1 ? clean.replace(/[\\/]+$/, "") : clean).toLowerCase();
  }
  function convCwd(c) {
    if (!c) return "";
    if (c.cwd) return String(c.cwd).trim();
    const fromTurn = (c.turns || []).map((t) => t?.cwd).find(Boolean);
    return fromTurn ? String(fromTurn).trim() : "";
  }
  function projectKey(p) {
    const n = normPath(p);
    return n || "__none__";
  }
  function projectLabel(p) {
    if (!p) return "未绑定项目";
    return baseName(p) || p;
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

  function loadConvs() {
    const arr = LS.get("agy.convs", []);
    if (!Array.isArray(arr)) return [];
    for (const c of arr) {
      if (!c || typeof c !== "object") continue;
      if (!Array.isArray(c.queue)) c.queue = [];
      if (!c.cwd) {
        const inferred = (c.turns || []).map((t) => t?.cwd).find(Boolean);
        if (inferred) c.cwd = inferred;
      }
      for (const t of c.turns || []) {
        if (!t || typeof t !== "object") continue;
        if (t.status === "running" && t.runId) {
          t._reattach = true;
        } else {
          if (t.status === "running") {
            t.status = "aborted";
            t.endedAt = t.endedAt || t.startedAt;
            t.blocks = t.blocks || [];
            t.blocks.push({ kind: "system", key: uid("s"), text: "页面刷新或关闭，本次运行已中断。" });
          }
          for (const b of t.blocks || []) if (b && b.state === "running") b.state = "stopped";
        }
        if (Array.isArray(t.blocks)) {
          t.blocks = t.blocks.filter((b) => !(b.kind === "text" && isToolOutputText(b.text)));
        }
      }
    }
    return arr;
  }
  state.convs = loadConvs();
  if (!state.convs.some((c) => c.id === state.activeId)) state.activeId = null;

  let saveTimer = null;
  function scheduleSave() {
    clearTimeout(saveTimer);
    saveTimer = setTimeout(saveNow, 600);
  }
  function saveNow() {
    const replacer = (k, v) => (k.startsWith("_") ? undefined : typeof v === "string" && v.length > 16000 ? v.slice(0, 16000) + "\n… (truncated)" : v);
    for (let attempt = 0; attempt < 6; attempt++) {
      try {
        localStorage.setItem("agy.convs", JSON.stringify(state.convs, replacer));
        return;
      } catch {
        if (state.convs.length <= 1) return;
        const keep = [...state.convs].sort((a, b) => b.updatedAt - a.updatedAt).slice(0, Math.max(1, Math.floor(state.convs.length * 0.7)));
        state.convs = state.convs.filter((c) => keep.includes(c));
      }
    }
  }

  const activeConv = () => state.convs.find((c) => c.id === state.activeId) || null;
  const isLive = (conv) => !!conv && state.live.has(conv.id);

  function findConvForRun(runId) {
    if (!runId) return null;
    for (const [cid, live] of state.live) {
      if (live.runId === runId) return state.convs.find((c) => c.id === cid) || null;
    }
    for (const c of state.convs) {
      for (const t of c.turns || []) {
        if (t.runId === runId) return c;
      }
    }
    return null;
  }

  function listRunningOwners() {
    const out = [];
    const seen = new Set();
    for (const r of state.runs || []) {
      const c = findConvForRun(r.run_id);
      if (c && !seen.has(c.id)) {
        seen.add(c.id);
        out.push({ conv: c, run: r });
      }
    }
    for (const [cid] of state.live) {
      if (seen.has(cid)) continue;
      const c = state.convs.find((x) => x.id === cid);
      if (c) {
        seen.add(cid);
        out.push({ conv: c, run: null });
      }
    }
    return out;
  }

  async function abortRunId(runId, owner) {
    if (owner && isLive(owner)) return stopRun(owner.id);
    try {
      const res = await api("/v1/agent/abort", { method: "POST", body: { run_id: runId }, timeoutMs: 8000 });
      toast(res.ok ? "已终止后台任务" : `终止失败：${res.error}`, !res.ok);
    } catch (err) {
      toast(`终止失败：${err.message}`, true);
    }
    setTimeout(loadRuns, 800);
  }

  function closeRunsPop() {
    const pop = $("#runsPop");
    if (pop) pop.classList.add("hidden");
    $("#runsPill")?.classList.remove("on");
  }

  function renderRunsPop() {
    const pop = $("#runsPop");
    if (!pop) return;
    pop.innerHTML = "";
    pop.appendChild(h("div", { class: "rp-title", text: "进行中的任务" }));
    const owners = listRunningOwners();
    const shown = new Set(owners.map((o) => o.run?.run_id).filter(Boolean));

    const addRow = (title, sub, { onOpen, onAbort, openable }) => {
      pop.appendChild(h("div", {
        class: "run-row" + (openable ? " clickable" : ""),
        onclick: openable ? onOpen : undefined,
      },
        h("span", { class: "spin" }),
        h("div", { class: "grow" },
          h("div", { class: "rid", text: title }),
          h("div", { class: "rsub", text: sub })),
        openable ? h("button", { class: "btn sm", onclick: (e) => { e.stopPropagation(); onOpen(); } }, "打开") : null,
        h("button", { class: "btn sm danger", onclick: (e) => { e.stopPropagation(); onAbort(); } }, "停止")));
    };

    for (const { conv, run } of owners) {
      addRow(
        conv.title || "对话",
        run ? `${run.run_id} · pid ${run.pid ?? "—"} · ${fmtDur(Date.now() - run.startedAt)}` : "本页正在流式输出",
        {
          openable: true,
          onOpen: () => {
            selectConv(conv.id);
            closeRunsPop();
            closeDrawers();
            setTimeout(scrollBottom, 40);
          },
          onAbort: () => abortRunId(run?.run_id || state.live.get(conv.id)?.runId, conv),
        },
      );
    }

    for (const r of state.runs || []) {
      if (shown.has(r.run_id)) continue;
      addRow(
        "后台残留进程（前端已断开）",
        `${r.run_id} · pid ${r.pid ?? "—"} · ${fmtDur(Date.now() - r.startedAt)}`,
        {
          openable: false,
          onOpen: null,
          onAbort: () => abortRunId(r.run_id, null),
        },
      );
    }

    if (!owners.length && !(state.runs || []).length) {
      pop.appendChild(h("div", { class: "empty-note", text: "当前没有进行中的任务" }));
    }
  }

  async function focusRunning(ev) {
    ev?.stopPropagation?.();
    closePops();
    closeDrawers();

    // Prefer live frontend stream — jump immediately, never open Settings
    if (state.live.size === 1) {
      selectConv([...state.live.keys()][0]);
      closeRunsPop();
      setTimeout(scrollBottom, 40);
      return;
    }
    if (state.live.size > 1) {
      const sorted = [...state.live.keys()]
        .map((id) => state.convs.find((c) => c.id === id))
        .filter(Boolean)
        .sort((a, b) => (b.updatedAt || 0) - (a.updatedAt || 0));
      if (sorted[0]) {
        selectConv(sorted[0].id);
        closeRunsPop();
        setTimeout(scrollBottom, 40);
        toast(`已打开最近的进行中对话（共 ${state.live.size} 个）`);
        return;
      }
    }

    try { await loadRuns(); } catch { /* ignore */ }
    const owners = listRunningOwners();
    if (owners.length === 1) {
      selectConv(owners[0].conv.id);
      closeRunsPop();
      setTimeout(scrollBottom, 40);
      return;
    }

    // Multiple / orphan: show popover under the pill — never Settings
    renderRunsPop();
    const pop = $("#runsPop");
    const open = pop?.classList.contains("hidden");
    if (open) {
      pop.classList.remove("hidden");
      $("#runsPill").classList.add("on");
    } else {
      closeRunsPop();
    }
  }

  // ==========================================================
  // Models / quota helpers
  // ==========================================================
  function modelGroup(m) {
    if (m?.group) return m.group;
    const id = typeof m === "string" ? m : m?.id || "";
    if (/^gemini/i.test(id)) return "Gemini Models";
    if (/^(claude|gpt)/i.test(id)) return "Claude and GPT models";
    return "Other";
  }
  function modelLabel(id) {
    if (!id || id === "null" || id === "undefined") return "";
    const m = state.models.find((x) => x.id === id);
    const label = m ? (m.display_name || m.label || m.id) : id;
    if (label == null || label === "null" || label === "undefined") return String(id);
    return String(label);
  }
  function modelDotClass(id) {
    const g = modelGroup(id || "");
    if (/gemini/i.test(g)) return "g";
    if (/^gpt/i.test(id || "")) return "o";
    if (/claude/i.test(g)) return "c";
    return "";
  }
  const effectiveModel = () => state.model || state.prefs.defaultModel || "gemini-3.8-flash-high";
  const effectiveCwd = () => state.cwd || state.prefs.defaultCwd || state.health?.cwd || "";

  function bucketPct(b) {
    if (!b) return null;
    if (b.disabled) return 0;
    if (b.remainingPercent != null) return +b.remainingPercent;
    if (b.remainingFraction != null) return Math.round(b.remainingFraction * 1000) / 10;
    if (b.remaining_fraction != null) return Math.round(b.remaining_fraction * 1000) / 10;
    return null;
  }
  function bucketResetSecs(b) {
    if (!b) return null;
    if (b.reset_in_seconds != null) return b.reset_in_seconds;
    const rt = b.resetTime || b.reset_time;
    return rt ? Math.max(0, (new Date(rt) - Date.now()) / 1000) : null;
  }
  function pickBucket(g, window) {
    const buckets = g?.buckets || [];
    const win = String(window || "").toLowerCase();
    return buckets.find((b) => {
      const w = String(b.window || b.bucketId || "").toLowerCase();
      if (win === "weekly") return w === "weekly" || w.includes("weekly");
      if (win === "5h") return w === "5h" || w.endsWith("-5h") || w.includes("five");
      return false;
    }) || null;
  }
  function groupSummary(g) {
    const buckets = g.buckets || [];
    let limiting = null;
    for (const b of buckets) {
      if (b.disabled) continue;
      const p = bucketPct(b);
      if (p == null) continue;
      if (!limiting || p < limiting.pct) limiting = { pct: p, bucket: b };
    }
    return limiting;
  }
  function quotaForGroup(name) {
    const g = state.usage?.panel?.groups?.find((x) => (x.displayName || "").toLowerCase() === String(name).toLowerCase());
    return g ? groupSummary(g) : null;
  }
  const shortGroup = (name) => (/gemini/i.test(name) ? "Gemini" : /claude|gpt/i.test(name) ? "Claude · GPT" : name);
  const shortWin = (b) => {
    const w = String(b?.window || b?.bucketId || "").toLowerCase();
    if (w.includes("weekly") || w === "weekly") return "7d";
    if (w.includes("5h") || w === "5h") return "5h";
    return (b?.displayName || "").replace(/ Limit Remaining/i, "").slice(0, 6) || "—";
  };
  const levelClass = (p) => (p == null ? "" : p <= 10 ? "crit" : p <= 30 ? "warn" : "");

  // ==========================================================
  // Sidebar: conversations by project (folder)
  // ==========================================================
  function renderConvItem(c) {
    const last = c.turns?.[c.turns.length - 1];
    const indicator = isLive(c)
      ? h("span", { class: "spin" })
      : h("span", { class: `ci-dot ${last?.status === "error" ? "err" : last?.status === "aborted" ? "aborted" : ""}` });
    return h("button", {
      class: "conv-item" + (c.id === state.activeId ? " active" : ""),
      title: c.title,
      onclick: () => selectConv(c.id),
    },
      indicator,
      h("span", { class: "ci-title", text: c.title || "Untitled" }),
      h("span", {
        class: "ci-del", title: "删除对话", role: "button",
        onclick: (e) => { e.stopPropagation(); deleteConv(c.id); },
      }, icon("trash")),
    );
  }

  function renderConvList() {
    const list = $("#convList");
    list.innerHTML = "";
    const q = state.search.trim().toLowerCase();
    const convs = [...state.convs]
      .filter((c) => !q || (c.title || "").toLowerCase().includes(q)
        || (c.cwd || "").toLowerCase().includes(q)
        || (c.turns || []).some((t) => (t.prompt || "").toLowerCase().includes(q)))
      .sort((a, b) => b.updatedAt - a.updatedAt);

    if (!convs.length) {
      list.appendChild(h("div", {
        class: "conv-empty",
        text: q ? "没有匹配的对话" : "还没有会话。点上方 New conversation 选择本机文件夹开始。",
      }));
      return;
    }

    // Group by project cwd (like Cursor / Antigravity)
    const groups = new Map();
    for (const c of convs) {
      const cwd = convCwd(c);
      const key = projectKey(cwd);
      if (!groups.has(key)) groups.set(key, { cwd, items: [] });
      groups.get(key).items.push(c);
    }
    const ordered = [...groups.values()].sort((a, b) => {
      if (!a.cwd && b.cwd) return 1;
      if (a.cwd && !b.cwd) return -1;
      const ta = Math.max(...a.items.map((x) => x.updatedAt || 0));
      const tb = Math.max(...b.items.map((x) => x.updatedAt || 0));
      return tb - ta;
    });

    const activeCwd = convCwd(activeConv());
    for (const g of ordered) {
      const key = projectKey(g.cwd);
      const collapsed = !!state.projCollapsed[key] && projectKey(activeCwd) !== key;
      const head = h("div", { class: "proj-head" + (collapsed ? " collapsed" : "") },
        h("button", {
          class: "proj-toggle",
          type: "button",
          title: g.cwd || "未绑定项目",
          onclick: () => {
            state.projCollapsed[key] = !state.projCollapsed[key];
            LS.set("agy.projCollapsed", state.projCollapsed);
            renderConvList();
          },
        },
          h("span", { class: "proj-chev" }, icon(collapsed ? "chevRight" : "chevDown")),
          icon("folder"),
          h("span", { class: "proj-name", text: projectLabel(g.cwd) }),
          h("span", { class: "proj-count", text: String(g.items.length) }),
        ),
        h("div", { class: "proj-actions" },
          h("button", {
            class: "proj-clear",
            type: "button",
            title: `清空「${projectLabel(g.cwd)}」下的全部 ${g.items.length} 个会话`,
            onclick: (e) => {
              e.stopPropagation();
              clearProjectConvs(g.cwd || "", g.items);
            },
          }, icon("trash")),
          h("button", {
            class: "proj-add",
            type: "button",
            title: g.cwd ? `在「${projectLabel(g.cwd)}」中新建会话` : "新建未绑定项目的会话",
            onclick: (e) => {
              e.stopPropagation();
              newChatInProject(g.cwd || "");
            },
          }, icon("plus")),
        ),
      );
      list.appendChild(h("div", { class: "proj-group" }, head));
      if (!collapsed) {
        for (const c of g.items) list.appendChild(renderConvItem(c));
      }
    }
  }

  function selectConv(id) {
    state.activeId = id;
    LS.set("agy.activeConv", id);
    const c = state.convs.find((x) => x.id === id);
    const cwd = convCwd(c);
    applyCwd(cwd || "");
    closePops();
    renderConvList();
    renderThread();
    if (window.innerWidth <= 900) document.body.classList.add("side-collapsed");
    $("#promptInput").focus();
  }

  /** Create a new chat bound to a project folder (cwd). */
  function newChatInProject(cwd) {
    const path = (cwd || "").trim();
    if (path) applyCwd(path);
    const conv = {
      id: uid("c_"),
      title: "New conversation",
      conversationId: null,
      cwd: path || null,
      createdAt: Date.now(),
      updatedAt: Date.now(),
      turns: [],
      queue: [],
    };
    state.convs.unshift(conv);
    state.activeId = conv.id;
    LS.set("agy.activeConv", conv.id);
    state.continueNext = false;
    // Ensure project group is expanded
    const key = projectKey(path);
    if (state.projCollapsed[key]) {
      delete state.projCollapsed[key];
      LS.set("agy.projCollapsed", state.projCollapsed);
    }
    closePops();
    closeModal();
    scheduleSave();
    renderConvList();
    renderThread();
    renderCwdChip();
    $("#promptInput").focus();
  }

  /** Top-level New conversation → browse local folders (best UX). */
  function newChat() {
    openProjectPicker();
  }

  function openProjectPicker(opts = {}) {
    const start = opts.start || state.cwd || state.prefs.defaultCwd || state.health?.cwd || "";
    const onPick = opts.onPick || ((p) => newChatInProject(p));
    let current = start;
    let loading = false;

    const body = h("div", { class: "fs-picker" });
    const crumb = h("div", { class: "fs-crumb" });
    const list = h("div", { class: "fs-list" });
    const foot = h("div", { class: "fs-foot" });
    body.append(crumb, list, foot);

    const setLoading = (on) => {
      loading = on;
      list.classList.toggle("loading", on);
    };

    const renderCrumb = (data) => {
      crumb.innerHTML = "";
      const parts = [];
      if (data.atRoots || !data.path) {
        parts.push({ label: "此电脑", path: ":roots" });
      } else {
        parts.push({ label: "此电脑", path: ":roots" });
        // Build path segments
        const full = data.path.replace(/\//g, "\\");
        const segs = full.split("\\").filter(Boolean);
        let acc = "";
        for (let i = 0; i < segs.length; i++) {
          const seg = segs[i];
          if (i === 0 && /^[A-Za-z]:$/.test(seg)) acc = seg + "\\";
          else acc = acc ? pathJoin(acc, seg) : seg;
          parts.push({ label: seg, path: acc });
        }
      }
      for (let i = 0; i < parts.length; i++) {
        const p = parts[i];
        if (i) crumb.appendChild(h("span", { class: "fs-sep", text: "/" }));
        crumb.appendChild(h("button", {
          class: "fs-crumb-btn" + (i === parts.length - 1 ? " cur" : ""),
          type: "button",
          title: p.path,
          onclick: () => load(p.path),
        }, p.label));
      }
    };

    const pathJoin = (a, b) => {
      if (!a) return b;
      if (/^[A-Za-z]:\\?$/.test(a)) return a.replace(/\\?$/, "\\") + b;
      return a.replace(/[\\/]+$/, "") + "\\" + b;
    };

    const renderList = (data) => {
      list.innerHTML = "";
      if (!data.entries?.length) {
        list.appendChild(h("div", { class: "fs-empty", text: "此目录下没有子文件夹" }));
        return;
      }
      for (const ent of data.entries) {
        list.appendChild(h("button", {
          class: "fs-item",
          type: "button",
          title: ent.path,
          onclick: () => load(ent.path),
          ondblclick: () => { onPick(ent.path); },
        },
          icon("folder"),
          h("span", { class: "fs-item-name", text: ent.name }),
          h("span", { class: "fs-item-go" }, icon("chevRight")),
        ));
      }
    };

    const renderFoot = (data) => {
      foot.innerHTML = "";
      const canSelect = !data.atRoots && !!data.path;
      const recent = state.recentCwds || [];
      if (recent.length && (data.atRoots || !current)) {
        foot.appendChild(h("div", { class: "fs-recent-title", text: "最近项目" }));
        for (const p of recent.slice(0, 6)) {
          foot.appendChild(h("button", {
            class: "fs-recent",
            type: "button",
            title: p,
            onclick: () => load(p),
            ondblclick: () => onPick(p),
          },
            icon("folder"),
            h("div", { class: "fs-recent-main" },
              h("div", { class: "fs-recent-name", text: baseName(p) }),
              h("div", { class: "fs-recent-path", text: p }),
            ),
          ));
        }
      }
      foot.appendChild(h("div", { class: "fs-actions" },
        h("button", {
          class: "btn sm ghost",
          type: "button",
          onclick: () => { closeModal(); newChatInProject(""); },
        }, "不绑定项目"),
        h("button", {
          class: "btn sm",
          type: "button",
          onclick: () => load(data.home || ":roots"),
        }, "用户目录"),
        h("button", {
          class: "btn sm primary",
          type: "button",
          disabled: !canSelect,
          onclick: () => { if (canSelect) onPick(data.path); },
        }, canSelect ? `在「${baseName(data.path)}」新建` : "选择文件夹"),
      ));
    };

    async function load(dir) {
      if (loading) return;
      setLoading(true);
      current = dir;
      try {
        const q = dir === ":roots" || !dir ? ":roots" : dir;
        const data = await api(`/v1/fs/list?path=${encodeURIComponent(q)}`, { timeoutMs: 15000 });
        renderCrumb(data);
        renderList(data);
        renderFoot(data);
      } catch (err) {
        list.innerHTML = "";
        list.appendChild(h("div", { class: "fs-empty", text: `无法打开：${err.message || err}` }));
        foot.innerHTML = "";
        foot.appendChild(h("div", { class: "fs-actions" },
          h("button", { class: "btn sm", type: "button", onclick: () => load(":roots") }, "返回此电脑"),
          h("button", { class: "btn sm ghost", type: "button", onclick: () => closeModal() }, "取消"),
        ));
      } finally {
        setLoading(false);
      }
    }

    openModal("选择项目文件夹", body);
    load(start || ":roots");
  }

  async function deleteConv(id) {
    const c = state.convs.find((x) => x.id === id);
    if (!c) return;
    const live = state.live.get(id);
    const activeRunIdSet = new Set((state.runs || []).map((r) => r.run_id));
    const runIds = new Set();
    if (live?.runId) runIds.add(live.runId);
    for (const t of c.turns || []) {
      if (t.runId && activeRunIdSet.has(t.runId)) runIds.add(t.runId);
    }

    const convIds = new Set();
    if (c.conversationId) convIds.add(c.conversationId);
    for (const t of c.turns || []) {
      for (const b of t.blocks || []) {
        if (b.kind !== "subagent") continue;
        for (const sa of b.subagents || []) {
          const sid = sa.transcript_id || sa.conversation_id;
          if (sid) convIds.add(sid);
        }
      }
    }

    const parts = [];
    if (runIds.size || live) parts.push(`停止 ${runIds.size || 1} 个后台任务`);
    if (convIds.size) parts.push(`删除 ${convIds.size} 组本地残留文件（brain / db）`);
    const hint = parts.length ? `\n\n将同时：${parts.join("；")}。` : "";
    if (!confirm(`删除对话「${c.title || "Untitled"}」？${hint}`)) return;

    if (live) {
      try { await stopRun(id, true); } catch { /* ignore */ }
    }
    for (const rid of runIds) {
      if (live?.runId === rid) continue;
      try {
        await api("/v1/agent/abort", { method: "POST", body: { run_id: rid }, timeoutMs: 8000 });
      } catch { /* ignore */ }
    }
    state.live.delete(id);

    let purged = 0;
    if (convIds.size) {
      try {
        const res = await api("/v1/conversations/purge", {
          method: "POST",
          body: { conversation_ids: [...convIds] },
          timeoutMs: 30000,
        });
        purged = res.count || 0;
        if (res.errors?.length) toast(`部分残留未能删除：${res.errors[0].error || "unknown"}`, true);
      } catch (err) {
        toast(`残留文件清理失败：${err.message}`, true);
      }
    }

    state.convs = state.convs.filter((x) => x.id !== id);
    if (state.activeId === id) state.activeId = null;
    LS.set("agy.activeConv", state.activeId);
    saveNow();
    renderConvList();
    renderThread();
    closeRunsPop();
    setTimeout(loadRuns, 400);
    toast(`对话已删除${runIds.size ? "，任务已停止" : ""}${purged ? `，清理 ${purged} 个文件` : ""}`);
  }

  async function clearProjectConvs(cwd, items) {
    if (!items || !items.length) return;
    const label = projectLabel(cwd);
    const n = items.length;
    if (!confirm(`确定清空「${label}」分组下的全部 ${n} 个会话？\n\n将同时停止相关运行并删除本地残留文件（brain / db）。此操作不可撤销。`)) return;

    const itemIds = new Set(items.map((x) => x.id));
    const activeRunIdSet = new Set((state.runs || []).map((r) => r.run_id));
    const runIds = new Set();
    const convIds = new Set();

    for (const c of items) {
      const live = state.live.get(c.id);
      if (live?.runId) runIds.add(live.runId);
      if (c.conversationId) convIds.add(c.conversationId);
      for (const t of c.turns || []) {
        if (t.runId && activeRunIdSet.has(t.runId)) runIds.add(t.runId);
        for (const b of t.blocks || []) {
          if (b.kind !== "subagent") continue;
          for (const sa of b.subagents || []) {
            const sid = sa.transcript_id || sa.conversation_id;
            if (sid) convIds.add(sid);
          }
        }
      }
      if (live) {
        try { await stopRun(c.id, true); } catch { /* ignore */ }
      }
      state.live.delete(c.id);
    }

    for (const rid of runIds) {
      try {
        await api("/v1/agent/abort", { method: "POST", body: { run_id: rid }, timeoutMs: 8000 });
      } catch { /* ignore */ }
    }

    let purged = 0;
    if (convIds.size) {
      try {
        const res = await api("/v1/conversations/purge", {
          method: "POST",
          body: { conversation_ids: [...convIds] },
          timeoutMs: 60000,
        });
        purged = res.count || 0;
      } catch (err) {
        toast(`残留文件清理失败：${err.message}`, true);
      }
    }

    state.convs = state.convs.filter((x) => !itemIds.has(x.id));
    if (state.activeId && itemIds.has(state.activeId)) state.activeId = null;
    LS.set("agy.activeConv", state.activeId);
    saveNow();
    renderConvList();
    renderThread();
    closeRunsPop();
    setTimeout(loadRuns, 400);
    toast(`已清空「${label}」下的 ${n} 个会话${purged ? `，清理 ${purged} 个文件` : ""}`);
  }

  // ==========================================================
  // Thread rendering
  // ==========================================================
  const threadEl = $("#thread");
  const threadInner = $("#threadInner");
  const nearBottom = () => threadEl.scrollHeight - threadEl.scrollTop - threadEl.clientHeight < 120;
  const scrollBottom = () => { threadEl.scrollTop = threadEl.scrollHeight; };

  function renderThread() {
    const conv = activeConv();
    threadInner.innerHTML = "";
    const empty = !conv || !conv.turns.length;
    $("#main").classList.toggle("is-empty", empty && !(conv?.queue?.length));
    if (conv) {
      for (const t of conv.turns) threadInner.appendChild(renderTurn(conv, t));
      renderQueue(conv);
      if (conv.conversationId) enrichTurnFromTranscript(conv);
    }
    renderTopbar();
    syncComposer();
    requestAnimationFrame(scrollBottom);
  }

  function renderTopbar() {
    const conv = activeConv();
    const title = $("#convTitle");
    title.value = conv?.title || "New conversation";
    title.readOnly = !conv;
    const chip = $("#convIdChip");
    if (conv?.conversationId) {
      chip.textContent = `#${shortId(conv.conversationId)}`;
      chip.classList.remove("hidden");
    } else chip.classList.add("hidden");
    document.title = conv?.title ? `${conv.title} · Antigravity 破甲` : "Antigravity 破甲";
  }

  function renderTurn(conv, turn) {
    const cleanPrompt = cleanUserPrompt(turn.prompt);
    const uMeta = h("div", { class: "u-meta" },
      h("span", { text: fmtTime(turn.at) }),
      turn.cwd ? h("span", { class: "mono", title: turn.cwd, text: baseName(turn.cwd) }) : null,
      h("button", { title: "复制", onclick: () => copyText(cleanPrompt) }, icon("copy")),
      h("button", { title: "编辑后重新发送", onclick: () => setPrompt(cleanPrompt) }, icon("edit")),
    );
    const attachRow = (turn.attachments || []).length
      ? h("div", { class: "u-atts" }, turn.attachments.map((f) =>
        h("span", { class: "u-att", title: f.path || f.name },
          icon(isImageExt(f.ext) ? "image" : "file"),
          h("span", { text: f.name || baseName(f.path) }))))
      : null;
    const head = h("div", { class: "a-head" });
    const blocks = h("div", { class: "a-blocks" });
    const live = h("div", { class: "a-live hidden" });
    const foot = h("div", { class: "a-foot" });
    const root = h("article", { class: "turn" },
      h("div", { class: "u-msg" }, attachRow, h("div", { class: "u-bubble", text: cleanPrompt }), uMeta),
      h("div", { class: "a-msg" }, head, blocks, live, foot),
    );
    const prevTx = turn._v?.tx;
    turn._v = { conv, root, head, blocks, live, foot, els: new Map(), tx: new Map(), wait: null };
    if (prevTx) for (const [id, tx] of prevTx) { clearInterval(tx.timer); }
    paintHead(turn);
    paintAllBlocks(turn);
    paintWait(turn);
    updateCaret(turn);
    paintLive(turn);
    paintFoot(turn);
    return root;
  }

  function selectingIn(el) {
    const sel = window.getSelection?.();
    if (!el || !sel || sel.isCollapsed || !sel.rangeCount) return false;
    return el.contains(sel.anchorNode) || el.contains(sel.focusNode);
  }

  /** Rebuilding the turn would wipe the user's text selection; retry once it is released. */
  function deferWhileSelecting(turn) {
    if (!selectingIn(turn._v.blocks)) return false;
    if (!turn._v.selWait) {
      turn._v.selWait = setTimeout(() => {
        turn._v.selWait = 0;
        if (!attached(turn)) return;
        paintAllBlocks(turn);
        updateCaret(turn);
      }, 700);
    }
    return true;
  }

  function clearSelection() {
    window.getSelection?.()?.removeAllRanges();
  }

  function toolLabel(b) {
    const d = describeTool(b.name, b.params);
    return d.phrase || [d.verb, d.target].filter(Boolean).join(" ") || b.name || "工具";
  }

  function errorSnippet(b) {
    const raw = b.error != null ? pretty(b.error) : typeof b.output === "string" ? b.output : b.output != null ? pretty(b.output) : "";
    const lines = raw.split(/\r?\n|(?<=\.)\s+(?=[A-Z])/).map((l) => l.trim()).filter(Boolean);
    const hit = [...lines].reverse().find((l) => /error|exception|traceback|failed|fatal|denied|not found|no such|无法|错误|失败/i.test(l) && !/^Created At:/.test(l));
    const line = hit || lines[lines.length - 1] || "";
    return [b.exitCode ? `退出码 ${b.exitCode}` : "", line].filter(Boolean).join(" · ");
  }

  const CONTINUE_AFTER_KILL_PROMPT = "上一轮有后台任务在 agy 退出时被强制终止（agy 最多只等后台任务 30 分钟）。请先检查这些任务的实际状态（日志、进程、产物）并直接告诉我结果；没完成的，改用独立进程重新启动（Windows 用 Start-Process；WSL 用隐藏的 wsl.exe 前台运行并把输出写入日志文件），然后继续原来的任务。";

  /** Status strip under a turn: latest transcript activity, background tasks, idle-wait countdown. */
  function paintLive(turn) {
    const v = turn._v;
    if (!v?.live) return;
    const now = Date.now();
    const rows = [];
    const row = (cls, ico, k, val, extra) => h("div", { class: `lv-row ${cls}` },
      icon(ico), h("span", { class: "lv-k", text: k }), h("span", { class: "lv-v", text: val }), extra || null);
    if (turn.status === "running") {
      const act = turn._txLast;
      if (act) rows.push(row("", "zap", "最新动态", `第 ${act.idx} 步 · ${act.desc}`,
        act.at ? h("span", { class: "lv-t", text: `${fmtDur(now - act.at)}前` }) : null));
      const th = turn.thoughts?.[turn.thoughts.length - 1];
      if (th?.thinking) {
        const at = Date.parse(th.created_at || "");
        rows.push(row("", "brain", "最新思路", oneLine(th.thinking, 220),
          at ? h("span", { class: "lv-t", text: `${fmtDur(now - at)}前` }) : null));
      }
      for (const b of turn.blocks || []) {
        if (b.bg && !b.bg.finished && b.state === "running") {
          const since = Date.parse(b.bg.since || "");
          rows.push(row("", "terminal", "后台任务", oneLine(b.bg.desc || toolLabel(b), 140),
            since ? h("span", { class: "lv-t", text: `已运行 ${fmtDur(now - since)}` }) : null));
        }
        if (b.kind === "subagent") {
          for (const sa of b.subagents || []) {
            if (sa.finished) continue;
            const last = sa._last;
            rows.push(row("", "bot", "子代理", `${sa.role || sa.type_name || "subagent"} 运行中${last ? ` · ${last.desc}` : ""}`,
              last?.at ? h("span", { class: "lv-t", text: `${fmtDur(now - last.at)}前` }) : null));
          }
        }
      }
      if (turn.idleWait) {
        const left = Math.max(0, turn.idleWait.limitMs - (now - turn.idleWait.at));
        const pending = (turn.blocks || []).filter((b) => b.bg && !b.bg.finished && b.state === "running")
          .map((b) => oneLine(b.bg.desc || toolLabel(b), 60));
        const conv = state.convs.find((c) => (c.turns || []).includes(turn));
        rows.push(row("warn", "clock", "等待后台任务",
          `agent 已写完回复，只剩 ${turn.idleWait.count} 个后台任务没结束${pending.length ? `（${pending.join("；")}）` : ""}。agy 最多再等 ${fmtDur(left)}；不需要这些任务就直接结束。`,
          conv ? h("button", { class: "btn sm", onclick: () => stopRun(conv.id) }, icon("stop"), "结束等待") : null));
      }
    }
    if (turn.bgKilled) {
      rows.push(row("err", "alert", "后台任务被终止", `${turn.bgKilled} 个后台任务在 agy 退出时被强制终止（agy 最多只等后台任务 30 分钟）。`,
        turn.status !== "running" ? h("button", { class: "btn sm", onclick: () => setPrompt(CONTINUE_AFTER_KILL_PROMPT) }, icon("rotate"), "让 agent 检查并继续") : null));
    }
    v.live.replaceChildren(...rows);
    v.live.classList.toggle("hidden", !rows.length);
  }

  const attached = (turn) => !!turn._v && turn._v.root.isConnected;

  function paintHead(turn) {
    if (!turn._v) return;
    const v = turn._v;
    v.head.innerHTML = "";
    let st;
    if (turn.status === "running") {
      st = h("span", { class: "a-state" }, h("span", { class: "spin" }), h("span", { class: "shimmer", text: "Working" }),
        h("span", { class: "el", text: fmtDur(Date.now() - turn.startedAt) }));
    } else {
      const dur = turn.endedAt && turn.startedAt ? fmtDur(turn.endedAt - turn.startedAt) : "";
      const label = turn.status === "error" ? "Failed" : turn.status === "aborted" ? "Stopped" : "Done";
      const cls = turn.status === "error" ? "red" : turn.status === "aborted" ? "" : "green";
      st = h("span", { class: "a-state" }, h("span", { class: `tag ${cls}`, text: label }), dur ? h("span", { text: dur }) : null);
    }
    v.head.append(
      logoEl("logo"),
      h("span", { class: "a-name", text: "Antigravity" }),
      turn.model ? h("span", { class: "a-model", text: modelLabel(turn.model) || turn.model }) : null,
      st,
    );
  }

  function paintWait(turn) {
    if (!turn._v) return;
    const v = turn._v;
    const need = turn.status === "running" && !turn.blocks.length;
    if (need && !v.wait) {
      v.wait = h("div", { class: "blk-wait" }, h("span", { class: "spin" }), h("span", { class: "shimmer", text: "Planning next steps…" }));
      v.blocks.appendChild(v.wait);
    } else if (!need && v.wait) {
      v.wait.remove();
      v.wait = null;
    }
  }

  function updateCaret(turn) {
    if (!turn._v) return;
    for (const el of $$(".md.caret", turn._v.blocks)) el.classList.remove("caret");
    if (turn.status !== "running") return;
    const last = turn.blocks[turn.blocks.length - 1];
    if (last?.kind === "text") turn._v.els.get(last.key)?.querySelector(".md")?.classList.add("caret");
  }

  function isNoiseTool(b) {
    if (!b || b.kind !== "tool") return false;
    const p = parseMaybeJSON(b.params);
    const obj = p && typeof p === "object" ? p : {};
    const action = String(pick(obj, ["toolAction", "ToolAction", "action"]) || "");
    const summary = String(pick(obj, ["toolSummary", "ToolSummary", "summary"]) || "");
    const cmd = String(pick(obj, ["CommandLine", "Command", "cmd"]) || "");
    const blob = `${action} ${summary} ${cmd}`;
    return /test(?:ing|ed)?\b|command runner|environment PATH|Checking PATH|powershell (?:dir|directory|path|v1\.0)|FSO GetFolder|regex on robocopy|python availability|Write-Output\s|echo\s+test|Stopping (?:full|broad)|Cancelling task|Setting timer|Checking scan task/i.test(blob);
  }

  function isStepBlock(b) {
    return b?.kind === "tool" || b?.kind === "subagent";
  }

  function isSubagentBlock(b) {
    return b?.kind === "subagent" || (b?.kind === "tool" && b.name === "invoke_subagent");
  }

  function classifyTool(toolName, params) {
    const n = String(toolName || "").toLowerCase();
    const p = parseMaybeJSON(params);
    const obj = p && typeof p === "object" ? p : {};
    const action = String(pick(obj, ["toolAction", "ToolAction", "action"]) || "").toLowerCase();
    const summary = String(pick(obj, ["toolSummary", "ToolSummary", "summary"]) || "").toLowerCase();
    const cmd = String(pick(obj, ["CommandLine", "Command", "cmd"]) || "");
    const meta = `${action} ${summary}`;

    if (/invoke_subagent|define_subagent|manage_subagent|subagent/.test(n) || /subagent|子代理/.test(meta)) {
      return "subagent";
    }
    if (/task|manage_task|task_boundary/.test(n) || /task|任务/.test(meta)) {
      return "task";
    }
    if (/write_to_file|create_file|write_file|replace|multi_replace|edit|patch|sed_file/.test(n) ||
        /write|edit|replace|patch|修改|创建|编辑|写入|删除|清理/.test(meta) ||
        /Remove-Item|Clear-RecycleBin|rimraf|\brm\b|\bdel\b/i.test(cmd)) {
      return "edit";
    }
    if (/grep|codebase_search|search_web|web_search|read_url|fetch|glob/.test(n) ||
        /search|grep|find|query|搜索|查找|查询/.test(meta) ||
        /Select-String|findstr|\bgrep\b/i.test(cmd)) {
      return "search";
    }
    if (/view|read|list|outline|browse|cat|dir|find_by_name/.test(n) ||
        /view|read|list|explore|inspect|scan|check|analyz|examin|查看|读取|探索|分析|浏览|列出|扫描|检查/.test(meta) ||
        /Get-ChildItem|Get-PSDrive|Get-Item|Get-Content|\bdir\b|\bls\b|\btree\b|Measure-Object/i.test(cmd)) {
      return "explored";
    }
    if (/run_command|^shell|bash|exec|terminal|command_status|send_command_input/.test(n) || /command|shell|exec|命令|终端|执行/.test(meta)) {
      return "command";
    }
    return "other";
  }

  function aggregateStepStats(bucket) {
    const stats = {
      explored: 0,
      search: 0,
      command: 0,
      edit: 0,
      subagent: 0,
      task: 0,
      other: 0,
      total: 0,
    };
    for (const b of bucket) {
      if (!b) continue;
      if (b.kind === "subagent") {
        const count = (b.subagents && b.subagents.length) ? b.subagents.length : 1;
        stats.subagent += count;
        stats.total += count;
        continue;
      }
      if (b.kind === "tool") {
        const cat = classifyTool(b.name, b.params);
        if (cat === "subagent") {
          const subs = extractSubagentsFromToolBlock(b);
          const count = subs.length ? subs.length : 1;
          stats.subagent += count;
          stats.total += count;
          continue;
        }
        stats[cat] = (stats[cat] || 0) + 1;
        stats.total += 1;
        continue;
      }
      stats.total += 1;
    }
    return stats;
  }

  function renderStepPills(stats) {
    const wrap = h("span", { class: "steps-stats" });
    let renderedCount = 0;
    if (stats.explored > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-explored", title: `${stats.explored} 次文件/目录探索` }, icon("eye"), `探索 ${stats.explored}`));
      renderedCount++;
    }
    if (stats.search > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-search", title: `${stats.search} 次代码/网络搜索` }, icon("search"), `搜索 ${stats.search}`));
      renderedCount++;
    }
    if (stats.command > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-command", title: `${stats.command} 条命令执行` }, icon("terminal"), `命令 ${stats.command}`));
      renderedCount++;
    }
    if (stats.edit > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-edit", title: `${stats.edit} 处文件修改/创建` }, icon("pencil"), `修改 ${stats.edit}`));
      renderedCount++;
    }
    if (stats.subagent > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-subagent", title: `${stats.subagent} 个子代理调度` }, icon("bot"), `子代理 ${stats.subagent}`));
      renderedCount++;
    }
    if (stats.task > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-task", title: `${stats.task} 个任务操作` }, icon("list"), `任务 ${stats.task}`));
      renderedCount++;
    }
    if (!renderedCount && stats.total > 0) {
      wrap.appendChild(h("span", { class: "step-stat-badge pill-other" }, icon("tool"), `${stats.total} 步骤`));
    }
    return wrap;
  }

  function buildThinkingCard(turn) {
    const thoughts = turn.thoughts || (turn.thinking ? [{ thinking: turn.thinking }] : []);
    if (!thoughts.length) return null;
    const isRunning = turn.status === "running";
    const open = turn._thinkOpen != null ? !!turn._thinkOpen : true;
    const firstPreview = oneLine(thoughts[0].thinking || "", 120);

    const summary = h("summary", {
      class: "think-summary",
      title: "点击展开/收起思考过程",
    },
      h("span", { class: "think-ico" }, icon("brain")),
      h("span", { class: "think-title", text: isRunning ? "思考中…" : "思考过程" }),
      thoughts.length > 1 ? h("span", { class: "think-badge", text: `${thoughts.length} 阶段` }) : null,
      turn.usage?.thinking_tokens ? h("span", { class: "think-badge", title: "thinking tokens", text: `${fmtNum(turn.usage.thinking_tokens)} think` }) : null,
      h("span", { class: "think-prev", text: firstPreview }),
      h("span", { class: "think-chev" }, icon("chevRight")),
    );

    const body = h("div", { class: "think-body md" });
    if (thoughts.length === 1) {
      body.innerHTML = md(thoughts[0].thinking || "");
    } else {
      thoughts.forEach((th, idx) => {
        const phHead = h("div", { class: "think-phase-title", text: `第 ${idx + 1} 阶段思考` + (th.step_index != null ? ` · Step #${th.step_index}` : "") });
        const phBody = h("div", { html: md(th.thinking || "") });
        body.append(phHead, phBody);
      });
    }

    const card = h("details", { class: "think-card" }, summary, body);
    if (open) card.open = true;
    card.addEventListener("toggle", () => {
      turn._thinkOpen = card.open;
    });
    return card;
  }

  /** Rebuild block list: tool/subagent rows live in a collapsible group that auto-closes when the turn finishes. */
  function paintAllBlocks(turn) {
    if (!turn._v) return;
    if (deferWhileSelecting(turn)) return;
    const v = turn._v;
    const frag = document.createDocumentFragment();
    const els = new Map();
    let mainBucket = [];
    let noiseBucket = [];

    // Thinking process card displayed prominently at the top
    const thinkCard = buildThinkingCard(turn);
    if (thinkCard) frag.appendChild(thinkCard);

    const makeGroup = (bucket, { noise = false } = {}) => {
      if (!bucket.length) return;
      const stats = aggregateStepStats(bucket);
      const busy = turn.status === "running" || bucket.some((b) => b.state === "running");
      const key = noise ? "_noiseOpen" : "_stepsOpen";
      if (turn[key] == null) {
        const hasText = (turn.blocks || []).some((b) => b.kind === "text" && b.text);
        turn[key] = noise ? false : (busy && bucket.length <= 4 && !hasText);
      }
      const open = !!turn[key];
      const body = h("div", { class: "steps-body" });
      for (const b of bucket) {
        const el = buildBlock(turn, b);
        els.set(b.key, el);
        body.appendChild(el);
      }
      if (!open) body.classList.add("hidden");

      let toggleKids;
      if (noise) {
        toggleKids = [
          h("span", { class: "bt-chev" }, icon("chevRight")),
          h("span", { class: "steps-label", text: open ? `调试探测 · ${stats.total}` : `另有 ${stats.total} 条调试步骤` }),
          h("span", { class: "steps-hint", text: open ? "点击收起" : "点击展开" }),
        ];
      } else {
        const pillsWrap = renderStepPills(stats);
        toggleKids = [
          h("span", { class: "bt-chev" }, icon("chevRight")),
          busy ? h("span", { class: "spin", style: "margin-right:2px" }) : h("span", { class: "bt-state ok", style: "margin-right:2px" }, icon("check")),
          h("span", { class: "steps-label", text: busy ? "执行中" : "已完成" }),
          pillsWrap,
          h("span", { class: "steps-hint", text: open ? "点击收起" : "点击展开" }),
        ];
      }

      const wrap = h("div", { class: "steps-group" + (open ? " open" : "") + (noise ? " noise" : "") },
        h("button", {
          class: "steps-toggle",
          type: "button",
          title: open ? "收起" : "展开",
          onclick: () => {
            clearSelection();
            turn[key] = !turn[key];
            paintAllBlocks(turn);
          },
        }, ...toggleKids),
        body,
      );
      frag.appendChild(wrap);

      const failed = noise ? [] : bucket.filter((b) => b.state === "error");
      if (failed.length) {
        frag.appendChild(h("div", { class: "step-fails" },
          failed.length > 3 ? h("div", { class: "sf-more", text: `共 ${failed.length} 个步骤失败，显示最近 3 个` }) : null,
          ...failed.slice(-3).map((b) => h("button", {
            class: "step-fail",
            type: "button",
            title: "点击展开这一步的详细输出",
            onclick: () => {
              clearSelection();
              turn[key] = true;
              b._open = true;
              paintAllBlocks(turn);
            },
          },
          icon("alert"),
          h("span", { class: "sf-label", text: `失败：${oneLine(toolLabel(b), 80)}` }),
          h("span", { class: "sf-err", text: oneLine(errorSnippet(b), 200) })))));
      }
    };

    const flushSteps = () => {
      makeGroup(mainBucket, { noise: false });
      makeGroup(noiseBucket, { noise: true });
      mainBucket = [];
      noiseBucket = [];
    };

    for (const b of turn.blocks || []) {
      // subagent cards stay outside the collapsible group so their progress is always visible
      if (isStepBlock(b) && !isSubagentBlock(b)) {
        if (isNoiseTool(b)) noiseBucket.push(b);
        else mainBucket.push(b);
      } else {
        flushSteps();
        const el = buildBlock(turn, b);
        els.set(b.key, el);
        frag.appendChild(el);
      }
    }
    flushSteps();

    v.els = els;
    v.blocks.replaceChildren(frag);
    v.wait = null;
    paintWait(turn);
  }

  function paintBlock(turn, b) {
    if (!turn._v) return;
    // Step blocks (and mixed streams) always go through grouped rebuild so collapse state stays consistent
    if (isStepBlock(b) || (turn.blocks || []).some(isStepBlock)) {
      paintAllBlocks(turn);
      return;
    }
    if (deferWhileSelecting(turn)) return;
    const v = turn._v;
    const el = buildBlock(turn, b);
    const old = v.els.get(b.key);
    if (old) old.replaceWith(el);
    else {
      if (v.wait) { v.wait.remove(); v.wait = null; }
      v.blocks.appendChild(el);
    }
    v.els.set(b.key, el);
  }

  // batched painting for streaming
  const pending = new Map(); // turn -> Set(blocks)
  let rafId = 0;
  function schedulePaint(turn, block, meta = false) {
    if (!attached(turn)) return;
    if (!pending.has(turn)) pending.set(turn, { blocks: new Set(), meta: false });
    const p = pending.get(turn);
    if (block) p.blocks.add(block);
    if (meta) p.meta = true;
    if (!rafId) rafId = requestAnimationFrame(flushPaint);
  }
  function flushPaint() {
    rafId = 0;
    const stick = nearBottom();
    for (const [turn, p] of pending) {
      if (!attached(turn)) continue;
      if ([...p.blocks].some(isStepBlock) || (turn.blocks || []).some(isStepBlock)) {
        paintAllBlocks(turn);
      } else {
        for (const b of p.blocks) paintBlock(turn, b);
      }
      if (p.meta) { paintHead(turn); paintLive(turn); paintFoot(turn); }
      paintWait(turn);
      updateCaret(turn);
    }
    pending.clear();
    if (stick) scrollBottom();
  }

  function extractSubagentsFromToolBlock(b) {
    if (Array.isArray(b?.subagents) && b.subagents.length) return b.subagents;
    const p = parseMaybeJSON(b?.params);
    const obj = p && typeof p === "object" ? p : {};
    let raw = obj.Subagents ?? obj.subagents ?? obj.agents;
    const rawText = typeof raw === "string" ? raw : null;
    if (typeof raw === "string") raw = parseMaybeJSON(raw);
    if (!Array.isArray(raw) || !raw.length) {
      // transcript args get cut ("<truncated N bytes>"), which breaks the JSON: salvage prompts/roles/ids
      const outText = b?.output == null ? "" : typeof b.output === "string" ? b.output : JSON.stringify(b.output);
      const ids = [...outText.matchAll(/"conversationId":\s*"([0-9a-f-]{36})"/gi)].map((m) => m[1]);
      const grab = (key) => rawText ? [...rawText.matchAll(new RegExp(`"${key}"\\s*:\\s*"((?:[^"\\\\]|\\\\.)*)`, "g"))]
        .map((m) => m[1].replace(/\n?<truncated \d+ bytes>$/, "").replace(/\\n/g, "\n").replace(/\\(.)/g, "$1")) : [];
      const roles = grab("Role");
      const prompts = grab("Prompt");
      const n = Math.max(ids.length, roles.length, prompts.length);
      return Array.from({ length: n }, (_, i) => ({
        role: roles[i] || "subagent",
        initial_prompt: prompts[i] || null,
        conversation_id: ids[i] || null,
        transcript_id: ids[i] || null,
      }));
    }
    const subs = raw.map((sa) => ({
      role: sa.Role || sa.role || sa.TypeName || sa.type_name || "subagent",
      type_name: sa.TypeName || sa.type_name || sa.Type || sa.type,
      initial_prompt: sa.Prompt || sa.prompt || sa.task || sa.Task,
      model: sa.Model || sa.model,
      workspace: sa.Workspace || sa.workspace,
      conversation_id: sa.conversation_id || sa.conversationId || null,
      transcript_id: sa.conversation_id || sa.conversationId || null,
    }));
    if (b?.output) {
      const outText = typeof b.output === "string" ? b.output : JSON.stringify(b.output);
      const matches = [...outText.matchAll(/"conversationId":\s*"([0-9a-f-]+)"/gi)];
      if (matches.length) {
        for (let i = 0; i < subs.length && i < matches.length; i++) {
          if (!subs[i].conversation_id) {
            subs[i].conversation_id = matches[i][1];
            subs[i].transcript_id = matches[i][1];
          }
        }
      } else {
        const uuids = [...outText.matchAll(/\b([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\b/gi)];
        for (let i = 0; i < subs.length && i < uuids.length; i++) {
          if (!subs[i].conversation_id) {
            subs[i].conversation_id = uuids[i][1];
            subs[i].transcript_id = uuids[i][1];
          }
        }
      }
    }
    return subs;
  }

  function buildBlock(turn, b) {
    if (b.kind === "subagent" || (b.kind === "tool" && b.name === "invoke_subagent")) {
      const subs = extractSubagentsFromToolBlock(b);
      if (subs.length > 0) {
        b.subagents = subs;
        return buildSubagent(turn, b);
      }
    }
    switch (b.kind) {
      case "text":
        if (isToolOutputText(b.text)) return h("div", { style: "display:none" });
        return h("div", { class: "blk-text" }, h("div", { class: "md", html: md(b.text) }));
      case "tool":
        return buildTool(turn, b);
      case "subagent":
        return buildSubagent(turn, b);
      case "error":
        return h("div", { class: "blk-error" }, icon("alert"),
          h("div", { class: "be-body" }, b.text || "Error", b.code ? h("div", { class: "be-code", text: b.code }) : null));
      case "system":
        return h("div", { class: "blk-system" }, icon("info"), h("span", { text: b.text }));
      default:
        return h("div");
    }
  }

  // ---------- tools ----------
  function describeTool(name, params) {
    const n = String(name || "tool").toLowerCase();
    const p = parseMaybeJSON(params);
    const obj = p && typeof p === "object" ? p : {};
    const action = pick(obj, ["toolAction", "ToolAction", "action"]);
    const summary = pick(obj, ["toolSummary", "ToolSummary", "summary"]);
    const file = pick(obj, ["AbsolutePath", "TargetFile", "FilePath", "File", "Path", "Uri", "DirectoryPath"]);
    const meta = action || summary;

    if (n === "task_boundary") return { kind: "task" };
    if (/run_command|^shell|bash|exec/.test(n)) {
      const cmd = pick(obj, ["CommandLine", "Command", "cmd"]);
      const cwd = pick(obj, ["Cwd", "WorkingDirectory"]);
      const lab = meta ? humanToolPhrase(meta, "执行操作", pathHintFromCmd(cmd)) : inferShellLabel(cmd);
      return {
        icon: lab.icon || "tool",
        phrase: lab.phrase,
        verb: lab.verb,
        target: lab.target,
        term: true,
        cwd,
        rawCmd: cmd,
        title: cmd,
      };
    }
    if (/command_status|read_terminal|send_command_input/.test(n)) {
      const lab = humanToolPhrase(meta, n === "send_command_input" ? "发送输入" : "检查进度", null);
      return { icon: "tool", phrase: lab.phrase, verb: lab.verb, target: lab.target || pick(obj, ["Input", "CommandId", "Name", "id"]) };
    }
    if (/view_file|view_code_item|read_file|^view/.test(n)) {
      let t = file ? baseName(file) : pick(obj, ["NodePath", "NodePaths", "Symbol"]);
      const s = pick(obj, ["StartLine", "Offset"]);
      const e = pick(obj, ["EndLine"]);
      if (t && s != null) t += `#L${s}${e != null ? `-${e}` : ""}`;
      const lab = humanToolPhrase(meta, /outline/.test(n) ? "查看" : "分析", t);
      return { icon: "eye", phrase: lab.phrase, verb: lab.verb, target: lab.target, title: file };
    }
    if (/list_dir|list_directory|^ls$/.test(n)) {
      const d = pick(obj, ["DirectoryPath", "Path", "Dir"]) || file;
      const lab = humanToolPhrase(meta, "列出", d ? baseName(d) : ".");
      return { icon: "folder", phrase: lab.phrase, verb: lab.verb, target: lab.target, title: d };
    }
    if (/grep|codebase_search|find_by_name|search_files|^find|glob/.test(n)) {
      const lab = humanToolPhrase(meta, "搜索", pick(obj, ["Query", "Pattern", "SearchPattern", "Includes", "Name"]));
      return { icon: "search", phrase: lab.phrase, verb: lab.verb, target: lab.target, title: pick(obj, ["SearchPath", "SearchDirectory", "DirectoryPath"]) };
    }
    if (/write_to_file|create_file|write_file/.test(n)) {
      const lab = humanToolPhrase(meta, "创建", file && baseName(file));
      return { icon: "filePlus", phrase: lab.phrase, verb: lab.verb, target: lab.target, title: file };
    }
    if (/multi_replace|replace|edit|patch|sed_file/.test(n)) {
      const lab = humanToolPhrase(meta, "修改", file && baseName(file));
      return { icon: "pencil", phrase: lab.phrase, verb: lab.verb, target: lab.target, title: file };
    }
    if (/search_web|web_search/.test(n)) {
      const lab = humanToolPhrase(meta, "搜索", pick(obj, ["Query"]));
      return { icon: "globe", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/read_url|fetch|url_content/.test(n)) {
      const lab = humanToolPhrase(meta, "读取", pick(obj, ["Url"]));
      return { icon: "globe", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/browser/.test(n)) {
      const lab = humanToolPhrase(meta, "查看", pick(obj, ["TaskName", "Task", "Url"]));
      return { icon: "globe", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/invoke_subagent|define_subagent|manage_subagents/.test(n)) {
      const subs = extractSubagentsFromToolBlock({ name, params });
      let phrase = null;
      if (subs.length > 1) {
        phrase = `调度 ${subs.length} 个子代理：${subs.map((s) => s.role || s.type_name).join(" · ")}`;
      } else if (subs.length === 1) {
        phrase = `调度子代理：${subs[0].role || subs[0].type_name}`;
      }
      const lab = humanToolPhrase(meta, phrase || "子代理", pick(obj, ["Role", "Name", "Prompt"]));
      return { icon: "bot", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/manage_task/.test(n)) {
      const lab = humanToolPhrase(meta, "任务", pick(obj, ["Action", "TaskId", "Name"]));
      return { icon: "list", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/image/.test(n)) {
      const lab = humanToolPhrase(meta, "生成图片", pick(obj, ["Prompt", "ImageName"]));
      return { icon: "image", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    if (/notify|message_user/.test(n)) {
      const lab = humanToolPhrase(meta, "通知", pick(obj, ["Message"]));
      return { icon: "message", phrase: lab.phrase, verb: lab.verb, target: lab.target };
    }
    const lab = humanToolPhrase(meta, "操作", null);
    return { icon: "tool", phrase: lab.phrase, verb: lab.verb, target: lab.target };
  }

  function stateBadge(st) {
    if (st === "running") return h("span", { class: "bt-state" }, h("span", { class: "spin" }));
    if (st === "error") return h("span", { class: "bt-state err", title: "失败" }, icon("x"));
    if (st === "stopped") return h("span", { class: "bt-state stop", title: "已停止" }, icon("minus"));
    return h("span", { class: "bt-state ok", title: "完成" }, icon("check"));
  }

  function buildTool(turn, b) {
    const d = describeTool(b.name, b.params);
    if (d.kind === "task") return buildTask(b);
    const toggle = () => { clearSelection(); b._open = !b._open; paintBlock(turn, b); };
    const label = d.phrase || [d.verb, d.target].filter(Boolean).join(" ");
    const el = h("div", { class: "blk-tool" + (b._open ? " open" : "") },
      h("button", { class: "bt-row", title: d.title || label || b.name || "", onclick: toggle },
        h("span", { class: "bt-ico" }, icon(d.icon)),
        h("span", { class: "bt-verb", text: oneLine(label, 160) }),
        h("span", { class: "bt-spacer" }),
        stateBadge(b.state),
        h("span", { class: "bt-chev" }, icon("chevRight")),
      ),
    );
    if (b._open) {
      const det = h("div", { class: "bt-detail" });
      if (d.term) {
        const cmdText = d.rawCmd != null ? d.rawCmd : "";
        const pre = h("pre", { class: "bt-pre term" }, h("span", { class: "prompt", text: "$ " }), String(cmdText ?? ""));
        if (b.output != null) pre.append("\n\n" + pretty(b.output));
        det.append(h("div", {}, h("div", { class: "bt-label", text: d.cwd ? `终端 · ${d.cwd}` : "终端" }), pre));
      } else {
        if (b.params != null) det.append(h("div", {}, h("div", { class: "bt-label", text: "参数" }), h("pre", { class: "bt-pre", text: pretty(b.params) })));
        if (b.output != null) det.append(h("div", {}, h("div", { class: "bt-label", text: "输出" }), h("pre", { class: "bt-pre", text: pretty(b.output) })));
      }
      if (b.error) det.append(h("div", {}, h("div", { class: "bt-label", text: "错误" }), h("pre", { class: "bt-pre err", text: pretty(b.error) })));
      el.appendChild(det);
    }
    return el;
  }

  function buildTask(b) {
    const p = parseMaybeJSON(b.params);
    const obj = p && typeof p === "object" ? p : {};
    const name = pick(obj, ["TaskName", "Name", "Title"]) || "Task";
    const status = pick(obj, ["TaskStatus", "Status"]);
    const summary = pick(obj, ["TaskSummary", "Summary"]);
    const mode = pick(obj, ["Mode"]);
    return h("div", { class: "blk-task" },
      h("span", { class: "bt-ico" }, icon("list")),
      h("div", { style: "flex:1;min-width:0" },
        h("div", { class: "tk-name" }, name, mode ? h("span", { class: "tag", style: "margin-left:8px", text: humanize(mode) }) : null),
        status ? h("div", { class: "tk-status", text: status }) : null,
        summary ? h("div", { class: "tk-summary", text: oneLine(summary, 400) }) : null,
      ),
      b.state === "running" ? h("span", { class: "spin" }) : null,
    );
  }

  // ---------- subagents ----------
  function buildSubagent(turn, b) {
    const subs = b.subagents || [];
    const roles = subs.map((s) => s.role || s.type_name).filter(Boolean);
    const el = h("div", { class: "blk-sub" },
      h("div", { class: "bs-head" },
        h("span", { class: "bt-ico" }, icon("bot")),
        h("b", { text: subs.length > 1 ? `${subs.length} subagents` : "Subagent" }),
        roles.length ? h("span", { class: "dim", text: oneLine(roles.join(" · "), 80) }) : null,
        h("span", { class: "bt-spacer" }),
        stateBadge(b.state),
      ),
    );
    if (!subs.length) el.appendChild(h("div", { class: "bs-item" }, h("div", { class: "bs-prompt", text: "等待子代理信息…" })));
    for (const sa of subs) {
      const id = sa.transcript_id || sa.conversation_id;
      let tx = null;
      if (id && turn._v?.tx) {
        tx = turn._v.tx.get(id);
        if (!tx) {
          tx = { open: false, el: h("div", { class: "bs-tx hidden" }), timer: null, openKeys: new Set() };
          turn._v.tx.set(id, tx);
          if (turn.status === "running" && !sa.finished) setTranscriptOpen(turn, id, tx, true);
        }
      }
      const promptText = sa.initial_prompt || sa.prompt || sa.task || sa.Prompt || null;
      const promptEl = promptText ? h("div", { class: "bs-prompt", title: "点击展开完整提示词", text: promptText }) : null;
      if (promptEl) promptEl.onclick = () => promptEl.classList.toggle("full");
      const txBtn = id ? h("button", { class: "btn sm", onclick: () => toggleTranscript(turn, id, txBtn) },
        icon("bulb"), tx?.open ? "收起思考与步骤" : "查看思考与步骤") : null;
      const running = turn.status === "running" && !sa.finished;
      const last = sa._last;
      const liveLine = running
        ? h("div", { class: "bs-live" }, h("span", { class: "spin" }),
          h("span", { text: last ? `第 ${last.total || last.idx + 1} 步 · ${last.desc}` : "子代理运行中…" }),
          last?.at ? h("span", { class: "dim", text: `${fmtDur(Date.now() - last.at)}前` }) : null)
        : sa.finished
          ? h("div", { class: "bs-live done" }, icon("check"), h("span", { text: sa.report ? `已汇报：${sa.report}` : "已汇报" }))
          : null;
      const item = h("div", { class: "bs-item" },
        h("div", { class: "bs-role" }, sa.role || sa.type_name || "subagent",
          sa.type_name && sa.type_name !== sa.role ? h("span", { class: "tag", text: sa.type_name }) : null,
          sa.model ? h("span", { class: "tag dim", text: sa.model }) : null),
        promptEl,
        liveLine,
        h("div", { class: "bs-actions" },
          txBtn,
          id ? h("button", { class: "btn sm ghost", title: "全屏查看 transcript", onclick: () => openTranscriptModal(id, sa.role) }, icon("external"), "全屏") : null,
          id ? h("span", { class: "tag mono", style: "cursor:pointer", title: `${id}（点击复制）`, onclick: () => copyText(id, "已复制子代理 conversation_id") }, `#${shortId(id)}`) : null,
        ),
      );
      if (tx) item.appendChild(tx.el);
      el.appendChild(item);
    }
    return el;
  }

  function setTranscriptOpen(turn, id, tx, open) {
    tx.open = open;
    tx.el.classList.toggle("hidden", !open);
    tx.el.classList.toggle("live", open && turn.status === "running");
    clearInterval(tx.timer);
    tx.timer = null;
    if (open) {
      loadTranscriptInto(id, tx);
      if (turn.status === "running") tx.timer = setInterval(() => loadTranscriptInto(id, tx), 4000);
    }
  }

  function toggleTranscript(turn, id, btn) {
    const tx = turn._v.tx.get(id);
    if (!tx) return;
    setTranscriptOpen(turn, id, tx, !tx.open);
    btn.lastChild.textContent = tx.open ? "收起思考与步骤" : "查看思考与步骤";
  }

  async function loadTranscriptInto(id, tx) {
    if (!tx.el.childElementCount) tx.el.appendChild(h("div", { class: "loading-line" }, h("span", { class: "spin" }), "读取 transcript…"));
    for (const d of $$("details[data-k]", tx.el)) (d.open ? tx.openKeys.add(d.dataset.k) : tx.openKeys.delete(d.dataset.k));
    try {
      const data = await api(`/v1/transcripts/${encodeURIComponent(id)}?limit=500&tail=1`, { timeoutMs: 20000 });
      const steps = data.steps || [];
      const last = steps[steps.length - 1];
      const sig = `${data.total}:${last?.step_index}:${(last?.content || "").length}:${(last?.thinking || "").length}`;
      if (sig === tx.sig && tx.el.querySelector(".tx")) return;
      if (selectingIn(tx.el)) return;
      tx.sig = sig;
      const stick = tx.el.scrollHeight - tx.el.scrollTop - tx.el.clientHeight < 60;
      tx.el.replaceChildren(renderTranscript(data, tx.openKeys));
      if (stick) tx.el.scrollTop = tx.el.scrollHeight;
    } catch (err) {
      const msg = err.status === 404 ? "Transcript 尚未生成（子代理可能刚启动），稍后自动重试。" : `读取失败：${err.message}`;
      tx.el.replaceChildren(h("div", { class: "tx-empty", text: msg }));
    }
  }

  function renderTranscript(data, openKeys = new Set()) {
    const steps = data.steps || [];
    const wrap = h("div", { class: "tx" });
    const thinkCount = steps.filter((s) => s.thinking).length;

    const allCalls = [];
    steps.forEach((s) => {
      const calls = Array.isArray(s.tool_calls) ? s.tool_calls : s.tool_calls ? [s.tool_calls] : [];
      calls.forEach((c) => {
        allCalls.push({
          kind: "tool",
          name: c?.name || c?.tool_name || c?.function?.name || "tool",
          params: c?.args ?? c?.arguments ?? c?.parameters ?? c?.function?.arguments ?? c?.input,
        });
      });
    });
    const subStats = aggregateStepStats(allCalls);
    const pillsWrap = renderStepPills(subStats);

    wrap.appendChild(h("div", { class: "tx-meta" },
      h("span", { text: `${steps.length} steps` }),
      thinkCount ? h("span", { class: "tag violet" }, icon("brain"), `${thinkCount} thoughts`) : null,
      pillsWrap,
      data.path ? h("span", { class: "mono", title: data.path, text: baseName(data.path) === "transcript.jsonl" ? `…/${shortId(data.conversation_id)}/transcript.jsonl` : data.path }) : null,
    ));
    if (!steps.length) {
      wrap.appendChild(h("div", { class: "tx-empty", text: "暂无步骤" }));
      return wrap;
    }
    steps.forEach((s, idx) => {
      const k = `${s.step_index ?? idx}`;
      const isModel = /planner|model|response|assistant/i.test(`${s.type || ""} ${s.source || ""}`);
      const step = h("div", { class: `tx-step${s.error ? " err" : isModel ? " model" : ""}` });
      step.appendChild(h("div", { class: "tx-head" },
        h("span", { text: `#${s.step_index ?? idx + 1}` }),
        h("span", { class: "tx-type", text: humanize(s.type) || "Step" }),
        s.source ? h("span", { text: humanize(s.source) }) : null,
        s.status ? h("span", { class: `tag ${/error|fail/i.test(s.status) ? "red" : /done|success|complete/i.test(s.status) ? "green" : ""}`, text: humanize(s.status) }) : null,
        s.created_at ? h("span", { text: fmtTime(s.created_at) }) : null,
      ));
      if (s.thinking) {
        const d = h("details", { class: "tx-think", "data-k": `t${k}` },
          h("summary", {}, icon("brain"), h("span", { text: "Thought" }), h("span", { class: "prev", text: oneLine(s.thinking, 140) })),
          h("div", { class: "think-body md", html: md(s.thinking) }));
        if (openKeys.has(`t${k}`)) d.open = true;
        step.appendChild(d);
      }
      if (s.content != null && s.content !== "") {
        const c = parseMaybeJSON(s.content);
        const text = typeof c === "string" ? c : pick(c, ["text", "content", "message"]);
        step.appendChild(typeof text === "string"
          ? h("div", { class: "tx-content md", html: md(text.length > 20000 ? text.slice(0, 20000) + "\n…" : text) })
          : h("pre", { class: "bt-pre", text: pretty(c) }));
      }
      const calls = Array.isArray(s.tool_calls) ? s.tool_calls : s.tool_calls ? [s.tool_calls] : [];
      if (calls.length) {
        const box = h("div", { class: "tx-calls" });
        calls.forEach((tc, j) => {
          const name = tc?.name || tc?.tool_name || tc?.function?.name || "tool";
          const args = tc?.args ?? tc?.arguments ?? tc?.parameters ?? tc?.function?.arguments ?? tc?.input;
          const d = describeTool(name, args);
          const label = d.phrase || [d.verb, d.target].filter(Boolean).join(" ") || name;
          const det = h("details", { class: "tx-call", "data-k": `c${k}-${j}` },
            h("summary", {}, icon(d.icon || "tool"), h("span", { class: "bt-verb", text: oneLine(label, 140) })),
            h("pre", { class: "bt-pre", text: pretty(args) }));
          if (openKeys.has(`c${k}-${j}`)) det.open = true;
          box.appendChild(det);
        });
        step.appendChild(box);
      }
      if (s.error) step.appendChild(h("div", { class: "tx-err", text: pretty(s.error) }));
      wrap.appendChild(step);
    });
    return wrap;
  }

  async function openTranscriptModal(id, title) {
    const body = h("div", {}, h("div", { class: "loading-line" }, h("span", { class: "spin" }), "读取 transcript…"));
    openModal(title ? `Transcript · ${title}` : `Transcript · #${shortId(id)}`, body);
    try {
      const data = await api(`/v1/transcripts/${encodeURIComponent(id)}?limit=2000`, { timeoutMs: 30000 });
      body.replaceChildren(renderTranscript(data));
    } catch (err) {
      body.replaceChildren(h("div", { class: "loading-line err", text: err.status === 404 ? `未找到 transcript：${err.data?.path || id}` : `读取失败：${err.message}` }));
    }
  }

  // ---------- footer ----------
  function paintFoot(turn) {
    if (!turn._v) return;
    const v = turn._v;
    v.foot.innerHTML = "";
    if (turn.status === "running") {
      if (turn.stderr) v.foot.appendChild(stderrBox(turn));
      return;
    }
    const u = turn.usage || {};
    const parts = [];
    if (u.input_tokens != null) parts.push(h("span", { class: "mono", title: "input tokens" }, `↑ ${fmtNum(u.input_tokens)}`));
    if (u.output_tokens != null) parts.push(h("span", { class: "mono", title: "output tokens" }, `↓ ${fmtNum(u.output_tokens)}`));
    if (u.thinking_tokens) parts.push(h("span", { class: "mono", style: "cursor:pointer", title: "点击展开/收起思考过程", onclick: () => { turn._thinkOpen = !turn._thinkOpen; paintAllBlocks(turn); } }, `✦ ${fmtNum(u.thinking_tokens)} think`));
    if (u.cache_read_tokens) parts.push(h("span", { class: "mono", title: "cache read tokens" }, `⟲ ${fmtNum(u.cache_read_tokens)} cached`));
    const text = turn.blocks.filter((b) => b.kind === "text").map((b) => b.text).join("\n\n") || turn.response || "";
    const items = [];
    for (const p of parts) items.push(p, h("span", { class: "sep" }));
    if (turn.status_text && turn.status_text !== "SUCCESS") items.push(h("span", { class: "tag", text: turn.status_text }), h("span", { class: "sep" }));
    if (items.length) items.pop();
    v.foot.append(...items, h("span", { class: "grow" }));
    if (text) v.foot.appendChild(h("button", { class: "f-btn", title: "复制回复", onclick: () => copyText(text) }, icon("copy"), "Copy"));
    if (turn.status !== "done") v.foot.appendChild(h("button", { class: "f-btn", title: "用相同提示重试", onclick: () => retryTurn(v.conv, turn) }, icon("rotate"), "Retry"));
    if (turn.stderr) v.foot.appendChild(stderrBox(turn));
  }

  function stderrBox(turn) {
    const d = h("details", { class: "stderr-box" },
      h("summary", {}, icon("terminal"), `诊断输出 · ${fmtNum(turn.stderr.length)} chars`),
      h("pre", { class: "bt-pre", text: turn.stderr.slice(-12000) }));
    d.open = !!turn._stderrOpen;
    d.addEventListener("toggle", () => { turn._stderrOpen = d.open; });
    return d;
  }

  // elapsed ticker
  setInterval(() => {
    for (const conv of state.convs) {
      if (!isLive(conv)) continue;
      const turn = conv.turns[conv.turns.length - 1];
      const el = turn?._v?.head.querySelector(".el");
      if (el) el.textContent = fmtDur(Date.now() - turn.startedAt);
      if (turn && attached(turn)) paintLive(turn);
    }
  }, 1000);

  // ==========================================================
  // Running agents
  // ==========================================================
  function upsertBlock(turn, key, kind, fn) {
    let b = turn.blocks.find((x) => x.key === key);
    if (!b) {
      b = { kind, key };
      turn.blocks.push(b);
    }
    fn(b);
    schedulePaint(turn, b);
    return b;
  }

  function normState(s, fallback = "running") {
    const t = String(s || "").toLowerCase();
    if (!t) return fallback;
    if (/error|fail|cancel|abort/.test(t)) return "error";
    if (/done|complete|success|finish|^ok$/.test(t)) return "done";
    return "running";
  }

  function setPrompt(text) {
    const input = $("#promptInput");
    input.value = text;
    autoGrow();
    syncComposer();
    input.focus();
    input.setSelectionRange(input.value.length, input.value.length);
  }

  async function send(promptOverride, attachmentsOverride) {
    if (promptOverride == null && state.attachments.some((f) => f.uploading)) {
      toast("文件正在上传中，请稍候…");
      return;
    }
    const input = $("#promptInput");
    const text = (promptOverride ?? input.value).trim();
    const files = attachmentsOverride != null
      ? attachmentsOverride
      : (promptOverride != null ? [] : state.attachments.filter((f) => f.path && !f.uploading));
    if (!text && !files.length) return;
    const prompt = text || (files.length ? "请分析我附上的这些文件。" : "");
    const agentPrompt = buildPromptWithAttachments(prompt, files);
    const fileMeta = files.map(({ name, path, size, ext, mime }) => ({ name, path, size, ext, mime }));

    let conv = activeConv();
    if (!conv) {
      conv = {
        id: uid("c_"), title: oneLine(prompt, 60), conversationId: null,
        cwd: (state.cwd || "").trim() || null,
        createdAt: Date.now(), updatedAt: Date.now(), turns: [], queue: [],
      };
      state.convs.push(conv);
      state.activeId = conv.id;
      LS.set("agy.activeConv", conv.id);
    }
    if (!conv.queue) conv.queue = [];
    if (!conv.cwd && state.cwd) conv.cwd = state.cwd;

    // Running: queue next message like official Antigravity (pre-add)
    if (isLive(conv)) {
      if (promptOverride != null) return; // don't auto-queue retries into a live run
      conv.queue.push({ id: uid("q"), prompt, attachments: fileMeta, agentPrompt, at: Date.now() });
      input.value = "";
      clearAttachments();
      autoGrow();
      conv.updatedAt = Date.now();
      scheduleSave();
      renderThread();
      syncComposer();
      scrollBottom();
      toast("已加入队列，当前任务结束后自动发送");
      return;
    }

    if (promptOverride == null) {
      input.value = "";
      clearAttachments();
      autoGrow();
    }

    await startTurn(conv, { prompt, attachments: fileMeta, agentPrompt });
  }

  async function startTurn(conv, { prompt, attachments = [], agentPrompt }) {
    if (!conv || isLive(conv)) return;
    const runId = `run_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
    const cwd = (conv.cwd || state.cwd || "").trim() || null;
    if (cwd && !conv.cwd) conv.cwd = cwd;
    if (cwd && state.cwd !== cwd) applyCwd(cwd);
    const turn = {
      id: uid("t_"), prompt, attachments,
      at: Date.now(), startedAt: Date.now(), endedAt: null,
      status: "running", model: effectiveModel(),
      cwd, runId, blocks: [], usage: null, response: null, stderr: "",
    };
    conv.turns.push(turn);
    conv.updatedAt = Date.now();
    if (!conv.title || conv.title === "New conversation") conv.title = oneLine(prompt, 60);

    const payload = { prompt: agentPrompt || prompt, run_id: runId };
    payload.model = state.model || effectiveModel() || "gemini-3.8-flash-high";
    if (cwd) payload.cwd = cwd;
    if (conv.conversationId) payload.conversation_id = conv.conversationId;
    if (state.printTimeout) payload.print_timeout = state.printTimeout;
    if (+state.timeoutMin > 0) payload.timeout_ms = Math.round(+state.timeoutMin * 60000);

    const live = { runId, ctrl: new AbortController(), mode: "stream", stopping: false };
    state.live.set(conv.id, live);

    renderConvList();
    if (conv.id === state.activeId) {
      if ($("#main").classList.contains("is-empty")) renderThread();
      else { threadInner.appendChild(renderTurn(conv, turn)); renderQueue(conv); renderTopbar(); syncComposer(); }
      scrollBottom();
    }
    scheduleSave();
    setTimeout(loadRuns, 800);

    try {
      await runStream(conv, turn, payload, live);
    } catch (err) {
      if (err.name === "AbortError" || live.stopping) finishTurn(conv, turn, "aborted");
      else finishTurn(conv, turn, "error", { message: err.message, code: err.code, detail: err.detail });
    }
    if (turn.status === "running") finishTurn(conv, turn, live.stopping ? "aborted" : "error", live.stopping ? undefined : { message: "连接意外中断（未收到 done 事件）" });
  }

  /** Re-attach to the server-side run after the SSE connection drops (the run keeps going on the server). */
  async function followUntilDone(conv, turn, live) {
    for (let attempt = 0; turn.status === "running" && !live.stopping && attempt < 5; attempt++) {
      if (attempt) await new Promise((r) => setTimeout(r, 1500 * attempt));
      try {
        const gone = await resumeStream(conv, turn, live);
        if (gone) break;
      } catch (err) {
        if (err.name === "AbortError" || live.stopping) break;
      }
    }
    if (turn.status === "running") {
      finishTurn(conv, turn, live.stopping ? "aborted" : "error", live.stopping ? undefined : { message: "与服务端的连接已断开，且服务端已没有这次运行的记录（可能服务重启过）。已从对话记录恢复可见内容。" });
    }
  }

  /** Returns true when the server no longer knows this run. */
  async function resumeStream(conv, turn, live) {
    live.ctrl = new AbortController();
    const res = await fetch(apiUrl(`/v1/agent/stream/${encodeURIComponent(turn.runId)}?after=${turn.lastSeq || 0}`), {
      headers: headers(false),
      signal: live.ctrl.signal,
    });
    if (res.status === 404) return true;
    if (!res.ok || !res.body) throw apiError(res, await res.json().catch(() => ({})));
    await readSse(res, (ev, obj) => onStreamEvent(conv, turn, live, ev, obj));
    return false;
  }

  /** Page was refreshed while runs were in flight: rebuild those turns from the server's event buffer. */
  async function reattachRuns() {
    for (const conv of state.convs) {
      const turn = (conv.turns || [])[conv.turns.length - 1];
      for (const t of conv.turns || []) {
        if (t._reattach && t !== turn) {
          t._reattach = false;
          t.status = "aborted";
          for (const b of t.blocks || []) if (b.state === "running") b.state = "stopped";
        }
      }
      if (!turn?._reattach) continue;
      turn._reattach = false;
      turn.blocks = [];
      turn.thoughts = null;
      turn.thinking = "";
      turn.stderr = "";
      turn.lastSeq = 0;
      turn.idleWait = null;
      turn.bgKilled = 0;
      const live = { runId: turn.runId, ctrl: new AbortController(), mode: "stream", stopping: false };
      state.live.set(conv.id, live);
      renderConvList();
      if (conv.id === state.activeId) renderThread();
      syncComposer();
      const enrichTimer = setInterval(() => liveTick(conv, turn), 3000);
      followUntilDone(conv, turn, live).finally(() => clearInterval(enrichTimer));
    }
  }

  function renderQueue(conv) {
    if (!conv || conv.id !== state.activeId) return;
    $$(".q-msg", threadInner).forEach((el) => el.remove());
    const queue = conv.queue || [];
    if (!queue.length) return;
    for (const q of queue) {
      const att = (q.attachments || []).length
        ? h("div", { class: "u-atts" }, q.attachments.map((f) =>
          h("span", { class: "u-att", title: f.path || f.name },
            icon(isImageExt(f.ext) ? "image" : "file"),
            h("span", { text: f.name || baseName(f.path) }))))
        : null;
      const rm = h("button", {
        class: "q-rm", title: "移出队列",
        onclick: () => {
          conv.queue = (conv.queue || []).filter((x) => x.id !== q.id);
          scheduleSave();
          renderQueue(conv);
          syncComposer();
        },
      }, icon("x"));
      threadInner.appendChild(h("div", { class: "u-msg q-msg" },
        att,
        h("div", { class: "u-bubble" },
          h("span", { class: "tag", style: "margin-right:8px", text: "排队中" }),
          q.prompt,
        ),
        h("div", { class: "u-meta" }, h("span", { text: "当前任务结束后发送" }), rm),
      ));
    }
  }

  async function runStream(conv, turn, payload, live) {
    const enrichTimer = setInterval(() => liveTick(conv, turn), 3000);
    try {
      try {
        const res = await fetch(apiUrl("/v1/agent/stream"), {
          method: "POST",
          headers: headers(true),
          body: JSON.stringify(payload),
          signal: live.ctrl.signal,
        });
        if (!res.ok || !res.body) {
          const data = await res.json().catch(() => ({}));
          throw apiError(res, data);
        }
        await readSse(res, (ev, obj) => onStreamEvent(conv, turn, live, ev, obj));
      } catch (err) {
        if (err.name === "AbortError" || live.stopping || !turn.lastSeq) throw err;
      }
      await followUntilDone(conv, turn, live);
    } finally {
      clearInterval(enrichTimer);
    }
  }

  async function readSse(res, onEvent) {
    const reader = res.body.getReader();
    const dec = new TextDecoder();
    let buf = "";
    for (;;) {
      const { value, done } = await reader.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let m;
      while ((m = buf.match(/\r?\n\r?\n/))) {
        const block = buf.slice(0, m.index);
        buf = buf.slice(m.index + m[0].length);
        let ev = "message";
        const data = [];
        for (const line of block.split(/\r?\n/)) {
          if (line.startsWith("event:")) ev = line.slice(6).trim();
          else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
        }
        if (!data.length) continue;
        let obj;
        try { obj = JSON.parse(data.join("\n")); } catch { continue; }
        onEvent(ev, obj);
      }
    }
  }

  function onStreamEvent(conv, turn, live, ev, d) {
    const type = ev !== "message" ? ev : d.type;
    const si = d.step_index;
    if (d.seq) turn.lastSeq = Math.max(turn.lastSeq || 0, d.seq);
    switch (type) {
      case "run_started":
        if (d.run_id) live.runId = turn.runId = d.run_id;
        if (d.cwd) turn.cwd = d.cwd;
        if (d.model) turn.model = d.model;
        schedulePaint(turn, null, true);
        break;
      case "init":
        if (d.conversation_id) setConversationId(conv, d.conversation_id);
        if (d.model && !turn.model) turn.model = d.model;
        break;
      case "thinking": {
        const text = d.thinking || d.text_delta || "";
        if (!text) break;
        if (!turn.thoughts) turn.thoughts = [];
        let cur = turn.thoughts[turn.thoughts.length - 1];
        if (!cur || (si != null && cur.step_index !== si)) {
          cur = { step_index: si, thinking: "", created_at: new Date(d.ts || Date.now()).toISOString() };
          turn.thoughts.push(cur);
        }
        cur.thinking += text;
        turn.thinking = turn.thoughts.map((x) => x.thinking).join("\n\n---\n\n");
        schedulePaint(turn, null, true);
        break;
      }
      case "step": {
        if (d.thinking) {
          if (!turn.thoughts) turn.thoughts = [];
          if (!turn.thoughts.some((th) => th.thinking === d.thinking)) {
            turn.thoughts.push({ step_index: si, thinking: d.thinking, created_at: new Date(d.ts || Date.now()).toISOString() });
            turn.thinking = turn.thoughts.map((x) => x.thinking).join("\n\n---\n\n");
            schedulePaint(turn, null, true);
          }
        }
        const text = d.text_delta || d.content || d.text || d.response;
        if (text && typeof text === "string" && text.trim() && !isToolOutputText(text)) {
          const key = si != null ? `t${si}` : uid("t");
          upsertBlock(turn, key, "text", (b) => {
            if (!b._tx || text.length >= (b.text || "").length) b.text = text;
          });
        }
        break;
      }
      case "text_delta": {
        const text = d.text_delta ?? d.content ?? d.text ?? "";
        if (!text || isToolOutputText(text)) break;
        const last = turn.blocks[turn.blocks.length - 1];
        const key = si != null ? `t${si}` : last?.kind === "text" ? last.key : uid("t");
        // Already filled in (complete) from the transcript while the stream was blocked
        if (turn.blocks.find((x) => x.key === key)?._tx) break;
        upsertBlock(turn, key, "text", (b) => {
          b.text = b.text || "";
          if (b.text && text.length > b.text.length && text.startsWith(b.text)) b.text = text;
          else if (b.text && text === b.text) { /* already exact match */ }
          else b.text += text;
        });
        break;
      }
      case "tool": {
        const info = d.tool_info || {};
        if (d.thinking) {
          if (!turn.thoughts) turn.thoughts = [];
          if (!turn.thoughts.some((th) => th.thinking === d.thinking)) {
            turn.thoughts.push({ step_index: si, thinking: d.thinking, created_at: new Date(d.ts || Date.now()).toISOString() });
            turn.thinking = turn.thoughts.map((x) => x.thinking).join("\n\n---\n\n");
          }
        }
        upsertBlock(turn, si != null ? `x${si}` : uid("x"), "tool", (b) => {
          b.name = d.tool_name || info.name || b.name;
          const params = extractToolParams(info);
          if (params != null) b.params = params;
          if (info.output != null) b.output = info.output;
          if (info.error != null) b.error = info.error;
          const next = info.error ? "error" : normState(d.state, b.state || "running");
          // the transcript may already know this step finished (the stream lags behind background steps)
          if (!(next === "running" && (b.state === "done" || b.state === "error")) && !(b.exitCode && next === "done")) b.state = next;
        });
        break;
      }
      case "subagent":
        upsertBlock(turn, si != null ? `s${si}` : uid("s"), "subagent", (b) => {
          const map = new Map((b.subagents || []).map((s) => [s.conversation_id || s.role, s]));
          for (const s of d.subagents || []) map.set(s.conversation_id || s.role, { ...(map.get(s.conversation_id || s.role) || {}), ...s });
          b.subagents = [...map.values()];
          b.state = normState(d.state, b.state || "running");
        });
        break;
      case "error_message":
        upsertBlock(turn, si != null ? `e${si}` : uid("e"), "error", (b) => { b.text = d.message || d.text_delta || "Model error"; });
        break;
      case "system":
        if (d.text_delta) upsertBlock(turn, si != null ? `y${si}` : uid("y"), "system", (b) => { b.text = d.text_delta; });
        break;
      case "stderr": {
        const text = d.text || "";
        turn.stderr = (turn.stderr + text).slice(-40000);
        const idle = text.match(/root agent idle; waiting up to (\S+) for (\d+) background task/);
        if (idle && !turn.idleWait) turn.idleWait = { at: d.ts || Date.now(), limitMs: parseGoDuration(idle[1]), count: +idle[2] };
        const killed = text.match(/terminating (\d+) background task\(s\) on exit/);
        if (killed) turn.bgKilled = +killed[1];
        else if (/drain grace period expired/.test(text) && !turn.bgKilled) turn.bgKilled = turn.idleWait?.count || 1;
        schedulePaint(turn, null, true);
        paintLive(turn);
        break;
      }
      case "result":
        if (d.conversation_id) setConversationId(conv, d.conversation_id);
        if (d.response != null) turn.response = d.response;
        if (d.usage) turn.usage = d.usage;
        if (d.status) turn.status_text = d.status;
        if (d.error) upsertBlock(turn, "result-error", "error", (b) => { b.text = typeof d.error === "string" ? d.error : pretty(d.error); });
        break;
      case "run_finished":
        if (d.usage && !turn.usage) turn.usage = d.usage;
        if (d.response && !turn.response) turn.response = d.response;
        break;
      case "done":
        if (d.conversation_id) setConversationId(conv, d.conversation_id);
        if (d.usage) turn.usage = d.usage;
        if (d.response != null) turn.response = d.response;
        if (d.model) turn.model = d.model;
        if (d.status) turn.status_text = d.status;
        finishTurn(conv, turn, "done");
        break;
      case "error": {
        const r = d.result || {};
        if (r.conversation_id) setConversationId(conv, r.conversation_id);
        if (r.usage) turn.usage = r.usage;
        if (r.response) turn.response = r.response;
        if (d.code === "AGY_ABORTED" || live.stopping) finishTurn(conv, turn, "aborted");
        else finishTurn(conv, turn, "error", { message: d.message, code: d.code, stderr: r.stderr });
        break;
      }
      default:
        break;
    }
    scheduleSave();
  }

  async function runSync(conv, turn, payload, live) {
    const data = await api("/v1/agent", { method: "POST", body: payload, timeoutMs: 0, signal: live.ctrl.signal });
    if (data.conversation_id) setConversationId(conv, data.conversation_id);
    turn.usage = data.usage || null;
    turn.response = data.response ?? null;
    if (data.model) turn.model = data.model;
    if (data.run_id) turn.runId = data.run_id;
    if (data.status) turn.status_text = data.status;
    if (data.stderr) turn.stderr = data.stderr;
    finishTurn(conv, turn, "done");
  }

  function setConversationId(conv, id) {
    if (!id || conv.conversationId === id) return;
    conv.conversationId = id;
    if (conv.id === state.activeId) renderTopbar();
  }

  // ---------- transcript ⇄ live stream merge ----------
  // agy streams steps strictly in order, so one backgrounded command holds back every later
  // step; the transcript is written as steps finish and is used to fill the gap.
  const TOOL_EXIT_RE = /exited with code (-?\d+)/;
  const UUID_SENDER_RE = /sender=([0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12})\s[\s\S]*?content=([\s\S]{0,400})/i;

  function parseGoDuration(s) {
    const m = String(s || "").match(/^(?:(\d+)h)?(?:(\d+)m)?(?:([\d.]+)s)?$/);
    if (!m) return 30 * 60000;
    return ((+m[1] || 0) * 3600 + (+m[2] || 0) * 60 + (+m[3] || 0)) * 1000;
  }

  function scanTranscriptSignals(steps) {
    const bgDone = new Map();
    const subMsg = new Map();
    for (const s of steps || []) {
      if (!/system_message/i.test(s.type || "") || typeof s.content !== "string") continue;
      const done = s.content.match(/Task id "([^"]+)" finished with result:\s*([\s\S]{0,400})/);
      if (done) { bgDone.set(done[1], done[2]); continue; }
      const sub = s.content.match(UUID_SENDER_RE);
      if (sub) subMsg.set(sub[1].toLowerCase(), { at: s.created_at, text: sub[2] });
    }
    return { bgDone, subMsg };
  }

  function transcriptToolResult(out) {
    const s = typeof out === "string" ? out : "";
    if (/Tool is running as a background task/.test(s.slice(0, 300))) {
      const m = s.match(/task id:\s*(\S+)\s+Task Description:\s*([\s\S]*?)\s+(?:Task logs are available|YOU MUST)/i);
      return { bg: { id: m?.[1] || null, desc: (m?.[2] || "").trim() } };
    }
    const m = s.match(TOOL_EXIT_RE);
    return { exitCode: m ? +m[1] : null };
  }

  function blockStepIndex(b) {
    const m = /^[txsey](\d+)$/.exec(b?.key || "");
    return m ? +m[1] : null;
  }

  function sortBlocksByStep(t) {
    const idx = t.blocks.map(blockStepIndex);
    let lastNumbered = -1;
    idx.forEach((n, i) => { if (n != null) lastNumbered = i; });
    let carry = -1;
    const rows = t.blocks.map((b, i) => {
      const n = idx[i];
      if (n != null) carry = n;
      return { b, i, o: n != null ? n : i > lastNumbered ? Infinity : carry + 0.5 };
    });
    rows.sort((a, z) => (a.o - z.o) || (a.i - z.i));
    t.blocks = rows.map((r) => r.b);
  }

  /** Merge one turn's transcript steps into its blocks. Keys match the live stream (tool/subagent = output step index). */
  function mergeTranscriptSteps(t, part, sig) {
    if (!t.blocks) t.blocks = [];
    let changed = false;
    const before = t.blocks.length;
    const running = t.status === "running";
    const lo = part.length ? part[0].step_index : null;
    const hi = part.length ? (running ? Infinity : part[part.length - 1].step_index + 1) : null;
    t.blocks = t.blocks.filter((b) => {
      if (/^tx-/.test(b.key || "") || (b.kind === "text" && isToolOutputText(b.text))) return false;
      const n = blockStepIndex(b);
      return n == null || lo == null || (n >= lo && n <= hi);
    });
    if (t.blocks.length !== before) changed = true;
    const byIdx = new Map(part.map((s) => [s.step_index, s]));
    const find = (key) => t.blocks.find((b) => b.key === key);
    const set = (b, k, v) => { if (b[k] !== v) { b[k] = v; changed = true; } };

    for (const s of part) {
      if (s.tool_calls) {
        const calls = Array.isArray(s.tool_calls) ? s.tool_calls : [s.tool_calls];
        calls.forEach((tc, j) => {
          const outIdx = s.step_index + 1 + j;
          const outStep = byIdx.get(outIdx);
          const output = outStep && !/planner_response|user_input/i.test(outStep.type || "") ? outStep.content : null;
          const name = tc.name || tc.tool_name || tc.function?.name || "tool";
          const isSub = name === "invoke_subagent";
          const key = (isSub ? "s" : "x") + outIdx;
          let b = find(key);
          if (!b) {
            b = { kind: isSub ? "subagent" : "tool", key, state: "running" };
            t.blocks.push(b);
            changed = true;
          }
          if (!b.name) set(b, "name", name);
          const params = tc.args ?? tc.arguments ?? tc.parameters ?? tc.input;
          if (b.params == null && params != null) set(b, "params", params);
          if (output != null && b.output == null) set(b, "output", output);

          let state = b.state || "running";
          if (output != null) {
            const r = transcriptToolResult(output);
            if (r.bg) {
              const res = r.bg.id ? sig.bgDone.get(r.bg.id) : undefined;
              const finished = res != null;
              const code = finished ? +(res.match(TOOL_EXIT_RE)?.[1] ?? 0) : 0;
              const bg = { id: r.bg.id, desc: r.bg.desc, since: outStep.created_at || null, finished };
              if (JSON.stringify(b.bg) !== JSON.stringify(bg)) { b.bg = bg; changed = true; }
              if (finished && code) {
                set(b, "exitCode", code);
                if (b.error == null) set(b, "error", res);
                state = "error";
              } else state = finished ? "done" : running ? "running" : "stopped";
            } else if (r.exitCode) {
              set(b, "exitCode", r.exitCode);
              state = "error";
            } else if (state === "running") state = "done";
          } else if (!running && state === "running") state = "done";

          if (isSub) {
            const subs = extractSubagentsFromToolBlock({ name, params: b.params, output: b.output });
            if (!b.subagents?.length) {
              if (subs.length) { b.subagents = subs; changed = true; }
            } else {
              b.subagents.forEach((sa, k) => {
                if (!sa.conversation_id && subs[k]?.conversation_id) {
                  sa.conversation_id = sa.transcript_id = subs[k].conversation_id;
                  changed = true;
                }
              });
            }
            let anyRunning = false;
            for (const sa of b.subagents || []) {
              const id = String(sa.transcript_id || sa.conversation_id || "").toLowerCase();
              const msg = id && sig.subMsg.get(id);
              if (msg && !sa.finished) {
                sa.finished = true;
                sa.report = oneLine(msg.text, 300);
                changed = true;
              }
              if (!sa.finished) anyRunning = true;
            }
            state = running && anyRunning ? "running" : state === "error" ? "error" : "done";
          }
          set(b, "state", state);
        });
      }

      if (/planner_response|agent_response|model_response/i.test(s.type || "") &&
          typeof s.content === "string" && s.content.trim() && !isToolOutputText(s.content)) {
        const key = `t${s.step_index}`;
        const b = find(key);
        if (!b) {
          t.blocks.push({ kind: "text", key, text: s.content, _tx: true });
          changed = true;
        } else if (b.text !== s.content && s.content.length >= (b.text || "").length) {
          b.text = s.content;
          b._tx = true;
          changed = true;
        } else if (!b._tx && (b.text || "").trim() === s.content.trim()) {
          b._tx = true;
        }
      }
    }

    const numbered = t.blocks.filter((b) => b.kind === "text" && /^t\d+$/.test(b.key));
    if (numbered.length) {
      const all = numbered.map((b) => (b.text || "").trim()).join("\n");
      const n = t.blocks.length;
      t.blocks = t.blocks.filter((b) => !(b.kind === "text" && (b.key === "final" || b.key === "final-tx") && all.includes((b.text || "").trim())));
      if (t.blocks.length !== n) changed = true;
    }
    if (changed) sortBlocksByStep(t);
    return changed;
  }

  function describeTranscriptStep(s) {
    const type = String(s?.type || "");
    const calls = Array.isArray(s?.tool_calls) ? s.tool_calls : s?.tool_calls ? [s.tool_calls] : [];
    if (calls.length) {
      const tc = calls[0];
      const name = tc.name || tc.tool_name || tc.function?.name || "tool";
      const d = describeTool(name, tc.args ?? tc.arguments ?? tc.parameters ?? tc.input);
      return `调用工具：${d.phrase || [d.verb, d.target].filter(Boolean).join(" ") || name}`;
    }
    const c = typeof s?.content === "string" ? s.content : "";
    if (/user_input/i.test(type)) return "收到指令";
    if (/system_message/i.test(type)) {
      if (/Task id "[^"]+" finished/.test(c)) return "后台任务结束，agent 正在处理结果";
      if (UUID_SENDER_RE.test(c)) return "收到子代理汇报";
      return "系统通知";
    }
    if (/planner_response|agent_response|model_response/i.test(type)) return c.trim() ? `回复：${oneLine(c, 80)}` : "思考中";
    const r = transcriptToolResult(c);
    if (r.bg) return `命令已转入后台：${oneLine(r.bg.desc, 80)}`;
    if (r.exitCode) return `命令失败（退出码 ${r.exitCode}）`;
    return "工具执行完成";
  }

  const subPollBusy = new Set();
  function pollSubagents(turn) {
    if (turn.status !== "running") return;
    for (const b of turn.blocks || []) {
      if (b.kind !== "subagent") continue;
      for (const sa of b.subagents || []) {
        const id = sa.transcript_id || sa.conversation_id;
        if (!id || sa.finished || subPollBusy.has(id)) continue;
        subPollBusy.add(id);
        api(`/v1/transcripts/${encodeURIComponent(id)}?limit=4&tail=1&thinking=0`, { timeoutMs: 8000 })
          .then((data) => {
            const steps = data?.steps || [];
            const last = steps[steps.length - 1];
            if (!last) return;
            const pick = [...steps].reverse().find((s) => s.tool_calls || (/planner_response/i.test(s.type || "") && s.content)) || last;
            const info = { idx: last.step_index, total: data.total || null, at: Date.parse(last.created_at) || null, desc: describeTranscriptStep(pick) };
            if (JSON.stringify(sa._last) === JSON.stringify(info)) return;
            sa._last = info;
            if (attached(turn)) { paintAllBlocks(turn); paintLive(turn); }
          })
          .catch(() => {})
          .finally(() => subPollBusy.delete(id));
      }
    }
  }

  function liveTick(conv, turn) {
    if (conv.conversationId) enrichTurnFromTranscript(conv, turn);
    pollSubagents(turn);
  }

  function partitionUserStep(part) {
    return (part || []).find((s) => /^user_input$/i.test(String(s.type || ""))) || null;
  }

  const normPrompt = (s) => cleanUserPrompt(String(s || "")).replace(/[\s\\"'`]+/g, "").slice(0, 40);

  /**
   * Map turns to transcript partitions (one per USER_INPUT). Turns may be missing locally
   * (sent from another tab) or local-only (failed before agy started), so index order is unreliable.
   */
  function alignTurnsToPartitions(turns, partitions) {
    const users = partitions.map(partitionUserStep);
    const partNorm = users.map((u) => normPrompt(u?.content));
    const partOf = new Map();
    const used = new Set();
    const take = (t, pi) => { partOf.set(t, pi); used.add(pi); };
    const isGenerated = (t) => /^t_[0-9a-f-]{36}_\d+$/i.test(t.id || "");
    const matches = (t, pi) => {
      const a = normPrompt(t.prompt);
      const b = partNorm[pi];
      return !!a && !!b && (a === b || b.startsWith(a) || a.startsWith(b));
    };

    for (const t of turns) {
      if (t.txUser == null) continue;
      const pi = users.findIndex((u) => u && u.step_index === t.txUser);
      if (pi >= 0 && !used.has(pi)) take(t, pi);
    }

    const local = turns.filter((t) => !isGenerated(t));
    local.forEach((t, k) => {
      if (partOf.has(t)) return;
      let lo = 0;
      let hi = partitions.length - 1;
      for (let j = k - 1; j >= 0; j--) if (partOf.has(local[j])) { lo = partOf.get(local[j]) + 1; break; }
      for (let j = k + 1; j < local.length; j++) if (partOf.has(local[j])) { hi = partOf.get(local[j]) - 1; break; }
      for (let pi = lo; pi <= hi; pi++) if (!used.has(pi) && matches(t, pi)) { take(t, pi); break; }
    });

    const live = turns.find((t) => t.status === "running");
    if (live && !partOf.has(live) && partitions.length) {
      const pi = partitions.length - 1;
      const at = Date.parse(users[pi]?.created_at || "") || 0;
      if (!used.has(pi) && at && at >= (live.startedAt || 0) - 120000) take(live, pi);
    }

    if (turns.length === partitions.length) {
      turns.forEach((t, i) => { if (!partOf.has(t) && !isGenerated(t) && !used.has(i)) take(t, i); });
    }

    for (const t of turns) {
      if (partOf.has(t) || !isGenerated(t)) continue;
      const pi = partitions.findIndex((_, k) => !used.has(k) && matches(t, k));
      if (pi >= 0) take(t, pi);
    }

    if (live) return partOf;
    for (let i = turns.length - 1; i >= 0; i--) {
      if (!partOf.has(turns[i]) && isGenerated(turns[i])) turns.splice(i, 1);
    }
    let key = -1;
    const order = turns.map((t, i) => {
      if (partOf.has(t)) key = partOf.get(t);
      return { t, i, o: partOf.has(t) ? key : key + 0.5 };
    });
    order.sort((a, b) => a.o - b.o || a.i - b.i);
    order.forEach((r, i) => { turns[i] = r.t; });
    return partOf;
  }

  const transcriptLoadingSet = new Set();
  async function enrichTurnFromTranscript(conv, targetTurn) {
    const cid = conv?.conversationId;
    if (!cid || transcriptLoadingSet.has(cid)) return;
    transcriptLoadingSet.add(cid);
    try {
      const data = await api(`/v1/transcripts/${encodeURIComponent(cid)}?limit=5000`, { timeoutMs: 12000 });
      if (!data?.ok || !Array.isArray(data.steps)) return;

      if (!conv.turns) conv.turns = [];
      const turns = conv.turns;

      // Group transcript steps by genuine USER_INPUT
      const partitions = [];
      let cur = [];
      for (const s of data.steps) {
        const typeStr = String(s.type || "");
        const srcStr = String(s.source || "");
        const isUserTurn =
          /^user_input$/i.test(typeStr) ||
          (/user_input/i.test(typeStr) && /user/i.test(srcStr));
        if (isUserTurn && cur.length > 0 && cur.some((x) => /^user_input$/i.test(String(x.type || "")))) {
          partitions.push(cur);
          cur = [s];
        } else {
          cur.push(s);
        }
      }
      if (cur.length > 0) partitions.push(cur);
      if (!partitions.length) return;

      const hasLiveTurn = turns.some((t) => t.status === "running");
      let needRerender = false;
      const orderBefore = turns.slice();
      const partOf = alignTurnsToPartitions(turns, partitions);
      if (turns.length !== orderBefore.length || turns.some((t, i) => t !== orderBefore[i])) needRerender = true;
      if (!hasLiveTurn) {
        const used = new Set(partOf.values());
        for (let pi = 0; pi < partitions.length; pi++) {
          if (used.has(pi)) continue;
          const userStep = partitionUserStep(partitions[pi]);
          const at = userStep?.created_at ? new Date(userStep.created_at).getTime() : Date.now();
          const nt = {
            id: `t_${conv.conversationId}_${pi}`,
            prompt: cleanUserPrompt(userStep?.content || "") || (pi === 0 ? conv.title : "用户输入"),
            at, startedAt: at, endedAt: at,
            status: "done",
            blocks: [],
            txUser: userStep?.step_index ?? null,
          };
          let pos = turns.length;
          for (let k = 0; k < turns.length; k++) {
            const q = partOf.get(turns[k]);
            if (q != null && q > pi) { pos = k; break; }
          }
          turns.splice(pos, 0, nt);
          partOf.set(nt, pi);
          needRerender = true;
        }
      }

      let updated = false;
      const signals = scanTranscriptSignals(data.steps);
      for (let i = 0; i < turns.length; i++) {
        const t = turns[i];
        if (targetTurn && t !== targetTurn && (t.thoughts || t.thinking)) continue;
        const pi = partOf.get(t);
        const part = pi == null ? null : partitions[pi];
        if (!part) continue;
        const us = partitionUserStep(part);
        if (us && t.txUser !== us.step_index) { t.txUser = us.step_index; updated = true; }
        let changed = false;

        const thoughts = [];
        for (const s of part) {
          if (s.thinking && typeof s.thinking === "string" && s.thinking.trim()) {
            thoughts.push({ step_index: s.step_index, thinking: s.thinking.trim(), created_at: s.created_at });
          }
        }
        const thoughtSig = (list) => (list || []).map((x) => x.thinking).join("\u0001");
        if (thoughts.length > 0 && thoughtSig(thoughts) !== thoughtSig(t.thoughts)) {
          t.thoughts = thoughts;
          t.thinking = thoughts.map((x) => x.thinking).join("\n\n---\n\n");
          changed = true;
        }

        // Clean XML tags from turn prompt if present
        if (t.prompt && /<USER_REQUEST>|<USER_SETTINGS_CHANGE>|<ADDITIONAL_METADATA>/i.test(t.prompt)) {
          const cleaned = cleanUserPrompt(t.prompt);
          if (cleaned && cleaned !== t.prompt) {
            t.prompt = cleaned;
            updated = true;
          }
        }

        if (mergeTranscriptSteps(t, part, signals)) changed = true;

        if (t.status === "running") {
          const last = part[part.length - 1];
          if (last && last.step_index !== t._txLast?.idx) {
            t._txLast = { idx: last.step_index, at: Date.parse(last.created_at) || null, desc: describeTranscriptStep(last) };
            paintLive(t);
          }
        } else if (!(t.blocks || []).some((b) => b.kind === "text")) {
          const lastModel = [...part].reverse().find((s) =>
            s.content && typeof s.content === "string" && s.content.trim() &&
            !/generic|system_message|tool_output|user_input/i.test(`${s.type || ""}`) &&
            !isToolOutputText(s.content)
          );
          if (lastModel?.content) {
            t.blocks.push({ kind: "text", key: "final-tx", text: lastModel.content });
            changed = true;
          }
        }

        if (changed) {
          updated = true;
          if (attached(t)) {
            paintAllBlocks(t);
            updateCaret(t);
            paintLive(t);
          }
        }
      }
      if (updated || needRerender) {
        scheduleSave();
        if (needRerender && conv.id === state.activeId && !hasLiveTurn) renderThread();
      }
    } catch {
      // Non-fatal background fetch
    } finally {
      transcriptLoadingSet.delete(cid);
    }
  }

  function finishTurn(conv, turn, status, err) {
    if (turn.status !== "running") return;
    turn.status = status;
    turn.endedAt = Date.now();
    turn._stepsOpen = false; // auto-collapse tool steps when done
    for (const b of turn.blocks) {
      if ((b.kind === "tool" || b.kind === "subagent") && b.state === "running") b.state = status === "done" ? "done" : "stopped";
      if (b.kind === "tool") b._open = false; // also collapse any expanded tool detail
    }
    if (!turn.blocks.some((b) => b.kind === "text") && turn.response) turn.blocks.push({ kind: "text", key: "final", text: turn.response });
    if (err) {
      turn.blocks.push({ kind: "error", key: uid("e"), text: err.message || "请求失败", code: err.code });
      const extra = err.stderr || err.detail?.stderr;
      if (extra && !turn.stderr.includes(extra)) turn.stderr += (turn.stderr ? "\n" : "") + extra;
    }
    if (status === "aborted" && !turn.blocks.some((b) => b.kind === "system" && /停止/.test(b.text))) {
      turn.blocks.push({ kind: "system", key: uid("y"), text: "已停止本次运行。" });
    }
    state.live.delete(conv.id);
    conv.updatedAt = Date.now();

    if (attached(turn)) {
      const stick = nearBottom();
      paintAllBlocks(turn);
      paintHead(turn);
      paintWait(turn);
      updateCaret(turn);
      paintLive(turn);
      paintFoot(turn);
      for (const [id, tx] of turn._v.tx) {
        clearInterval(tx.timer);
        tx.timer = null;
        tx.el.classList.remove("live");
        if (tx.open) loadTranscriptInto(id, tx);
      }
      if (stick) scrollBottom();
    }
    if (conv.conversationId) enrichTurnFromTranscript(conv, turn);
    renderConvList();
    syncComposer();
    saveNow();
    clearTimeout(finishTurn.t);
    finishTurn.t = setTimeout(() => { loadUsage(false); loadRuns(); }, 1500);
    if (status === "done" && document.hidden) toast(`「${oneLine(conv.title, 30)}」已完成`);

    // Only auto-drain queue after a successful finish (keep queue on stop/error)
    if (status === "done") {
      const next = (conv.queue || []).shift();
      if (next) {
        scheduleSave();
        if (conv.id === state.activeId) renderQueue(conv);
        setTimeout(() => {
          if (isLive(conv)) return;
          startTurn(conv, {
            prompt: next.prompt,
            attachments: next.attachments || [],
            agentPrompt: next.agentPrompt || buildPromptWithAttachments(next.prompt, next.attachments || []),
          });
        }, 250);
        return;
      }
    }
    if (conv.id === state.activeId) renderQueue(conv);
  }

  async function stopRun(convId, silent = false) {
    const live = state.live.get(convId);
    if (!live || live.stopping) return;
    live.stopping = true;
    syncComposer();
    const runId = live.runId;
    if (live.mode === "stream" && runId) {
      try {
        const r = await api("/v1/agent/abort", { method: "POST", body: { run_id: runId }, timeoutMs: 8000 });
        if (!r.ok && !silent) toast(`后端未找到该 run（${r.error || "unknown"}），已断开连接`, true);
      } catch (err) {
        if (!silent) toast(`中止请求失败：${err.message}，已断开连接`, true);
      }
      setTimeout(() => { if (state.live.get(convId) === live) live.ctrl.abort(); }, 3000);
    } else {
      live.ctrl.abort();
      // Still try to kill backend if we know the run id
      if (runId) {
        try { await api("/v1/agent/abort", { method: "POST", body: { run_id: runId }, timeoutMs: 8000 }); } catch { /* ignore */ }
      } else if (!silent) {
        toast("同步模式只能断开请求；后端进程可在 running 列表里终止", true);
      }
    }
  }

  function retryTurn(conv, turn) {
    if (!conv || isLive(conv)) return;
    if (conv.id !== state.activeId) selectConv(conv.id);
    send(turn.prompt, turn.attachments);
  }

  // ==========================================================
  // Composer
  // ==========================================================
  const promptInput = $("#promptInput");
  const ATTACH_MAX = 10;
  const ATTACH_MAX_BYTES = 25 * 1024 * 1024;
  const ATTACH_EXT = new Set([
    "jpg", "jpeg", "png", "gif", "webp", "bmp", "svg",
    "md", "markdown", "txt", "log", "csv", "json", "xml", "html", "htm",
    "pdf", "doc", "docx", "xls", "xlsx", "rtf", "yaml", "yml",
  ]);

  function fileExt(name) {
    const m = String(name || "").toLowerCase().match(/\.([a-z0-9]+)$/);
    return m ? m[1] : "";
  }

  function buildPromptWithAttachments(text, files) {
    if (!files?.length) return text;
    const lines = files.map((f) => `- ${f.path}`);
    return `用户附上了以下文件，请直接读取/分析这些本地路径（图片可用查看类工具，文档请打开内容）：\n${lines.join("\n")}\n\n${text}`;
  }

  function clearAttachments() {
    for (const f of state.attachments) {
      if (f.previewUrl) URL.revokeObjectURL(f.previewUrl);
    }
    state.attachments = [];
    renderAttachList();
  }

  function removeAttachment(id) {
    const hit = state.attachments.find((f) => f.id === id);
    if (hit?.previewUrl) URL.revokeObjectURL(hit.previewUrl);
    state.attachments = state.attachments.filter((f) => f.id !== id);
    renderAttachList();
    syncComposer();
  }

  function renderAttachList() {
    const box = $("#attachList");
    if (!box) return;
    box.innerHTML = "";
    if (!state.attachments.length) {
      box.classList.add("hidden");
      return;
    }
    box.classList.remove("hidden");
    for (const f of state.attachments) {
      const chip = h("div", { class: "attach-chip" + (f.uploading ? " busy" : f.error ? " err" : ""), title: f.path || f.name },
        f.previewUrl
          ? h("img", { class: "att-thumb", src: f.previewUrl, alt: "" })
          : h("span", { class: "att-ico" }, icon(isImageExt(f.ext) ? "image" : "file")),
        h("span", { class: "att-name", text: f.name }),
        f.uploading ? h("span", { class: "spin" }) : h("button", {
          class: "att-x", type: "button", title: "移除",
          onclick: () => removeAttachment(f.id),
        }, icon("x")));
      box.appendChild(chip);
    }
  }

  function readFileAsBase64(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const s = String(reader.result || "");
        const i = s.indexOf(",");
        resolve(i >= 0 ? s.slice(i + 1) : s);
      };
      reader.onerror = () => reject(reader.error || new Error("read failed"));
      reader.readAsDataURL(file);
    });
  }

  async function addFiles(fileList) {
    const incoming = [...(fileList || [])];
    if (!incoming.length) return;
    const room = ATTACH_MAX - state.attachments.length;
    if (room <= 0) return toast(`最多附加 ${ATTACH_MAX} 个文件`, true);
    const batch = incoming.slice(0, room);
    if (incoming.length > room) toast(`已忽略多余文件（上限 ${ATTACH_MAX}）`, true);

    for (const file of batch) {
      const ext = fileExt(file.name);
      if (!ATTACH_EXT.has(ext)) {
        toast(`不支持的类型：${file.name}`, true);
        continue;
      }
      if (file.size === 0) {
        toast(`文件为空：${file.name}`, true);
        continue;
      }
      if (file.size > ATTACH_MAX_BYTES) {
        toast(`文件过大（≤25MB）：${file.name}`, true);
        continue;
      }
      const item = {
        id: uid("att"),
        name: file.name,
        size: file.size,
        ext,
        mime: file.type || null,
        path: null,
        uploading: true,
        error: null,
        previewUrl: isImageExt(ext) ? URL.createObjectURL(file) : null,
      };
      state.attachments.push(item);
      renderAttachList();
      syncComposer();
      try {
        const content_base64 = await readFileAsBase64(file);
        const res = await api("/v1/uploads", {
          method: "POST",
          body: {
            filename: file.name,
            content_base64,
            mime: file.type || null,
            cwd: effectiveCwd() || undefined,
          },
          timeoutMs: 120000,
        });
        item.uploading = false;
        item.path = res.path;
        item.name = res.name || file.name;
        item.size = res.size ?? file.size;
        item.ext = (res.ext || `.${ext}`).replace(/^\./, "");
      } catch (err) {
        item.uploading = false;
        item.error = err.message;
        toast(`上传失败：${file.name} — ${err.message}`, true);
        state.attachments = state.attachments.filter((x) => x.id !== item.id);
        if (item.previewUrl) URL.revokeObjectURL(item.previewUrl);
      }
      renderAttachList();
      syncComposer();
    }
  }

  function autoGrow() {
    promptInput.style.height = "auto";
    promptInput.style.height = Math.min(promptInput.scrollHeight, 240) + "px";
  }

  function syncComposer() {
    const conv = activeConv();
    const live = conv ? state.live.get(conv.id) : null;
    const btn = $("#sendBtn");
    btn.innerHTML = "";
    $("#composer").classList.toggle("running", !!live);
    const uploading = state.attachments.some((f) => f.uploading);
    const hasContent = !!(promptInput.value.trim() || state.attachments.some((f) => f.path));
    if (live && !hasContent) {
      btn.className = "send-btn stop";
      btn.title = live.stopping ? "正在停止…" : "停止 (Esc)";
      btn.disabled = live.stopping;
      btn.dataset.mode = "stop";
      btn.appendChild(live.stopping ? h("span", { class: "spin" }) : icon("stop"));
    } else {
      btn.className = "send-btn";
      btn.title = live ? "加入队列，当前任务结束后发送 (Enter)" : "发送 (Enter)";
      btn.disabled = uploading || !hasContent;
      btn.dataset.mode = live ? "queue" : "send";
      btn.appendChild(icon("arrowUp"));
    }
    promptInput.disabled = false;
    const ab = $("#attachBtn");
    if (ab) ab.disabled = false;
  }

  // ---------- popovers ----------
  const POPS = ["cwdPop", "modelPop"];
  const POP_CHIP = { cwdPop: "cwdChip", modelPop: "modelChip" };
  const POP_RENDER = { cwdPop: renderCwdPop, modelPop: renderModelPop };

  function togglePop(id) {
    const el = $(`#${id}`);
    const willOpen = el.classList.contains("hidden");
    closePops();
    if (!willOpen) return;
    POP_RENDER[id]();
    el.classList.remove("hidden");
    $(`#${POP_CHIP[id]}`).classList.add("on");
    const focusable = $("input", el);
    if (focusable) setTimeout(() => focusable.focus(), 20);
  }
  function closePops() {
    for (const id of POPS) {
      $(`#${id}`).classList.add("hidden");
      $(`#${POP_CHIP[id]}`).classList.remove("on");
    }
    closeRunsPop();
  }
  const popOpen = () => POPS.some((id) => !$(`#${id}`).classList.contains("hidden")) || !$("#runsPop")?.classList.contains("hidden");

  // model
  function renderModelChip() {
    const id = effectiveModel();
    let label = "Loading…";
    if (id) label = modelLabel(id) || id;
    else if (state.connected) label = "选择模型";
    $("#modelLabel").textContent = label;
    $("#modelDot").className = `model-dot ${modelDotClass(id)}`;
    const q = id ? quotaForGroup(modelGroup(state.models.find((m) => m.id === id) || id)) : null;
    $("#modelChip").title = id ? `${id}${q ? ` · ${q.pct}%` : ""}` : "选择模型";
  }

  function renderModelPop() {
    const pop = $("#modelPop");
    pop.innerHTML = "";
    if (state.models.length > 7) {
      const input = h("input", { type: "text", placeholder: "搜索模型", value: state.modelFilter });
      input.addEventListener("input", () => { state.modelFilter = input.value; renderModelList(list); });
      input.addEventListener("keydown", (e) => {
        if (e.key === "Enter") { const first = $(".pop-item[data-id]", list); if (first) first.click(); }
      });
      pop.appendChild(h("div", { class: "pop-search" }, icon("search"), input));
    }
    const list = h("div");
    pop.appendChild(list);
    renderModelList(list);
  }

  function renderModelList(list) {
    list.innerHTML = "";
    const q = state.modelFilter.trim().toLowerCase();
    if (!state.models.length) {
      list.appendChild(h("div", { class: "pop-note", text: state.connected ? "未获取到模型列表" : "后端未连接" }));
      return;
    }
    const groups = new Map();
    for (const m of state.models) {
      if (q && !`${m.id} ${m.label || ""}`.toLowerCase().includes(q)) continue;
      const g = modelGroup(m);
      if (!groups.has(g)) groups.set(g, []);
      groups.get(g).push(m);
    }
    const order = ["Gemini Models", "Claude and GPT models"];
    const names = [...groups.keys()].sort((a, b) => ((order.indexOf(a) + 1) || 9) - ((order.indexOf(b) + 1) || 9));
    for (const g of names) {
      const qs = quotaForGroup(g);
      const reset = qs ? bucketResetSecs(qs.bucket) : null;
      list.appendChild(h("div", { class: "pop-title" }, h("span", { text: g }),
        qs ? h("span", { class: `q ${levelClass(qs.pct)}`, title: reset != null ? `resets in ${fmtSecs(reset)}` : "" }, qs.pct <= 0 ? (reset != null ? `额度耗尽 · ${fmtSecs(reset)}` : "额度耗尽") : `${qs.pct}% left`) : null));
      for (const m of groups.get(g)) {
        const isDef = m.id === state.prefs.defaultModel;
        const star = h("span", { class: "pi-star" + (isDef ? " on" : ""), role: "button", title: isDef ? "当前服务器默认模型" : "设为服务器默认模型" }, icon("star"));
        star.onclick = (e) => { e.stopPropagation(); if (!isDef) setServerPrefs({ defaultModel: m.id }, `默认模型已设为 ${m.label || m.id}`); };
        list.appendChild(h("button", { class: "pop-item" + (m.id === state.model ? " sel" : "") + (qs && qs.pct <= 0 ? " dim" : ""), "data-id": m.id, onclick: () => selectModel(m.id) },
          h("span", { class: `model-dot ${modelDotClass(m.id)}` }),
          h("div", { class: "pi-main" }, h("div", { class: "pi-label", text: m.display_name || m.label || m.id }), h("div", { class: "pi-sub", text: m.id })),
          star,
          h("span", { class: "pi-check" }, icon("check"))));
      }
    }
    if (!names.length) list.appendChild(h("div", { class: "pop-note", text: "没有匹配的模型" }));
  }

  function selectModel(id) {
    state.model = id;
    LS.set("agy.model", id);
    renderModelChip();
    closePops();
  }

  // cwd
  function renderCwdChip() {
    const cwd = effectiveCwd();
    $("#cwdLabel").textContent = cwd ? baseName(cwd) : "Workspace";
    $("#cwdChip").classList.toggle("set", !!state.cwd);
    $("#cwdChip").title = `工作目录：${cwd || "（服务启动目录）"}${state.cwd ? "" : "（默认）"}`;
  }
  function applyCwd(val) {
    state.cwd = (val || "").trim();
    LS.set("agy.cwd", state.cwd);
    if (state.cwd) {
      const rec = Array.isArray(state.recentCwds) ? state.recentCwds : [];
      state.recentCwds = [state.cwd, ...rec.filter((x) => x !== state.cwd)].slice(0, 8);
      LS.set("agy.recentCwds", state.recentCwds);
    }
    renderCwdChip();
  }
  function renderCwdPop() {
    const pop = $("#cwdPop");
    pop.innerHTML = "";
    const def = state.prefs.defaultCwd || state.health?.cwd || "";
    const input = h("input", { class: "field mono", type: "text", placeholder: def || "D:\\your\\project", value: state.cwd, spellcheck: "false" });
    const apply = () => {
      applyCwd(input.value);
      const conv = activeConv();
      if (conv) { conv.cwd = (state.cwd || "").trim() || null; scheduleSave(); renderConvList(); }
      closePops();
    };
    input.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); apply(); } });
    pop.appendChild(h("div", { class: "pop-title", text: "工作目录 (cwd)" }));
    pop.appendChild(h("div", { class: "pop-form" },
      input,
      h("div", { class: "row" },
        h("button", { class: "btn sm primary", onclick: apply }, "应用"),
        h("button", {
          class: "btn sm",
          title: "浏览本机文件夹",
          onclick: () => {
            closePops();
            openProjectPicker({
              start: state.cwd || def,
              onPick: (p) => {
                applyCwd(p);
                const conv = activeConv();
                if (conv) { conv.cwd = p; scheduleSave(); renderConvList(); }
                else newChatInProject(p);
                closeModal();
                renderCwdChip();
              },
            });
          },
        }, "浏览…"),
        h("button", {
          class: "btn sm",
          title: "写入服务器 prefs.defaultCwd",
          onclick: async () => {
            const v = input.value.trim();
            if (!v) return toast("请输入路径", true);
            const ok = await setServerPrefs({ defaultCwd: v }, "默认工作目录已保存");
            if (ok) { applyCwd(""); closePops(); }
          },
        }, "设为默认"),
        state.cwd ? h("button", { class: "btn sm ghost", onclick: () => { applyCwd(""); const conv = activeConv(); if (conv) { conv.cwd = null; scheduleSave(); renderConvList(); } closePops(); } }, "清除") : null,
      )));
    if (state.recentCwds.length) {
      pop.appendChild(h("div", { class: "pop-sep" }));
      pop.appendChild(h("div", { class: "pop-title", text: "最近使用" }));
      for (const p of state.recentCwds) {
        pop.appendChild(h("button", { class: "pop-item" + (p === state.cwd ? " sel" : ""), title: p, onclick: () => {
          applyCwd(p);
          const conv = activeConv();
          if (conv) { conv.cwd = p; scheduleSave(); renderConvList(); }
          closePops();
        } },
          icon("folder"), h("div", { class: "pi-main" }, h("div", { class: "pi-label", text: baseName(p) }), h("div", { class: "pi-sub", text: p })),
          h("span", { class: "pi-check" }, icon("check"))));
      }
    }
  }

  // ==========================================================
  // Health / models / prefs / runs / caps
  // ==========================================================
  async function loadHealth() {
    try {
      const hl = await api("/health", { timeoutMs: 8000 });
      const wasDown = !state.connected;
      state.health = hl;
      state.connected = true;
      if (hl.prefs) state.prefs = hl.prefs;
      $("#connDot").className = "conn-dot ok";
      $("#connText").textContent = `Connected · v${hl.version || "?"}`;
      renderAccountChip(hl.account);
      renderCwdChip();
      renderModelChip();
      renderQMeter();
      if (wasDown) {
        loadModels();
        if (!state.usageLoading) loadUsage(false);
        loadCaps();
        loadRuns();
      } else if (!state.usage && !state.usageErr && !state.usageLoading) {
        loadUsage(false);
      }
    } catch (err) {
      state.connected = false;
      $("#connDot").className = "conn-dot err";
      $("#connText").textContent = err.status === 401 ? "API Key 无效" : "后端未连接";
      renderModelChip();
      renderQMeter();
    }
    $("#connUrl").textContent = baseUrl().replace(/^https?:\/\//, "");
  }

  async function loadModels() {
    try {
      const data = await api("/v1/models", { timeoutMs: 70000 });
      state.models = data.data || [];
      if (data.default_model !== undefined) state.prefs.defaultModel = data.default_model;
      if (!state.model) {
        const pick = state.prefs.defaultModel || state.models[0]?.id || null;
        if (pick) {
          state.model = pick;
          LS.set("agy.model", pick);
        }
      }
    } catch (err) {
      state.models = [];
      if (state.connected) toast(`模型列表加载失败：${err.message}`, true);
    }
    renderModelChip();
    if (!$("#modelPop").classList.contains("hidden")) renderModelPop();
    if (state.drawer === "settings") renderSettings();
  }

  async function setServerPrefs(patch, okMsg) {
    try {
      const r = await api("/v1/prefs", { method: "PUT", body: patch, timeoutMs: 10000 });
      state.prefs = r.prefs || { ...state.prefs, ...patch };
      toast(okMsg || "已保存");
      renderModelChip();
      renderCwdChip();
      if (!$("#modelPop").classList.contains("hidden")) renderModelPop();
      if (state.drawer === "settings") renderSettings();
      return true;
    } catch (err) {
      toast(`保存失败：${err.message}`, true);
      return false;
    }
  }

  async function loadCaps() {
    try { state.caps = await api("/v1/capabilities", { timeoutMs: 8000 }); } catch { state.caps = null; }
    if (state.drawer === "settings") renderSettings();
  }

  async function loadRuns() {
    if (!state.connected) return;
    try {
      const data = await api("/v1/runs", { timeoutMs: 8000 });
      state.runs = data.runs || [];
    } catch {
      state.runs = [];
    }
    const n = state.runs.length;
    $("#runsPill").classList.toggle("hidden", !n);
    $("#runsCount").textContent = n;
    if (state.drawer === "settings") renderRunsList();
  }

  // ==========================================================
  // Quota
  // ==========================================================
  async function loadUsage(force = false) {
    state.usageLoading = true;
    renderQMeter();
    if (state.drawer === "quota" && force) {
      $("#quotaBody").replaceChildren(h("div", { class: "loading-line" }, h("span", { class: "spin" }), "刷新中…"));
    }
    try {
      state.usage = await api(`/v1/usage${force ? "?refresh=1" : ""}`, { timeoutMs: 60000 });
      state.usageErr = null;
      if (state.usage?.panel) LS.set("agy.usage", state.usage);
    } catch (err) {
      state.usageErr = err.message;
    } finally {
      state.usageLoading = false;
    }
    renderQMeter();
    renderModelChip();
    if (state.drawer === "quota") renderQuota();
  }

  function renderQMeter() {
    const btn = $("#quotaBtn");
    btn.innerHTML = "";
    const groups = state.usage?.panel?.groups || [];
    if (!groups.length) {
      if (state.usageLoading) {
        btn.appendChild(h("span", { class: "qm-empty loading" }, h("span", { class: "spin" }), "刷新额度…"));
        btn.title = "正在获取最新模型配额…";
        return;
      }
      const msg = state.usageErr ? `额度失败` : "加载额度…";
      btn.appendChild(h("span", { class: "qm-empty" + (state.usageErr ? " qm-err" : ""), text: msg }));
      btn.title = state.usageErr ? `配额加载失败：${state.usageErr}` : "Model Quotas · 点击查看 Gemini / Claude·GPT 的 7d 与 5h 剩余";
      return;
    }
    const tips = [];
    if (state.usageLoading) tips.push("【后台刷新中…】");
    for (const g of groups) {
      const weekly = pickBucket(g, "weekly");
      const five = pickBucket(g, "5h");
      const rows = [weekly, five].filter(Boolean);
      const rowEls = (rows.length ? rows : (g.buckets || [])).map((b) => {
        const pct = bucketPct(b);
        const barPct = b.disabled ? 0 : (pct == null ? 0 : Math.max(2, Math.min(100, pct)));
        const pctText = b.disabled ? "0%" : (pct == null ? "—" : `${Math.round(pct)}%`);
        const cls = b.disabled ? "crit" : levelClass(pct);
        return h("div", { class: "qm-row" },
          h("span", { class: "qm-win", text: shortWin(b) }),
          h("span", { class: "qm-bar" }, h("i", { class: cls, style: `width:${barPct}%` })),
          h("span", { class: "qm-pct", text: pctText }));
      });
      btn.appendChild(h("span", { class: "qm" },
        h("span", { class: "qm-name", text: shortGroup(g.displayName) }),
        h("div", { class: "qm-rows" }, rowEls)));
      for (const b of (rows.length ? rows : g.buckets || [])) {
        const pct = bucketPct(b);
        const reset = bucketResetSecs(b);
        tips.push(`${shortGroup(g.displayName)} ${shortWin(b)}: ${b.disabled ? "0% (已受周限)" : (pct == null ? "—" : `${pct}%`)}${reset != null ? ` · resets ${fmtSecs(reset)}` : ""}`);
      }
    }
    btn.title = tips.join("\n") || "Model Quotas";
  }

  function bucketEl(b) {
    const pct = bucketPct(b);
    const secs = bucketResetSecs(b);
    const resetIn = b.resetsIn || (secs != null ? fmtSecs(secs) : "");
    const rt = b.resetTime || b.reset_time;
    const winLabel = shortWin(b);
    const title = b.displayName || b.display_name || b.bucketId || winLabel;
    const fillPct = b.disabled ? 0 : (pct == null ? 0 : Math.max(0, Math.min(100, pct)));
    const pctText = b.disabled ? "0% (受限)" : (pct == null ? "—" : `${pct}%`);
    return h("div", { class: "q-bucket" + (b.disabled ? " disabled" : "") },
      h("div", { class: "qb-head" },
        h("span", {}, title, h("span", { class: "tag", style: "margin-left:8px", text: winLabel }),
          b.disabled ? h("span", { class: "tag red", style: "margin-left:8px", text: "受周额度限制" }) : null),
        h("span", { class: "qb-pct" + (b.disabled ? " crit" : ""), text: pctText })),
      h("div", { class: "qb-bar" }, h("div", { class: `qb-fill ${levelClass(pct)}`, style: `width:${fillPct}%` })),
      h("div", { class: "qb-sub" },
        h("span", { text: resetIn ? `Resets in ${resetIn}` : "" }),
        h("span", { text: rt ? fmtDateTime(rt) : "" })),
      b.description ? h("div", { class: "qb-desc", text: b.description }) : null);
  }

  function renderQuota() {
    const body = $("#quotaBody");
    const data = state.usage;
    if (!data) {
      body.replaceChildren(state.usageErr
        ? h("div", { class: "loading-line err", text: `加载失败：${state.usageErr}` })
        : h("div", { class: "loading-line" }, h("span", { class: "spin" }), "加载中…"));
      return;
    }
    $("#quotaTitle").textContent = data.panel?.title || "Model Quotas";
    $("#quotaDesc").textContent = data.panel?.description || "";
    const frag = document.createDocumentFragment();
    if (data.stale || state.usageErr) {
      frag.appendChild(h("div", { class: "blk-error", style: "margin-bottom:16px" }, icon("alert"),
        h("div", { class: "be-body", text: state.usageErr ? `刷新失败：${state.usageErr}` : "刷新失败，显示缓存" })));
    }
    if (data.is_apikey) {
      frag.appendChild(h("div", { class: "card", style: "margin-bottom:16px" },
        h("h3", {}, "Gemini API Key 模式"),
        h("p", { class: "drawer-desc", text: "当前账号使用 Gemini API Key 模式，不消耗 Google Cloud Code 个人周配额。如需使用 Claude 或 Google 官方订阅配额，请切换至 OAuth 账号。" })));
    }
    const groups = data.panel?.groups || [];
    if (groups.length) {
      for (const g of groups) {
        const s = groupSummary(g);
        const weekly = pickBucket(g, "weekly");
        const five = pickBucket(g, "5h");
        const ordered = [weekly, five].filter(Boolean);
        const buckets = ordered.length ? ordered : (g.buckets || []);
        frag.appendChild(h("div", { class: "card q-group" },
          h("h3", {}, h("span", { class: `model-dot ${/gemini/i.test(g.displayName) ? "g" : "c"}` }), g.displayName,
            s && s.pct <= 0 ? h("span", { class: "tag red", text: "Exhausted" }) : null),
          buckets.map(bucketEl)));
      }
    } else if (data.quota && Object.keys(data.quota).length) {
      frag.appendChild(h("div", { class: "card q-group" }, Object.entries(data.quota).map(([id, q]) => bucketEl({
        bucketId: id, displayName: q.display_name || id, remainingFraction: q.remaining_fraction,
        resetTime: q.reset_time, reset_in_seconds: q.reset_in_seconds, disabled: q.disabled,
      }))));
    } else if (!data.is_apikey) {
      frag.appendChild(h("div", { class: "loading-line", text: "无配额数据" }));
    }

    if (data.credits?.available) {
      frag.appendChild(h("div", { class: "section", style: "margin-top:22px" },
        h("div", { class: "section-title", text: "AI Credits" }),
        h("div", { class: "card" }, h("div", { class: "stat" }, h("div", { class: "s-label", text: "Balance" }), h("div", { class: "s-val", text: String(data.credits.balance ?? "—") })))));
    }

    const loc = data.local;
    if (loc) {
      const today = loc.today || {};
      const total = loc.total || {};
      const sec = h("div", { class: "section", style: "margin-top:22px" },
        h("div", { class: "section-title" }, h("span", { text: "本地统计" }), h("span", { class: "tag", text: "Antigravity Gemini 破甲" })),
        h("div", { class: "stat-grid" },
          h("div", { class: "stat" }, h("div", { class: "s-label", text: "今日请求" }), h("div", { class: "s-val", text: fmtNum(today.requests || 0) }),
            h("div", { class: "s-sub", text: `↑${fmtNum(today.input_tokens || 0)} ↓${fmtNum(today.output_tokens || 0)}` })),
          h("div", { class: "stat" }, h("div", { class: "s-label", text: "今日 tokens" }), h("div", { class: "s-val", text: fmtNum(today.total_tokens || 0) }),
            h("div", { class: "s-sub", text: `think ${fmtNum(today.thinking_tokens || 0)}` })),
          h("div", { class: "stat" }, h("div", { class: "s-label", text: "累计请求" }), h("div", { class: "s-val", text: fmtNum(total.requests || 0) }),
            h("div", { class: "s-sub", text: `cache ${fmtNum(total.cache_read_tokens || 0)}` })),
          h("div", { class: "stat" }, h("div", { class: "s-label", text: "累计 tokens" }), h("div", { class: "s-val", text: fmtNum(total.total_tokens || 0) }),
            h("div", { class: "s-sub", text: `↑${fmtNum(total.input_tokens || 0)} ↓${fmtNum(total.output_tokens || 0)}` }))));
      const recent = (loc.recent || []).slice(0, 8);
      if (recent.length) {
        sec.appendChild(h("div", { class: "recent-list" }, recent.map((r) =>
          h("div", { class: "recent-row", title: r.conversation_id || "" },
            h("span", { class: "r-time", text: fmtDateTime(r.at) }),
            h("span", { class: "r-model", text: r.model ? modelLabel(r.model) : "default" }),
            h("span", { class: "r-tok", text: `${fmtNum(r.usage?.total_tokens || 0)} tok` })))));
      }
      frag.appendChild(sec);
    }
    body.replaceChildren(frag);

    const foot = $("#quotaFoot");
    foot.innerHTML = "";
    if (data.email) foot.appendChild(h("span", { text: data.email }));
    if (data.plan_tier) foot.appendChild(h("span", { text: `Plan ${data.plan_tier}` }));
    if (data.fetchedAt) foot.appendChild(h("span", { text: `更新于 ${fmtTime(data.fetchedAt)}` }));
    if (data.cached) foot.appendChild(h("span", { text: data.stale ? "缓存（刷新失败）" : "缓存" }));
  }

  // ==========================================================
  // Accounts
  // ==========================================================
  // Accounts
  // ==========================================================
  let addAccountPoll = null;
  /** Survives drawer re-render so progress is not lost when Chrome steals focus. */
  const addFlow = {
    active: false,
    phase: "",       // busy | ok | err
    text: "",
    state: null,
    authUrl: null,
    btnLabel: "添加账号",
  };
  let addUi = { status: null, btn: null, statusText: null };

  function renderAccountChip(account) {
    const email = account?.email || (account?.accountType ? `(${account.accountType})` : null);
    $("#accountEmail").textContent = email || "未登录";
    $("#avatarLetter").textContent = (account?.email || account?.activeProfile || "?")[0].toUpperCase();
    $("#accountChip").title = account ? `${account.email || ""}\nprofile: ${account.activeProfile || "—"}` : "账号管理";
  }

  function stopAddPoll() {
    if (addAccountPoll) { clearInterval(addAccountPoll); addAccountPoll = null; }
  }

  function paintAddUi() {
    const { status, btn } = addUi;
    if (btn) {
      const busy = addFlow.phase === "busy";
      btn.disabled = busy;
      btn.classList.toggle("busy", busy);
      if (btn.tagName === "BUTTON") {
        btn.replaceChildren();
        if (btn.id === "mainAddBtn") {
          if (busy) btn.appendChild(h("span", { class: "spin" }));
          else if (addFlow.phase === "ok") btn.appendChild(icon("check"));
          else if (addFlow.phase === "err") btn.appendChild(icon("alert"));
          else btn.appendChild(icon("plus"));
          btn.appendChild(document.createTextNode(addFlow.btnLabel || "添加账号 (Google OAuth)"));
        } else {
          if (busy) {
            btn.appendChild(h("span", { class: "spin" }));
            btn.appendChild(document.createTextNode(" 换取中…"));
          } else {
            btn.appendChild(document.createTextNode("提交"));
          }
        }
      }
    }
    if (status) {
      status.className = "acct-add-status" + (addFlow.phase ? ` ${addFlow.phase}` : "");
      status.replaceChildren();
      if (addFlow.text) {
        if (addFlow.phase === "busy") status.appendChild(h("span", { class: "spin" }));
        else if (addFlow.phase === "ok") status.appendChild(icon("check"));
        else if (addFlow.phase === "err") status.appendChild(icon("alert"));
        status.appendChild(h("span", { text: addFlow.text }));
      }
    }
  }

  function setAddProgress(phase, text) {
    addFlow.phase = phase || "";
    addFlow.text = text || "";
    if (phase === "busy") addFlow.btnLabel = text || "添加中…";
    else if (phase === "ok") addFlow.btnLabel = "添加成功";
    else if (phase === "err") addFlow.btnLabel = "添加失败，重试";
    else addFlow.btnLabel = "添加账号";
    paintAddUi();
  }

  function resetAddFlow() {
    stopAddPoll();
    addFlow.active = false;
    addFlow.phase = "";
    addFlow.text = "";
    addFlow.state = null;
    addFlow.authUrl = null;
    addFlow.btnLabel = "添加账号";
  }

  async function submitManualOAuthCode(rawCode) {
    if (!rawCode || !String(rawCode).trim()) {
      toast("请先输入或粘贴授权码", true);
      return;
    }
    const code = extractCodeFromClip(rawCode) || String(rawCode).trim();
    if (!code) {
      toast("未能提取到有效授权码", true);
      return;
    }
    setAddProgress("busy", "正在向 Google 换取 Token 并保存账号…");
    try {
      const r = await api("/v1/accounts/oauth/finish", {
        method: "POST",
        body: { state: addFlow.state, code },
        timeoutMs: 35000,
      });
      finishAddSuccess(r.email || r.name);
    } catch (err) {
      setAddProgress("err", `换票失败：${err.message}`);
      toast(`换票失败：${err.message}`, true);
    }
  }

  async function saveApiKeyAccount(name, apiKey) {
    if (!name || !apiKey) {
      toast("档案名和 API Key 均不能为空", true);
      return;
    }
    setAddProgress("busy", "正在保存 API Key 账号…");
    try {
      const r = await api("/v1/accounts/save", {
        method: "POST",
        body: { name, type: "apikey", apiKey },
        timeoutMs: 15000,
      });
      finishAddSuccess(r.name);
    } catch (err) {
      setAddProgress("err", `保存失败：${err.message}`);
      toast(`保存失败：${err.message}`, true);
      paintAddUi();
    }
  }

  async function renderAccounts(force = false) {
    const body = $("#accountBody");
    const desc = $("#accountDesc");
    if (desc) desc.textContent = "";
    body.replaceChildren(h("div", { class: "loading-line" }, h("span", { class: "spin" }), "加载中…"));
    let data;
    try {
      data = await api("/v1/accounts", { timeoutMs: 15000 });
    } catch (err) {
      body.replaceChildren(h("div", { class: "loading-line err", text: `加载失败：${err.message}` }));
      return;
    }
    const w = data.whoami || {};
    renderAccountChip(w);
    const frag = document.createDocumentFragment();

    frag.appendChild(h("div", { class: "card acct-now" },
      h("span", { class: "avatar lg", text: (w.email || w.activeProfile || "?")[0].toUpperCase() }),
      h("div", { class: "meta" },
        h("strong", { text: w.email || "未登录" }),
        w.activeProfile ? h("div", { class: "tags" }, h("span", { class: "tag blue", text: w.activeProfile })) : null)));

    const addCard = h("div", { class: "card acct-add" });
    if (addFlow.active) {
      const busy = addFlow.phase === "busy";
      const head = h("div", { class: "row center", style: "justify-content:space-between; margin-bottom:8px" },
        h("div", { class: "row gap-xs center" },
          busy ? h("span", { class: "spin", style: "width:13px; height:13px" }) : (addFlow.phase === "ok" ? icon("check") : (addFlow.phase === "err" ? icon("alert") : icon("key"))),
          h("strong", { style: "font-size:13px", text: "手动提交 Google 授权码" })
        ),
        h("button", {
          class: "btn sm",
          type: "button",
          onclick: () => {
            resetAddFlow();
            renderAccounts();
          },
        }, "取消")
      );

      const hint = h("div", { class: "acct-add-hint", style: "margin:4px 0 10px; font-size:12px; line-height:1.6; color:var(--text-dim)" },
        h("div", {}, "1. 在打开的 Google 页面登录并完成授权；"),
        h("div", {}, "2. 页面会显示「Paste this code to complete authentication」及授权码（或跳转至回调网址）；"),
        h("div", {}, "3. 复制该授权码（或完整网址），粘贴至下方输入框并点击「提交」。")
      );

      const actionRow = h("div", { class: "row gap-xs", style: "margin-bottom:8px" },
        addFlow.authUrl ? h("a", {
          class: "btn sm primary grow",
          href: addFlow.authUrl,
          target: "_blank",
          rel: "noopener noreferrer",
          style: "text-align:center; text-decoration:none; display:flex; align-items:center; justify-content:center; gap:6px",
        }, icon("external-link"), "重新打开 Google 授权窗口") : null,
        addFlow.authUrl ? h("button", {
          class: "btn sm",
          type: "button",
          onclick: () => {
            copyText(addFlow.authUrl);
            toast("已复制授权链接");
          },
        }, "复制授权链接") : null
      );

      const codeIn = h("input", {
        class: "field mono grow",
        type: "text",
        placeholder: "在此粘贴授权码 (以 4/ 开头) 或完整回调 URL",
        autocomplete: "off",
        autofocus: true,
      });
      codeIn.addEventListener("keydown", (e) => {
        if (e.key === "Enter" && !busy) {
          e.preventDefault();
          submitManualOAuthCode(codeIn.value);
        }
      });

      const submitBtn = h("button", {
        class: "btn primary sm" + (busy ? " busy" : ""),
        type: "button",
        disabled: busy,
        onclick: () => submitManualOAuthCode(codeIn.value),
      }, busy ? [h("span", { class: "spin" }), " 换取 token 中…"] : "提交");

      const inputRow = h("div", { class: "row gap-xs", style: "margin-bottom:6px" }, codeIn, submitBtn);
      const status = h("div", { class: "acct-add-status" + (addFlow.phase ? ` ${addFlow.phase}` : "") });
      if (addFlow.text) {
        status.appendChild(h("span", { text: addFlow.text }));
      }
      addUi = { status, btn: submitBtn, statusText: null };

      addCard.append(head, hint, actionRow, inputRow, status);
    } else {
      const addBtn = h("button", {
        id: "mainAddBtn",
        class: "btn primary",
        type: "button",
        style: "width:100%",
        onclick: () => {
          if (addFlow.phase === "busy") return;
          beginBrowserOAuthFlow();
        },
      }, icon("plus"), "添加账号 (Google OAuth)");

      const status = h("div", { class: "acct-add-status" });
      addUi = { status, btn: addBtn, statusText: null };

      let showManualKey = false;
      const keyNameIn = h("input", { class: "field mono grow", placeholder: "档案名 (如 gemini-key)" });
      const keyValIn = h("input", { class: "field mono grow", type: "password", placeholder: "Gemini API Key (AIzaSy...)" });
      const keySubBtn = h("button", {
        class: "btn primary sm",
        type: "button",
        onclick: () => saveApiKeyAccount(keyNameIn.value.trim(), keyValIn.value.trim()),
      }, "保存 API Key");

      const keyBox = h("div", {
        class: "col gap-xs",
        style: "display:none; margin-top:8px; padding-top:8px; border-top:1px dashed var(--border)",
      }, keyNameIn, keyValIn, keySubBtn);

      const keyToggle = h("button", {
        class: "btn sm",
        type: "button",
        style: "width:100%; margin-top:6px; font-size:12px",
        onclick: () => {
          showManualKey = !showManualKey;
          keyBox.style.display = showManualKey ? "flex" : "none";
          keyToggle.textContent = showManualKey ? "收起 API Key 录入" : "使用 Gemini API Key 登录";
        },
      }, "使用 Gemini API Key 登录");

      addCard.append(addBtn, keyToggle, keyBox, status);
      paintAddUi();
    }
    frag.appendChild(addCard);

    const accounts = data.accounts || [];
    if (accounts.length) {
      const list = h("div");
      for (const a of accounts) {
        const cachedQ = force ? null : state.accountQuotas?.[a.name];
        const qContainer = h("div", { class: "acct-quotas", id: `acct-quota-${a.name}` },
          ...renderAccountQuotaPill(cachedQ, a.name));

        list.appendChild(h("div", { class: "acct-item" + (a.active ? " active" : "") },
          h("span", { class: "avatar", text: (a.email || a.name || "?")[0].toUpperCase() }),
          h("div", { class: "grow" },
            h("div", { class: "name" }, a.name,
              a.active ? h("span", { class: "tag blue", text: "active" }) : null),
            a.email ? h("div", { class: "mail", text: a.email }) : null,
            qContainer),
          h("button", { class: "btn sm" + (a.active ? "" : " primary"), disabled: a.active, onclick: () => switchAccount(a.name) }, a.active ? "Active" : "Switch"),
          h("button", { class: "icon-btn sm", title: "删除", onclick: () => deleteAccount(a.name) }, icon("trash"))));
      }
      frag.appendChild(h("div", { class: "section", style: "margin-top:18px" }, list));
    }

    body.replaceChildren(frag);
    loadAccountQuotas(force);
  }

  function renderAccountQuotaPill(q, name) {
    if (!q) {
      return [h("span", { class: "acct-q-pill loading" }, h("span", { class: "spin" }), "配额加载中…")];
    }
    if (q.is_apikey || q.type === "apikey") {
      return [h("span", { class: "acct-q-pill" }, h("span", { class: "q-dot g" }), h("span", { class: "q-name", text: "API Key 模式" }))];
    }
    if (q.error) {
      return [h("span", { class: "acct-q-pill err", title: q.error }, h("span", { class: "q-name", text: "配额未获取" }))];
    }

    const pills = [];
    // 1. Gemini Weekly
    if (q.geminiWeekly) {
      const gw = q.geminiWeekly;
      const pct = gw.remainingPercent;
      const isExhausted = gw.disabled || (pct != null && pct <= 0);
      const cls = isExhausted ? "crit" : (levelClass(pct) || "ok");
      const tip = `Gemini 7d 剩余: ${pct == null ? "—" : `${pct}%`}${gw.resetsIn ? ` · ${gw.resetsIn} 后刷新` : ""}${gw.description ? `\n${gw.description}` : ""}`;
      pills.push(h("span", { class: `acct-q-pill g ${cls}`, title: tip },
        h("span", { class: "q-dot" }),
        h("span", { class: "q-name", text: "Gemini 7d" }),
        h("span", { class: "q-bar" }, h("i", { style: `width:${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%` })),
        h("span", { class: "q-val", text: pct == null ? "—" : `${pct}%` })
      ));
    }

    // 2. Claude Weekly
    if (q.claudeWeekly) {
      const cw = q.claudeWeekly;
      const pct = cw.remainingPercent;
      const isExhausted = cw.disabled || (pct != null && pct <= 0);
      const cls = isExhausted ? "crit" : (levelClass(pct) || "ok");
      const tip = `Claude 7d 剩余: ${pct == null ? "—" : `${pct}%`}${cw.resetsIn ? ` · ${cw.resetsIn} 后刷新` : ""}${cw.description ? `\n${cw.description}` : ""}`;
      pills.push(h("span", { class: `acct-q-pill c ${cls}`, title: tip },
        h("span", { class: "q-dot" }),
        h("span", { class: "q-name", text: "Claude 7d" }),
        h("span", { class: "q-bar" }, h("i", { style: `width:${pct == null ? 0 : Math.max(2, Math.min(100, pct))}%` })),
        h("span", { class: "q-val", text: pct == null ? "—" : `${pct}%` })
      ));
    }

    return pills.length ? pills : [h("span", { class: "acct-q-pill err", text: "无配额数据" })];
  }

  async function loadAccountQuotas(force = false) {
    state.accountQuotasLoading = true;
    try {
      const res = await api(`/v1/accounts/quotas${force ? "?refresh=1" : ""}`, { timeoutMs: 35000 });
      if (res?.ok && res.quotas) {
        state.accountQuotas = res.quotas;
        LS.set("agy.accountQuotas", res.quotas);
        for (const [name, q] of Object.entries(res.quotas)) {
          const el = $(`#acct-quota-${name}`);
          if (el) el.replaceChildren(...renderAccountQuotaPill(q, name));
        }
      }
    } catch (err) {
      console.warn("loadAccountQuotas failed:", err);
    } finally {
      state.accountQuotasLoading = false;
    }
  }

  async function beginBrowserOAuthFlow() {
    stopAddPoll();
    addFlow.active = true;
    addFlow.phase = "busy";
    addFlow.text = "正在获取授权链接…";
    renderAccounts();
    toast("正在获取授权链接…");

    // Pre-open new tab synchronously on click to guarantee popup blockers do not block it
    let authWin = null;
    try {
      authWin = window.open("about:blank", "_blank");
    } catch { /* ignore */ }

    try {
      const r = await api("/v1/accounts/oauth/start", {
        method: "POST",
        body: { open: false },
        timeoutMs: 15000,
      });
      addFlow.state = r.state || null;
      addFlow.authUrl = r.authUrl || null;
      addFlow.active = true;
      addFlow.phase = "";
      addFlow.text = "";

      if (r.authUrl) {
        if (authWin && !authWin.closed) {
          authWin.location.href = r.authUrl;
          authWin.focus();
        } else {
          window.open(r.authUrl, "_blank");
        }
      }

      toast("已打开授权窗口，请登录后复制授权码粘贴至下方");
      renderAccounts();
      loadHealth();
    } catch (err) {
      if (authWin && !authWin.closed) {
        try { authWin.close(); } catch {}
      }
      addFlow.active = true;
      addFlow.phase = "err";
      addFlow.text = `获取授权链接失败：${err.message}`;
      toast(`获取授权链接失败：${err.message}`, true);
      renderAccounts();
    }
  }

  function finishAddSuccess(emailOrName) {
    stopAddPoll();
    addFlow.state = null;
    const label = emailOrName ? `添加成功 · ${emailOrName}` : "添加成功";
    setAddProgress("ok", label);
    toast(label);
    setTimeout(() => {
      resetAddFlow();
      renderAccounts(true);
      loadHealth();
      loadModels();
      loadUsage(true);
    }, 1200);
  }

  function finishAddError(msg) {
    stopAddPoll();
    addFlow.state = null;
    setAddProgress("err", msg || "添加失败");
    toast(msg || "添加失败", true);
  }

  function extractCodeFromClip(t) {
    if (!t) return null;
    const s = String(t).trim();
    const m = s.match(/[?&#]code=([^&#\s]+)/i);
    if (m?.[1]) {
      try { return decodeURIComponent(m[1]).trim(); } catch { return m[1].trim(); }
    }
    const gm = s.match(/\b([41]\/[0-9A-Za-z\-_]{20,})\b/);
    if (gm?.[1]) return gm[1].trim();
    const bare = s.replace(/\s+/g, "");
    if (bare.length >= 20 && !/^https?:/i.test(bare) && /^[A-Za-z0-9_/\-.+=]+$/.test(bare)) return bare;
    return s;
  }

  async function switchAccount(name) {
    try {
      const r = await api("/v1/accounts/switch", { method: "POST", body: { name }, timeoutMs: 30000 });
      toast(`已切换到 ${r.name}${r.email ? `（${r.email}）` : ""}`);
      renderAccounts(true);
      loadHealth();
      loadModels();
      loadUsage(true);
    } catch (err) {
      toast(`切换失败：${err.message}`, true);
    }
  }
  async function deleteAccount(name) {
    if (!confirm(`确定删除「${name}」？`)) return;
    try {
      await api(`/v1/accounts/${encodeURIComponent(name)}`, { method: "DELETE", timeoutMs: 15000 });
      toast(`已删除 ${name}`);
      renderAccounts();
      loadHealth();
    } catch (err) {
      toast(`删除失败：${err.message}`, true);
    }
  }

  // ==========================================================
  // Settings
  // ==========================================================
  const CAP_LABELS = {
    model_quotas_panel: "官方配额面板",
    model_selector: "模型切换",
    account_switch: "多账号切换",
    auto_approve: "强制自动同意",
    streaming_steps: "流式步骤 (SSE)",
    subagent_events: "子代理事件",
    subagent_thinking_via_transcript: "子代理思考（transcript）",
    parallel_agent_default: "默认 Agent（与官方桌面端一致）",
    main_agent_thinking_stream: "主代理独立思考流",
    ai_credits_balance: "AI Credits 余额",
    interactive_agents_panel_kill: "单独终止某个子代理",
  };

  function renderSettings() {
    const body = $("#settingsBody");
    const frag = document.createDocumentFragment();

    // appearance
    const pref = themePref();
    const seg = h("div", { class: "theme-seg", role: "radiogroup", "aria-label": "主题" });
    for (const o of THEME_OPTS) {
      seg.appendChild(h("button", {
        class: `theme-opt${pref === o.v ? " active" : ""}`,
        type: "button",
        role: "radio",
        "aria-checked": pref === o.v ? "true" : "false",
        "data-v": o.v,
        title: o.d,
        onclick: () => setThemePref(o.v),
      }, h("div", { class: "theme-swatch", "aria-hidden": "true" }), icon(o.icon), h("span", { class: "t-label", text: o.l })));
    }
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title", text: "外观" }),
      h("div", { class: "card form-grid" },
        h("label", {}, "主题", seg))));

    // connection
    const urlIn = h("input", { class: "field mono", placeholder: defaultBase, value: cfg.base });
    const keyIn = h("input", { class: "field mono", type: "password", placeholder: "API Key", value: cfg.apiKey, autocomplete: "off" });
    const saveConn = () => {
      cfg.base = urlIn.value.trim().replace(/\/+$/, "");
      cfg.apiKey = keyIn.value.trim();
      LS.set("agy.base", cfg.base);
      LS.set("agy.apiKey", cfg.apiKey);
      state.connected = false;
      toast("连接设置已保存");
      loadHealth();
    };
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title", text: "连接" }),
      h("div", { class: "card form-grid" },
        h("label", {}, "Backend URL", urlIn),
        h("label", {}, "API Key", keyIn),
        h("div", { class: "form-actions" },
          h("span", { class: "grow" }, h("span", { class: `conn-dot ${state.connected ? "ok" : "err"}`, style: "display:inline-block;margin-right:8px" }), state.connected ? "已连接" : "未连接"),
          h("button", { class: "btn primary", onclick: saveConn }, "保存并重连")))));

    // prefs
    const p = state.prefs || {};
    const mSel = h("select", { class: "field" },
      state.models.map((m) => h("option", { value: m.id, text: `${m.label || m.id}` })));
    if (p.defaultModel && !state.models.some((m) => m.id === p.defaultModel)) mSel.appendChild(h("option", { value: p.defaultModel, text: p.defaultModel }));
    mSel.value = p.defaultModel || state.model || state.models[0]?.id || "";
    const cIn = h("input", { class: "field mono", placeholder: state.health?.cwd || "", value: p.defaultCwd || "" });
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title", text: "默认偏好" }),
      h("div", { class: "card form-grid" },
        h("label", {}, "默认模型", mSel),
        h("label", {}, "默认工作目录", cIn),
        h("div", { class: "form-actions" },
          h("span", { class: "grow", text: p.updatedAt ? `更新于 ${fmtDateTime(p.updatedAt)}` : "" }),
          h("button", {
            class: "btn primary",
            onclick: () => setServerPrefs({ defaultModel: mSel.value || null, defaultCwd: cIn.value.trim() || null }, "已保存"),
          }, "保存")))));

    // runs
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title" }, h("span", { text: "进行中的任务" }), h("button", { class: "btn sm ghost", onclick: loadRuns }, icon("refresh"), "刷新")),
      h("div", { id: "runsList" })));

    // transcript lookup
    const txIn = h("input", { class: "field mono", placeholder: "conversation_id" });
    const openTx = () => { const v = txIn.value.trim(); if (v) openTranscriptModal(v); };
    txIn.addEventListener("keydown", (e) => { if (e.key === "Enter") openTx(); });
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title", text: "Transcript" }),
      h("div", { class: "card form-grid" },
        h("div", { class: "pop-form", style: "padding:0" }, h("div", { class: "row" }, txIn, h("button", { class: "btn", onclick: openTx }, "打开"))))));

    // capabilities
    const caps = state.caps?.official_parity;
    const capList = h("div", { class: "cap-list" });
    if (caps) {
      for (const [k, v] of Object.entries(caps)) {
        const kind = v === true ? "yes" : v === false ? "no" : /partial/i.test(String(v)) ? "part" : "yes";
        capList.appendChild(h("div", { class: "cap-row" },
          h("span", { class: `cap-ico ${kind}` }, icon(kind === "no" ? "x" : kind === "part" ? "minus" : "check")),
          h("span", { class: "c-name", text: CAP_LABELS[k] || humanize(k) }),
          typeof v === "string" ? h("span", { class: "c-val", text: v }) : null));
      }
    } else capList.appendChild(h("div", { class: "empty-note", text: state.connected ? "加载中…" : "后端未连接" }));
    frag.appendChild(h("div", { class: "section" },
      h("div", { class: "section-title", text: "能力" }),
      h("div", { class: "card" }, capList)));

    // about
    const hl = state.health;
    if (hl) {
      frag.appendChild(h("div", { class: "section" },
        h("div", { class: "section-title", text: "关于" }),
        h("div", { class: "card" }, h("dl", { class: "kv" },
          h("dt", { text: "Service" }), h("dd", { text: `${hl.service || "agy-auto"} v${hl.version || "?"}` }),
          h("dt", { text: "agy" }), h("dd", { text: hl.agy || "—" }),
          h("dt", { text: "Server cwd" }), h("dd", { text: hl.cwd || "—" }),
          h("dt", { text: "Permission" }), h("dd", { text: hl.flag || (hl.autoApprove ? "auto-approve" : "—") }),
          h("dt", { text: "Endpoints" }), h("dd", { text: String(state.caps?.endpoints?.length ?? "—") })))));
    }

    body.replaceChildren(frag);
    renderRunsList();
  }

  function renderRunsList() {
    const box = $("#runsList");
    if (!box) return;
    box.innerHTML = "";
    if (!state.runs.length) {
      box.appendChild(h("div", { class: "empty-note", text: "当前没有进行中的 agy 进程" }));
      return;
    }
    for (const r of state.runs) {
      const owner = findConvForRun(r.run_id);
      const open = () => {
        if (!owner) {
          toast("找不到对应对话（可能是其他标签页发起，或本页已刷新断开）", true);
          return;
        }
        selectConv(owner.id);
        closeDrawers();
        setTimeout(scrollBottom, 40);
      };
      box.appendChild(h("div", {
        class: "run-row" + (owner ? " clickable" : ""),
        title: owner ? "点击打开对话" : "无关联对话",
        onclick: owner ? open : undefined,
      },
        h("span", { class: "spin" }),
        h("div", { class: "grow" },
          h("div", { class: "rid", text: owner ? (owner.title || "对话") : r.run_id }),
          h("div", { class: "rsub", text: `${owner ? r.run_id + " · " : ""}pid ${r.pid ?? "—"} · 已运行 ${fmtDur(Date.now() - r.startedAt)}` })),
        owner ? h("button", {
          class: "btn sm",
          onclick: (e) => { e.stopPropagation(); open(); },
        }, "打开") : null,
        h("button", {
          class: "btn sm danger",
          onclick: (e) => { e.stopPropagation(); abortRunId(r.run_id, owner); },
        }, "Abort")));
    }
  }

  // ==========================================================
  // Drawers / modal
  // ==========================================================
  function openDrawer(name) {
    closePops();
    for (const d of ["quota", "account", "settings"]) $(`#${d}Drawer`).classList.toggle("hidden", d !== name);
    $("#mask").classList.remove("hidden");
    state.drawer = name;
    if (name === "quota") { renderQuota(); loadUsage(false); }
    if (name === "account") renderAccounts();
    if (name === "settings") { renderSettings(); loadRuns(); if (!state.caps) loadCaps(); }
  }
  function closeDrawers() {
    for (const d of ["quota", "account", "settings"]) $(`#${d}Drawer`).classList.add("hidden");
    $("#mask").classList.add("hidden");
    state.drawer = null;
  }
  function openModal(title, content) {
    $("#modalTitle").textContent = title;
    $("#modalBody").replaceChildren(content);
    $("#modalWrap").classList.remove("hidden");
  }
  function closeModal() {
    $("#modalWrap").classList.add("hidden");
    $("#modalBody").innerHTML = "";
  }

  // ==========================================================
  // Events
  // ==========================================================
  hydrateIcons();

  $("#sendBtn").onclick = () => {
    const conv = activeConv();
    const mode = $("#sendBtn").dataset.mode;
    if (mode === "stop" && conv && isLive(conv)) stopRun(conv.id);
    else send();
  };
  promptInput.addEventListener("input", () => { autoGrow(); syncComposer(); });
  promptInput.addEventListener("keydown", (e) => {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) {
      e.preventDefault();
      send();
    }
  });

  // attachments: click + drag-drop + paste image
  $("#attachBtn").onclick = () => { if (!$("#attachBtn").disabled) $("#attachInput").click(); };
  $("#attachInput").addEventListener("change", () => {
    addFiles($("#attachInput").files);
    $("#attachInput").value = "";
  });
  {
    const box = $("#composer");
    let dragDepth = 0;
    const setDrag = (on) => box.classList.toggle("dragover", on);
    box.addEventListener("dragenter", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      dragDepth += 1;
      setDrag(true);
    });
    box.addEventListener("dragover", (e) => {
      if (!e.dataTransfer?.types?.includes("Files")) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = "copy";
    });
    box.addEventListener("dragleave", () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (!dragDepth) setDrag(false);
    });
    box.addEventListener("drop", (e) => {
      e.preventDefault();
      dragDepth = 0;
      setDrag(false);
      addFiles(e.dataTransfer?.files);
    });
    promptInput.addEventListener("paste", (e) => {
      const items = [...(e.clipboardData?.items || [])];
      const files = items.filter((it) => it.kind === "file").map((it) => it.getAsFile()).filter(Boolean);
      if (!files.length) return;
      e.preventDefault();
      addFiles(files);
    });
    window.addEventListener("dragover", (e) => e.preventDefault());
    window.addEventListener("drop", (e) => e.preventDefault());
  }

  $("#btnNewChat").onclick = newChat;
  $("#btnCollapse").onclick = () => document.body.classList.add("side-collapsed");
  $("#btnExpand").onclick = () => document.body.classList.remove("side-collapsed");
  $("#convSearch").addEventListener("input", (e) => { state.search = e.target.value; renderConvList(); });

  const title = $("#convTitle");
  const commitTitle = () => {
    const conv = activeConv();
    if (!conv) return;
    const v = title.value.trim();
    if (v && v !== conv.title) { conv.title = v; scheduleSave(); renderConvList(); renderTopbar(); }
    else title.value = conv.title;
  };
  title.addEventListener("keydown", (e) => { if (e.key === "Enter") { e.preventDefault(); title.blur(); } if (e.key === "Escape") { title.value = activeConv()?.title || ""; title.blur(); } });
  title.addEventListener("blur", commitTitle);
  $("#convIdChip").onclick = () => { const c = activeConv(); if (c?.conversationId) copyText(c.conversationId, "已复制 conversation_id"); };

  for (const id of POPS) {
    $(`#${POP_CHIP[id]}`).addEventListener("click", (e) => { e.stopPropagation(); togglePop(id); });
    $(`#${id}`).addEventListener("click", (e) => e.stopPropagation());
  }
  document.addEventListener("click", () => closePops());

  $("#quotaBtn").onclick = () => openDrawer("quota");
  $("#accountChip").onclick = () => openDrawer("account");
  $("#btnTheme").onclick = cycleThemeQuick;
  $("#btnSettings").onclick = () => openDrawer("settings");
  $("#runsPill").onclick = (e) => focusRunning(e);
  $("#runsPop")?.addEventListener("click", (e) => e.stopPropagation());
  document.addEventListener("click", () => closeRunsPop());
  $("#connBox").onclick = () => openDrawer("settings");
  $("#mask").onclick = closeDrawers;
  for (const b of $$("[data-close]")) b.onclick = closeDrawers;
  $("#quotaRefresh").onclick = () => loadUsage(true);
  $("#accountRefresh").onclick = () => renderAccounts(true);
  $("#modalClose").onclick = closeModal;
  $("#modalWrap").addEventListener("click", (e) => { if (e.target.id === "modalWrap") closeModal(); });

  document.addEventListener("click", (e) => {
    const btn = e.target.closest(".cb-copy");
    if (!btn) return;
    const code = btn.closest(".codeblock")?.querySelector("code")?.textContent || "";
    copyText(code, "代码已复制");
  });

  threadEl.addEventListener("scroll", () => $("#main").classList.toggle("scrolled", threadEl.scrollTop > 4), { passive: true });

  document.addEventListener("keydown", (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "k") { e.preventDefault(); newChat(); return; }
    if (e.key === "Escape") {
      if (!$("#modalWrap").classList.contains("hidden")) return closeModal();
      if (popOpen()) return closePops();
      if (state.drawer) return closeDrawers();
      const conv = activeConv();
      // Match send button: Esc stops only when composer has no pending text/files
      if (conv && isLive(conv) && $("#sendBtn").dataset.mode === "stop") stopRun(conv.id);
      return;
    }
    if (e.key === "/" && !/INPUT|TEXTAREA|SELECT/.test(document.activeElement?.tagName || "")) { e.preventDefault(); promptInput.focus(); }
  });

  window.addEventListener("beforeunload", () => {
    saveNow();
  });

  async function syncConvsFromBackend() {
    try {
      const data = await api("/v1/conversations?limit=60", { timeoutMs: 8000 });
      if (!Array.isArray(data?.conversations)) return;
      let updated = false;
      for (const dc of data.conversations) {
        if (!dc.id) continue;
        let local = state.convs.find((c) => c.conversationId === dc.id || c.id === dc.id);
        if (!local) {
          state.convs.push({
            id: dc.id,
            title: dc.title || "Conversation",
            conversationId: dc.id,
            createdAt: dc.createdAt || Date.now(),
            updatedAt: dc.updatedAt || Date.now(),
            turns: [
              {
                id: `t_${dc.id}_0`,
                prompt: dc.prompt || dc.title,
                at: dc.createdAt || Date.now(),
                startedAt: dc.createdAt || Date.now(),
                status: "done",
                blocks: [],
              },
            ],
            queue: [],
          });
          updated = true;
        } else {
          if (!local.conversationId) {
            local.conversationId = dc.id;
            updated = true;
          }
        }
      }
      if (updated) {
        scheduleSave();
        renderConvList();
      }
    } catch {
      // non-fatal
    }
  }

  // ==========================================================
  // Boot
  // ==========================================================
  if (window.innerWidth <= 900) document.body.classList.add("side-collapsed");
  renderConvList();
  renderThread();
  renderCwdChip();
  renderModelChip();
  renderQMeter();
  autoGrow();
  loadHealth();
  loadUsage(false);
  loadAccountQuotas(false);
  syncConvsFromBackend();
  reattachRuns();
  setInterval(loadHealth, 30000);
  setInterval(loadRuns, 15000);
  setInterval(() => { if (!document.hidden && state.connected) loadUsage(false); }, 5 * 60000);
})();
