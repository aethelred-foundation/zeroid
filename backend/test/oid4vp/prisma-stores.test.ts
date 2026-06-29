import type { PrismaClient } from "@prisma/client";
import { createPrismaOid4vpRequestStore } from "@/services/oid4vp/request-store-prisma";
import { createPrismaIssuanceStores } from "@/services/oid4vci/issuance-stores-prisma";

describe("createPrismaOid4vpRequestStore", () => {
  function setup() {
    const m = { create: jest.fn(), findUnique: jest.fn(), updateMany: jest.fn(), update: jest.fn() };
    const store = createPrismaOid4vpRequestStore(
      { oid4vpPresentationRequest: m } as unknown as Pick<PrismaClient, "oid4vpPresentationRequest">,
    );
    return { m, store };
  }

  it("consumeNonce is true only when exactly one PENDING row transitions to CONSUMED", async () => {
    const { m, store } = setup();
    m.updateMany.mockResolvedValueOnce({ count: 1 });
    await expect(store.consumeNonce("n")).resolves.toBe(true);
    m.updateMany.mockResolvedValueOnce({ count: 0 });
    await expect(store.consumeNonce("n")).resolves.toBe(false);
    expect(m.updateMany).toHaveBeenCalledWith(
      expect.objectContaining({ data: { status: "CONSUMED" } }),
    );
  });

  it("getByState maps a row and converts expiry to epoch seconds", async () => {
    const { m, store } = setup();
    m.findUnique.mockResolvedValue({
      state: "s", nonce: "n", policyId: "p", audience: "a",
      status: "PENDING", decision: null, expiresAt: new Date(1_000_000),
    });
    await expect(store.getByState("s")).resolves.toMatchObject({
      state: "s", nonce: "n", status: "PENDING", expiresAt: 1000,
    });
  });
});

describe("createPrismaIssuanceStores", () => {
  function setup() {
    const offer = { create: jest.fn(), delete: jest.fn() };
    const token = { create: jest.fn(), findUnique: jest.fn(), delete: jest.fn() };
    const store = createPrismaIssuanceStores(
      { oid4vciOffer: offer, oid4vciTokenSession: token } as unknown as Pick<
        PrismaClient,
        "oid4vciOffer" | "oid4vciTokenSession"
      >,
    );
    return { offer, token, store };
  }

  it("takeOffer consumes atomically (delete), maps the grant, and returns null when absent", async () => {
    const { offer, store } = setup();
    offer.delete.mockResolvedValueOnce({
      configId: "c", subjectDid: "d", txCode: null, expiresAt: new Date(2_000_000),
    });
    await expect(store.takeOffer("code")).resolves.toMatchObject({
      configId: "c", subjectDid: "d", expiresAt: 2000,
    });
    offer.delete.mockRejectedValueOnce(new Error("not found"));
    await expect(store.takeOffer("missing")).resolves.toBeNull();
  });

  it("getToken maps a session", async () => {
    const { token, store } = setup();
    token.findUnique.mockResolvedValue({
      configId: "c", subjectDid: "d", cNonce: "n", expiresAt: new Date(3_000_000),
    });
    await expect(store.getToken("at")).resolves.toMatchObject({ cNonce: "n", expiresAt: 3000 });
  });
});
