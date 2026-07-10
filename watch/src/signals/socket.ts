import { createServer, Server } from "node:net";
import { randomUUID } from "node:crypto";
import { existsSync, unlinkSync } from "node:fs";
import type { Signal } from "../types";

export interface SocketServer {
  close(): Promise<void>;
}

export type SignalHandler = (signal: Signal) => void | Promise<void>;

export async function createSocketServer(path: string, handler: SignalHandler): Promise<SocketServer> {
  // Clean up stale Unix socket (Windows named pipes auto-clean)
  if (process.platform !== "win32" && existsSync(path)) {
    try { unlinkSync(path); } catch {}
  }

  const server: Server = createServer(socket => {
    socket.on("error", err => console.error("[watch] socket client error:", err));
    let buf = "";
    socket.on("data", chunk => {
      buf += chunk.toString();
      let nl: number;
      while ((nl = buf.indexOf("\n")) >= 0) {
        const line = buf.slice(0, nl);
        buf = buf.slice(nl + 1);
        if (!line.trim()) continue;
        try {
          const raw = JSON.parse(line);
          const signal: Signal = {
            id: raw.id ?? `sig_${randomUUID()}`,
            source: raw.source,
            type: raw.type,
            repo: raw.repo,
            timestamp: raw.timestamp ?? new Date().toISOString(),
            metadata: raw.metadata ?? {},
          };
          Promise.resolve(handler(signal)).catch(err => {
            console.error("[watch] signal handler error:", err);
          });
        } catch (err) {
          console.error("[watch] invalid signal payload:", err);
        }
      }
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(path, () => {
      server.on("error", err => console.error("[watch] socket server error:", err));
      resolve();
    });
  });

  return {
    async close() {
      await new Promise<void>(r => server.close(() => r()));
      if (process.platform !== "win32" && existsSync(path)) {
        try { unlinkSync(path); } catch {}
      }
    },
  };
}
