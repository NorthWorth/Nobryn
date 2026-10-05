import "dotenv/config";
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { X509Certificate } from "node:crypto";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

/**
 * Normalize a PEM certificate supplied through the environment.
 *
 * Some hosting environments store certificates as a single line with escaped
 * newline sequences (`\n`). Convert those back into real newlines so Node's
 * TLS layer receives valid PEM. The environment variable itself is never
 * modified — this only affects the value passed to the TLS configuration.
 */
function normalizePem(raw: string): string {
  return raw
    .replace(/\\r\\n/g, "\n")
    .replace(/\\n/g, "\n")
    .replace(/\r/g, "")
    .trim();
}

/**
 * Load the database CA certificate (Aiven CA) from the environment.
 *
 * Fails loudly if it is missing or malformed: TLS certificate verification
 * must never be silently bypassed as a fallback.
 */
function loadCaCertificate(): string {
  const raw = process.env.DATABASE_CA_CERT;
  if (!raw || !raw.trim()) {
    throw new Error(
      "DATABASE_CA_CERT is not set. Nobryn requires the database CA certificate " +
        "to verify the PostgreSQL server certificate. TLS verification cannot be bypassed."
    );
  }
  const pem = normalizePem(raw);
  const BEGIN = "-----BEGIN CERTIFICATE-----";
  const END = "-----END CERTIFICATE-----";
  if (!pem.includes(BEGIN) || !pem.includes(END)) {
    throw new Error(
      `DATABASE_CA_CERT is not a complete PEM certificate (value length ` +
        `${raw.trim().length} characters, ` +
        `${!pem.includes(BEGIN) ? "missing BEGIN marker" : "missing END marker — the value looks truncated"}). ` +
        "Paste the complete certificate (BEGIN through END) via Settings → Environment. " +
        "Multi-line PEMs may be stored as a single line with literal \\n escapes."
    );
  }
  try {
    new X509Certificate(pem);
  } catch {
    throw new Error(
      "DATABASE_CA_CERT could not be parsed as an X.509 certificate. " +
        "Re-save the complete, unmodified PEM via Settings → Environment."
    );
  }
  return pem;
}

/**
 * Remove SSL-related query parameters from the connection string before
 * handing it to pg.
 *
 * pg builds its effective config with
 * `Object.assign({}, config, parse(connectionString))`, so `sslmode` (and
 * `ssl`/`sslrootcert`/...) parsed from the URL would *override* the explicit
 * `ssl: { ca, rejectUnauthorized: true }` pool configuration. Stripping those
 * parameters from the string passed to pg — DATABASE_URL itself is untouched —
 * lets the explicit CA configuration take effect: the connection stays
 * encrypted, the server certificate is verified against DATABASE_CA_CERT, and
 * hostname verification stays enabled (Node's default checkServerIdentity).
 */
function stripSslParams(connectionString: string): string {
  try {
    const url = new URL(connectionString);
    for (const key of [
      "sslmode",
      "ssl",
      "sslnegotiation",
      "sslcert",
      "sslkey",
      "sslrootcert",
    ]) {
      url.searchParams.delete(key);
    }
    return url.toString();
  } catch {
    // Let pg parse/report malformed URLs itself.
    return connectionString;
  }
}

/**
 * Single database connection path for the whole application:
 * API and seed both import `prisma` from this module, so they share the same
 * PrismaPg adapter configuration and the same TLS settings.
 */
function createClient(): PrismaClient {
  const connectionString = stripSslParams(process.env.DATABASE_URL ?? "");
  const ca = loadCaCertificate();
  const adapter = new PrismaPg({
    connectionString,
    ssl: {
      ca,
      rejectUnauthorized: true,
    },
  });
  return new PrismaClient({ adapter });
}

export const prisma = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
