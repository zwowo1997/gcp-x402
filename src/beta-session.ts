import { chmodSync, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { config } from "./config.js";

interface StoredBetaSession {
  token: string;
  expiresAt: string;
}

let current: StoredBetaSession | null | undefined;

export function betaSessionToken(): string | null {
  if (current === undefined) {
    try { current = existsSync(config.betaSessionFile) ? JSON.parse(readFileSync(config.betaSessionFile, "utf8")) as StoredBetaSession : null; }
    catch { current = null; }
  }
  if (!current || new Date(current.expiresAt).getTime() <= Date.now()) return null;
  return current.token;
}

export function saveBetaSession(session: StoredBetaSession): void {
  const directory = dirname(config.betaSessionFile);
  mkdirSync(directory, { recursive: true });
  try { writeFileSync(`${directory}/.gitignore`, "*\n", { flag: "wx" }); } catch { /* already exists */ }
  writeFileSync(config.betaSessionFile, JSON.stringify(session, null, 2), { mode: 0o600 });
  try { chmodSync(config.betaSessionFile, 0o600); } catch { /* best effort on non-POSIX systems */ }
  current = session;
}
