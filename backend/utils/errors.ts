/** Safe display text for unknown runtime errors. */
export function errorMessage(error: unknown, fallback = 'Nieznany błąd.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}

/** Prisma errors expose their stable code as a string, but are not always Error instances. */
export function hasErrorCode(error: unknown, code: string): boolean {
  return typeof error === 'object'
    && error !== null
    && 'code' in error
    && (error as { code?: unknown }).code === code;
}

export function errorStatusCode(error: unknown): number | null {
  if (!error || typeof error !== 'object' || !('statusCode' in error)) return null;
  const statusCode = (error as { statusCode?: unknown }).statusCode;
  return typeof statusCode === 'number' && Number.isInteger(statusCode) ? statusCode : null;
}
