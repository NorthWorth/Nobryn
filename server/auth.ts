import type { NextFunction, Request, Response } from "express";
import jwt from "jsonwebtoken";
import { prisma } from "./prisma.js";
import { ApiError } from "./errors.js";

/**
 * JWT signing secret. A real secret is required outside local development:
 * the built-in development fallback must never be active in production,
 * because anyone who can read the source could forge session tokens.
 */
const DEV_FALLBACK_JWT_SECRET = "nobryn-dev-secret-change-me";

if (!process.env.JWT_SECRET && process.env.NODE_ENV === "production") {
  throw new Error(
    "JWT_SECRET is not set. Configure a strong JWT_SECRET before running Nobryn in production " +
      '(generate one with: openssl rand -hex 32).'
  );
}
if (!process.env.JWT_SECRET) {
  console.warn(
    "[nobryn] JWT_SECRET is not set — using the built-in development-only signing secret. " +
      "Set JWT_SECRET before deploying."
  );
}
const JWT_SECRET = process.env.JWT_SECRET || DEV_FALLBACK_JWT_SECRET;

export interface AuthUser {
  id: string;
  email: string;
  firstName: string;
  lastName: string;
}

export interface AuthedRequest extends Request {
  user?: AuthUser;
  workspaceId?: string;
}

export function signToken(user: AuthUser): string {
  return jwt.sign({ sub: user.id, email: user.email }, JWT_SECRET, { expiresIn: "30d" });
}

export function requireAuth(req: Request, res: Response, next: NextFunction) {
  void res;
  const header = req.headers.authorization;
  if (!header?.startsWith("Bearer ")) {
    res.status(401).json({ error: "You must be signed in to do that." });
    return;
  }
  try {
    const payload = jwt.verify(header.slice(7), JWT_SECRET) as { sub?: string };
    if (!payload.sub) throw new Error("missing sub");
    const authReq = req as AuthedRequest;
    authReq.user = { id: payload.sub, email: "", firstName: "", lastName: "" };
    next();
  } catch {
    res.status(401).json({ error: "Your session has expired. Please sign in again." });
  }
}

/**
 * Resolves the user's primary workspace. Every workspace-scoped query in the
 * app goes through this, so one workspace can never read another's data.
 */
export async function requireWorkspace(req: Request, res: Response, next: NextFunction) {
  void res;
  try {
    const authReq = req as AuthedRequest;
    if (!authReq.user) {
      res.status(401).json({ error: "You must be signed in to do that." });
      return;
    }
    const user = await prisma.user.findUnique({ where: { id: authReq.user.id } });
    if (!user) {
      res.status(401).json({ error: "Your session has expired. Please sign in again." });
      return;
    }
    authReq.user = {
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    };
    const workspace = await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
    });
    if (!workspace) {
      res.status(403).json({ error: "No workspace found for this account." });
      return;
    }
    authReq.workspaceId = workspace.id;
    next();
  } catch (err) {
    next(err);
  }
}
