// SPDX-License-Identifier: Apache-2.0
pragma solidity ^0.8.24;

import {Create2} from "@openzeppelin/contracts/utils/Create2.sol";
import {PasskeyAccount} from "./PasskeyAccount.sol";

/// @title PasskeyAccountFactory
/// @notice Deploys a `PasskeyAccount` at an address derived from the passkey.
///
/// @dev WHY A FACTORY IS NOT OPTIONAL. ERC-4337's whole answer to "the user has
///      no funds and therefore cannot create their own account" is the
///      counterfactual address: the account's address is computed from its
///      initcode with CREATE2 and can be used — attested to, printed in a QR,
///      named as a prescriber — before any code exists there. The first
///      UserOperation carries this factory's call in `initCode` and the
///      EntryPoint deploys the account inside that operation, with the
///      paymaster paying. The doctor never signs a deployment. That is Fase 5's
///      exit criterion, "una emisión completa sin que el médico posea AVAX",
///      and without a factory there is no way to reach it.
///
/// @dev WHY THERE IS NO SALT. The public key is a constructor argument, so it is
///      already inside the initcode the address is derived from; a salt would
///      add a second degree of freedom and with it the possibility of two
///      accounts for one passkey. One passkey, one address, no ambiguity — which
///      matters because an EAS credential is issued to an address and a doctor
///      with two addresses has one accredited account and one that silently is
///      not. The salt is fixed at zero for that reason and not exposed.
///
/// @dev NO ADMIN. This factory holds no privilege over what it creates: the
///      accounts it deploys have no owner it can act as, no upgrade hook and no
///      rotation. Anyone may call `createAccount` with any public key; doing so
///      for a key that is not yours creates an account only that key can sign
///      for, so a griefer's only achievement is paying gas to deploy an account
///      on its owner's behalf. Accreditation still runs entirely through EAS.
contract PasskeyAccountFactory {
    /// @notice A new account was deployed. Not emitted when one already existed.
    event AccountCreated(address indexed account, uint256 publicKeyX, uint256 publicKeyY);

    /// @notice EntryPoint v0.7, baked into every account this factory makes.
    address public immutable entryPoint;

    /// @notice The `PrescriptionRegistry` every account this factory makes serves.
    address public immutable registry;

    /// @notice Solidity P-256 fallback verifier, or zero for precompile-only.
    address public immutable fallbackVerifier;

    constructor(address entryPoint_, address registry_, address fallbackVerifier_) {
        entryPoint = entryPoint_;
        registry = registry_;
        fallbackVerifier = fallbackVerifier_;
    }

    /// @notice Deploy the account for `(publicKeyX, publicKeyY)`, or return the
    ///         one already there.
    ///
    /// @dev Idempotent BY REQUIREMENT, not as a courtesy. A UserOperation's
    ///      `initCode` can be executed after the account already exists — two
    ///      operations sent close together, a bundle retried — and ERC-4337
    ///      expects the factory to hand back the existing account rather than
    ///      revert on a CREATE2 collision.
    function createAccount(uint256 publicKeyX, uint256 publicKeyY) external returns (PasskeyAccount) {
        address predicted = getAddress(publicKeyX, publicKeyY);

        if (predicted.code.length != 0) {
            return PasskeyAccount(payable(predicted));
        }

        PasskeyAccount account = new PasskeyAccount{salt: bytes32(0)}(
            entryPoint, registry, fallbackVerifier, publicKeyX, publicKeyY
        );

        emit AccountCreated(address(account), publicKeyX, publicKeyY);

        return account;
    }

    /// @notice The address `createAccount` would use, whether or not it has been
    ///         called yet.
    /// @dev This is what the doctor's app shows at enrolment and what the
    ///      credential authority attests to. It stays correct forever because
    ///      every input to it is immutable.
    /// @dev The `abi.encodePacked` below joins two dynamic values and the
    ///      linter flags that shape as collision-prone. It is not, here: this is
    ///      initcode, not a hashed message. `creationCode` is a fixed byte
    ///      string for a given build and `abi.encode` pads every argument to 32
    ///      bytes, so there is no pair of inputs that could produce the same
    ///      concatenation — and the EVM itself requires exactly this layout.
    function getAddress(uint256 publicKeyX, uint256 publicKeyY) public view returns (address) {
        return Create2.computeAddress(
            bytes32(0),
            keccak256(
                abi.encodePacked(
                    type(PasskeyAccount).creationCode,
                    abi.encode(entryPoint, registry, fallbackVerifier, publicKeyX, publicKeyY)
                )
            )
        );
    }
}
