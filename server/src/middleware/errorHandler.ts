import { Request, Response, NextFunction } from "express";
import { logger } from "../utils/logger";

// Custom error class for API errors
export class APIError extends Error {
  constructor(
    public statusCode: number,
    message: string,
    public details?: unknown
  ) {
    super(message);
    this.name = "APIError";
  }
}

// Error handler middleware
export const errorHandler = (
  err: Error,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next: NextFunction
) => {
  // Log the error
  logger.error("Error occurred:", {
    error: {
      name: err.name,
      message: err.message,
      stack: err.stack,
      ...(err instanceof APIError && { details: err.details }),
    },
    request: {
      method: req.method,
      url: req.url,
      body: req.body,
      params: req.params,
      query: req.query,
    },
  });

  // If it's our custom API error, use its status code and details
  if (err instanceof APIError) {
    return res.status(err.statusCode).json({
      error: {
        message: err.message,
        details: err.details,
      },
    });
  }

  // Handle specific error types
  if (err.name === "ValidationError") {
    return res.status(400).json({
      error: {
        message: "Validation Error",
        details: err.message,
      },
    });
  }

  // Default error response
  return res.status(500).json({
    error: {
      message:
        process.env.NODE_ENV === "production"
          ? "Internal Server Error"
          : err.message,
    },
  });
};

// Async handler wrapper to catch promise rejections
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<unknown>
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch(next);
  };
};
