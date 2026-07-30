// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";

import {ZeroID} from "../contracts/ZeroID.sol";
import {ZKCredentialVerifier} from "../contracts/ZKCredentialVerifier.sol";
import {AccumulatorRevocation} from "../contracts/AccumulatorRevocation.sol";
import {GovernanceModule} from "../contracts/GovernanceModule.sol";
import {CredentialRegistry} from "../contracts/CredentialRegistry.sol";
import {SelectiveDisclosure} from "../contracts/SelectiveDisclosure.sol";

/**
 * @title DeployIdentity
 * @notice Deploys ZeroID's CORE identity suite — the contracts the frontend
 *         reads (see src/config/constants.ts) — to an Aethelred network in
 *         dependency order:
 *
 *           ZeroID (identity registry)      <- admin
 *           ZKCredentialVerifier            <- admin
 *           AccumulatorRevocation           <- admin
 *           GovernanceModule                <- admin, votingPeriod, quorum
 *           CredentialRegistry              <- admin, identity, governance
 *           SelectiveDisclosure             <- admin, credentials, zkVerifier
 *
 *         Config is read from the environment so the same script serves testnet
 *         and mainnet:
 *           PRIVATE_KEY              deployer (hex). Admin defaults to this address.
 *           ZEROID_ADMIN            (optional) DEFAULT_ADMIN_ROLE holder
 *           ZEROID_VOTING_PERIOD    (optional) governance voting period, seconds (default 3 days)
 *           ZEROID_QUORUM           (optional) governance quorum (default 1)
 *           ZEROID_EXPECTED_CHAIN_ID (optional) abort if the RPC reports another chain
 *           ZEROID_WRITE_MANIFEST   (optional; default false) write deployments/<chainId>.json
 *
 * Usage (testnet):
 *   PRIVATE_KEY=0x<funded> forge script script/DeployIdentity.s.sol:DeployIdentity \
 *     --rpc-url http://<validator-ip>:8545 --broadcast --legacy --slow
 *
 * The run prints every address in NEXT_PUBLIC_* form, ready to paste into the
 * frontend .env. The AETHEL token is the chain's NATIVE coin (precisebank), not
 * an ERC-20, and there is no standalone TEE-attestation contract in this suite,
 * so NEXT_PUBLIC_AETHEL_TOKEN_ADDRESS / NEXT_PUBLIC_TEE_ATTESTATION_ADDRESS are
 * intentionally left unset here.
 */
contract DeployIdentity is Script {
    function run()
        external
        returns (
            ZeroID identity,
            ZKCredentialVerifier zkVerifier,
            AccumulatorRevocation revocation,
            GovernanceModule governance,
            CredentialRegistry credentials,
            SelectiveDisclosure disclosure
        )
    {
        uint256 deployerKey = vm.envUint("PRIVATE_KEY");
        address deployer = vm.addr(deployerKey);
        address admin = vm.envOr("ZEROID_ADMIN", deployer);
        uint256 expectedChainId = vm.envOr("ZEROID_EXPECTED_CHAIN_ID", block.chainid);
        require(block.chainid == expectedChainId, "RPC chain ID does not match ZEROID_EXPECTED_CHAIN_ID");

        uint64 votingPeriod = uint64(vm.envOr("ZEROID_VOTING_PERIOD", uint256(3 days)));
        uint256 quorum = vm.envOr("ZEROID_QUORUM", uint256(1));

        // The admin receives DEFAULT_ADMIN_ROLE + every operational role on all
        // six contracts — it is total authority. Keeping it separate from the
        // (hot, gas-paying) deployer is the point of ZEROID_ADMIN. Refuse to
        // silently make a throwaway deployer the permanent admin.
        if (admin == deployer) {
            console2.log("");
            console2.log("!! WARNING: ZEROID_ADMIN is unset, so the deployer becomes admin of ALL");
            console2.log("!! contracts (upgrade/pause/role authority). Set ZEROID_ADMIN to a durable");
            console2.log("!! governance account (a multisig for mainnet). See deployments/README.md.");
            require(
                vm.envOr("ZEROID_ALLOW_DEPLOYER_ADMIN", false),
                "Set ZEROID_ADMIN to a durable account, or ZEROID_ALLOW_DEPLOYER_ADMIN=true to accept deployer-as-admin (testnet only)."
            );
        }

        vm.startBroadcast(deployerKey);

        identity = new ZeroID(admin);
        zkVerifier = new ZKCredentialVerifier(admin);
        revocation = new AccumulatorRevocation(admin);
        governance = new GovernanceModule(admin, votingPeriod, quorum);
        credentials = new CredentialRegistry(admin, address(identity), address(governance));
        disclosure = new SelectiveDisclosure(admin, address(credentials), address(zkVerifier));

        vm.stopBroadcast();

        console2.log("");
        console2.log("== ZeroID core identity suite deployed (admin: %s) ==", admin);
        console2.log("NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=%s", address(identity));
        console2.log("NEXT_PUBLIC_ZK_VERIFIER_ADDRESS=%s", address(zkVerifier));
        console2.log("NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS=%s", address(revocation));
        console2.log("NEXT_PUBLIC_GOVERNANCE_MODULE_ADDRESS=%s", address(governance));
        console2.log("NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS=%s", address(credentials));
        console2.log("NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS=%s", address(disclosure));

        if (vm.envOr("ZEROID_WRITE_MANIFEST", false)) {
            _writeManifest(
                admin,
                deployer,
                address(identity),
                address(zkVerifier),
                address(revocation),
                address(governance),
                address(credentials),
                address(disclosure)
            );
        } else {
            console2.log("");
            console2.log("Deployment manifest not written (ZEROID_WRITE_MANIFEST is false).");
        }
    }

    /// @dev Record the deployment as a committed source of truth in
    ///      deployments/<chainId>.json (not a paste in someone's .env).
    function _writeManifest(
        address admin,
        address deployer,
        address identity,
        address zkVerifier,
        address revocation,
        address governance,
        address credentials,
        address disclosure
    ) private {
        string memory j = "zeroid-deployment";
        vm.serializeUint(j, "chainId", block.chainid);
        vm.serializeUint(j, "blockNumber", block.number);
        vm.serializeUint(j, "timestamp", block.timestamp);
        vm.serializeAddress(j, "admin", admin);
        vm.serializeAddress(j, "deployer", deployer);
        vm.serializeAddress(j, "identityRegistry", identity);
        vm.serializeAddress(j, "zkVerifier", zkVerifier);
        vm.serializeAddress(j, "accumulatorRevocation", revocation);
        vm.serializeAddress(j, "governanceModule", governance);
        vm.serializeAddress(j, "credentialRegistry", credentials);
        string memory out = vm.serializeAddress(j, "selectiveDisclosure", disclosure);
        string memory path = string.concat("deployments/", vm.toString(block.chainid), ".json");
        vm.writeJson(out, path);
        console2.log("\nDeployment manifest written to %s", path);
    }
}
