import { api } from "./api";

/**
 * Fetches content the connected wallet already paid for, without paying again.
 * The wallet signs "redact:reveal:<listingId>:<unixTimestamp>" (a plain message,
 * no gas) and the backend checks the on-chain purchase record before decrypting.
 */
export async function fetchOwnedContent(listingId, signer, address) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await signer.signMessage(`redact:reveal:${listingId}:${timestamp}`);
  return api.ownerContent(listingId, { address, signature, timestamp });
}
