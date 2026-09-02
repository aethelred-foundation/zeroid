/**
 * The registration flow reads paused() and parses IdentityRegistered from
 * this ABI, and the API's verifier decodes resolveIdentity with the same
 * tuple. Pin the shapes against contracts/interfaces/IZeroID.sol.
 */
import { IdentityRegistryABI } from "@/config/abis";

type AbiItem = { name?: string; type: string; [key: string]: unknown };

const find = (name: string, type: string) =>
  (IdentityRegistryABI as readonly AbiItem[]).find(
    (item) => item.name === name && item.type === type,
  );

describe("IdentityRegistryABI", () => {
  it("declares IdentityRegistered with indexed didHash/controller and a uint64 timestamp", () => {
    expect(find("IdentityRegistered", "event")).toEqual(
      expect.objectContaining({
        inputs: [
          { name: "didHash", type: "bytes32", indexed: true },
          { name: "controller", type: "address", indexed: true },
          { name: "timestamp", type: "uint64", indexed: false },
        ],
      }),
    );
  });

  it("decodes the Identity tuple with uint32 credentialCount and uint32 nonce", () => {
    const resolveIdentity = find("resolveIdentity", "function") as
      | {
          outputs: Array<{ components: Array<{ name: string; type: string }> }>;
        }
      | undefined;
    expect(resolveIdentity).toBeDefined();
    expect(resolveIdentity!.outputs[0].components).toEqual([
      { name: "didHash", type: "bytes32" },
      { name: "controller", type: "address" },
      { name: "createdAt", type: "uint64" },
      { name: "updatedAt", type: "uint64" },
      { name: "status", type: "uint8" },
      { name: "recoveryHash", type: "bytes32" },
      { name: "credentialCount", type: "uint32" },
      { name: "nonce", type: "uint32" },
    ]);
  });

  it("exposes the paused() view used by the registration pre-flight", () => {
    expect(find("paused", "function")).toEqual(
      expect.objectContaining({
        stateMutability: "view",
        inputs: [],
        outputs: [{ name: "", type: "bool" }],
      }),
    );
  });

  it("keeps registerIdentity(bytes32,bytes32) as the write the verifier binds to", () => {
    expect(find("registerIdentity", "function")).toEqual(
      expect.objectContaining({
        stateMutability: "nonpayable",
        inputs: [
          { name: "didHash", type: "bytes32" },
          { name: "recoveryHash", type: "bytes32" },
        ],
      }),
    );
  });
});
