/**
 * ZeroID — Prisma-backed idempotency store.
 *
 * Implements the `IdempotencyStore` seam consumed by `agentEligibilityProof`.
 * Keys are namespaced by `scope` so the same client key used against two
 * different endpoints never collides. `set` is first-write-wins (an upsert with
 * an empty `update`): once a terminal response is recorded it is never
 * overwritten.
 *
 * Concurrency note: this is memoization, not a distributed lock. It guarantees
 * that *sequential* retries — the common case where a client times out and
 * retries — return the original result without re-recording an AgentAction or
 * re-running eligibility. Two requests with the same key that are genuinely
 * in flight at the same instant can both miss `get` and both execute; the store
 * then keeps the first response written. Deduplicating truly-concurrent
 * duplicates would require reserve-before-work (a PENDING row + 409 on
 * conflict), which is intentionally out of scope for v1.
 */
import type { Prisma, PrismaClient } from '@prisma/client';
import type {
  IdempotencyStore,
  AgentEligibilityProofResponse,
} from './agent-eligibility';

export function createPrismaIdempotencyStore(
  prisma: Pick<PrismaClient, 'idempotencyRecord'>,
  scope: string,
): IdempotencyStore {
  const scopedKey = (key: string) => `${scope}:${key}`;

  return {
    async get(key) {
      const row = await prisma.idempotencyRecord.findUnique({
        where: { key: scopedKey(key) },
      });
      return row
        ? (row.response as unknown as AgentEligibilityProofResponse)
        : null;
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
