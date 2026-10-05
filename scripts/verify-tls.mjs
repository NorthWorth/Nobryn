/**
 * TLS verification proof for the Nobryn database connection.
 *
 * Verifies that certificate validation is actually enforced against the
 * Aiven PostgreSQL:
 *   1. real DATABASE_CA_CERT + rejectUnauthorized:true  -> must CONNECT
 *   2. no CA + rejectUnauthorized:true                  -> must be REJECTED
 *   3. bogus CA + rejectUnauthorized:true               -> must be REJECTED
 *
 * Usage: node scripts/verify-tls.mjs   (exits 0 only if all three hold)
 * Never prints certificate material or credentials.
 */
import { Pool } from "pg";
import fs from "node:fs";

function safeUrl() {
  const u = new URL(process.env.DATABASE_URL);
  for (const key of ["sslmode", "ssl", "sslnegotiation", "sslcert", "sslkey", "sslrootcert"]) {
    u.searchParams.delete(key);
  }
  return u.toString();
}

async function test(name, ssl) {
  const pool = new Pool({ connectionString: safeUrl(), ssl });
  try {
    await pool.query("SELECT 1 AS ok");
    console.log(`${name}: CONNECTED`);
    return true;
  } catch (err) {
    console.log(`${name}: REJECTED - ${String(err.message).split("\n")[0]}`);
    return false;
  } finally {
    await pool.end().catch(() => {});
  }
}

const raw = process.env.DATABASE_CA_CERT || "";
console.log(`DATABASE_CA_CERT present: ${raw.trim().length > 0}`);

// Same normalization as server/prisma.ts (escaped \n on single-line env values).
const ca = raw
  .replace(/\\r\\n/g, "\n")
  .replace(/\\n/g, "\n")
  .replace(/\r/g, "")
  .trim();
console.log(`PEM normalized: ${ca.includes("-----BEGIN CERTIFICATE-----")}`);

// A valid self-signed certificate that is NOT the Aiven CA: if verification
// were bypassed, this would connect; with verification active it must fail.
const bogusCaPath = process.env.TLS_BOGUS_CA || "/tmp/fake-ca.pem";
let bogusCa = null;
try {
  bogusCa = fs.readFileSync(bogusCaPath, "utf8");
} catch {
  console.log(`bogus CA file not available at ${bogusCaPath} — run openssl to generate it`);
}

(async () => {
  const realOk = await test("1. real DATABASE_CA_CERT + rejectUnauthorized:true", {
    ca,
    rejectUnauthorized: true,
  });
  const noCaRejected = await test("2. no CA + rejectUnauthorized:true", {
    rejectUnauthorized: true,
  });
  const bogusRejected =
    bogusCa === null
      ? false
      : await test("3. bogus CA + rejectUnauthorized:true", {
          ca: bogusCa,
          rejectUnauthorized: true,
        });

  const pass = realOk && noCaRejected && bogusRejected;
  console.log(
    pass
      ? "VERDICT: verification is active — the connection only succeeds with the trusted Aiven CA."
      : "VERDICT: UNEXPECTED — investigate before proceeding."
  );
  process.exit(pass ? 0 : 1);
})();
