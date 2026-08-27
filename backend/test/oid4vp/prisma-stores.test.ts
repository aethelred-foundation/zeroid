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
  const storeEnv = {
    NODE_ENV: "test",
    OID4VCI_STORAGE_HASH_PEPPER: "p".repeat(64),
  };

  function setup() {
    const offer = {
      create: jest.fn(),
      findUnique: jest.fn(),
      deleteMany: jest.fn(),
    };
    const token = {
      create: jest.fn(),
      findUnique: jest.fn(),
      updateMany: jest.fn(),
      deleteMany: jest.fn(),
    };
    const tx = { oid4vciOffer: offer, oid4vciTokenSession: token };
    const transaction = jest.fn(async (operation: (client: typeof tx) => unknown) => operation(tx));
    const store = createPrismaIssuanceStores(
      {
        ...tx,
        $transaction: transaction,
      } as unknown as Pick<
        PrismaClient,
        "oid4vciOffer" | "oid4vciTokenSession" | "$transaction"
      >,
      storeEnv,
    );
    return { offer, token, transaction, store };
  }

  it("persists only HMAC digests for an offer and its tx_code", async () => {
    const { offer, store } = setup();
    await store.saveOffer("plain-pre-authorized-code", {
      configId: "c",
      subjectDid: "d",
      txCode: "1234",
      expiresAt: 2000,
    });

    const data = offer.create.mock.calls[0][0].data;
    expect(data.preAuthCode).toMatch(/^[0-9a-f]{64}$/);
    expect(data.preAuthCode).not.toContain("plain-pre-authorized-code");
    expect(data.txCode).toMatch(/^[0-9a-f]{64}$/);
    expect(data.txCode).not.toContain("1234");
  });

  it("does not consume an offer for a wrong tx_code", async () => {
    const { offer, token, store } = setup();
    await store.saveOffer("code", {
      configId: "c",
      subjectDid: "d",
      txCode: "1234",
      expiresAt: 2000,
    });
    const stored = offer.create.mock.calls[0][0].data;
    offer.findUnique.mockResolvedValue({
      ...stored,
      expiresAt: new Date(2_000_000),
    });

    await expect(store.redeemOffer({
      code: "code",
      txCode: "9999",
      now: 1000,
      accessToken: "access-token",
      cNonce: "nonce",
      tokenExpiresAt: 1600,
    })).resolves.toBeNull();

    expect(offer.deleteMany).not.toHaveBeenCalled();
    expect(token.create).not.toHaveBeenCalled();
  });

  it("atomically exchanges an offer and stores no plaintext bearer material", async () => {
    const { offer, token, transaction, store } = setup();
    await store.saveOffer("code", {
      configId: "c",
      subjectDid: "d",
      txCode: "1234",
      expiresAt: 2000,
    });
    const stored = offer.create.mock.calls[0][0].data;
    offer.findUnique.mockResolvedValue({ ...stored, expiresAt: new Date(2_000_000) });
    offer.deleteMany.mockResolvedValue({ count: 1 });
    token.create.mockResolvedValue({});

    await expect(store.redeemOffer({
      code: "code",
      txCode: "1234",
      now: 1000,
      accessToken: "plain-access-token",
      cNonce: "plain-c-nonce",
      tokenExpiresAt: 1600,
    })).resolves.toMatchObject({ configId: "c", subjectDid: "d" });

    expect(transaction).toHaveBeenCalledTimes(1);
    expect(offer.deleteMany).toHaveBeenCalledWith({
      where: expect.objectContaining({
        preAuthCode: stored.preAuthCode,
        txCode: stored.txCode,
      }),
    });
    const tokenData = token.create.mock.calls[0][0].data;
    expect(tokenData.accessToken).toMatch(/^[0-9a-f]{64}$/);
    expect(tokenData.accessToken).not.toContain("plain-access-token");
    expect(tokenData.cNonce).toMatch(/^v1\./);
    expect(tokenData.cNonce).not.toContain("plain-c-nonce");
  });

  it("claims, decrypts, completes, and releases by exact lease owner", async () => {
    const { offer, token, store } = setup();
    await store.saveOffer("code", {
      configId: "c",
      subjectDid: "d",
      expiresAt: 2000,
    });
    const storedOffer = offer.create.mock.calls[0][0].data;
    offer.findUnique.mockResolvedValue({ ...storedOffer, expiresAt: new Date(2_000_000) });
    offer.deleteMany.mockResolvedValue({ count: 1 });
    token.create.mockResolvedValue({});
    await store.redeemOffer({
      code: "code",
      now: 1000,
      accessToken: "at",
      cNonce: "nonce",
      tokenExpiresAt: 1600,
    });
    const tokenData = token.create.mock.calls[0][0].data;
    token.findUnique.mockResolvedValue({
      ...tokenData,
      expiresAt: new Date(1_600_000),
    });
    token.updateMany.mockResolvedValueOnce({ count: 1 });

    await expect(store.claimToken("at", {
      claimId: "owner-1",
      now: 1000,
      claimExpiresAt: 1120,
    })).resolves.toMatchObject({ cNonce: "nonce", claimId: "owner-1" });
    expect(token.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        accessToken: tokenData.accessToken,
        OR: [
          { claimId: null },
          { claimExpiresAt: { lte: new Date(1_000_000) } },
        ],
      }),
      data: {
        claimId: "owner-1",
        claimExpiresAt: new Date(1_120_000),
      },
    });

    token.deleteMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(store.completeToken("at", "stale-owner", 1001)).resolves.toBe(false);
    await expect(store.completeToken("at", "owner-1", 1001)).resolves.toBe(true);
    expect(token.deleteMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({
        accessToken: tokenData.accessToken,
        claimId: "owner-1",
        claimExpiresAt: { gt: new Date(1_001_000) },
      }),
    });

    token.updateMany.mockResolvedValueOnce({ count: 0 }).mockResolvedValueOnce({ count: 1 });
    await expect(store.releaseToken("at", "stale-owner")).resolves.toBe(false);
    await expect(store.releaseToken("at", "owner-1")).resolves.toBe(true);
    expect(token.updateMany).toHaveBeenLastCalledWith({
      where: expect.objectContaining({ claimId: "owner-1" }),
      data: { claimId: null, claimExpiresAt: null },
    });
  });

  it("fails closed without a production storage pepper or with a weak configured pepper", () => {
    const { offer, token } = setup();
    const prisma = {
      oid4vciOffer: offer,
      oid4vciTokenSession: token,
      $transaction: jest.fn(),
    } as unknown as Pick<
      PrismaClient,
      "oid4vciOffer" | "oid4vciTokenSession" | "$transaction"
    >;
    expect(() => createPrismaIssuanceStores(
      prisma,
      { NODE_ENV: "production" },
    )).toThrow(/OID4VCI_STORAGE_HASH_PEPPER/);
    expect(() => createPrismaIssuanceStores(
      prisma,
      { NODE_ENV: "test", OID4VCI_STORAGE_HASH_PEPPER: "weak" },
    )).toThrow(/OID4VCI_STORAGE_HASH_PEPPER/);
  });
});
