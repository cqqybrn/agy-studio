import http from 'node:http';
import type { IncomingMessage } from 'node:http';
import type { Socket } from 'node:net';
import os from 'node:os';

/** Set on every request that arrived through the LAN listener (as opposed to 127.0.0.1). */
const LAN_REQUEST = Symbol.for('agy-studio.lan-request');

export function isLanRequest(raw: IncomingMessage): boolean {
  return (raw as IncomingMessage & { [LAN_REQUEST]?: boolean })[LAN_REQUEST] === true;
}

export interface LanAddress {
  /** Network adapter name, e.g. "WLAN" or "以太网". */
  name: string;
  address: string;
}

/** Virtual adapters (VMware, Hyper-V, WSL, VPN…) are listed after real ones. */
const VIRTUAL_ADAPTER = /vmware|virtualbox|vethernet|hyper-v|wsl|docker|loopback|tailscale|zerotier|vpn|tap|tun/i;

/** IPv4 addresses other devices on the network can use to reach this computer. */
export function lanAddresses(): LanAddress[] {
  const list: LanAddress[] = [];
  for (const [name, infos] of Object.entries(os.networkInterfaces())) {
    for (const info of infos ?? []) {
      if (info.family === 'IPv4' && !info.internal && !info.address.startsWith('169.254.')) {
        list.push({ name, address: info.address });
      }
    }
  }
  return list.sort((a, b) => Number(VIRTUAL_ADAPTER.test(a.name)) - Number(VIRTUAL_ADAPTER.test(b.name)));
}

/**
 * A second listener (0.0.0.0 on the same port) that hands every request and WebSocket upgrade to
 * the main server, marked as coming from the LAN. Windows lets it coexist with the 127.0.0.1
 * listener; requests from this computer keep arriving on 127.0.0.1.
 */
export class LanListener {
  private server: http.Server | null = null;
  private readonly sockets = new Set<Socket>();

  constructor(
    private readonly target: http.Server,
    private readonly host = '0.0.0.0',
  ) {}

  get running(): boolean {
    return this.server !== null;
  }

  async start(port: number): Promise<void> {
    if (this.server) return;
    const server = http.createServer((req, res) => {
      (req as IncomingMessage & { [LAN_REQUEST]?: boolean })[LAN_REQUEST] = true;
      this.target.emit('request', req, res);
    });
    server.on('upgrade', (req: IncomingMessage, socket: Socket, head: Buffer) => {
      (req as IncomingMessage & { [LAN_REQUEST]?: boolean })[LAN_REQUEST] = true;
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
      this.target.emit('upgrade', req, socket, head);
    });
    server.on('connection', (socket: Socket) => {
      this.sockets.add(socket);
      socket.once('close', () => this.sockets.delete(socket));
    });
    await new Promise<void>((resolve, reject) => {
      server.once('error', reject);
      server.listen(port, this.host, () => {
        server.off('error', reject);
        resolve();
      });
    });
    this.server = server;
  }

  /** Stops listening and drops every LAN connection, WebSockets included. */
  async stop(): Promise<void> {
    const server = this.server;
    if (!server) return;
    this.server = null;
    for (const socket of this.sockets) socket.destroy();
    this.sockets.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
  }
}
