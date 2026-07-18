import type { PrismaClient } from "@prisma/client";
import {
  createPrismaIdempotencyStore,
  IDEMPOTENCY_LEASE_MS,
  withIdempotency,
  readIdempotencyKey,
  type IdempotencyStore,
} from "@/services/idempotency";

function makePrisma() {
  const findUnique = jest.fn();
  const create = jest.fn();
  const updateMany = jest.fn();
  const deleteMany = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    idempotencyRecord: { findUnique, create, updateMany, deleteMany, upsert },
  } as unknown as Pick<PrismaClient, "idempotencyRecord">;
  return { prisma, findUnique, create, updateMany, deleteMany, upsert };
}

interface FakeIdempotencyRow {
  key: string;
  scope: string;
  response: unknown;
  createdAt: Date;
}

function jsonEqual(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/** A shared in-memory delegate that preserves the DB's unique-key/CAS semantics. */
function atomicPrisma() {
  const rows = new Map<string, FakeIdempotencyRow>();
  const findUnique = jest.fn(
    async ({ where }: { where: { key: string } }) => rows.get(where.key) ?? null,
  );
  const create = jest.fn(
    async ({ data }: { data: { key: string; scope: string; response: unknown } }) => {
      if (rows.has(data.key)) {
        throw Object.assign(new Error("unique constraint"), { code: "P2002" });
      }
      const row = { ...data, createdAt: new Date() };
      rows.set(data.key, row);
      return row;
    },
  );
  const updateMany = jest.fn(
    async ({
      where,
      data,
    }: {
      where: { key: string; response: { equals: unknown } };
      data: { response: unknown };
    }) => {
      const row = rows.get(where.key);
      if (!row || !jsonEqual(row.response, where.response.equals)) {
        return { count: 0 };
      }
      row.response = data.response;
      return { count: 1 };
    },
  );
  const deleteMany = jest.fn(
    async ({
      where,
    }: {
      where: { key: string; response: { equals: unknown } };
    }) => {
      const row = rows.get(where.key);
      if (!row || !jsonEqual(row.response, where.response.equals)) {
        return { count: 0 };
      }
      rows.delete(where.key);
      return { count: 1 };
    },
  );
  const upsert = jest.fn();
  const prisma = {
    idempotencyRecord: { findUnique, create, updateMany, deleteMany, upsert },
  } as unknown as Pick<PrismaClient, "idempotencyRecord">;
  return { prisma, rows, findUnique, create, updateMany, deleteMany };
}

function memoryStore<T>(): IdempotencyStore<T> & { get: jest.Mock; set: jest.Mock } {
  const cache = new Map<string, T>();
  return {
    get: jest.fn(async (k: string) => cache.get(k) ?? null),
    set: jest.fn(async (k: string, v: T) => {
      cache.set(k, v);
    }),
  };
}

describe("createPrismaIdempotencyStore", () => {
  it("namespaces the key by scope on read", async () => {
    const { prisma, findUnique } = makePrisma();
    findUnique.mockResolvedValue(null);
    const store = createPrismaIdempotencyStore(prisma, "agent.eligibility.proof");
    await store.get("abc");
    expect(findUnique).toHaveBeenCalledWith({ where: { key: "agent.eligibility.proof:abc" } });
  });

  it("returns the stored response on a hit and null on a miss", async () => {
    const { prisma, findUnique } = makePrisma();
    const store = createPrismaIdempotencyStore<{ ok: boolean }>(prisma, "s");
    findUnique.mockResolvedValueOnce({ response: { ok: true } });
    await expect(store.get("k")).resolves.toEqual({ ok: true });
    findUnique.mockResolvedValueOnce(null);
    await expect(store.get("k")).resolves.toBeNull();
  });

  it("does not expose an internal PENDING envelope as a terminal response", async () => {
    const { prisma, findUnique } = makePrisma();
    const store = createPrismaIdempotencyStore<{ ok: boolean }>(prisma, "s");
    findUnique.mockResolvedValue({
      response: {
        __zeroidIdempotency: "zeroid.idempotency.pending.v1",
        owner: "owner-1",
        claimedAt: "2026-07-18T00:00:00.000Z",
        expiresAt: "2026-07-18T00:05:00.000Z",
      },
    });
    await expect(store.get("k")).resolves.toBeNull();
  });

  it("writes first-write-wins (upsert with empty update) under the scoped key", async () => {
    const { prisma, upsert } = makePrisma();
    const store = createPrismaIdempotencyStore<{ v: number }>(prisma, "s");
    await store.set("k", { v: 1 });
    expect(upsert).toHaveBeenCalledWith({
      where: { key: "s:k" },
      create: { key: "s:k", scope: "s", response: { v: 1 } },
      update: {},
    });
  });
});

describe("withIdempotency", () => {
  it("runs the work and caches it on a miss", async () => {
    const store = memoryStore<{ n: number }>();
    const work = jest.fn().mockResolvedValue({ n: 1 });
    const r = await withIdempotency(store, "k", work);
    expect(r).toEqual({ n: 1 });
    expect(work).toHaveBeenCalledTimes(1);
    expect(store.set).toHaveBeenCalledWith("k", { n: 1 });
  });

  it("returns the cached value and does not re-run on a repeated key", async () => {
    const store = memoryStore<{ n: number }>();
    const work = jest.fn().mockResolvedValue({ n: 1 });
    await withIdempotency(store, "k", work);
    const second = await withIdempotency(store, "k", work);
    expect(second).toEqual({ n: 1 });
    expect(work).toHaveBeenCalledTimes(1);
  });

  it("runs without touching the store when there is no key or no store", async () => {
    const store = memoryStore<{ n: number }>();
    const work = jest.fn().mockResolvedValue({ n: 2 });

    await withIdempotency(store, undefined, work);
    expect(store.get).not.toHaveBeenCalled();
    expect(store.set).not.toHaveBeenCalled();

    await withIdempotency(undefined, "k", work);
    expect(work).toHaveBeenCalledTimes(2);
  });

  it("does not cache a thrown attempt (stays retryable)", async () => {
    const store = memoryStore<unknown>();
    const work = jest.fn().mockRejectedValue(new Error("transient"));
    await expect(withIdempotency(store, "k", work)).rejects.toThrow("transient");
    expect(store.set).not.toHaveBeenCalled();
  });

  it("allows only one concurrent Prisma-backed caller to run for a fresh lease", async () => {
    const { prisma } = atomicPrisma();
    const firstStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
    const secondStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
    let unblock!: () => void;
    let markStarted!: () => void;
    const blocked = new Promise<void>((resolve) => {
      unblock = resolve;
    });
    const started = new Promise<void>((resolve) => {
      markStarted = resolve;
    });
    const firstWork = jest.fn(async () => {
      markStarted();
      await blocked;
      return { n: 1 };
    });
    const duplicateWork = jest.fn().mockResolvedValue({ n: 2 });

    const first = withIdempotency(firstStore, "same-key", firstWork);
    await started;
    await expect(
      withIdempotency(secondStore, "same-key", duplicateWork),
    ).rejects.toMatchObject({
      code: "IDEMPOTENCY_IN_PROGRESS",
      statusCode: 409,
    });
    expect(duplicateWork).not.toHaveBeenCalled();

    unblock();
    await expect(first).resolves.toEqual({ n: 1 });
    await expect(
      withIdempotency(secondStore, "same-key", duplicateWork),
    ).resolves.toEqual({ n: 1 });
    expect(duplicateWork).not.toHaveBeenCalled();
  });

  it("releases a failed owner's claim so the same key can be retried", async () => {
    const { prisma, rows } = atomicPrisma();
    const firstStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
    const retryStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");

    await expect(
      withIdempotency(firstStore, "retryable", async () => {
        throw new Error("transient");
      }),
    ).rejects.toThrow("transient");
    expect(rows.has("s:retryable")).toBe(false);
    await expect(
      withIdempotency(retryStore, "retryable", async () => ({ n: 2 })),
    ).resolves.toEqual({ n: 2 });
  });

  it("takes over an expired crash lease and rejects the displaced owner's CAS", async () => {
    jest.useFakeTimers();
    jest.setSystemTime(new Date("2026-07-18T00:00:00.000Z"));
    try {
      const { prisma } = atomicPrisma();
      const crashedStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
      const recoveryStore = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
      const crashedClaim = await crashedStore.claim!("crash-key");
      expect(crashedClaim.state).toBe("acquired");
      if (crashedClaim.state !== "acquired") throw new Error("claim not acquired");

      jest.setSystemTime(
        new Date(Date.now() + IDEMPOTENCY_LEASE_MS + 1),
      );
      const recoveryClaim = await recoveryStore.claim!("crash-key");
      expect(recoveryClaim.state).toBe("acquired");
      if (recoveryClaim.state !== "acquired") throw new Error("takeover failed");

      await expect(
        crashedStore.complete!("crash-key", crashedClaim.reservation, { n: 1 }),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_RESERVATION_LOST" });
      await expect(
        crashedStore.release!("crash-key", crashedClaim.reservation),
      ).rejects.toMatchObject({ code: "IDEMPOTENCY_RESERVATION_LOST" });

      await recoveryStore.complete!(
        "crash-key",
        recoveryClaim.reservation,
        { n: 2 },
      );
      await expect(recoveryStore.get("crash-key")).resolves.toEqual({ n: 2 });
    } finally {
      jest.useRealTimers();
    }
  });

  it("reads a legacy raw-response row as completed without running work", async () => {
    const { prisma, rows } = atomicPrisma();
    rows.set("s:legacy", {
      key: "s:legacy",
      scope: "s",
      response: { n: 7 },
      createdAt: new Date(),
    });
    const store = createPrismaIdempotencyStore<{ n: number }>(prisma, "s");
    const work = jest.fn().mockResolvedValue({ n: 8 });
    await expect(withIdempotency(store, "legacy", work)).resolves.toEqual({ n: 7 });
    expect(work).not.toHaveBeenCalled();
  });

  it("retains PENDING when terminal persistence fails after successful work", async () => {
    const store: IdempotencyStore<{ n: number }> = {
      get: jest.fn(),
      set: jest.fn(),
      claim: jest.fn().mockResolvedValue({
        state: "acquired",
        reservation: {
          owner: "o1",
          claimedAt: "2026-07-18T00:00:00.000Z",
          expiresAt: "2026-07-18T00:05:00.000Z",
        },
      }),
      complete: jest.fn().mockRejectedValue(new Error("database unavailable")),
      release: jest.fn(),
    };

    await expect(
      withIdempotency(store, "k", async () => ({ n: 1 })),
    ).rejects.toThrow("database unavailable");
    expect(store.release).not.toHaveBeenCalled();
  });
});

describe("readIdempotencyKey", () => {
  it("returns undefined when no header was sent (opt-in)", () => {
    expect(readIdempotencyKey(undefined)).toBeUndefined();
    expect(readIdempotencyKey([])).toBeUndefined();
  });

  it("trims and returns a valid key (string or first array element)", () => {
    expect(readIdempotencyKey("  abc  ")).toBe("abc");
    expect(readIdempotencyKey(["k1", "k2"])).toBe("k1");
  });

  it("throws INVALID_IDEMPOTENCY_KEY for blank or oversized values", () => {
    expect(() => readIdempotencyKey("   ")).toThrow(
      expect.objectContaining({ code: "INVALID_IDEMPOTENCY_KEY", statusCode: 400 }),
    );
    expect(() => readIdempotencyKey("x".repeat(256))).toThrow(
      expect.objectContaining({ code: "INVALID_IDEMPOTENCY_KEY", statusCode: 400 }),
    );
  });
});
