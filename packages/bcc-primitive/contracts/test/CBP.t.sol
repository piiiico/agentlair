// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.26;

import "forge-std/Test.sol";
import "../src/CBP.sol";

contract CBPTest is Test {
    CBP public cbp;
    address public alice = makeAddr("alice");
    address public bob   = makeAddr("bob");

    bytes32 constant SUBJECT_DID  = keccak256(abi.encodePacked("did:web:agentlair.dev:agents:acc_xyz"));
    bytes32 constant SUBJECT_REPO = keccak256(abi.encodePacked("github_repo:piiiico/agentlair"));

    function setUp() public {
        cbp = new CBP();
        vm.deal(alice, 100 ether);
        vm.deal(bob,   100 ether);
    }

    // -------------------------------------------------------------------------
    // Core invariant: lock-then-read returns Active
    // -------------------------------------------------------------------------

    function test_lockThenReadReturnsActive() public {
        vm.prank(alice);
        uint256 bondId = cbp.lock{value: 1 ether}(365 days, SUBJECT_DID);

        CBP.SlashingState state = cbp.readSlashingState(bondId);
        assertEq(uint8(state), uint8(CBP.SlashingState.Active), "should be Active");
    }

    // -------------------------------------------------------------------------
    // Zero-amount revert
    // -------------------------------------------------------------------------

    function test_lockZeroAmountReverts() public {
        vm.prank(alice);
        vm.expectRevert(CBP.ZeroAmount.selector);
        cbp.lock{value: 0}(365 days, SUBJECT_DID);
    }

    // -------------------------------------------------------------------------
    // Zero-term revert
    // -------------------------------------------------------------------------

    function test_lockZeroTermReverts() public {
        vm.prank(alice);
        vm.expectRevert(CBP.ZeroTerm.selector);
        cbp.lock{value: 1 ether}(0, SUBJECT_DID);
    }

    // -------------------------------------------------------------------------
    // Bond ID is unique per mint
    // -------------------------------------------------------------------------

    function test_bondIdUniquePerMint() public {
        vm.startPrank(alice);

        uint256 id1 = cbp.lock{value: 1 ether}(30 days, SUBJECT_DID);
        uint256 id2 = cbp.lock{value: 1 ether}(60 days, SUBJECT_DID);
        uint256 id3 = cbp.lock{value: 1 ether}(90 days, SUBJECT_REPO);

        vm.stopPrank();

        assertTrue(id1 != id2, "id1 and id2 must differ");
        assertTrue(id2 != id3, "id2 and id3 must differ");
        assertTrue(id1 != id3, "id1 and id3 must differ");
    }

    // -------------------------------------------------------------------------
    // Bond IDs increment monotonically from 1
    // -------------------------------------------------------------------------

    function test_bondIdsMonotonic() public {
        vm.startPrank(alice);
        uint256 first  = cbp.lock{value: 1 ether}(30 days, SUBJECT_DID);
        uint256 second = cbp.lock{value: 1 ether}(30 days, SUBJECT_DID);
        vm.stopPrank();

        assertEq(first,  1, "first bond should be id=1");
        assertEq(second, 2, "second bond should be id=2");
    }

    // -------------------------------------------------------------------------
    // Expired after term elapses
    // -------------------------------------------------------------------------

    function test_bondExpiredAfterTerm() public {
        vm.prank(alice);
        uint256 bondId = cbp.lock{value: 1 ether}(7 days, SUBJECT_DID);

        // Fast-forward past term
        vm.warp(block.timestamp + 8 days);

        CBP.SlashingState state = cbp.readSlashingState(bondId);
        assertEq(uint8(state), uint8(CBP.SlashingState.Expired), "should be Expired");
    }

    // -------------------------------------------------------------------------
    // Slashed state after slash()
    // -------------------------------------------------------------------------

    function test_slashTransitionsToSlashed() public {
        vm.prank(alice);
        uint256 bondId = cbp.lock{value: 1 ether}(365 days, SUBJECT_DID);

        // v0: anyone can slash (no access control)
        vm.expectEmit(true, false, false, true);
        emit CBP.BondSlashed(bondId, "test_slash", 1 ether);
        cbp.slash(bondId, "test_slash");

        CBP.SlashingState state = cbp.readSlashingState(bondId);
        assertEq(uint8(state), uint8(CBP.SlashingState.Slashed), "should be Slashed");
    }

    // -------------------------------------------------------------------------
    // Withdraw after expiry returns ETH
    // -------------------------------------------------------------------------

    function test_withdrawAfterExpiry() public {
        uint256 initial = alice.balance;

        vm.prank(alice);
        uint256 bondId = cbp.lock{value: 1 ether}(7 days, SUBJECT_DID);

        vm.warp(block.timestamp + 8 days);

        vm.prank(alice);
        cbp.withdraw(bondId);

        assertEq(alice.balance, initial, "alice should recover locked ETH");
    }

    // -------------------------------------------------------------------------
    // Cannot read non-existent bond
    // -------------------------------------------------------------------------

    function test_readNonExistentBondReverts() public {
        vm.expectRevert(CBP.BondNotFound.selector);
        cbp.readSlashingState(9999);
    }

    // -------------------------------------------------------------------------
    // BondMinted event is emitted correctly
    // -------------------------------------------------------------------------

    function test_bondMintedEventEmitted() public {
        vm.prank(alice);
        vm.expectEmit(true, true, true, true);
        emit CBP.BondMinted(1, alice, SUBJECT_DID, 1 ether, 30 days);
        cbp.lock{value: 1 ether}(30 days, SUBJECT_DID);
    }

    // -------------------------------------------------------------------------
    // Polymorphic subjectId — multiple encoding conventions work in same contract
    // -------------------------------------------------------------------------

    function test_polymorphicSubjectIds() public {
        bytes32 agentSubject   = keccak256(abi.encodePacked("did:web:agentlair.dev:agents:acc_test"));
        bytes32 humanSubject   = keccak256(abi.encodePacked("worldid:0xdeadbeef"));
        bytes32 repoSubject    = keccak256(abi.encodePacked("github_repo:example/repo"));
        bytes32 businessSubject = keccak256(abi.encodePacked("brreg:123456789"));
        bytes32 npmSubject     = keccak256(abi.encodePacked("npm:@agentlair/bcc-primitive"));

        vm.startPrank(alice);
        uint256 id1 = cbp.lock{value: 0.1 ether}(30 days, agentSubject);
        uint256 id2 = cbp.lock{value: 0.1 ether}(30 days, humanSubject);
        uint256 id3 = cbp.lock{value: 0.1 ether}(30 days, repoSubject);
        uint256 id4 = cbp.lock{value: 0.1 ether}(30 days, businessSubject);
        uint256 id5 = cbp.lock{value: 0.1 ether}(30 days, npmSubject);
        vm.stopPrank();

        assertEq(uint8(cbp.readSlashingState(id1)), uint8(CBP.SlashingState.Active));
        assertEq(uint8(cbp.readSlashingState(id2)), uint8(CBP.SlashingState.Active));
        assertEq(uint8(cbp.readSlashingState(id3)), uint8(CBP.SlashingState.Active));
        assertEq(uint8(cbp.readSlashingState(id4)), uint8(CBP.SlashingState.Active));
        assertEq(uint8(cbp.readSlashingState(id5)), uint8(CBP.SlashingState.Active));
    }
}
