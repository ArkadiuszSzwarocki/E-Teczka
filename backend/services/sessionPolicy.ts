export const SESSION_DURATION_MS = 20 * 60 * 1000;
export function activeSessionWhere(now = new Date()) {
  return { expiresAt: { gt: now }, createdAt: { gt: new Date(now.getTime() - SESSION_DURATION_MS) } };
}
export function effectiveSessionExpiry(createdAt: Date, expiresAt: Date) {
  return new Date(Math.min(expiresAt.getTime(), createdAt.getTime() + SESSION_DURATION_MS));
}
