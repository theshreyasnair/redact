import { wrapFetchWithPaymentFromConfig } from "@x402/fetch";
import { ExactEvmScheme } from "@x402/evm";
import { NETWORK_CAIP2 } from "../config";

/**
 * Adapts an ethers v6 JsonRpcSigner to the ClientEvmSigner shape @x402/evm expects:
 * { address, signTypedData({ domain, types, primaryType, message }) }.
 * onSigned fires once MetaMask returns the signature, so the UI can move from
 * "Waiting for signature" to "Fetching research".
 */
export function toX402Signer(signer, address, onSigned) {
  return {
    address,
    async signTypedData({ domain, types, message }) {
      // ethers derives EIP712Domain itself and rejects it if passed explicitly.
      const { EIP712Domain, ...rest } = types;
      const sig = await signer.signTypedData(domain, rest, message);
      onSigned?.();
      return sig;
    },
  };
}

/**
 * The backend serves an HTML paywall unless the request accepts JSON, and the
 * x402 client can only parse the JSON form. The wrapper clones the initial
 * Request for its retry, so headers on the first call do carry over, but this
 * inner fetch forces Accept on every leg (initial, hook, and paid retry)
 * regardless of what the caller passed. Any 402 is logged raw so a bad
 * paywall response is visible in the console.
 */
function jsonFetch(input, init) {
  const request = new Request(input, init);
  request.headers.set("Accept", "application/json");
  return fetch(request).then(async (response) => {
    if (response.status === 402) {
      const body = await response
        .clone()
        .text()
        .catch(() => "<unreadable body>");
      console.log("[x402] 402 response", {
        url: response.url,
        contentType: response.headers.get("content-type"),
        headers: Object.fromEntries(response.headers.entries()),
        body,
      });
    }
    return response;
  });
}

export function paidFetch(signer, address, onSigned) {
  const x402Signer = toX402Signer(signer, address, onSigned);
  return wrapFetchWithPaymentFromConfig(jsonFetch, {
    schemes: [{ network: NETWORK_CAIP2, client: new ExactEvmScheme(x402Signer) }],
  });
}
