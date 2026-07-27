import { createHmac, timingSafeEqual } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import { config } from "./config";

export const BETA_SESSION_HEADER = "x-gcp-x402-session";

interface SessionPayload {
  iat: number;
  exp: number;
}

function configured(): { password: string; sessionSecret: string } | null {
  if (!config.betaAccessPassword || !config.betaSessionSecret) return null;
  return { password: config.betaAccessPassword, sessionSecret: config.betaSessionSecret };
}

function hmac(value: string, secret: string): string {
  return createHmac("sha256", secret).update(value, "utf8").digest("base64url");
}

function equal(a: string, b: string): boolean {
  const left = Buffer.from(a);
  const right = Buffer.from(b);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function passwordMatches(password: string): boolean {
  const values = configured();
  return Boolean(values && equal(password, values.password));
}

export function issueBetaSession(): { token: string; expiresAt: string } {
  const values = configured();
  if (!values) throw new Error("Private-beta access is not configured.");
  const now = Math.floor(Date.now() / 1000);
  const payload: SessionPayload = { iat: now, exp: now + config.betaSessionTtlSeconds };
  const body = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return { token: `${body}.${hmac(body, values.sessionSecret)}`, expiresAt: new Date(payload.exp * 1000).toISOString() };
}

export function validBetaSession(token: string | null): boolean {
  const values = configured();
  if (!values || !token) return false;
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return false;
  const body = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!equal(signature, hmac(body, values.sessionSecret))) return false;
  try {
    const payload = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as SessionPayload;
    const now = Math.floor(Date.now() / 1000);
    return Number.isInteger(payload.iat) && Number.isInteger(payload.exp) && payload.iat <= now + 30 && payload.exp > now;
  } catch {
    return false;
  }
}

export function requireBetaSession(req: NextRequest): NextResponse | null {
  if (validBetaSession(req.headers.get(BETA_SESSION_HEADER))) return null;
  return NextResponse.json(
    { error: "Private beta locked. Unlock with the MCP unlock_service tool or POST /api/beta/unlock." },
    { status: 401, headers: { "cache-control": "no-store" } },
  );
}
