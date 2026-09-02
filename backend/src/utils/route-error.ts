import { Response } from 'express';

export type RouteError = Error & { statusCode?: number; code?: string };

export function asRouteError(error: unknown): RouteError {
  if (error instanceof Error) {
    return error as RouteError;
  }
  return new Error('Unknown route error') as RouteError;
}

export interface SendRouteErrorOptions {
  /**
   * Server-side codes whose fixed, operator-safe message may be returned as-is
   * instead of the generic 5xx mask. Only codes with a constant message that
   * carries no request or infrastructure detail belong here.
   */
  passthroughCodes?: readonly string[];
}

export function sendRouteError(
  res: Response,
  error: RouteError,
  fallbackCode: string,
  options: SendRouteErrorOptions = {},
): void {
  const statusCode =
    Number.isInteger(error.statusCode) &&
    error.statusCode! >= 400 &&
    error.statusCode! < 600
      ? error.statusCode!
      : 500;
  const isServerError = statusCode >= 500;

  if (
    isServerError &&
    error.code &&
    options.passthroughCodes?.includes(error.code)
  ) {
    res.status(statusCode).json({ error: error.message, code: error.code });
    return;
  }

  res.status(statusCode).json({
    error: isServerError ? 'Internal server error' : error.message,
    code: isServerError ? fallbackCode : error.code ?? fallbackCode,
  });
}
