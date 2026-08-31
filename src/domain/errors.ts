export type ErrorCode =
  | "INVALID_REQUEST"
  | "INVALID_PROFILE_URL"
  | "UNAUTHORIZED"
  | "RATE_LIMITED"
  | "PROFILE_NOT_FOUND"
  | "LINKEDIN_AUTH_REQUIRED"
  | "LINKEDIN_SESSION_EXPIRED"
  | "LINKEDIN_BLOCKED"
  | "SCRAPE_TIMEOUT"
  | "SCRAPE_CAPACITY_EXCEEDED"
  | "UPSTREAM_ERROR"
  | "INTERNAL_ERROR";

export class AppError extends Error {
  public constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly statusCode: number,
    public readonly retryable = false,
    options?: ErrorOptions
  ) {
    super(message, options);
    this.name = "AppError";
  }
}

export function isAppError(error: unknown): error is AppError {
  return error instanceof AppError;
}
