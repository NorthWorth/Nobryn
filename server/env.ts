import path from "node:path";
import { fileURLToPath } from "node:url";
import dotenv from "dotenv";

/**
 * Load environment configuration before any module reads process.env.
 *
 * The canonical location is the repository-root `.env` / `.env.local`
 * (managed by the hosting platform and used by local development); an
 * optional `server/.env` may be used for server-local overrides.
 * dotenv never overrides values that are already present in the
 * environment, so platform-injected secrets always win.
 */
const here = path.dirname(fileURLToPath(import.meta.url));
dotenv.config({
  path: [path.resolve(here, "..", ".env"), path.resolve(here, ".env")],
});
