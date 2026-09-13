// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Test} from "forge-std/Test.sol";
import {P256} from "../../src/P256.sol";
import {CanonicalP256Verifier} from "../mocks/CanonicalP256Verifier.sol";
import {MisbehavingPrecompileStub, RIP7212Stub} from "../mocks/P256Precompile.sol";

/// @notice Shared wiring for every test that needs a real P-256 signature.
///
/// @dev NOTHING HERE IS A FAKE SIGNATURE. `vm.signP256` and `vm.publicKeyP256`
///      are Foundry cheatcodes that do genuine secp256r1 arithmetic, and the
///      verification on the other side is the canonical audited verifier's own
///      bytecode, read off Avalanche Fuji. A test that passed because both
///      sides agreed to pretend would be worse than no test, so neither side
///      pretends.
///
/// @dev THE PRECOMPILE IS NOT HERE BY DEFAULT. `forge test` runs a `cancun`
///      EVM, which has no P-256 precompile; on Fuji there is one. Both states
///      are real and the library has to be right in both, so this fixture makes
///      the choice explicit at the top of every test rather than hiding it:
///      call `_installPrecompile()` to test as Fuji behaves, or leave it out to
///      test as a chain without RIP-7212 behaves. A test that says nothing gets
///      no precompile, which is the harsher of the two.
abstract contract P256Fixture is Test {
    /// @dev The doctor's passkey, in the only form a test can have it. A real
    ///      one never leaves the device's secure enclave, which is the entire
    ///      point of the design and also the reason this constant can never be
    ///      anything but a stand-in.
    uint256 internal constant DOCTOR_KEY = 0xC0FFEE1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF1234567890;

    /// @dev A second key, for "signed by somebody else" cases.
    uint256 internal constant IMPOSTOR_KEY =
        0xBADF00D1234567890ABCDEF1234567890ABCDEF1234567890ABCDEF123456789;

    uint256 internal constant N = 0xFFFFFFFF00000000FFFFFFFFFFFFFFFFBCE6FAADA7179E84F3B9CAC2FC632551;
    uint256 internal constant N_DIV_2 = 0x7FFFFFFF800000007FFFFFFFFFFFFFFFDE737D56D38BCF4279DCE5617E3192A8;

    /// @notice The audited Solidity verifier, at its canonical address.
    address internal constant VERIFIER = CanonicalP256Verifier.ADDRESS;

    /// @notice Put the canonical verifier where it lives on a real chain.
    /// @dev Called by `setUp`, because the fallback backend exists on Fuji
    ///      whether or not a given test uses it. The code hash is asserted, so a
    ///      mangled constant fails loudly here instead of silently verifying
    ///      signatures with something that is not the audited contract.
    function _installVerifier() internal {
        vm.etch(VERIFIER, CanonicalP256Verifier.runtimeCode());

        assertEq(
            VERIFIER.codehash,
            CanonicalP256Verifier.RUNTIME_CODE_HASH,
            "etched verifier is not the bytecode read from Fuji"
        );
    }

    /// @notice Make 0x…0100 behave the way Fuji's RIP-7212 precompile behaves.
    function _installPrecompile() internal {
        RIP7212Stub stub = new RIP7212Stub(VERIFIER);
        vm.etch(P256.PRECOMPILE, address(stub).code);
    }

    /// @notice Make 0x…0100 behave badly, in one of four documented ways.
    function _installPrecompile(MisbehavingPrecompileStub.Mode mode) internal {
        MisbehavingPrecompileStub stub = new MisbehavingPrecompileStub(mode);
        vm.etch(P256.PRECOMPILE, address(stub).code);
    }

    /// @notice The public key for a private key, as the account stores it.
    function _publicKey(uint256 privateKey) internal pure returns (uint256 x, uint256 y) {
        (x, y) = vm.publicKeyP256(privateKey);
    }

    /// @notice Sign `digest`, normalised to the low-`s` half.
    /// @dev The normalisation is defensive, not decorative. Foundry's cheatcode
    ///      happens to return low `s` today; the library REQUIRES it, and a test
    ///      helper that silently produced the other half would fail for a reason
    ///      that has nothing to do with the thing under test.
    function _sign(uint256 privateKey, bytes32 digest) internal pure returns (uint256 r, uint256 s) {
        (bytes32 rawR, bytes32 rawS) = vm.signP256(privateKey, digest);

        r = uint256(rawR);
        s = uint256(rawS);

        if (s > N_DIV_2) s = N - s;
    }

    /// @notice The malleable twin of `s`: the other signature for one message.
    function _flip(uint256 s) internal pure returns (uint256) {
        return N - s;
    }
}
