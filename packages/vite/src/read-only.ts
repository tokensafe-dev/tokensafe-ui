/**
 * OUMV spec §8.5 — read-only deployment (revision v1.11, wire stays 1.6.0).
 *
 * A read-only runtime does not register the mutating methods at all: they must
 * answer -32601 METHOD_NOT_FOUND, never a policy error (-32007) and never a
 * validation error (-32011). Every method that only reads stays available.
 */
export const READ_ONLY_ABSENT_METHODS = [
  'oumv/applyEdit',
  'oumv/previewEdit',
  'oumv/verify',
  'oumv/build',
  'oumv/mutate',
] as const;

const READ_ONLY_ABSENT_METHOD_SET: ReadonlySet<string> = new Set(READ_ONLY_ABSENT_METHODS);

export function isReadOnlyAbsentMethod(method: unknown): boolean {
  return typeof method === 'string' && READ_ONLY_ABSENT_METHOD_SET.has(method);
}
