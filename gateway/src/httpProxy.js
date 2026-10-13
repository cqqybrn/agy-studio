import net from "node:net";
import tls from "node:tls";
import https from "node:https";
import http from "node:http";
import { spawnSync } from "node:child_process";

let cachedProxy = undefined;

/**
 * 动态检测系统代理配置（跨平台兼容）：
 * 1. 优先检查环境变量 HTTP_PROXY / HTTPS_PROXY / ALL_PROXY（Clash、v2rayN、企业代理等通用）
 * 2. Windows 平台下，若无环境变量则查询注册表中的系统代理设置（ProxyEnable / ProxyServer）
 * 3. 若均未检测到或不在国内环境，返回 null，自动无缝走原生直连
 */
export function getSystemProxy(forceRefresh = false) {
  if (!forceRefresh && cachedProxy !== undefined) return cachedProxy;

  const env =
    process.env.HTTPS_PROXY ||
    process.env.https_proxy ||
    process.env.HTTP_PROXY ||
    process.env.http_proxy ||
    process.env.ALL_PROXY ||
    process.env.all_proxy;
  if (env) {
    try {
      const u = new URL(env.startsWith("http") ? env : `http://${env}`);
      cachedProxy = { host: u.hostname, port: Number(u.port || 8080) };
      return cachedProxy;
    } catch {
      /* continue */
    }
  }

  if (process.platform === "win32") {
    try {
      const regExe = `${process.env.SystemRoot || "C:\\Windows"}\\System32\\reg.exe`;
      const enR = spawnSync(regExe, [
        "query",
        "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
        "/v",
        "ProxyEnable",
      ], { encoding: "utf8", windowsHide: true });

      if (enR.status === 0 && /0x1\s*$/m.test(enR.stdout)) {
        const srvR = spawnSync(regExe, [
          "query",
          "HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Internet Settings",
          "/v",
          "ProxyServer",
        ], { encoding: "utf8", windowsHide: true });

        if (srvR.status === 0) {
          const m = srvR.stdout.match(/ProxyServer\s+REG_SZ\s+(\S+)/);
          if (m && m[1]) {
            let server = m[1];
            // Might be "http=127.0.0.1:10809;https=127.0.0.1:10809" or "127.0.0.1:7890"
            if (server.includes("https=")) {
              server = server.split(";").find((s) => s.startsWith("https="))?.slice(6) || server;
            } else if (server.includes("http=")) {
              server = server.split(";").find((s) => s.startsWith("http="))?.slice(5) || server;
            }
            const parts = server.split(":");
            if (parts[0] && parts[1]) {
              cachedProxy = { host: parts[0], port: Number(parts[1]) };
              return cachedProxy;
            }
          }
        }
      }
    } catch {
      /* ignore */
    }
  }

  cachedProxy = null;
  return null;
}

/**
 * 兼容标准 fetch 签名的代理请求函数：
 * - 自动检测代理环境：有代理则通过 CONNECT 隧道发送请求；无代理则走原生直接请求
 * - 返回与原生 fetch 一致的结构（ok, status, statusText, headers, text(), json()）
 */
export function proxyFetch(url, options = {}) {
  const targetUrl = new URL(url);
  const isHttps = targetUrl.protocol === "https:";
  const method = options.method || "GET";
  let body = options.body;
  if (body != null && typeof body !== "string" && !Buffer.isBuffer(body)) {
    body = String(body);
  }
  const timeoutMs = options.timeoutMs || 25000;
  const targetHost = targetUrl.hostname;
  const targetPort = targetUrl.port || (isHttps ? 443 : 80);

  const proxy = getSystemProxy();

  return new Promise((resolve, reject) => {
    let timer = null;

    const cleanup = () => {
      if (timer) clearTimeout(timer);
    };

    timer = setTimeout(() => {
      reject(new Error(`Request to ${targetHost} timed out after ${timeoutMs}ms`));
    }, timeoutMs);

    const makeDirectRequest = () => {
      const mod = isHttps ? https : http;
      const headers = { ...options.headers, Host: targetHost };
      if (body) headers["Content-Length"] = Buffer.byteLength(body);

      const req = mod.request({
        hostname: targetHost,
        port: targetPort,
        path: targetUrl.pathname + targetUrl.search,
        method,
        headers,
      }, (res) => {
        handleResponse(res);
      });
      req.on("error", (err) => { cleanup(); reject(err); });
      if (body) req.write(body);
      req.end();
    };

    const handleResponse = (res) => {
      const chunks = [];
      res.on("data", (c) => chunks.push(c));
      res.on("end", () => {
        cleanup();
        const raw = Buffer.concat(chunks).toString("utf8");
        resolve({
          ok: res.statusCode >= 200 && res.statusCode < 300,
          status: res.statusCode,
          statusText: res.statusMessage || "",
          headers: res.headers,
          text: async () => raw,
          json: async () => JSON.parse(raw),
        });
      });
      res.on("error", (err) => { cleanup(); reject(err); });
    };

    // 无代理或非 HTTPS 请求，直接回退走直连
    if (!proxy || !isHttps) {
      makeDirectRequest();
      return;
    }

    const proxySocket = net.connect(proxy.port, proxy.host, () => {
      proxySocket.write(
        `CONNECT ${targetHost}:${targetPort} HTTP/1.1\r\n` +
        `Host: ${targetHost}:${targetPort}\r\n` +
        `Proxy-Connection: Keep-Alive\r\n\r\n`
      );
    });

    proxySocket.once("data", (chunk) => {
      const resp = chunk.toString();
      if (!resp.includes("200")) {
        cleanup();
        proxySocket.destroy();
        return reject(new Error(`Proxy CONNECT error: ${resp.split("\r\n")[0]}`));
      }

      const tlsSocket = tls.connect({
        socket: proxySocket,
        servername: targetHost,
      }, () => {
        const headers = {
          ...options.headers,
          Host: targetHost,
          Connection: "close",
        };
        if (body) {
          headers["Content-Length"] = Buffer.byteLength(body);
        }

        const req = https.request({
          createConnection: () => tlsSocket,
          hostname: targetHost,
          port: targetPort,
          path: targetUrl.pathname + targetUrl.search,
          method,
          headers,
        }, (res) => {
          handleResponse(res);
        });

        req.on("error", (err) => { cleanup(); reject(err); });
        if (body) req.write(body);
        req.end();
      });

      tlsSocket.on("error", (err) => { cleanup(); reject(err); });
    });

    proxySocket.on("error", (err) => {
      cachedProxy = undefined; // 代理出错时清除缓存，下次请求重新探测
      cleanup();
      reject(err);
    });
  });
}
