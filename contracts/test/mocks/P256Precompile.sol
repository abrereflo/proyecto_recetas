// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice A stand-in for the RIP-7212 precompile, with its exact answers.
///
/// @dev The local EVM this suite runs on is `cancun`, which has no P-256
///      precompile: a call to 0x…0100 succeeds and returns nothing, exactly as
///      a call to any empty address does. So the tests install this at 0x…0100
///      with `vm.etch`.
///
///      It is not a fake verdict machine. It forwards the 160-byte payload to
///      the canonical daimo verifier — real secp256r1 arithmetic on real
///      vectors — and only translates the ANSWER into the precompile's
///      convention, which differs:
///
///        RIP-7212  valid -> 32 bytes of 0x…01,  invalid -> ZERO BYTES
///        daimo     valid -> 32 bytes of 0x…01,  invalid -> 32 bytes of 0x…00
///
///      Both halves of that table were measured against Avalanche Fuji by
///      `eth_call` on 13/09/2026, against 0x…0100 and 0xc2b7…4De4 respectively.
///      The difference is the whole reason `src/P256.sol` has to treat an empty
///      return as "no verdict" rather than as "invalid", so a stub that got it
///      wrong would test the wrong contract.
///
/// @dev The verifier address is `immutable`, which puts it in runtime code
///      rather than storage. That is deliberate: `vm.etch` copies code and
///      nothing else, so a stub configured through storage would arrive at
///      0x…0100 pointing at address zero.
contract RIP7212Stub {
    /// @notice Where the real curve arithmetic happens.
    address public immutable verifier;

    constructor(address verifier_) {
        verifier = verifier_;
    }

    /// @dev A precompile has no function selector: the first byte of calldata is
    ///      the first byte of the digest.
    fallback(bytes calldata input) external returns (bytes memory) {
        (bool ok, bytes memory ret) = verifier.staticcall(input);

        if (!ok || ret.length != 32 || abi.decode(ret, (uint256)) != 1) {
            return "";
        }

        return abi.encodePacked(uint256(1));
    }
}

/// @notice A precompile that answers badly, on purpose.
///
/// @dev `src/P256.sol` has to survive a backend that is absent, truncated or
///      broken, and the only way to show that is to put one there. Each mode is
///      a shape a real deployment could take:
///
///        AlwaysValid    a backend that says yes to everything. Used to prove a
///                       32-byte verdict SHORT-CIRCUITS the fallback, rather
///                       than being cross-checked against it.
///        AlwaysInvalid  a 32-byte zero. Also final, also no fallback.
///        Short          one byte instead of thirty-two. A chain with something
///                       else living at 0x…0100. Must count as "no verdict".
///        Reverts        a backend that throws. Must count as "no verdict",
///                       never as a revert of the account's validation.
///
/// @dev `mode` is `immutable` for the same reason as above: `vm.etch` copies
///      code, not storage.
contract MisbehavingPrecompileStub {
    enum Mode {
        AlwaysValid,
        AlwaysInvalid,
        Short,
        Reverts
    }

    Mode public immutable mode;

    constructor(Mode mode_) {
        mode = mode_;
    }

    fallback(bytes calldata) external returns (bytes memory) {
        if (mode == Mode.AlwaysValid) return abi.encodePacked(uint256(1));
        if (mode == Mode.AlwaysInvalid) return abi.encodePacked(uint256(0));
        if (mode == Mode.Short) return hex"01";

        revert("precompile exploded");
    }
}
