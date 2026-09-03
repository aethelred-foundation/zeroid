import { friendlyWalletError } from "@/lib/wallet-errors";

describe("friendlyWalletError", () => {
  it("maps the node's personal_sign -32601 to multi-wallet guidance", () => {
    // Exact message the chain node returns when a non-signing provider
    // proxies personal_sign to the RPC (viem surfaces it verbatim).
    const raw = new Error(
      "An unknown RPC error occurred. Details: the method personal_sign does not exist/is not available Version: viem@2.53.1",
    );
    const friendly = friendlyWalletError(raw);
    expect(friendly.message).toMatch(/could not sign/i);
    expect(friendly.message).toMatch(/MetaMask/);
    expect(friendly.message).not.toMatch(/viem@/);
  });

  it("maps wallet 'not supported' variants of personal_sign", () => {
    const friendly = friendlyWalletError(
      new Error("personal_sign is not supported by this provider"),
    );
    expect(friendly.message).toMatch(/could not sign/i);
  });

  it("maps user rejection to a retry prompt", () => {
    const friendly = friendlyWalletError(
      new Error("User rejected the request."),
    );
    expect(friendly.message).toMatch(/declined/i);
    expect(friendly.message).toMatch(/approve both prompts/i);
  });

  it("passes genuine errors through unchanged", () => {
    const raw = new Error("insufficient funds for gas");
    expect(friendlyWalletError(raw)).toBe(raw);
  });

  it("wraps non-Error throwables", () => {
    const friendly = friendlyWalletError("boom");
    expect(friendly).toBeInstanceOf(Error);
    expect(friendly.message).toBe("boom");
  });
});

// ---------------------------------------------------------------------------
// friendlyRegistrationError
// ---------------------------------------------------------------------------

import { friendlyRegistrationError } from "@/lib/wallet-errors";

describe("friendlyRegistrationError", () => {
  it("maps the backend 409 DID conflict to already-registered guidance", () => {
    const conflict = Object.assign(new Error("DID already registered"), {
      statusCode: 409,
      code: "IDENTITY_DID_EXISTS",
    });
    const friendly = friendlyRegistrationError(conflict);
    expect(friendly.message).toMatch(/already registered/i);
    expect(friendly.message).toMatch(/reload the dashboard/i);
  });

  it("falls back to the wallet mapper for non-409 errors", () => {
    const friendly = friendlyRegistrationError(
      new Error("the method personal_sign does not exist/is not available"),
    );
    expect(friendly.message).toMatch(/could not sign/i);
  });
});

describe("friendlyRegistrationError — registry verifier codes", () => {
  const withCode = (code: string, statusCode: number) =>
    Object.assign(new Error(`refused: ${code}`), { code, statusCode });

  it.each([
    "IDENTITY_REGISTRY_TX_NOT_MINED",
    "IDENTITY_REGISTRY_TX_NOT_CONFIRMED",
  ])(
    "tells the user to click Register again for %s (no new signature or tx)",
    (code) => {
      const friendly = friendlyRegistrationError(withCode(code, 409));
      expect(friendly.message).toMatch(/click Register again/i);
      expect(friendly.message).toMatch(/no new signature or transaction/i);
      expect(friendly).toMatchObject({ code, statusCode: 409 });
    },
  );

  it.each(["IDENTITY_REGISTRY_TX_ALREADY_USED", "IDENTITY_CONTROLLER_EXISTS"])(
    "maps %s to already-registered guidance",
    (code) => {
      const friendly = friendlyRegistrationError(withCode(code, 409));
      expect(friendly.message).toMatch(/already registered/i);
      expect(friendly).toMatchObject({ code });
    },
  );

  it("explains a reverted registry transaction", () => {
    const friendly = friendlyRegistrationError(
      withCode("IDENTITY_REGISTRY_TX_REVERTED", 422),
    );
    expect(friendly.message).toMatch(/reverted on-chain/i);
    expect(friendly.message).toMatch(/paused|already bound/i);
    expect(friendly.message).toMatch(/no session/i);
  });

  it("explains a DID network / chain id mismatch as an environment problem", () => {
    const friendly = friendlyRegistrationError(
      withCode("IDENTITY_DID_NETWORK_MISMATCH", 400),
    );
    expect(friendly.message).toMatch(/NEXT_PUBLIC_CHAIN_ENV/);
    expect(friendly.message).toMatch(/AETHELRED_CHAIN_ID/);
  });

  it.each([
    "IDENTITY_REGISTRY_NOT_CONFIGURED",
    "IDENTITY_REGISTRY_RPC_UNAVAILABLE",
    "IDENTITY_REGISTRATION_NOT_CONFIGURED",
  ])(
    "maps the %s 503 to a service-not-ready message that keeps the code",
    (code) => {
      const friendly = friendlyRegistrationError(withCode(code, 503));
      expect(friendly.message).toMatch(/not ready/i);
      expect(friendly.message).toMatch(/nothing was lost/i);
      expect(friendly).toMatchObject({ code, statusCode: 503 });
    },
  );

  it.each([
    "IDENTITY_REGISTRY_CHAIN_MISMATCH",
    "IDENTITY_REGISTRY_WRONG_TARGET",
    "IDENTITY_REGISTRY_SENDER_MISMATCH",
    "IDENTITY_REGISTRY_WRONG_FUNCTION",
    "IDENTITY_REGISTRY_ARGUMENT_MISMATCH",
    "IDENTITY_REGISTRY_EVENT_MISSING",
    "IDENTITY_REGISTRY_EVENT_MISMATCH",
    "IDENTITY_REGISTRY_STATE_MISMATCH",
  ])("maps the %s 422 to operator guidance quoting the tx hash", (code) => {
    const friendly = friendlyRegistrationError(withCode(code, 422));
    expect(friendly.message).toMatch(/could not match your transaction/i);
    expect(friendly.message).toMatch(/transaction hash/i);
    expect(friendly).toMatchObject({ code, statusCode: 422 });
  });

  it("keeps the API code on wallet-mapped errors that carry one", () => {
    const friendly = friendlyRegistrationError(
      Object.assign(new Error("User rejected the request."), {
        code: "WALLET_REJECTED",
        statusCode: 400,
      }),
    );
    expect(friendly.message).toMatch(/declined/i);
    expect(friendly).toMatchObject({ code: "WALLET_REJECTED" });
  });
});

describe("pre-flight messages", () => {
  it("exports the paused and already-bound guidance used before signing", () => {
    const {
      REGISTRY_PAUSED_MESSAGE,
      CONTROLLER_ALREADY_BOUND_MESSAGE,
    } = require("@/lib/wallet-errors");
    expect(REGISTRY_PAUSED_MESSAGE).toMatch(/registry is paused/i);
    expect(REGISTRY_PAUSED_MESSAGE).toMatch(/nothing was signed/i);
    expect(CONTROLLER_ALREADY_BOUND_MESSAGE).toMatch(/already bound/i);
  });
});
