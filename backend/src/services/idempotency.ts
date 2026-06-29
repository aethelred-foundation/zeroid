/**
 * ZeroID — idempotency primitives shared by every write-bearing endpoint.
 *
 * A client that sends the same `Idempotency-Key` header on a retry gets the
 * prior terminal response instead of repeating side effects (recording a second
 * AgentAction, re-running eligibility, re-deriving an escrow). Generic over the
 * response type `T` so the AI Agent Passport and the partner endpoints share
 * one store, one helper, and one header normalizer.
 *
 * Concurrency note: this is memoization, not a distributed lock. It deduplicates
 * *sequential* retries — the common case where a client times out and retries.
 * Two requests with the same key genuinely in flight at the same instant can
 * both miss `get` and both execute; the store then keeps the first response
 * written (`set` is first-write-wins). Deduplicating truly-concurrent duplicates
 * would require reserve-before-work (a PENDING row + 409 on conflict), which is
 * intentionally out of scope for v1.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import { ServiceError } from './errors';

/** Store seam: optional, so a caller without one simply runs the work. */
export interface IdempotencyStore<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
}

/**
 * Prisma-backed store. Keys are namespaced by operation `scope` so the same
 * client key used against two endpoints never collides; `set` is first-write-
 * wins (an upsert with an empty `update`) — a recorded response is never
 * overwritten.
 */
export function createPrismaIdempotencyStore<T>(
  prisma: Pick<PrismaClient, 'idempotencyRecord'>,
  scope: string,
): IdempotencyStore<T> {
  const scopedKey = (key: string) => `${scope}:${key}`;

  return {
    async get(key) {
      const row = await prisma.idempotencyRecord.findUnique({
        where: { key: scopedKey(key) },
      });
      return row ? (row.response as unknown as T) : null;
    },

    async set(key, value) {
      await prisma.idempotencyRecord.upsert({
        where: { key: scopedKey(key) },
        create: {
          key: scopedKey(key),
          scope,
          response: value as unknown as Prisma.InputJsonValue,
        },
        update: {}, // first write wins — never overwrite a recorded decision
      });
    },
  };
}

/**
 * Run `work` idempotently. With no store or no key it just runs the work (the
 * opt-in default). Otherwise: return a cached hit, else run, cache the terminal
 * result, and return it. Thrown errors propagate without being cached, so a
 * transient failure stays retryable.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore<T> | undefined,
  key: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!store || !key) return work();
  const cached = await store.get(key);
  if (cached != null) return cached;
  const result = await work();
  await store.set(key, result);
  return result;
}

/**
 * Normalize the optional `Idempotency-Key` header. Returns `undefined` when the
 * client did not send one (idempotency is opt-in), or throws a 400 when the
 * header is present but malformed.
 */
export function readIdempotencyKey(
  raw: string | string[] | undefined,
): string | undefined {
  if (raw === undefined) return undefined;
  const first = Array.isArray(raw) ? raw[0] : raw;
  if (first === undefined) return undefined;
  const value = first.trim();
  if (value.length === 0 || value.length > 255) {
    throw new ServiceError(
      'Idempotency-Key must be 1–255 characters',
      'INVALID_IDEMPOTENCY_KEY',
      400,
    );
  }
  return value;
}
