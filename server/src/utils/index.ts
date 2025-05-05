export function generateId(): string {
  // Simple random ID for placeholder (not cryptographically secure)
  return Math.random().toString(36).substring(2, 10);
}
