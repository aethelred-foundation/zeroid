"use client";

import { useCallback } from "react";
import { useAccount, usePublicClient, useWriteContract } from "wagmi";
import { bufferGasLimit } from "@/lib/gas";

/**
 * Drop-in replacement for wagmi's `useWriteContract` that buffers the gas
 * limit before submitting.
 *
 * The Aethelred EVM's `eth_estimateGas` under-reports gas for
 * state-changing calls, so a raw wagmi write reverts out-of-gas. This
 * hook estimates the call, applies {@link bufferGasLimit}, and passes the
 * result as an explicit `gas` limit — unless the caller already set one.
 * If estimation itself reverts (a genuinely failing call), we fall
 * through to the normal write so wagmi surfaces the real revert reason
 * rather than masking it.
 */
export function useSafeWriteContract() {
  const { writeContractAsync, ...rest } = useWriteContract();
  const publicClient = usePublicClient();
  const { address } = useAccount();

  type WriteArgs = Parameters<typeof writeContractAsync>;

  const safeWriteContractAsync = useCallback(
    async (params: WriteArgs[0], options?: WriteArgs[1]) => {
      // Preserve the caller's exact arity: only forward `options` when the
      // caller passed it, so `writeContractAsync(params)` stays a 1-arg call.
      const forward = (p: WriteArgs[0]) =>
        options === undefined
          ? writeContractAsync(p)
          : writeContractAsync(p, options);

      if (params.gas === undefined && publicClient) {
        try {
          const estimate = await publicClient.estimateContractGas({
            address: params.address,
            abi: params.abi,
            functionName: params.functionName,
            args: params.args,
            value: params.value,
            account: params.account ?? address,
            // viem's estimateContractGas is strict on the abi/functionName
            // relation; the runtime shape is correct, so relax the compile check.
          } as Parameters<
            NonNullable<typeof publicClient>["estimateContractGas"]
          >[0]);
          return forward({ ...params, gas: bufferGasLimit(estimate) });
        } catch {
          // Estimation reverted — proceed with the plain write so wagmi/viem
          // reports the actual failure rather than us swallowing it.
        }
      }
      return forward(params);
    },
    [writeContractAsync, publicClient, address],
  );

  return { ...rest, writeContractAsync: safeWriteContractAsync };
}
