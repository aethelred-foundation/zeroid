/**
 * Map raw wallet/RPC failures to actionable guidance.
 *
 * The telltale case: `personal_sign` "does not exist/is not available" is the
 * CHAIN NODE's -32601 — nodes never sign for users. Seeing it means the
 * signing request was never intercepted by a wallet that can sign (typically
 * several wallet extensions fighting over window.ethereum, with the dApp
 * connected to one that proxies unknown methods to the RPC).
 */
export function friendlyWalletError(error: unknown): Error {
  const message = error instanceof Error ? error.message : String(error ?? "");

  if (/personal_sign.*(does not exist|not available|not supported)/i.test(message)) {
    return new Error(
      "Your connected wallet could not sign the registration message — the " +
        "request reached the network node instead of a signing wallet. If " +
        "you have more than one wallet extension installed, disconnect, then " +
        "reconnect and pick MetaMask in the wallet menu (or disable the " +
        "other wallet extensions and reload).",
    );
  }

  if (/user rejected|user denied|4001/i.test(message)) {
    return new Error("Signature request declined in the wallet. Try again and approve both prompts.");
  }

  return error instanceof Error ? error : new Error(message || "Wallet request failed");
}

/**
 * Map backend registration failures to guidance. The notable case is the 409
 * DID conflict: after the fix that derives the canonical address-bound DID,
 * a conflict means this wallet's identity already exists server-side (e.g. a
 * previous attempt that stored the record but lost the session).
 */
export function friendlyRegistrationError(error: unknown): Error {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const code = (error as { code?: string })?.code;
  if (statusCode === 409 || code === "IDENTITY_DID_EXISTS") {
    return new Error(
      "An identity for this wallet is already registered. Reload the " +
        "dashboard — it should appear there. If it does not, an earlier " +
        "partial registration may hold the record; ask the operator to " +
        "remove it and register again.",
    );
  }
  return friendlyWalletError(error);
}
