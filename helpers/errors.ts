import { ApiError } from '../api/dfx/definitions/error';

const MAX_BODY_LENGTH = 200;

// Renders whatever is left of a rejection once the known shapes are exhausted. Objects are
// serialized rather than String()'d, which would only ever give "[object Object]"; anything
// unserializable (circular) is dropped rather than allowed to throw out of a catch block.
function describe(e: unknown): string | undefined {
  if (e == null) return undefined;
  if (typeof e !== 'object') return String(e);
  try {
    return JSON.stringify(e)?.slice(0, MAX_BODY_LENGTH);
  } catch {
    return undefined;
  }
}

// Normalizes anything a catch block can receive into an Error worth reporting.
//
// The HTTP layers reject with the parsed error body rather than an Error (see
// api/dfx/hooks/api.hook.ts and api/boltcards/hooks/api.hook.ts), and Sentry files an issue
// from the first Error among the console arguments. A raw body still gets grouped per call
// site - attachStacktrace is on, so the message path carries a synthetic stack - but its
// value reads "... [object Object]" whatever went wrong, and a 400 and a 500 from one site
// are indistinguishable.
//
// Always wrap, including when the rejection already is an Error: the wrapper's stack points
// at the call site, which is what keeps issues separated per site. Returning the original
// unchanged instead would drop `context` and, for the commonest mobile failure of all
// (`TypeError: Network request failed`, thrown inside the fetch polyfill with no app
// frames), merge every site in the app into one unattributable issue.
export function toError(context: string, e: unknown): Error {
  const cause = e instanceof Error ? e : undefined;
  const { statusCode, message } = (cause ? {} : (e ?? {})) as Partial<ApiError>;
  // Not every backend answers with {statusCode, message} - LNbits replies {"detail": ...} -
  // so an unrecognized body would otherwise reach the title as nothing at all.
  const detail = cause?.message ?? (typeof message === 'string' ? message : undefined) ?? (cause ? undefined : describe(e));
  const error = new Error(detail ? `${context}: ${detail}` : context);
  // Once a stack contributes, Sentry groups on the exception type and ignores the message,
  // so the status has to go in the type for a 400 and a 500 from one site to stay apart.
  // Keep a non-API cause's own type: an NFC or signing failure is not an ApiError.
  error.name = statusCode ? `ApiError${statusCode}` : (cause?.name ?? 'ApiError');
  // Deliberately NOT attached as `cause`: the RN SDK's linked-errors integration appends,
  // and Sentry titles an issue from the last exception, so chaining would put the original
  // back in the title and undo the attribution above. Callers pass it as a second console
  // argument instead, which keeps its stack and own properties in extra.arguments.
  return error;
}
