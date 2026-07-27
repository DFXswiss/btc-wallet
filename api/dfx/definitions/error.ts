export interface ApiError {
  statusCode: number;
  message: string;
}

// api.hook.ts rejects with the parsed error body, which is an ApiError and not an Error, and
// Sentry files an issue from the first Error among the console arguments. Reporting a raw
// body would collapse every failure into one stackless issue titled "... [object Object]".
//
// Always wrap, including when the rejection already is an Error: the wrapper's stack points
// at the call site, which is what keeps issues separated per site. Returning the original
// unchanged instead would drop `context` and, for the commonest mobile failure of all
// (`TypeError: Network request failed`, thrown with no app frames), merge every site in the
// app into one unattributable issue. The original stays reachable as a linked exception.
export function toError(context: string, e: unknown): Error {
  const cause = e instanceof Error ? e : undefined;
  const { statusCode, message } = (cause ? {} : (e ?? {})) as Partial<ApiError>;
  // String() only reads well for primitives: an object gives "[object Object]", and a
  // missing rejection gives the literal "undefined".
  const detail = cause?.message ?? message ?? (e == null || typeof e === 'object' ? undefined : String(e));
  const error = new Error(detail ? `${context}: ${detail}` : context);
  // Once a stack contributes, Sentry groups on the exception type and ignores the message,
  // so the status has to go in the type for a 400 and a 500 from one site to stay apart.
  error.name = statusCode ? `ApiError${statusCode}` : 'ApiError';
  if (cause) (error as Error & { cause?: unknown }).cause = cause;
  return error;
}
