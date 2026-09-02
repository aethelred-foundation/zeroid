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

  if (
    /personal_sign.*(does not exist|not available|not supported)/i.test(message)
  ) {
    return new Error(
      "Your connected wallet could not sign the registration message — the " +
        "request reached the network node instead of a signing wallet. If " +
        "you have more than one wallet extension installed, disconnect, then " +
        "reconnect and pick MetaMask in the wallet menu (or disable the " +
        "other wallet extensions and reload).",
    );
  }

  if (/user rejected|user denied|4001/i.test(message)) {
    return new Error(
      "Signature request declined in the wallet. Try again and approve both prompts.",
    );
  }

  return error instanceof Error
    ? error
    : new Error(message || "Wallet request failed");
}

/** Shown by the pre-flight when the registry's paused() view returns true. */
export const REGISTRY_PAUSED_MESSAGE =
  "The identity registry is paused by its administrator, so registrations are " +
  "rejected on-chain right now. Nothing was signed or submitted; try again " +
  "once the registry is unpaused.";

/** Shown by the pre-flight when resolveByController already returns a DID. */
export const CONTROLLER_ALREADY_BOUND_MESSAGE =
  "This wallet is already bound to an identity on the registry, but ZeroID " +
  "has no record of it. A second registration would be rejected on-chain. " +
  "Ask the operator to reconcile the identity for this wallet address.";

export interface RegistrationErrorCause {
  code?: string;
  statusCode?: number;
}

const ALREADY_REGISTERED_MESSAGE =
  "An identity for this wallet is already registered. Reload the " +
  "dashboard — it should appear there. If it does not, an earlier " +
  "partial registration may hold the record; ask the operator to " +
  "remove it and register again.";

const RETRY_LATER_MESSAGE =
  "Your registration transaction was mined in your browser's view of the " +
  "network, but the API's node has not seen it yet. Click Register again in " +
  "a moment — no new signature or transaction is needed.";

const SERVICE_NOT_READY_MESSAGE =
  "The registration service is not ready (its chain verifier is unavailable). " +
  "Nothing was lost: your transaction and signature are kept for a retry " +
  "later.";

const REVERTED_MESSAGE =
  "The registration transaction reverted on-chain — the registry is paused " +
  "or this wallet is already bound to an identity. No identity was created; " +
  "no session was started.";

const NETWORK_MISMATCH_MESSAGE =
  "This app is configured for a different Aethelred network than the API " +
  "verifies against (DID network vs chain id). Ask the operator to align " +
  "NEXT_PUBLIC_CHAIN_ENV with the API's AETHELRED_CHAIN_ID.";

const EVIDENCE_REJECTED_MESSAGE =
  "The API could not match your transaction to this identity, so no " +
  "identity or session was created. Contact the operator and quote the " +
  "transaction hash.";

function withCause(message: string, cause: RegistrationErrorCause): Error {
  return Object.assign(new Error(message), {
    code: cause.code,
    statusCode: cause.statusCode,
  });
}

/**
 * Map backend registration failures to guidance. The returned error keeps the
 * API's `code`/`statusCode` so callers can branch on them (for example the
 * wizard's unavailable state and the hook's pending-registration handling).
 */
export function friendlyRegistrationError(error: unknown): Error {
  const statusCode = (error as { statusCode?: number })?.statusCode;
  const code = (error as { code?: string })?.code;
  const cause: RegistrationErrorCause = { code, statusCode };

  switch (code) {
    case "IDENTITY_REGISTRY_TX_NOT_MINED":
    case "IDENTITY_REGISTRY_TX_NOT_CONFIRMED":
      return withCause(RETRY_LATER_MESSAGE, cause);
    case "IDENTITY_DID_EXISTS":
    case "IDENTITY_REGISTRY_TX_ALREADY_USED":
    case "IDENTITY_CONTROLLER_EXISTS":
      return withCause(ALREADY_REGISTERED_MESSAGE, cause);
    case "IDENTITY_REGISTRY_TX_REVERTED":
      return withCause(REVERTED_MESSAGE, cause);
    case "IDENTITY_DID_NETWORK_MISMATCH":
      return withCause(NETWORK_MISMATCH_MESSAGE, cause);
    case "IDENTITY_REGISTRY_NOT_CONFIGURED":
    case "IDENTITY_REGISTRY_RPC_UNAVAILABLE":
    case "IDENTITY_REGISTRATION_NOT_CONFIGURED":
      return withCause(SERVICE_NOT_READY_MESSAGE, cause);
    default:
      break;
  }

  if (statusCode === 409) {
    return withCause(ALREADY_REGISTERED_MESSAGE, cause);
  }
  if (
    statusCode === 422 &&
    typeof code === "string" &&
    code.startsWith("IDENTITY_REGISTRY_")
  ) {
    return withCause(EVIDENCE_REJECTED_MESSAGE, cause);
  }

  const friendly = friendlyWalletError(error);
  if (friendly === error) return friendly;
  return code || statusCode ? withCause(friendly.message, cause) : friendly;
}
