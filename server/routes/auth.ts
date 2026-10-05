import { Router } from "express";
import bcrypt from "bcryptjs";
import { prisma } from "../prisma.js";
import { ApiError, asyncHandler, parseWith } from "../errors.js";
import { requireAuth, signToken, type AuthedRequest } from "../auth.js";
import { loginSchema, registerSchema } from "../domain.js";

export const authRouter = Router();

authRouter.post(
  "/register",
  asyncHandler(async (req, res) => {
    const input = parseWith(registerSchema, req.body);
    const existing = await prisma.user.findUnique({ where: { email: input.email } });
    if (existing) {
      throw new ApiError(400, "An account with this email already exists.", {
        email: "An account with this email already exists.",
      });
    }
    const passwordHash = await bcrypt.hash(input.password, 10);
    const user = await prisma.user.create({
      data: {
        firstName: input.firstName,
        lastName: input.lastName,
        email: input.email,
        passwordHash,
      },
    });
    await prisma.workspace.create({
      data: {
        name: input.workspaceName,
        ownerId: user.id,
      },
    });
    const token = signToken({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    res.status(201).json({ token });
  })
);

authRouter.post(
  "/login",
  asyncHandler(async (req, res) => {
    const input = parseWith(loginSchema, req.body);
    const user = await prisma.user.findUnique({ where: { email: input.email } });
    if (!user) {
      throw new ApiError(401, "Incorrect email or password.");
    }
    const valid = await bcrypt.compare(input.password, user.passwordHash);
    if (!valid) {
      throw new ApiError(401, "Incorrect email or password.");
    }
    const token = signToken({
      id: user.id,
      email: user.email,
      firstName: user.firstName,
      lastName: user.lastName,
    });
    res.json({ token });
  })
);

authRouter.post(
  "/logout",
  asyncHandler(async (_req, res) => {
    // Token-based auth: the client discards the token on logout.
    res.json({ ok: true });
  })
);

authRouter.get(
  "/me",
  requireAuth,
  asyncHandler(async (req, res) => {
    const authReq = req as AuthedRequest;
    const user = await prisma.user.findUnique({ where: { id: authReq.user!.id } });
    if (!user) {
      throw new ApiError(401, "Your session has expired. Please sign in again.");
    }
    const workspace = await prisma.workspace.findFirst({
      where: { ownerId: user.id },
      orderBy: { createdAt: "asc" },
    });
    res.json({
      user: {
        id: user.id,
        firstName: user.firstName,
        lastName: user.lastName,
        email: user.email,
      },
      workspace: workspace ? { id: workspace.id, name: workspace.name } : null,
    });
  })
);
