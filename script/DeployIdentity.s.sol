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
        uint64 votingPeriod = uint64(vm.envOr("ZEROID_VOTING_PERIOD", uint256(3 days)));
        uint256 quorum = vm.envOr("ZEROID_QUORUM", uint256(1));

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
    }
}
