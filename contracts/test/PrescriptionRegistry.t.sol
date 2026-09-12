// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {
    IPrescriptionRegistry,
    PrescriptionRecord,
    PrescriptionStatus
} from "../src/IPrescriptionRegistry.sol";
import {RegistryFixture} from "./helpers/RegistryFixture.sol";

contract PrescriptionRegistryTest is RegistryFixture {
    address internal constant PRESCRIBER = address(0xA11CE);
    address internal constant PHARMACY_A = address(0xB0B);
    address internal constant PHARMACY_B = address(0xCAFE);

    /// @dev keccak256 of the ciphertext. No clinical content ever reaches here.
    bytes32 internal constant CONTENT_HASH = keccak256("ciphertext-bytes");
    /// @dev keccak256(patientId, salt), with a salt unique to this prescription.
    bytes32 internal constant PATIENT_COMMITMENT = keccak256("patientId+per-prescription-salt");

    uint64 internal expiresAt;

    event PrescriptionIssued(
        bytes32 indexed contentHash, address indexed prescriber, bytes32 patientCommitment, uint64 expiresAt
    );
    event PrescriptionDispensed(bytes32 indexed contentHash, address indexed pharmacy, uint64 dispensedAt);

    function setUp() public {
        // A fixed, non-zero starting time: expiry arithmetic must not underflow.
        vm.warp(1_757_000_000);

        _deployRegistry();

        // Accreditation is a precondition of every call below: the practitioner
        // and both pharmacies hold a live credential from the authority.
        _accredit(PRESCRIBER, PRACTITIONER_SCHEMA);
        _accredit(PHARMACY_A, PHARMACY_SCHEMA);
        _accredit(PHARMACY_B, PHARMACY_SCHEMA);

        expiresAt = uint64(block.timestamp + 30 days);

        vm.prank(PRESCRIBER);
        registry.issue(CONTENT_HASH, PATIENT_COMMITMENT, expiresAt);
    }

    /// @notice THE test that backs the pitch. If it fails, there is no project.
    function test_dispense_twice_reverts() public {
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);

        uint64 dispensedAt = uint64(block.timestamp);

        // The second attempt must name who dispensed and when, so the pharmacy
        // screen can say it out loud instead of showing a generic failure.
        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.AlreadyDispensed.selector, CONTENT_HASH, PHARMACY_A, dispensedAt
            )
        );
        vm.prank(PHARMACY_B);
        registry.dispense(CONTENT_HASH);

        // The record is untouched by the failed attempt.
        PrescriptionRecord memory record = registry.getPrescription(CONTENT_HASH);
        assertEq(uint8(record.status), uint8(PrescriptionStatus.Dispensed));
        assertEq(record.dispensedBy, PHARMACY_A);
        assertEq(record.dispensedAt, dispensedAt);
    }

    function test_issue_emits_event() public {
        bytes32 otherHash = keccak256("another-ciphertext");
        uint64 otherExpiry = uint64(block.timestamp + 15 days);

        vm.expectEmit(true, true, false, true);
        emit PrescriptionIssued(otherHash, PRESCRIBER, PATIENT_COMMITMENT, otherExpiry);

        vm.prank(PRESCRIBER);
        registry.issue(otherHash, PATIENT_COMMITMENT, otherExpiry);
    }

    function test_issue_twice_reverts() public {
        vm.expectRevert(abi.encodeWithSelector(IPrescriptionRegistry.AlreadyIssued.selector, CONTENT_HASH));
        vm.prank(PRESCRIBER);
        registry.issue(CONTENT_HASH, PATIENT_COMMITMENT, expiresAt);
    }

    function test_issue_with_past_expiry_reverts() public {
        bytes32 otherHash = keccak256("expired-on-arrival");
        uint64 pastExpiry = uint64(block.timestamp);

        vm.expectRevert(abi.encodeWithSelector(IPrescriptionRegistry.InvalidExpiry.selector, pastExpiry));
        vm.prank(PRESCRIBER);
        registry.issue(otherHash, PATIENT_COMMITMENT, pastExpiry);
    }

    function test_dispense_marks_dispensed() public {
        vm.expectEmit(true, true, false, true);
        emit PrescriptionDispensed(CONTENT_HASH, PHARMACY_A, uint64(block.timestamp));

        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);

        (PrescriptionStatus status, bool dispensable, address prescriber, uint64 recordExpiry) =
            registry.verify(CONTENT_HASH);

        assertEq(uint8(status), uint8(PrescriptionStatus.Dispensed));
        assertFalse(dispensable);
        assertEq(prescriber, PRESCRIBER);
        assertEq(recordExpiry, expiresAt);
    }

    function test_dispense_unknown_reverts() public {
        bytes32 unknownHash = keccak256("never-issued");

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.UnknownPrescription.selector, unknownHash)
        );
        vm.prank(PHARMACY_A);
        registry.dispense(unknownHash);
    }

    function test_dispense_expired_reverts() public {
        vm.warp(uint256(expiresAt) + 1);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.PrescriptionExpired.selector, CONTENT_HASH, expiresAt
            )
        );
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);
    }

    function test_dispense_cancelled_reverts() public {
        vm.prank(PRESCRIBER);
        registry.cancel(CONTENT_HASH);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.PrescriptionCancelledError.selector, CONTENT_HASH)
        );
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);
    }

    function test_cancel_only_by_prescriber() public {
        address otherDoctor = address(0xD0C2);

        vm.expectRevert(
            abi.encodeWithSelector(IPrescriptionRegistry.NotPrescriber.selector, otherDoctor, PRESCRIBER)
        );
        vm.prank(otherDoctor);
        registry.cancel(CONTENT_HASH);
    }

    function test_cancel_after_dispense_reverts() public {
        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);

        uint64 dispensedAt = uint64(block.timestamp);

        vm.expectRevert(
            abi.encodeWithSelector(
                IPrescriptionRegistry.AlreadyDispensed.selector, CONTENT_HASH, PHARMACY_A, dispensedAt
            )
        );
        vm.prank(PRESCRIBER);
        registry.cancel(CONTENT_HASH);
    }

    function test_verify_reports_dispensable_while_valid() public view {
        (PrescriptionStatus status, bool dispensable,,) = registry.verify(CONTENT_HASH);

        assertEq(uint8(status), uint8(PrescriptionStatus.Issued));
        assertTrue(dispensable);
    }

    function test_verify_expired_is_not_dispensable() public {
        vm.warp(uint256(expiresAt) + 1);

        (PrescriptionStatus status, bool dispensable,,) = registry.verify(CONTENT_HASH);

        // Expiry is derived, never stored: the status stays `Issued`.
        assertEq(uint8(status), uint8(PrescriptionStatus.Issued));
        assertFalse(dispensable);
    }

    /// @notice Invariant in test form: nothing takes a prescription out of
    ///         `Dispensed`. There is no reopen function, and there never will be.
    function testFuzz_never_leaves_dispensed(address caller, uint16 elapsed) public {
        vm.assume(caller != address(0));

        vm.prank(PHARMACY_A);
        registry.dispense(CONTENT_HASH);

        vm.warp(block.timestamp + elapsed);

        vm.prank(caller);
        try registry.dispense(CONTENT_HASH) {} catch {}

        vm.prank(caller);
        try registry.cancel(CONTENT_HASH) {} catch {}

        PrescriptionRecord memory record = registry.getPrescription(CONTENT_HASH);
        assertEq(uint8(record.status), uint8(PrescriptionStatus.Dispensed));
    }
}
