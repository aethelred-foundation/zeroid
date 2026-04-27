import { Response } from 'express';

export type RouteError = Error & { statusCode?: number; code?: string };

export function asRouteError(error: unknown): RouteError {
  if (error instanceof Error) {
    return error as RouteError;
  }
  return new Error('Unknown route error') as RouteError;
}

export function sendRouteError(
  res: Response,
  error: RouteError,
  fallbackCode: string,
): void {
  const statusCode =
    Number.isInteger(error.statusCode) &&
    error.statusCode! >= 400 &&
    error.statusCode! < 600
      ? error.statusCode!
      : 500;
  const isServerError = statusCode >= 500;

  res.status(statusCode).json({
    error: isServerError ? 'Internal server error' : error.message,
    code: isServerError ? fallbackCode : error.code ?? fallbackCode,
  });
}
