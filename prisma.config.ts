import path from "node:path";
import { defineConfig } from "@prisma/config";
import "dotenv/config";

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
