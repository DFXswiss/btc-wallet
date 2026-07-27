export interface ApiError {
  statusCode: number;
  message: string;
}

// api.hook.ts rejects with the parsed error body, which is an ApiError and not an Error.
// Sentry files an issue from the first Error among the console arguments, so reporting a
// raw body would collapse every failure into a single stackless issue titled
// "... [object Object]". Normalize before logging: a real Error keeps its own message and
// stack, a body becomes one titled by status so failures still group per cause.
export function toError(context: string, e: unknown): Error {
  if (e instanceof Error) return e;
  const { statusCode, message } = (e ?? {}) as Partial<ApiError>;
  return new Error(`${context} (${statusCode ?? 'network'}): ${message ?? String(e)}`);
}
