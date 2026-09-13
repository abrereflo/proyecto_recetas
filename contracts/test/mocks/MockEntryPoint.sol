// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {IEntryPointStake} from "../../src/IPaymaster.sol";

/// @notice The deposit and stake bookkeeping of EntryPoint v0.7, and nothing else.
///
/// @dev WHAT THIS IS NOT. It does not validate, bundle, execute or charge for a
///      UserOperation. The paymaster tests drive `validatePaymasterUserOp`
///      directly with `vm.prank(ENTRY_POINT)`, which is the honest way to say
///      "the EntryPoint called" without pretending to own a bundler — the same
///      choice `PasskeyAccountFixture` already makes and for the same reason.
///
///      This double exists only because `deposit`, `withdraw` and `addStake`
///      have to talk to SOMETHING with code at
///      0x0000000071727De22E5E9d8BAf0edAc6f37da032, and a test that asserted
///      "the call did not revert" without checking where the AVAX landed would
///      be asserting nothing.
///
///      The stake side reproduces one real rule on purpose: `addStake` refuses
///      an unstake delay shorter than the one already set. That rule is why
///      `PrescriptionPaymaster.addStake` is restricted to the funder, so the
///      double would be lying if it left it out.
contract MockEntryPoint is IEntryPointStake {
    mapping(address account => uint256 amount) public deposits;
    mapping(address account => uint256 amount) public stakes;
    mapping(address account => uint32 delay) public unstakeDelays;
    mapping(address account => bool unlocked) public stakeUnlocked;

    /// @inheritdoc IEntryPointStake
    function depositTo(address account) external payable {
        deposits[account] += msg.value;
    }

    /// @inheritdoc IEntryPointStake
    function balanceOf(address account) external view returns (uint256) {
        return deposits[account];
    }

    /// @inheritdoc IEntryPointStake
    function withdrawTo(address payable withdrawAddress, uint256 withdrawAmount) external {
        require(deposits[msg.sender] >= withdrawAmount, "MockEntryPoint: deposit too small");

        deposits[msg.sender] -= withdrawAmount;

        (bool sent,) = withdrawAddress.call{value: withdrawAmount}("");
        require(sent, "MockEntryPoint: withdraw failed");
    }

    /// @inheritdoc IEntryPointStake
    function addStake(uint32 unstakeDelaySec) external payable {
        require(unstakeDelaySec >= unstakeDelays[msg.sender], "MockEntryPoint: cannot decrease delay");

        stakes[msg.sender] += msg.value;
        unstakeDelays[msg.sender] = unstakeDelaySec;
        stakeUnlocked[msg.sender] = false;
    }

    /// @inheritdoc IEntryPointStake
    function unlockStake() external {
        stakeUnlocked[msg.sender] = true;
    }

    /// @inheritdoc IEntryPointStake
    function withdrawStake(address payable withdrawAddress) external {
        require(stakeUnlocked[msg.sender], "MockEntryPoint: stake is locked");

        uint256 amount = stakes[msg.sender];
        stakes[msg.sender] = 0;

        (bool sent,) = withdrawAddress.call{value: amount}("");
        require(sent, "MockEntryPoint: stake withdrawal failed");
    }
}
