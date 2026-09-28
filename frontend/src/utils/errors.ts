export function errorMessage(error: unknown, fallback = 'Wystąpił nieznany błąd.'): string {
  return error instanceof Error && error.message ? error.message : fallback;
}
