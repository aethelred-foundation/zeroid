/**
 * ZeroID — idempotency primitives shared by every write-bearing endpoint.
 *
 * A client that sends the same `Idempotency-Key` header on a retry gets the
 * prior terminal response instead of repeating side effects (recording a second
 * AgentAction, re-running eligibility, re-deriving an escrow). Generic over the
 * response type `T` so the AI Agent Passport and the partner endpoints share
 * one store, one helper, and one header normalizer.
 *
 * The Prisma store reserves the scoped key before work starts. The database
 * primary key is the serialization point: one caller creates a PENDING record,
 * while an identical concurrent caller receives a deterministic 409. Completion
 * and failure cleanup are compare-and-swap operations bound to the reservation
 * owner, so a stale caller can neither overwrite nor delete another caller's
 * claim. Stores that only implement the original get/set seam retain the legacy
 * sequential-memoization behavior for backwards compatibility.
 */
import { randomUUID } from 'node:crypto';
import type { Prisma, PrismaClient } from '@prisma/client';
import { ServiceError } from './errors';

/** Opaque ownership token returned by a successful reserve-before-work claim. */
export interface IdempotencyReservation {
  owner: string;
  claimedAt: string;
  expiresAt: string;
}

export type IdempotencyClaim<T> =
  | { state: 'acquired'; reservation: IdempotencyReservation }
  | { state: 'completed'; value: T }
  | { state: 'in-progress' };

/**
 * Store seam: get/set are the original contract. Reservation methods are
 * optional so existing in-memory/custom stores remain source-compatible.
 */
export interface IdempotencyStore<T> {
  get(key: string): Promise<T | null>;
  set(key: string, value: T): Promise<void>;
  claim?(key: string): Promise<IdempotencyClaim<T>>;
  complete?(
    key: string,
    reservation: IdempotencyReservation,
    value: T,
  ): Promise<void>;
  release?(
    key: string,
    reservation: IdempotencyReservation,
  ): Promise<void>;
}

interface ReservationStore<T> extends IdempotencyStore<T> {
  claim(key: string): Promise<IdempotencyClaim<T>>;
  complete(
    key: string,
    reservation: IdempotencyReservation,
    value: T,
  ): Promise<void>;
  release(key: string, reservation: IdempotencyReservation): Promise<void>;
}

const PENDING_MARKER = 'zeroid.idempotency.pending.v1' as const;
/** Long enough for request work, but bounded so a crashed process cannot wedge a key forever. */
export const IDEMPOTENCY_LEASE_MS = 5 * 60 * 1000;

interface PendingResponse {
  __zeroidIdempotency: typeof PENDING_MARKER;
  owner: string;
  claimedAt: string;
  expiresAt: string;
}

function pendingResponse(
  reservation: IdempotencyReservation,
): PendingResponse {
  return {
    __zeroidIdempotency: PENDING_MARKER,
    owner: reservation.owner,
    claimedAt: reservation.claimedAt,
    expiresAt: reservation.expiresAt,
  };
}

function isPendingResponse(value: unknown): value is PendingResponse {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return false;
  }
  const candidate = value as Record<string, unknown>;
  return (
    Object.keys(candidate).length === 4 &&
    candidate.__zeroidIdempotency === PENDING_MARKER &&
    typeof candidate.owner === 'string' &&
    typeof candidate.claimedAt === 'string' &&
    typeof candidate.expiresAt === 'string'
  );
}

function leaseExpired(pending: PendingResponse): boolean {
  const expiresAt = Date.parse(pending.expiresAt);
  return !Number.isFinite(expiresAt) || expiresAt <= Date.now();
}

function isUniqueConstraintError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    'code' in error &&
    error.code === 'P2002'
  );
}

function supportsReservations<T>(
  store: IdempotencyStore<T>,
): store is ReservationStore<T> {
  return (
    typeof store.claim === 'function' &&
    typeof store.complete === 'function' &&
    typeof store.release === 'function'
  );
}

/**
 * Prisma-backed store. Keys are namespaced by operation `scope` so the same
 * client key used against two endpoints never collides. A versioned PENDING
 * envelope is stored in the existing non-null JSON column during execution;
 * historical rows contain an unwrapped terminal response and remain readable.
 *
 * `updateMany`/`deleteMany` include the exact owner envelope as a JSON equality
 * predicate. PostgreSQL executes each as one statement, giving completion and
 * cleanup compare-and-swap semantics without a schema migration.
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
      if (!row || isPendingResponse(row.response)) return null;
      return row.response as unknown as T;
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

    async claim(key) {
      const claimedAt = new Date();
      const reservation: IdempotencyReservation = {
        owner: randomUUID(),
        claimedAt: claimedAt.toISOString(),
        expiresAt: new Date(
          claimedAt.getTime() + IDEMPOTENCY_LEASE_MS,
        ).toISOString(),
      };
      const pending = pendingResponse(reservation);

      // A row can disappear between a conflicting insert and our read when its
      // owner fails and releases it, so allow one bounded retry of the insert.
      for (let attempt = 0; attempt < 2; attempt += 1) {
        try {
          await prisma.idempotencyRecord.create({
            data: {
              key: scopedKey(key),
              scope,
              response: pending as unknown as Prisma.InputJsonValue,
            },
          });
          return { state: 'acquired', reservation };
        } catch (error) {
          if (!isUniqueConstraintError(error)) throw error;
        }

        // The conflicting insert has committed before PostgreSQL reports
        // P2002, so this observes its PENDING claim or terminal result.
        const existing = await prisma.idempotencyRecord.findUnique({
          where: { key: scopedKey(key) },
        });
        if (!existing) continue;
        if (!isPendingResponse(existing.response)) {
          return {
            state: 'completed',
            value: existing.response as unknown as T,
          };
        }
        if (!leaseExpired(existing.response)) return { state: 'in-progress' };

        // Crash recovery: only one contender can replace the exact expired
        // owner envelope. A live/fresh owner is never eligible for takeover.
        const takenOver = await prisma.idempotencyRecord.updateMany({
          where: {
            key: scopedKey(key),
            response: {
              equals: existing.response as unknown as Prisma.InputJsonValue,
            },
          },
          data: {
            response: pending as unknown as Prisma.InputJsonValue,
          },
        });
        if (takenOver.count === 1) {
          return { state: 'acquired', reservation };
        }

        // Another contender won the takeover (or completed) first. Re-read so
        // a terminal winner is returned immediately; otherwise report 409.
        const winner = await prisma.idempotencyRecord.findUnique({
          where: { key: scopedKey(key) },
        });
        if (winner && !isPendingResponse(winner.response)) {
          return {
            state: 'completed',
            value: winner.response as unknown as T,
          };
        }
        if (winner) return { state: 'in-progress' };
      }

      return { state: 'in-progress' };
    },

    async complete(key, reservation, value) {
      const pending = pendingResponse(reservation);
      const updated = await prisma.idempotencyRecord.updateMany({
        where: {
          key: scopedKey(key),
          response: {
            equals: pending as unknown as Prisma.InputJsonValue,
          },
        },
        data: { response: value as unknown as Prisma.InputJsonValue },
      });
      if (updated.count !== 1) {
        throw new ServiceError(
          'Idempotency reservation ownership was lost before completion',
          'IDEMPOTENCY_RESERVATION_LOST',
          409,
        );
      }
    },

    async release(key, reservation) {
      const pending = pendingResponse(reservation);
      const deleted = await prisma.idempotencyRecord.deleteMany({
        where: {
          key: scopedKey(key),
          response: {
            equals: pending as unknown as Prisma.InputJsonValue,
          },
        },
      });
      if (deleted.count !== 1) {
        throw new ServiceError(
          'Idempotency reservation ownership was lost before release',
          'IDEMPOTENCY_RESERVATION_LOST',
          409,
        );
      }
    },
  };
}

/**
 * Run `work` idempotently. With no store or no key it just runs the work (the
 * opt-in default). Reservation-capable stores claim before work, reject a
 * concurrent duplicate, and atomically transition PENDING to the terminal
 * response. A thrown work attempt releases only its own claim so it is
 * retryable. If terminal persistence fails after work succeeds, the claim is
 * deliberately retained: allowing a retry then could repeat completed side
 * effects. Legacy get/set-only stores keep their sequential behavior.
 */
export async function withIdempotency<T>(
  store: IdempotencyStore<T> | undefined,
  key: string | undefined,
  work: () => Promise<T>,
): Promise<T> {
  if (!store || !key) return work();

  if (supportsReservations(store)) {
    const claim = await store.claim(key);
    if (claim.state === 'completed') return claim.value;
    if (claim.state === 'in-progress') {
      throw new ServiceError(
        'A request with this Idempotency-Key is already in progress',
        'IDEMPOTENCY_IN_PROGRESS',
        409,
      );
    }

    let result: T;
    try {
      result = await work();
    } catch (error) {
      await store.release(key, claim.reservation);
      throw error;
    }

    // Keep this outside the catch above: a completion-write failure must leave
    // PENDING in place so a retry cannot repeat already-successful side effects.
    await store.complete(key, claim.reservation, result);
    return result;
  }

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
