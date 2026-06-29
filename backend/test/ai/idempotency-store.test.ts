import type { PrismaClient } from "@prisma/client";
import { createPrismaIdempotencyStore } from "@/services/ai/idempotency-store";
import type { AgentEligibilityProofResponse } from "@/services/ai/agent-eligibility";

function makePrisma() {
  const findUnique = jest.fn();
  const upsert = jest.fn().mockResolvedValue(undefined);
  const prisma = {
    idempotencyRecord: { findUnique, upsert },
  } as unknown as Pick<PrismaClient, "idempotencyRecord">;
  return { prisma, findUnique, upsert };
}

const sample = {
  status: "ALLOWED",
  decisionId: "dec1",
} as unknown as AgentEligibilityProofResponse;

describe("createPrismaIdempotencyStore", () => {
  it("namespaces the key by scope on read", async () => {
    const { prisma, findUnique } = makePrisma();
    findUnique.mockResolvedValue(null);
    const store = createPrismaIdempotencyStore(prisma, "agent.eligibility.proof");

    await store.get("abc");

    expect(findUnique).toHaveBeenCalledWith({
      where: { key: "agent.eligibility.proof:abc" },
    });
  });

  it("returns the stored response on a hit and null on a miss", async () => {
    const { prisma, findUnique } = makePrisma();
    const store = createPrismaIdempotencyStore(prisma, "s");

    findUnique.mockResolvedValueOnce({ response: sample });
    await expect(store.get("k")).resolves.toEqual(sample);

    findUnique.mockResolvedValueOnce(null);
    await expect(store.get("k")).resolves.toBeNull();
  });

  it("writes first-write-wins (upsert with empty update) under the scoped key", async () => {
    const { prisma, upsert } = makePrisma();
    const store = createPrismaIdempotencyStore(prisma, "s");

    await store.set("k", sample);

    expect(upsert).toHaveBeenCalledWith({
      where: { key: "s:k" },
      create: { key: "s:k", scope: "s", response: sample },
      update: {},
    });
  });
});
