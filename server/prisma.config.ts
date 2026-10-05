import path from "node:path";
import { defineConfig } from "@prisma/config";
import dotenv from "dotenv";

// Canonical env file lives at the repository root; optional server-local
// override. Platform-injected environment values always take precedence.
dotenv.config({
  path: [path.resolve(__dirname, "..", ".env"), path.resolve(__dirname, ".env")],
});

export default defineConfig({
  earlyAccess: true,
  schema: path.resolve(__dirname, "prisma", "schema.prisma"),
  migrations: {
    path: path.resolve(__dirname, "prisma", "migrations"),
  },
  datasource: {
    url: process.env.DATABASE_URL ?? "",
  },
});
