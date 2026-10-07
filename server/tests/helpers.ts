/**
 * Test bootstrap helpers.
 *
 * Makes the real database reachable from this workspace even when the sandbox
 * CA environment value is malformed: the PEM header is repaired in-memory only
 * (the environment itself is never modified or printed) and TLS certificate
 * verification stays fully enabled. Then boots the real Express API in-process
 * so tests exercise the actual HTTP surface.
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";
import { X509Certificate } from "node:crypto";

export function bootstrapEnvironment(): void {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const root = path.resolve(here, "..", "..");
  const envPath = path.join(root, ".env");
  const parsed = fs.existsSync(envPath) ? dotenv.parse(fs.readFileSync(envPath)) : {};

  const usablePem = (value?: string) =>
    !!value && value.includes("BEGIN CERTIFICATE") && value.includes("END CERTIFICATE");

  const url = (process.env.DATABASE_URL || parsed.DATABASE_URL || "").trim();
  if (!url) throw new Error("DATABASE_URL is not available for the test run.");
  process.env.DATABASE_URL = url;

  let ca = usablePem(process.env.DATABASE_CA_CERT)
    ? (process.env.DATABASE_CA_CERT as string)
    : parsed.DATABASE_CA_CERT;
  if (!ca) throw new Error("Database CA certificate is not available for the test run.");
  ca = ca
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/^-+BEGIN CERTIFICATE-+$/m, "-----BEGIN CERTIFICATE-----")
    .replace(/^-+END CERTIFICATE-+$/m, "-----END CERTIFICATE-----")
    .trim();
  new X509Certificate(ca); // throws if invalid — TLS verification stays enabled
  process.env.DATABASE_CA_CERT = ca;
  process.env.API_PORT = process.env.API_PORT || "4599";
}

export async function startApi(): Promise<string> {
  await import("../index.js");
  const base = `http://127.0.0.1:${process.env.API_PORT}`;
  for (let i = 0; i < 100; i++) {
    try {
      // The public liveness endpoint: database-free and rate-limit exempt, so
      // readiness polling can never be throttled or blocked by the database.
      const r = await fetch(`${base}/health`);
      if (r.ok) return base;
    } catch {
      /* not up yet */
    }
    await new Promise((resolve) => setTimeout(resolve, 100));
  }
  throw new Error("API did not become healthy in time.");
}

let failures = 0;
let passes = 0;

export function check(name: string, condition: boolean, extra?: unknown): void {
  if (condition) {
    passes++;
    console.log(`PASS  ${name}`);
  } else {
    failures++;
    console.log(
      `FAIL  ${name}${extra !== undefined ? ` — ${JSON.stringify(extra)}` : ""}`
    );
  }
}

export function finish(suiteName: string): never {
  console.log(
    `\n${suiteName}: ${passes} passed, ${failures} failed`
  );
  process.exit(failures === 0 ? 0 : 1);
}

export interface ApiResponse {
  status: number;
  json: any;
}

export function makeClient(base: string) {
  return async function req(
    method: string,
    path: string,
    body?: unknown,
    token?: string
  ): Promise<ApiResponse> {
    const res = await fetch(base + path, {
      method,
      headers: {
        "Content-Type": "application/json",
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const json = await res.json().catch(() => ({}));
    return { status: res.status, json };
  };
}

export const TODAY = () => new Date().toISOString().slice(0, 10);
export const IN_DAYS = (days: number) =>
  new Date(Date.now() + days * 86400000).toISOString().slice(0, 10);
export const YESTERDAY = () =>
  new Date(Date.now() - 86400000).toISOString().slice(0, 10);
