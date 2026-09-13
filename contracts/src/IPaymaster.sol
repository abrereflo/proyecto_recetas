// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {PackedUserOperation} from "./IAccount.sol";

/// @notice How the EntryPoint describes the outcome of the operation to the
///         paymaster that paid for it.
///
/// @dev Transcribed from eth-infinitism's `account-abstraction` v0.7
///      (`contracts/interfaces/IPaymaster.sol`), same discipline as
///      `IAccount.sol` and `IEAS.sol`: copied from the canonical source, never
///      inferred. The order of the members is the ABI, so a reordering here
///      would make `opReverted` arrive as `opSucceeded`.
///
///      `postOpReverted` is declared because the enum has three members and the
///      numbering must match, NOT because it can arrive. Upstream's own comment
///      is explicit: "Only used internally in the EntryPoint (cleanup after
///      postOp reverts). Never calling paymaster with this value."
enum PostOpMode {
    opSucceeded,
    opReverted,
    postOpReverted
}

/// @notice The paymaster side of ERC-4337, v0.7.
///
/// @dev Written out here instead of pulling in the `account-abstraction`
///      package, for the reason `IAccount.sol` already gives: the package
///      brings a second compiler pin, a `BasePaymaster`, a `StakeManager` and a
///      `SenderCreator` with it, and this project needs two function
///      signatures.
interface IPaymaster {
    /// @notice Decide whether to pay for this operation. Called by the
    ///         EntryPoint, only.
    ///
    /// @param userOp The operation the paymaster is being asked to fund.
    /// @param userOpHash The EntryPoint's digest over the operation. Unused by a
    ///        paymaster that signs nothing, which is the case here.
    /// @param maxCost The most this operation can cost the paymaster, derived
    ///        by the EntryPoint from the operation's gas limits and gas fees.
    ///
    /// @return context Handed back to `postOp` verbatim. AN EMPTY CONTEXT MEANS
    ///         `postOp` IS NEVER CALLED — the EntryPoint skips it on
    ///         `context.length == 0`.
    /// @return validationData `0` to sponsor, `1` to refuse, or a packed
    ///         `(authorizer, validUntil, validAfter)` word. Unlike an account,
    ///         a paymaster MAY revert to refuse, and this contract does: see the
    ///         long note on the failure channel in `PrescriptionPaymaster`.
    function validatePaymasterUserOp(PackedUserOperation calldata userOp, bytes32 userOpHash, uint256 maxCost)
        external
        returns (bytes memory context, uint256 validationData);

    /// @notice Settle up after the operation ran. Called by the EntryPoint, only.
    ///
    /// @param mode Whether the operation succeeded. The paymaster pays either way.
    /// @param context Whatever `validatePaymasterUserOp` returned.
    /// @param actualGasCost What the operation actually cost, excluding this call.
    /// @param actualUserOpFeePerGas The price the operation paid per unit of gas.
    ///        Not `tx.gasprice`, which is what the bundler paid.
    function postOp(
        PostOpMode mode,
        bytes calldata context,
        uint256 actualGasCost,
        uint256 actualUserOpFeePerGas
    ) external;
}

/// @notice The slice of the EntryPoint's `StakeManager` a paymaster has to
///         reach in order to hold a balance and get it back.
///
/// @dev Also transcribed rather than imported. `depositTo` is what funds the
///      sponsorship; `withdrawTo` is what recovers it; the three stake
///      functions exist because ERC-7562 asks a paymaster that reads storage
///      outside itself during validation to be staked, which this one does.
interface IEntryPointStake {
    /// @notice Add to `account`'s gas deposit. Permissionless by design.
    function depositTo(address account) external payable;

    /// @notice The gas deposit `account` currently holds.
    function balanceOf(address account) external view returns (uint256);

    /// @notice Move part of the caller's own deposit out.
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external;

    /// @notice Lock value as the caller's stake, with an unstake delay.
    /// @dev The delay may only ever grow. That is why `PrescriptionPaymaster`
    ///      does not expose this call to the public; see the note there.
    function addStake(uint32 unstakeDelaySec) external payable;

    /// @notice Start the unstake delay running.
    function unlockStake() external;

    /// @notice Take the stake out, once the delay has elapsed.
    function withdrawStake(address payable withdrawAddress) external;
}
