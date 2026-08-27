// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {Script, console2} from "forge-std/Script.sol";
import {FeeRouter} from "../contracts/FeeRouter.sol";
import {ConditionalDisclosure} from "../contracts/ConditionalDisclosure.sol";

/**
 * @title DeploySupplemental
 * @notice Deploys ZeroID's OPTIONAL economic + compliance contracts to an
 *         Aethelred network. This is not the public-testnet identity-suite
 *         deployment. The canonical six-contract identity deployment is
 *         script/DeployIdentity.s.sol:DeployIdentity.
 *
 *         Configuration is read from the environment so the same script serves
 *         testnet and mainnet:
 *
 *           ZEROID_ADMIN                 admin (DEFAULT_ADMIN_ROLE + PAUSER_ROLE)
 *           ZEROID_BURN_SINK             protocol burn address
 *           ZEROID_CRUZIBLE_SINK         Cruzible staking sink
 *           ZEROID_BURN_BPS              burn share in bps (default 5000 = 50%)
 *           ZEROID_DISCLOSURE_THRESHOLD  compliance quorum size (default 2)
 *
 * Usage:
 *   forge script script/DeploySupplemental.s.sol:DeploySupplemental \
 *     --rpc-url $AETHELRED_RPC --broadcast --verify
 *
 * Post-deploy (admin), grant operational roles:
 *   FeeRouter: PAUSER_ROLE to the incident responders (admin already has it).
 *   ConditionalDisclosure: ESCROW_ISSUER_ROLE to the ZeroID backend signer,
 *     COMPLIANCE_OFFICER_ROLE to each quorum member, PAUSER_ROLE to responders.
 */
contract DeploySupplemental is Script {
    function run() external returns (FeeRouter feeRouter, ConditionalDisclosure disclosure) {
        address admin = vm.envAddress("ZEROID_ADMIN");
        address burnSink = vm.envAddress("ZEROID_BURN_SINK");
        address cruzibleSink = vm.envAddress("ZEROID_CRUZIBLE_SINK");
        uint256 burnBps = vm.envOr("ZEROID_BURN_BPS", uint256(5000));
        uint256 disclosureThreshold = vm.envOr("ZEROID_DISCLOSURE_THRESHOLD", uint256(2));

        vm.startBroadcast();
        feeRouter = new FeeRouter(admin, burnSink, cruzibleSink, burnBps);
        disclosure = new ConditionalDisclosure(admin, disclosureThreshold);
        vm.stopBroadcast();

        console2.log("FeeRouter deployed at:", address(feeRouter));
        console2.log("ConditionalDisclosure deployed at:", address(disclosure));
    }
}
