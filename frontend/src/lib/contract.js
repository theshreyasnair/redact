import { ethers } from "ethers";
import abi from "../abi/ResearchMarketplace.json";
import { CONTRACT_ADDRESS, RPC_URL } from "../config";

export const readProvider = new ethers.JsonRpcProvider(RPC_URL);
export const readContract = new ethers.Contract(CONTRACT_ADDRESS, abi, readProvider);

export function writeContract(signer) {
  return new ethers.Contract(CONTRACT_ADDRESS, abi, signer);
}

export function hashContent(content) {
  return ethers.keccak256(ethers.toUtf8Bytes(content));
}

export function revertReason(err) {
  return err?.reason || err?.shortMessage || err?.info?.error?.message || err?.message || "Transaction failed";
}

/** Total listings on-chain, including delisted ones. */
export async function fetchListingCount() {
  return Number(await readContract.listingCount());
}
