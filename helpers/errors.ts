import { ApiError } from '../api/dfx/definitions/error';

const MAX_DETAIL_LENGTH = 200;
const MAX_TYPE_LENGTH = 60;

// Derives the exception type, which is what Sentry groups on once a stack contributes.
//
// The invariant is that it ENDS in "Error": the stack parser skips the header line by looking
// for the literal "Error: ", and a type without that suffix leaves the header to be parsed as
// a phantom frame that absorbs the frame pop, putting the culprit back on this helper.
//
// Everything here is third-party input reached from inside a catch block, so nothing is
// allowed to throw: `name` can be a getter, and a getter is somebody else's code.
function deriveType(statusCode: unknown, cause: Error | undefined): string {
  if (typeof statusCode === 'number') return `Api${statusCode}Error`;

  let name: unknown;
  try {
    name = cause?.name;
  } catch {
    name = undefined;
  }
  // Flattened and capped for the same reasons as the detail: a newline would land in the
  // stack header, and the type is half the issue title.
  const base = typeof name === 'string' ? name.replace(/\s+/g, ' ').trim().slice(0, MAX_TYPE_LENGTH) : '';
  const type = base || 'ApiError';
  return type.endsWith('Error') ? type : `${type}Error`;
}

// Renders whatever is left of a rejection once the known shapes are exhausted. Objects are
// serialized rather than String()'d, which would only ever give "[object Object]"; anything
// unserializable (circular) is dropped rather than allowed to throw out of a catch block.
// Length is capped by the caller, so both this and a body-supplied `message` get bounded.
function describe(e: unknown): string | undefined {
  if (e == null) return undefined;
  if (typeof e !== 'object') return String(e);
  try {
    return JSON.stringify(e);
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
// Always wrap, including when the rejection already is an Error: the wrapper is built at the
// call site, which is what keeps issues separated per site. Returning the original
// unchanged instead would drop `context` and, for the commonest mobile failure of all
// (`TypeError: Network request failed`, thrown inside the fetch polyfill with no app
// frames), merge every site in the app into one unattributable issue.
function toError(context: string, e: unknown, framesToPop: number): Error {
  const cause = e instanceof Error ? e : undefined;
  const { statusCode, message } = (cause ? {} : (e ?? {})) as Partial<ApiError>;
  // Not every backend answers with {statusCode, message} - LNbits replies {"detail": ...} -
  // so an unrecognized body would otherwise reach the title as nothing at all.
  const raw = cause?.message ?? (typeof message === 'string' ? message : undefined) ?? (cause ? undefined : describe(e));
  // Flatten before capping. A server-supplied message can contain newlines, and the stack is
  // just a string: injected "    at ..." lines parse as real frames, which both pushes the
  // true frames down past the pop below and lets the remote end choose what the issue blames.
  // Capping alone would not help - the injection fits well inside the limit.
  const flat = raw?.replace(/\s+/g, ' ').trim();
  const detail = flat && flat.length > MAX_DETAIL_LENGTH ? `${flat.slice(0, MAX_DETAIL_LENGTH)}...` : flat;
  const error = new Error(detail ? `${context}: ${detail}` : context);
  // Api404Error rather than ApiError404, and a non-API cause keeps its own type: an NFC or
  // signing failure is not an ApiError. See deriveType for why the suffix matters.
  error.name = deriveType(statusCode, cause);
  // Deliberately NOT attached as `cause`: the RN SDK's linked-errors integration appends,
  // and Sentry titles an issue from the last exception, so chaining would put the original
  // back in the title and undo the attribution above. reportError() passes it as a trailing
  // console argument instead, so its message and own properties land in extra.arguments.
  //
  // The cost, accepted knowingly: when the original did carry app frames - an NFC or signing
  // failure - only the wrapper's stack is parsed, so the issue points at the catch block
  // rather than at the throw site, and the original's stack survives only as an
  // unsymbolicated string. Passing the original through instead would keep those frames, but
  // it cannot be told apart at runtime from a network TypeError, which carries none - and
  // letting those through merges every network failure in the app into one unattributable
  // issue. Per-site attribution for all of them beats exact frames for some of them.
  //
  // The Error is constructed in here, so without this the top frame - and therefore the
  // culprit shown on every issue - would be this helper rather than the caller. Defined the
  // way the SDK defines it on its own fetch errors: non-enumerable so it stays out of
  // serialization, but still writable and configurable, since defineProperty otherwise
  // defaults all three to false and a second write would throw.
  Object.defineProperty(error, 'framesToPop', { value: framesToPop, writable: true, configurable: true });
  return error;
}

// Reports a caught rejection: the issue gets a per-site exception, the log keeps a readable
// template, and the original stays inspectable.
//
// The context goes first because the console-to-logs integration only emits the
// sentry.message.template and sentry.message.parameter.N attributes when the first argument
// is a string; without them a log has no parameterized template to group or search on. The
// body itself is formatConsoleArgs(args) either way and still carries the serialized wrapper,
// so this buys the attributes, not a shorter body. captureConsole is unaffected: it takes the
// first *Error* among the arguments, which is still the wrapper.
export function reportError(context: string, e: unknown): void {
  // Two frames, not one: toError built the Error, and it was called from in here.
  console.error(context, toError(context, e, 2), e);
}
