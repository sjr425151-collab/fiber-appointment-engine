/**
 * Structured JSON logs (one line per event) so Render's log search and any log
 * drain can filter by level, request id and route. Never log request bodies,
 * query strings (results tokens live there), cookies or contact details.
 */
type Level = 'info' | 'warn' | 'error';

export function log(level: Level, event: string, fields: Record<string, unknown> = {}) {
  const line = JSON.stringify({ level, time: new Date().toISOString(), event, ...fields });
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
}

/** Error details safe to log: name, message and stack only. */
export function errorFields(err: unknown): Record<string, unknown> {
  if (err instanceof Error) return { error: err.name, message: err.message, stack: err.stack?.split('\n').slice(0, 8).join('\n') };
  return { error: 'NonError', message: String(err).slice(0, 300) };
}
