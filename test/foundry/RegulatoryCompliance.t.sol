// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import "./helpers/TestHelper.sol";

contract RegulatoryComplianceTest is TestHelper {
    RegulatoryCompliance public rc;

    bytes32 constant JURISDICTION_US = keccak256("US");
    bytes32 constant JURISDICTION_EU = keccak256("EU");
    bytes32 constant RULE_KYC = keccak256("rule:kyc");
    bytes32 constant RULE_AML = keccak256("rule:aml");
    bytes32 constant CRED_HASH = keccak256("cred:compliance:1");
    bytes32 constant REPORT_ID = keccak256("report:sar:1");

    function setUp() public {
        rc = new RegulatoryCompliance(admin);
    }

    function _registerUS() internal {
        vm.prank(admin);
        rc.registerJurisdiction(
            JURISDICTION_US,
            "US",
            "United States",
            RegulatoryCompliance.KYCLevel.Enhanced,
            false,
            RegulatoryCompliance.EIDASLevel.None,
            0
        );
    }

    function _registerEU() internal {
        vm.prank(admin);
        rc.registerJurisdiction(
            JURISDICTION_EU,
            "EU",
            "European Union",
            RegulatoryCompliance.KYCLevel.Basic,
            true,
            RegulatoryCompliance.EIDASLevel.Substantial,
            0
        );
    }

    // ════════════════════════════════════════════════════════════════
    // Deployment
    // ════════════════════════════════════════════════════════════════

    function test_Constructor_SetsRoles() public view {
        assertTrue(rc.hasRole(rc.DEFAULT_ADMIN_ROLE(), admin));
        assertTrue(rc.hasRole(rc.COMPLIANCE_OFFICER_ROLE(), admin));
        assertTrue(rc.hasRole(rc.JURISDICTION_ADMIN_ROLE(), admin));
        assertTrue(rc.hasRole(rc.SANCTIONS_ORACLE_ROLE(), admin));
        assertTrue(rc.hasRole(rc.TRAVEL_RULE_ROLE(), admin));
        assertTrue(rc.hasRole(rc.EIDAS_AUTHORITY_ROLE(), admin));
    }

    function test_InitialState() public view {
        assertEq(rc.totalAttestations(), 0);
        assertEq(rc.totalReports(), 0);
        assertEq(rc.totalTravelRuleTransfers(), 0);
    }

    function test_Constants() public view {
        assertEq(rc.DEFAULT_ATTESTATION_VALIDITY(), 365 days);
        assertEq(rc.FATF_TRAVEL_RULE_THRESHOLD(), 1000 ether);
        assertEq(rc.MAX_RULES_PER_JURISDICTION(), 50);
    }

    // ════════════════════════════════════════════════════════════════
    // Jurisdiction Management
    // ════════════════════════════════════════════════════════════════

    function test_RegisterJurisdiction_Success() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit RegulatoryCompliance.JurisdictionRegistered(JURISDICTION_US, "US", block.timestamp);
        rc.registerJurisdiction(
            JURISDICTION_US,
            "US",
            "United States",
            RegulatoryCompliance.KYCLevel.Enhanced,
            false,
            RegulatoryCompliance.EIDASLevel.None,
            0
        );

        RegulatoryCompliance.Jurisdiction memory j = rc.getJurisdiction(JURISDICTION_US);
        assertTrue(j.active);
        assertEq(j.travelRuleThreshold, 1000 ether); // default
    }

    function test_RegisterJurisdiction_RevertsDuplicate() public {
        _registerUS();

        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionAlreadyRegistered.selector);
        rc.registerJurisdiction(JURISDICTION_US, "US", "US", RegulatoryCompliance.KYCLevel.None, false, RegulatoryCompliance.EIDASLevel.None, 0);
    }

    function test_UpdateJurisdiction_Success() public {
        _registerUS();

        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit RegulatoryCompliance.JurisdictionUpdated(JURISDICTION_US, block.timestamp);
        rc.updateJurisdiction(
            JURISDICTION_US,
            RegulatoryCompliance.KYCLevel.Full,
            false,
            RegulatoryCompliance.EIDASLevel.None,
            2000 ether
        );

        RegulatoryCompliance.Jurisdiction memory j = rc.getJurisdiction(JURISDICTION_US);
        assertEq(uint8(j.minimumKYCLevel), uint8(RegulatoryCompliance.KYCLevel.Full));
        assertEq(j.travelRuleThreshold, 2000 ether);
    }

    function test_UpdateJurisdiction_RevertsNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionNotRegistered.selector);
        rc.updateJurisdiction(keccak256("unknown"), RegulatoryCompliance.KYCLevel.None, false, RegulatoryCompliance.EIDASLevel.None, 0);
    }

    // ════════════════════════════════════════════════════════════════
    // Compliance Rules
    // ════════════════════════════════════════════════════════════════

    function test_AddComplianceRule_Success() public {
        _registerUS();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit RegulatoryCompliance.ComplianceRuleAdded(JURISDICTION_US, RULE_KYC, "KYC", block.timestamp);
        rc.addComplianceRule(
            JURISDICTION_US,
            RULE_KYC,
            "KYC",
            "Know Your Customer",
            keccak256("type:kyc"),
            365 days,
            true
        );

        RegulatoryCompliance.ComplianceRule memory rule = rc.getRule(JURISDICTION_US, RULE_KYC);
        assertTrue(rule.active);
        assertTrue(rule.mandatory);
    }

    function test_AddComplianceRule_RevertsJurisdictionNotRegistered() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionNotRegistered.selector);
        rc.addComplianceRule(keccak256("bad"), RULE_KYC, "KYC", "desc", bytes32(0), 0, true);
    }

    function test_AddComplianceRule_RevertsDuplicate() public {
        _registerUS();

        vm.prank(admin);
        rc.addComplianceRule(JURISDICTION_US, RULE_KYC, "KYC", "desc", bytes32(0), 0, true);

        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.RuleAlreadyExists.selector);
        rc.addComplianceRule(JURISDICTION_US, RULE_KYC, "KYC", "desc", bytes32(0), 0, true);
    }

    // ════════════════════════════════════════════════════════════════
    // Compliance Attestations
    // ════════════════════════════════════════════════════════════════

    function test_IssueComplianceAttestation_Success() public {
        _registerUS();

        bytes32[] memory rules = new bytes32[](0);

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit RegulatoryCompliance.ComplianceAttestationIssued(
            CRED_HASH, JURISDICTION_US, RegulatoryCompliance.ComplianceStatus.Compliant, block.timestamp
        );
        rc.issueComplianceAttestation(
            CRED_HASH,
            JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"),
            RegulatoryCompliance.KYCLevel.Enhanced,
            rules,
            0
        );

        assertEq(rc.totalAttestations(), 1);
    }

    function test_IssueComplianceAttestation_RevertsInvalidKYCLevel() public {
        _registerUS();

        bytes32[] memory rules = new bytes32[](0);

        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.InvalidKYCLevel.selector);
        rc.issueComplianceAttestation(
            CRED_HASH,
            JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"),
            RegulatoryCompliance.KYCLevel.Basic, // Below Enhanced minimum
            rules,
            0
        );
    }

    function test_IssueComplianceAttestation_JurisdictionNotActive() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionNotActive.selector);
        rc.issueComplianceAttestation(
            CRED_HASH,
            keccak256("unknown"),
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"),
            RegulatoryCompliance.KYCLevel.Full,
            new bytes32[](0),
            0
        );
    }

    function test_CheckCompliance_Compliant() public {
        _registerUS();
        bytes32[] memory rules = new bytes32[](0);

        vm.prank(admin);
        rc.issueComplianceAttestation(
            CRED_HASH, JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"), RegulatoryCompliance.KYCLevel.Enhanced, rules, 0
        );

        (
            RegulatoryCompliance.ComplianceStatus status,
            RegulatoryCompliance.KYCLevel kycLevel,
            uint256 expiresAt,
            bool valid
        ) = rc.checkCompliance(CRED_HASH, JURISDICTION_US);

        assertEq(uint8(status), uint8(RegulatoryCompliance.ComplianceStatus.Compliant));
        assertEq(uint8(kycLevel), uint8(RegulatoryCompliance.KYCLevel.Enhanced));
        assertGt(expiresAt, block.timestamp);
        assertTrue(valid);
    }

    function test_CheckCompliance_Expired() public {
        _registerUS();
        bytes32[] memory rules = new bytes32[](0);

        vm.prank(admin);
        rc.issueComplianceAttestation(
            CRED_HASH, JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"), RegulatoryCompliance.KYCLevel.Enhanced, rules, 1 days
        );

        vm.warp(block.timestamp + 2 days);

        (, , , bool valid) = rc.checkCompliance(CRED_HASH, JURISDICTION_US);
        assertFalse(valid);
    }

    function test_CheckMultiJurisdictionCompliance() public {
        _registerUS();
        _registerEU();

        bytes32[] memory rules = new bytes32[](0);

        vm.prank(admin);
        rc.issueComplianceAttestation(
            CRED_HASH, JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"), RegulatoryCompliance.KYCLevel.Enhanced, rules, 0
        );

        bytes32[] memory jurisdictions = new bytes32[](2);
        jurisdictions[0] = JURISDICTION_US;
        jurisdictions[1] = JURISDICTION_EU;

        (uint256 compliantCount, RegulatoryCompliance.ComplianceStatus[] memory results) =
            rc.checkMultiJurisdictionCompliance(CRED_HASH, jurisdictions);

        assertEq(compliantCount, 1);
        assertEq(uint8(results[0]), uint8(RegulatoryCompliance.ComplianceStatus.Compliant));
        assertEq(uint8(results[1]), uint8(RegulatoryCompliance.ComplianceStatus.Unknown));
    }

    // ════════════════════════════════════════════════════════════════
    // Regulatory Reporting
    // ════════════════════════════════════════════════════════════════

    function test_CommitReport_Success() public {
        _registerUS();

        vm.prank(admin);
        vm.expectEmit(true, true, false, true);
        emit RegulatoryCompliance.RegulatoryReportCommitted(
            REPORT_ID, JURISDICTION_US, keccak256("report_data"), block.timestamp
        );
        rc.commitReport(REPORT_ID, JURISDICTION_US, keccak256("report_data"), "SAR", 1000, 2000);

        assertEq(rc.totalReports(), 1);

        RegulatoryCompliance.RegulatoryReport memory report = rc.getReport(REPORT_ID);
        assertEq(report.reportHash, keccak256("report_data"));
    }

    function test_CommitReport_RevertsDuplicate() public {
        _registerUS();

        vm.prank(admin);
        rc.commitReport(REPORT_ID, JURISDICTION_US, keccak256("data"), "SAR", 1000, 2000);

        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.ReportAlreadySubmitted.selector);
        rc.commitReport(REPORT_ID, JURISDICTION_US, keccak256("data2"), "CTR", 1000, 2000);
    }

    function test_CommitReport_RevertsJurisdictionNotActive() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionNotActive.selector);
        rc.commitReport(REPORT_ID, keccak256("unknown"), keccak256("data"), "SAR", 1000, 2000);
    }

    // ════════════════════════════════════════════════════════════════
    // Sanctions Screening
    // ════════════════════════════════════════════════════════════════

    function test_UpdateSanctionsList_Success() public {
        _registerUS();

        bytes32 merkleRoot = keccak256("sanctions_root");
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit RegulatoryCompliance.SanctionsListUpdated(JURISDICTION_US, merkleRoot, 1000, block.timestamp);
        rc.updateSanctionsList(JURISDICTION_US, merkleRoot, 1000, keccak256("OFAC"));

        RegulatoryCompliance.SanctionsList memory sl = rc.getSanctionsList(JURISDICTION_US);
        assertEq(sl.merkleRoot, merkleRoot);
        assertEq(sl.listSize, 1000);
    }

    function test_UpdateSanctionsList_RevertsJurisdictionNotActive() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.JurisdictionNotActive.selector);
        rc.updateSanctionsList(keccak256("bad"), keccak256("root"), 100, keccak256("src"));
    }

    function test_ScreenSanctions_NoHit() public {
        _registerUS();

        vm.prank(admin);
        rc.updateSanctionsList(JURISDICTION_US, keccak256("root"), 100, keccak256("OFAC"));

        bytes32[] memory proof = new bytes32[](0);
        // Empty proof won't match the root, so no hit
        bool hit = rc.screenSanctions(keccak256("subject"), JURISDICTION_US, proof);
        assertFalse(hit);
    }

    // ════════════════════════════════════════════════════════════════
    // Travel Rule
    // ════════════════════════════════════════════════════════════════

    function test_RecordTravelRuleTransfer_BelowThreshold() public {
        _registerUS();
        _registerEU();

        vm.prank(admin);
        bytes32 transferId = rc.recordTravelRuleTransfer(
            keccak256("originator"),
            keccak256("beneficiary"),
            JURISDICTION_US,
            JURISDICTION_EU,
            500 ether, // below 1000 ether threshold
            keccak256("vasp_orig"),
            keccak256("vasp_bene")
        );

        assertEq(rc.totalTravelRuleTransfers(), 1);
        RegulatoryCompliance.TravelRuleRecord memory t = rc.getTravelRuleTransfer(transferId);
        assertTrue(t.compliant); // below threshold = compliant
    }

    function test_RecordTravelRuleTransfer_RevertsInvalidJurisdiction() public {
        _registerUS();

        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.InvalidJurisdictionPair.selector);
        rc.recordTravelRuleTransfer(
            keccak256("o"), keccak256("b"),
            JURISDICTION_US, keccak256("unknown"),
            1500 ether,
            keccak256("v1"), keccak256("v2")
        );
    }

    // ════════════════════════════════════════════════════════════════
    // eIDAS 2.0
    // ════════════════════════════════════════════════════════════════

    function test_MarkEIDASCredential_Success() public {
        vm.prank(admin);
        vm.expectEmit(true, false, false, true);
        emit RegulatoryCompliance.EIDASCredentialMarked(
            CRED_HASH, RegulatoryCompliance.EIDASLevel.High, keccak256("trusted_list"), block.timestamp
        );
        rc.markEIDASCredential(
            CRED_HASH,
            RegulatoryCompliance.EIDASLevel.High,
            keccak256("trusted_list"),
            keccak256("issuer"),
            365 days
        );

        RegulatoryCompliance.EIDASMarker memory marker = rc.getEIDASMarker(CRED_HASH);
        assertTrue(marker.active);
        assertEq(uint8(marker.level), uint8(RegulatoryCompliance.EIDASLevel.High));
    }

    function test_MarkEIDASCredential_RevertsNoneLevel() public {
        vm.prank(admin);
        vm.expectRevert(RegulatoryCompliance.InvalidEIDASLevel.selector);
        rc.markEIDASCredential(
            CRED_HASH, RegulatoryCompliance.EIDASLevel.None, keccak256("tl"), keccak256("i"), 0
        );
    }

    function test_CheckEIDAS_Valid() public {
        vm.prank(admin);
        rc.markEIDASCredential(
            CRED_HASH, RegulatoryCompliance.EIDASLevel.High, keccak256("tl"), keccak256("i"), 365 days
        );

        (bool valid, RegulatoryCompliance.EIDASLevel level) =
            rc.checkEIDAS(CRED_HASH, RegulatoryCompliance.EIDASLevel.Substantial);
        assertTrue(valid);
        assertEq(uint8(level), uint8(RegulatoryCompliance.EIDASLevel.High));
    }

    function test_CheckEIDAS_InvalidBelowLevel() public {
        vm.prank(admin);
        rc.markEIDASCredential(
            CRED_HASH, RegulatoryCompliance.EIDASLevel.Low, keccak256("tl"), keccak256("i"), 365 days
        );

        (bool valid, ) = rc.checkEIDAS(CRED_HASH, RegulatoryCompliance.EIDASLevel.High);
        assertFalse(valid);
    }

    function test_CheckEIDAS_InvalidExpired() public {
        vm.prank(admin);
        rc.markEIDASCredential(
            CRED_HASH, RegulatoryCompliance.EIDASLevel.High, keccak256("tl"), keccak256("i"), 1 days
        );

        vm.warp(block.timestamp + 2 days);

        (bool valid, ) = rc.checkEIDAS(CRED_HASH, RegulatoryCompliance.EIDASLevel.Low);
        assertFalse(valid);
    }

    // ════════════════════════════════════════════════════════════════
    // View Functions
    // ════════════════════════════════════════════════════════════════

    function test_GetJurisdictionRuleIds() public {
        _registerUS();

        vm.prank(admin);
        rc.addComplianceRule(JURISDICTION_US, RULE_KYC, "KYC", "desc", bytes32(0), 0, true);

        bytes32[] memory ruleIds = rc.getJurisdictionRuleIds(JURISDICTION_US);
        assertEq(ruleIds.length, 1);
        assertEq(ruleIds[0], RULE_KYC);
    }

    // ════════════════════════════════════════════════════════════════
    // Pause
    // ════════════════════════════════════════════════════════════════

    function test_Pause_BlocksAttestations() public {
        _registerUS();

        vm.prank(admin);
        rc.pause();

        vm.prank(admin);
        vm.expectRevert();
        rc.issueComplianceAttestation(
            CRED_HASH, JURISDICTION_US,
            RegulatoryCompliance.ComplianceStatus.Compliant,
            keccak256("att"), RegulatoryCompliance.KYCLevel.Enhanced, new bytes32[](0), 0
        );
    }
}
