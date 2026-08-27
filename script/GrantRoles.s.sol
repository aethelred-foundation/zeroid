// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {CredentialRegistry} from "../contracts/CredentialRegistry.sol";
import {ZKCredentialVerifier} from "../contracts/ZKCredentialVerifier.sol";
import {AccumulatorRevocation} from "../contracts/AccumulatorRevocation.sol";

/**
 * @title GrantRoles
 * @notice Grants the CORE identity suite's operational roles to their real
 *         actors, AFTER those actors exist. Run by the ADMIN (the account that
 *         holds DEFAULT_ADMIN_ROLE from DeployIdentity), NOT the deployer.
 *
 *         Each role is granted only if its actor env var is set, so this script
 *         is safe to re-run as actors come online:
 *           ZEROID_BACKEND_SIGNER        -> CredentialRegistry.ISSUER_ROLE
 *                                           (the backend credential signer)
 *           ZEROID_CIRCUIT_MANAGER       -> ZKCredentialVerifier.CIRCUIT_MANAGER_ROLE
 *                                           (registers the trusted-setup vkeys)
 *           ZEROID_REVOCATION_AUTHORITY  -> AccumulatorRevocation.REVOCATION_AUTHORITY_ROLE
 *
 *         Contract addresses come from the deployment (paste them or export from
 *         deployments/<chainId>.json):
 *           NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS
 *           NEXT_PUBLIC_ZK_VERIFIER_ADDRESS
 *           NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS
 *
 * Usage:
 *   ZEROID_ADMIN_KEY=0x<admin-key> \
 *   NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS=0x.. NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=0x.. \
 *   NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS=0x.. \
 *   ZEROID_BACKEND_SIGNER=0x.. [ZEROID_CIRCUIT_MANAGER=0x..] [ZEROID_REVOCATION_AUTHORITY=0x..] \
 *   forge script script/GrantRoles.s.sol:GrantRoles --rpc-url <rpc> --broadcast --legacy --slow
 */
contract GrantRoles is Script {
    function run() external {
        uint256 adminKey = vm.envUint("ZEROID_ADMIN_KEY");

        address backendSigner = vm.envOr("ZEROID_BACKEND_SIGNER", address(0));
        address circuitManager = vm.envOr("ZEROID_CIRCUIT_MANAGER", address(0));
        address revocationAuthority = vm.envOr("ZEROID_REVOCATION_AUTHORITY", address(0));

        vm.startBroadcast(adminKey);

        if (backendSigner != address(0)) {
            CredentialRegistry reg = CredentialRegistry(vm.envAddress("NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS"));
            reg.grantRole(reg.ISSUER_ROLE(), backendSigner);
            console2.log("granted CredentialRegistry.ISSUER_ROLE to %s", backendSigner);
        }

        if (circuitManager != address(0)) {
            ZKCredentialVerifier vk = ZKCredentialVerifier(vm.envAddress("NEXT_PUBLIC_ZK_VERIFIER_ADDRESS"));
            vk.grantRole(vk.CIRCUIT_MANAGER_ROLE(), circuitManager);
            console2.log("granted ZKCredentialVerifier.CIRCUIT_MANAGER_ROLE to %s", circuitManager);
        }

        if (revocationAuthority != address(0)) {
            AccumulatorRevocation rev = AccumulatorRevocation(vm.envAddress("NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS"));
            rev.grantRole(rev.REVOCATION_AUTHORITY_ROLE(), revocationAuthority);
            console2.log("granted AccumulatorRevocation.REVOCATION_AUTHORITY_ROLE to %s", revocationAuthority);
        }

        vm.stopBroadcast();
    }
}
