import type { PrismaClient } from "@prisma/client";
import {
  createPrismaIdempotencyStore,
  withIdempotency,
  readIdempotencyKey,
  type IdempotencyStore,
} from "@/services/idempotency";

function makePrisma() {
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    idempotencyRecord: { findUnique, upsert },
  } as unknown as Pick<PrismaClient, "idempotencyRecord">;
  return { prisma, findUnique, upsert };
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
