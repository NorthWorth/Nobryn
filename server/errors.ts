import type { NextFunction, Request, Response } from "express";
import { z } from "zod";

/**
 * Human-readable error shape returned to the client.
 */
export class ApiError extends Error {
  status: number;
  details?: Record<string, string>;

  constructor(status: number, message: string, details?: Record<string, string>) {
    super(message);
    this.status = status;
    this.details = details;
  }
}

export function asyncHandler(
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) {
  return (req: Request, res: Response, next: NextFunction) => {
    fn(req, res, next).catch(next);
  };
}

export function parseWith<T extends z.ZodType>(schema: T, data: unknown): z.infer<T> {
  const result = schema.safeParse(data);
  if (!result.success) {
    const details: Record<string, string> = {};
    for (const issue of result.error.issues) {
      const key = issue.path.join(".") || "form";
      if (!details[key]) details[key] = issue.message;
    }
    throw new ApiError(400, "Please correct the highlighted fields.", details);
  }
  return result.data;
}

/**
 * Maps unexpected errors to safe responses. Never leaks stack traces.
 */
export function errorHandler(err: unknown, _req: Request, res: Response, _next: NextFunction) {
  if (err instanceof ApiError) {
    res.status(err.status).json({ error: err.message, details: err.details });
    return;
  }
  console.error("[nobryn] unhandled error:", err);
  res.status(500).json({ error: "Something went wrong. Please try again." });
}
