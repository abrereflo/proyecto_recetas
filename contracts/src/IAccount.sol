// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

/// @notice A UserOperation as EntryPoint v0.7 passes it to an account.
///
/// @dev Transcribed field by field from eth-infinitism's
///      `account-abstraction` v0.7 (`contracts/interfaces/PackedUserOperation.sol`).
///      The order and the types must match the deployed EntryPoint EXACTLY: the
///      struct arrives ABI-encoded in calldata, and a reordered or resized field
///      decodes into the wrong slot in silence. The same warning as `IEAS.sol`,
///      for the same reason — any change here is checked against the canonical
///      source, never inferred.
///
///      Two fields are packed pairs of `uint128`, which is the v0.7 change that
///      shrank calldata:
///        `accountGasLimits` = verificationGasLimit (high) || callGasLimit (low)
///        `gasFees`          = maxPriorityFeePerGas (high) || maxFeePerGas (low)
///      This account reads neither, so it does not unpack them.
struct PackedUserOperation {
    address sender;
    uint256 nonce;
    bytes initCode;
    bytes callData;
    bytes32 accountGasLimits;
    uint256 preVerificationGas;
    bytes32 gasFees;
    bytes paymasterAndData;
    bytes signature;
}

/// @notice The account side of ERC-4337, v0.7.
///
/// @dev Written out here rather than pulled in as a dependency, the same way
///      `IEAS.sol` transcribes the part of EAS this project consumes. The
///      account-abstraction package brings a `BaseAccount`, a `SenderCreator`,
///      stake management and a second compiler pin with it; this project needs
///      nine struct fields and one function signature.
interface IAccount {
    /// @notice Validate a UserOperation. Called by the EntryPoint, only.
    ///
    /// @param userOp The operation. `userOp.signature` is the only field this
    ///        account reads: everything else is already bound into `userOpHash`.
    /// @param userOpHash What the owner actually signed. The EntryPoint computes
    ///        it over the operation, its own address and the chain id, so a
    ///        signature cannot be replayed onto another chain, another
    ///        EntryPoint, or a different operation.
    /// @param missingAccountFunds What the account owes the EntryPoint up front.
    ///        Zero when a paymaster is covering the operation.
    ///
    /// @return validationData 0 for a valid signature, 1 for an invalid one, or
    ///         a packed `(aggregator, validUntil, validAfter)` word. A FAILED
    ///         SIGNATURE MUST NOT REVERT: the EntryPoint needs the failure as a
    ///         return value so it can charge and drop the operation instead of
    ///         losing the whole bundle. Reverting is reserved for what is
    ///         genuinely not the signature's fault — a caller that is not the
    ///         EntryPoint.
    function validateUserOp(
        PackedUserOperation calldata userOp,
        bytes32 userOpHash,
        uint256 missingAccountFunds
    ) external returns (uint256 validationData);
}
