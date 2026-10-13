/**
 * Error taxonomy.
 *
 * Every failure the API reports on purpose is an `ApiError` carrying a stable
 * machine-readable `code`. Anything else that reaches the error middleware is
 * treated as a bug: logged with its stack, reported as a bare 500.
 */

import type { FieldIssue } from "@micacms/core";

export type ErrorCode =
  | "bad_request"
  | "validation_failed"
  | "unauthenticated"
  | "forbidden"
  | "not_found"
  | "conflict"
  | "payload_too_large"
  | "unsupported_media_type"
  | "rate_limited"
  | "internal_error"
  /** An identity provider Mica depends on could not be reached. */
  | "service_unavailable";

const STATUS: Record<ErrorCode, number> = {
  bad_request: 400,
  validation_failed: 422,
  unauthenticated: 401,
  forbidden: 403,
  not_found: 404,
  conflict: 409,
  payload_too_large: 413,
  unsupported_media_type: 415,
  rate_limited: 429,
  internal_error: 500,
  service_unavailable: 503,
};

export interface ApiErrorBody {
  error: {
    code: ErrorCode;
    message: string;
    issues?: FieldIssue[];
  };
}

export class ApiError extends Error {
  override name = "ApiError";
  readonly code: ErrorCode;
  readonly status: number;
  readonly issues?: FieldIssue[];
  /** Extra response headers, e.g. `Retry-After` on a rate limit. */
  readonly headers?: Record<string, string>;

  constructor(
    code: ErrorCode,
    message: string,
    options: { issues?: FieldIssue[]; headers?: Record<string, string>; cause?: unknown } = {},
  ) {
    super(message, { cause: options.cause });
    this.code = code;
    this.status = STATUS[code];
    this.issues = options.issues;
    this.headers = options.headers;
  }

  toBody(): ApiErrorBody {
    return {
      error: {
        code: this.code,
        message: this.message,
        ...(this.issues ? { issues: this.issues } : {}),
      },
    };
  }
}

export const badRequest = (message: string) => new ApiError("bad_request", message);
export const unauthenticated = (message = "Authentication required.") =>
  new ApiError("unauthenticated", message);
export const forbidden = (message = "You do not have access to this resource.") =>
  new ApiError("forbidden", message);
export const notFound = (message = "Not found.") => new ApiError("not_found", message);
export const conflict = (message: string) => new ApiError("conflict", message);
