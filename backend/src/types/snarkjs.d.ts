declare module "snarkjs" {
  export namespace groth16 {
    function verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
    function fullProve(
      input: Record<string, unknown>,
      wasmFile: string,
      zkeyFile: string,
    ): Promise<{ proof: unknown; publicSignals: string[] }>;
  }
  export namespace plonk {
    function verify(
      verificationKey: unknown,
      publicSignals: string[],
      proof: unknown,
    ): Promise<boolean>;
  }
  export namespace zKey {
    function exportVerificationKey(zkeyFile: string): Promise<unknown>;
  }
}
