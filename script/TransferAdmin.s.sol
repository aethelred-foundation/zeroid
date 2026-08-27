// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {IAccessControl} from "@openzeppelin/contracts/access/IAccessControl.sol";

import {ZeroID} from "../contracts/ZeroID.sol";
import {ZKCredentialVerifier} from "../contracts/ZKCredentialVerifier.sol";
import {AccumulatorRevocation} from "../contracts/AccumulatorRevocation.sol";
import {GovernanceModule} from "../contracts/GovernanceModule.sol";
import {CredentialRegistry} from "../contracts/CredentialRegistry.sol";
import {SelectiveDisclosure} from "../contracts/SelectiveDisclosure.sol";

/**
 * @title TransferAdmin
 * @notice Migrates ALL roles on the six core identity contracts from the current
 *         admin (e.g. the deployer, when ZEROID_ADMIN was left unset) to a
 *         durable governance account, then renounces the current admin's roles —
 *         a clean, no-redeploy handover using OpenZeppelin AccessControl.
 *
 *         Run by the CURRENT admin (the account that holds DEFAULT_ADMIN_ROLE):
 *           ZEROID_CURRENT_ADMIN_KEY   current admin private key (the deployer)
 *           ZEROID_NEW_ADMIN           the durable governance account (multisig on mainnet)
 *
 *         Contract addresses (from deployments/<chainId>.json or the deploy log):
 *           NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS, NEXT_PUBLIC_ZK_VERIFIER_ADDRESS,
 *           NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS, NEXT_PUBLIC_GOVERNANCE_MODULE_ADDRESS,
 *           NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS, NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS
 *
 * Usage:
 *   ZEROID_CURRENT_ADMIN_KEY=0x<deployer-key> ZEROID_NEW_ADMIN=0x<governance> \
 *   NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS=0x.. ... (all six) \
 *   forge script script/TransferAdmin.s.sol:TransferAdmin \
 *     --rpc-url http://<validator-ip>:8545 --broadcast --legacy --slow
 */
contract TransferAdmin is Script {
    bytes32 constant DEFAULT_ADMIN_ROLE = 0x00;

    function run() external {
        uint256 currentKey = vm.envUint("ZEROID_CURRENT_ADMIN_KEY");
        address from = vm.addr(currentKey);
        address to = vm.envAddress("ZEROID_NEW_ADMIN");
        require(to != address(0) && to != from, "ZEROID_NEW_ADMIN must be a distinct, non-zero account");

        ZeroID identity = ZeroID(vm.envAddress("NEXT_PUBLIC_IDENTITY_REGISTRY_ADDRESS"));
        ZKCredentialVerifier zk = ZKCredentialVerifier(vm.envAddress("NEXT_PUBLIC_ZK_VERIFIER_ADDRESS"));
        AccumulatorRevocation rev = AccumulatorRevocation(vm.envAddress("NEXT_PUBLIC_ACCUMULATOR_REVOCATION_ADDRESS"));
        GovernanceModule gov = GovernanceModule(vm.envAddress("NEXT_PUBLIC_GOVERNANCE_MODULE_ADDRESS"));
        CredentialRegistry cred = CredentialRegistry(vm.envAddress("NEXT_PUBLIC_CREDENTIAL_REGISTRY_ADDRESS"));
        SelectiveDisclosure disc = SelectiveDisclosure(vm.envAddress("NEXT_PUBLIC_SELECTIVE_DISCLOSURE_ADDRESS"));

        console2.log("Transferring admin from %s to %s", from, to);

        vm.startBroadcast(currentKey);

        // Grant every role to the new admin, then renounce it from the old admin.
        // Order matters: grant DEFAULT_ADMIN_ROLE to `to` first so it can manage
        // roles, and renounce the old admin's DEFAULT_ADMIN_ROLE LAST.
        bytes32[4] memory idRoles = [DEFAULT_ADMIN_ROLE, identity.ADMIN_ROLE(), identity.GOVERNANCE_ROLE(), identity.OPERATOR_ROLE()];
        _migrate(address(identity), idRoles, from, to);

        bytes32[4] memory zkRoles = [DEFAULT_ADMIN_ROLE, zk.ADMIN_ROLE(), zk.GOVERNANCE_ROLE(), zk.CIRCUIT_MANAGER_ROLE()];
        _migrate(address(zk), zkRoles, from, to);

        bytes32[3] memory revRoles = [DEFAULT_ADMIN_ROLE, rev.REVOCATION_AUTHORITY_ROLE(), rev.WITNESS_UPDATER_ROLE()];
        _migrate3(address(rev), revRoles, from, to);

        bytes32[4] memory govRoles = [DEFAULT_ADMIN_ROLE, gov.ADMIN_ROLE(), gov.GOVERNANCE_ROLE(), gov.VOTER_ROLE()];
        _migrate(address(gov), govRoles, from, to);

        bytes32[4] memory credRoles = [DEFAULT_ADMIN_ROLE, cred.ADMIN_ROLE(), cred.ISSUER_ROLE(), cred.GOVERNANCE_ROLE()];
        _migrate(address(cred), credRoles, from, to);

        bytes32[4] memory discRoles = [DEFAULT_ADMIN_ROLE, disc.ADMIN_ROLE(), disc.VERIFIER_ROLE(), disc.GOVERNANCE_ROLE()];
        _migrate(address(disc), discRoles, from, to);

        vm.stopBroadcast();

        console2.log("Admin migration complete. Update deployments/<chainId>.json admin -> %s", to);
    }

    function _migrate(address target, bytes32[4] memory roles, address from, address to) private {
        IAccessControl ac = IAccessControl(target);
        for (uint256 i = 0; i < roles.length; i++) ac.grantRole(roles[i], to);
        // Renounce from old admin — DEFAULT_ADMIN_ROLE (index 0) last.
        for (uint256 i = roles.length; i > 0; i--) {
            if (ac.hasRole(roles[i - 1], from)) ac.renounceRole(roles[i - 1], from);
        }
    }

    function _migrate3(address target, bytes32[3] memory roles, address from, address to) private {
        IAccessControl ac = IAccessControl(target);
        for (uint256 i = 0; i < roles.length; i++) ac.grantRole(roles[i], to);
        for (uint256 i = roles.length; i > 0; i--) {
            if (ac.hasRole(roles[i - 1], from)) ac.renounceRole(roles[i - 1], from);
        }
    }
}
