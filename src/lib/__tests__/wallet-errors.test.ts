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
