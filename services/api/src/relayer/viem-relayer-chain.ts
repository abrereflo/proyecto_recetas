import {
  createPublicClient,
  createWalletClient,
  encodeFunctionData,
  http,
  type PublicClient,
  type WalletClient,
} from 'viem';
import { privateKeyToAccount } from 'viem/accounts';
import { nonceManager } from 'viem/nonce';
import { buildChain, entryPointV07Abi, type PackedUserOperation } from '@recetas/chain';
import type { Address, Hex } from '@recetas/shared';
import type { RelayerConfig } from '../env';
import type { RelayerChain } from './relayer';

/**
 * The one place in this service that talks to a node and holds a key.
 *
 * EVERYTHING ABOVE IT IS PURE. `Relayer` takes this interface, so the packing,
 * the hashing, the policy and the refusals are all tested without a chain, and
 * this file has no logic worth testing — it is adapter and nothing else. That
 * split is the reason `relayer.test.ts` can assert what the relayer would do
 * with a paymaster that is not ours, or an operation that hashes to something
 * else, without an RPC anywhere near it.
 *
 * THE KEY. `privateKeyToAccount` is the only consumer of
 * `config.privateKey`; the account it produces exposes an address and a signing
 * function and nothing else. Nothing in this file logs, returns or re-exports
 * the key, and `RelayerDescription` — the only shape that reaches a response —
 * has no field it could travel in.
 *
 * THE CHAIN IS BUILT FROM CONFIGURATION, through `@recetas/chain`'s `buildChain`,
 * for the reason that package's header gives: a parallel constant here would be
 * a second definition of the chain, and the first RPC change would leave this
 * service talking to one network while the apps propose another.
 */
export function createViemRelayerChain(config: RelayerConfig): RelayerChain {
  const chain = buildChain({ chainId: config.chainId, rpcUrl: config.rpcUrl });
  /**
   * THE `nonceManager` IS LOAD-BEARING. One key, nothing above this file
   * serialises submissions, so two doctors sending at once are two concurrent
   * `sendHandleOps`; without it viem reads `eth_getTransactionCount(pending)`
   * afresh per send, both reads return the same number, and the transactions
   * collide — one dropped or rejected as "nonce too low" AFTER simulation
   * passed, wedging the relayer. One in-process counter is the right scope
   * because this process alone holds the key.
   */
  const account = privateKeyToAccount(config.privateKey, { nonceManager });

  const publicClient: PublicClient = createPublicClient({ chain, transport: http(config.rpcUrl) });
  const walletClient: WalletClient = createWalletClient({
    account,
    chain,
    transport: http(config.rpcUrl),
  });

  return {
    address: account.address as Address,

    async getBalance() {
      return publicClient.getBalance({ address: account.address });
    },

    async getCodeSize(address) {
      const code = await publicClient.getCode({ address });

      return code === undefined || code === '0x' ? 0 : (code.length - 2) / 2;
    },

    async getNonce(sender) {
      return publicClient.readContract({
        address: config.entryPoint,
        abi: entryPointV07Abi,
        functionName: 'getNonce',
        // Key 0 exclusively. Parallel nonce keys buy concurrent operations from
        // one account, and a doctor signs one prescription at a time.
        args: [sender, 0n],
      });
    },

    async getFees() {
      const [block, maxPriorityFeePerGas] = await Promise.all([
        publicClient.getBlock({ blockTag: 'latest' }),
        publicClient.estimateMaxPriorityFeePerGas(),
      ]);

      return { baseFeePerGas: block.baseFeePerGas ?? 0n, maxPriorityFeePerGas };
    },

    async predictAccount(factory, publicKeyX, publicKeyY) {
      return publicClient.readContract({
        address: factory,
        abi: [
          {
            type: 'function',
            name: 'getAddress',
            stateMutability: 'view',
            inputs: [
              { name: 'publicKeyX', type: 'uint256' },
              { name: 'publicKeyY', type: 'uint256' },
            ],
            outputs: [{ name: '', type: 'address' }],
          },
        ] as const,
        functionName: 'getAddress',
        args: [publicKeyX, publicKeyY],
      }) as Promise<Address>;
    },

    async getPaymasterDeposit(paymaster) {
      return publicClient.readContract({
        address: config.entryPoint,
        abi: entryPointV07Abi,
        functionName: 'balanceOf',
        args: [paymaster],
      });
    },

    /**
     * Defence (1) from `relayer.ts`: an `eth_call` of the exact transaction,
     * from the exact sender, before anything is signed.
     *
     * `call` RATHER THAN `simulateContract`, AND THIS IS THE WHOLE POINT OF THE
     * METHOD. `simulateContract` throws away the revert bytes. Verified against
     * viem 2.21.54: `getContractError` builds a FRESH
     * `ContractFunctionRevertedError` and drops the error that carried the hex,
     * and that new error's `.data` is the DECODED OBJECT
     * `{ abiItem, errorName, args }` — decoded against the ABI passed here,
     * which is the EntryPoint's. A selector it does not know reduces to
     * `.signature`, four bytes, arguments gone. Every path out of it loses the
     * payload `failures.ts` exists to read, which is how
     * `SponsorshipExhausted(account, used, limit, windowEndsAt)` became
     * undecodable in a service whose first defence is explaining refusals.
     *
     * `call` keeps the node's answer intact: `getCallError` wraps rather than
     * rebuilds, so the JSON-RPC `{ code: 3, data }` survives on the cause chain
     * for `revertDataOf` to find and `decodeHandleOpsFailure` to name — and it
     * names it from the raw bytes, so a paymaster error the EntryPoint ABI has
     * never heard of decodes anyway. Nothing is lost by not decoding the
     * return: `handleOps` returns nothing.
     */
    async simulateHandleOps(userOp: PackedUserOperation) {
      await publicClient.call({
        to: config.entryPoint,
        data: encodeFunctionData({
          abi: entryPointV07Abi,
          functionName: 'handleOps',
          args: [[userOp], account.address],
        }),
        account,
      });
    },

    async sendHandleOps(userOp: PackedUserOperation, gas: bigint): Promise<Hex> {
      return walletClient.writeContract({
        address: config.entryPoint,
        abi: entryPointV07Abi,
        functionName: 'handleOps',
        // The beneficiary is this relayer: the EntryPoint reimburses it from
        // the paymaster's deposit when the operation succeeds.
        args: [[userOp], account.address],
        account,
        chain,
        gas,
      });
    },
  };
}
