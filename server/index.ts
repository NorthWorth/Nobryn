import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import cors from "cors";
import "dotenv/config";
import { errorHandler } from "./errors.js";
import { authRouter } from "./routes/auth.js";
import { apiRouter } from "./routes/api.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const app = express();
app.disable("x-powered-by");
app.use(express.json({ limit: "1mb" }));

const corsOrigin = process.env.CORS_ORIGIN;
if (corsOrigin) {
  app.use(cors({ origin: corsOrigin.split(",").map((s) => s.trim()) }));
} else {
  app.use(cors());
}

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "nobryn-api" });
});

app.use("/api/auth", authRouter);
app.use("/api", apiRouter);

// Serve the built frontend in production.
const distDir = path.resolve(__dirname, "..", "dist");
app.use(express.static(distDir));
app.get(/^\/(?!api\/).*/, (_req, res) => {
  res.sendFile(path.join(distDir, "index.html"));
});

// 404 for unknown API routes.
app.use("/api", (_req, res) => {
  res.status(404).json({ error: "Not found." });
});

app.use(errorHandler);

// The API binds to its own port: API_PORT when running alongside the Vite dev
// server (which owns PORT in managed previews), otherwise PORT (production).
const port = Number(process.env.API_PORT || process.env.PORT || 4000);
app.listen(port, "0.0.0.0", () => {
  console.log(`[nobryn] API listening on http://0.0.0.0:${port}`);
});
