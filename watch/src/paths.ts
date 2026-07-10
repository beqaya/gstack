import { homedir } from "node:os";
import { join } from "node:path";

export function gstackDataDir(): string {
  return join(homedir(), ".gstack");
}

export function watchRoot(): string {
  return join(gstackDataDir(), "watch");
}

export function watchLogDir(): string {
  return join(watchRoot(), "log");
}

export function watchPidFile(): string {
  return join(watchRoot(), "daemon.pid");
}

export function watchSocketPath(): string {
  if (process.platform === "win32") {
    return "\\\\.\\pipe\\gstack-watch";
  }
  return join(watchRoot(), "daemon.sock");
}

export function watchSecretsDir(): string {
  return join(watchRoot(), "secrets");
}
