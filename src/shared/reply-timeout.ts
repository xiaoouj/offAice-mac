export const DEFAULT_REPLY_IDLE_SECONDS = 300;
/** Applies to missing reply content, never to total generation time. */
export function replyIdleSeconds(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(1800, Math.max(30, Math.floor(value)))
    : DEFAULT_REPLY_IDLE_SECONDS;
}
