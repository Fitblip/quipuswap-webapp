import {
  TezosToolkit,
  WalletContract,
  ContractMethod,
  Wallet,
} from "@taquito/taquito";
import BigNumber from "bignumber.js";
import mem from "mem";
import { QSAsset, QSNetwork, QSTokenType } from "./types";
import { snakeToCamelKeys } from "./helpers";
import { FastRpcClient } from "./taquito-fast-rpc";
import { LambdaViewSigner } from "./lambda-view";
import {
  ALL_NETWORKS,
  DEFAULT_NETWORK,
  DEFAULT_TOKEN_LOGO_URL,
  MAINNET_TOKENS,
  TESTNET_TOKENS,
} from "./defaults";

export const Tezos = new TezosToolkit(
  new FastRpcClient(getNetwork().rpcBaseURL)
);
Tezos.setSignerProvider(new LambdaViewSigner());

export async function getTokens() {
  const { type, fa1_2FactoryContract, fa2FactoryContract } = getNetwork();
  if (!fa1_2FactoryContract && !fa2FactoryContract) {
    throw new Error("Contracts for this network not found");
  }

  const [fa1_2FacStorage, fa2FacStorage] = await Promise.all([
    fa1_2FactoryContract &&
      getStorage(fa1_2FactoryContract).then(s => snakeToCamelKeys(s)),
    fa2FactoryContract &&
      getStorage(fa2FactoryContract).then(s => snakeToCamelKeys(s)),
  ]);

  return Promise.all([
    ...(fa1_2FacStorage?.tokenList ?? []).map(async (tAddress: string) => {
      const exchange = await fa1_2FacStorage.tokenToExchange.get(tAddress);

      if (type === "main") {
        const knownToken = MAINNET_TOKENS.find(({ id }) => tAddress === id);
        if (knownToken) {
          return knownToken;
        }
      } else if (type === "test") {
        const knownToken = TESTNET_TOKENS.find(({ id }) => tAddress === id);
        if (knownToken) {
          console.log("Type ", type, TESTNET_TOKENS, knownToken, exchange)
          return knownToken;
        }
      }

      return toUnknownToken(tAddress, exchange, QSTokenType.FA1_2);
    }),
    ...(fa2FacStorage?.tokenList ?? []).map(
      async ({ 0: tAddress, 1: tId }: { 0: string; 1: BigNumber }) => {
        const exchange = await fa2FacStorage.tokenToExchange.get([
          tAddress,
          +tId,
        ]);

        return toUnknownToken(tAddress, exchange, QSTokenType.FA2, +tId);
      }
    ),
  ]);
}

export function approveToken(
  token: Pick<QSAsset, "tokenType" | "fa2TokenId">,
  tokenContract: WalletContract,
  from: string,
  to: string,
  amount: number
): ContractMethod<Wallet> {
  if (token.tokenType === QSTokenType.FA2) {
    return tokenContract.methods.update_operators([
      {
        ["add_operator"]: {
          owner: from,
          operator: to,
          token_id: token.fa2TokenId,
        },
      },
    ]);
  } else {
    return tokenContract.methods.approve(to, amount);
  }
}

function toUnknownToken(
  address: string,
  exchange: string,
  tokenType: QSTokenType,
  fa2TokenId?: number
): QSAsset {
  return {
    type: "token",
    tokenType,
    id: address,
    decimals: 0,
    symbol: address,
    name: "Token",
    imgUrl: DEFAULT_TOKEN_LOGO_URL,
    exchange,
    fa2TokenId,
  };
}

export async function getDexShares(
  address: string,
  exchange: string,
  decimals = 0
) {
  const storage = await getDexStorage(exchange);
  const ledger = storage.ledger || storage.accounts;
  const val = await ledger.get(address);
  if (!val) return null;

  const unfrozen = new BigNumber(val.balance).div(10 ** decimals);
  const frozen = new BigNumber(val.frozen_balance).div(10 ** decimals);

  return {
    unfrozen,
    frozen,
    total: unfrozen.plus(frozen),
  };
}

/**
 * Storage
 */

export function clearMem() {
  mem.clear(getStorage);
  mem.clear(getContract);
}

export const getDexStorage = (contractAddress: string) =>
  getStorage(contractAddress).then(s => snakeToCamelKeys(s.storage));

export const getStorage = mem(getStoragePure, { maxAge: 30000 });

export async function getStoragePure(contractAddress: string) {
  const contract = await getContract(contractAddress);
  return contract.storage<any>();
}

export const getContract = mem(getContractPure);

export function getContractPure(address: string) {
  return Tezos.contract.at(address);
}

/**
 * Network
 */

export function getNetwork() {
  const netId = localStorage.getItem("netid");
  if (!netId) return DEFAULT_NETWORK;
  const found = ALL_NETWORKS.find(n => n.id === netId);
  return found && !found.disabled ? found : DEFAULT_NETWORK;
}

export function setNetwork(net: QSNetwork) {
  localStorage.setItem("netid", net.id);
  location.reload();
}
