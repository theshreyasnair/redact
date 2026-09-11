const { privateKeyToAccount } = require("viem/accounts");
const { wrapFetchWithPaymentFromConfig } = require("@x402/fetch");
const { ExactEvmScheme } = require("@x402/evm");
const { NETWORK_CAIP2 } = require("./config");

/**
 * Builds a fetch that pays 402s automatically.
 *
 * @x402/evm's ExactEvmScheme takes a ClientEvmSigner: an object with `address`
 * and `signTypedData({ domain, types, primaryType, message })`. viem's
 * privateKeyToAccount returns exactly that shape, so no wallet client, provider,
 * or EIP-1193 shim is needed. Signing is local; the facilitator broadcasts.
 */
function createPaidFetch(privateKey) {
  const account = privateKeyToAccount(privateKey);
  const fetchWithPayment = wrapFetchWithPaymentFromConfig(fetch, {
    schemes: [{ network: NETWORK_CAIP2, client: new ExactEvmScheme(account) }],
  });
  return { address: account.address, fetchWithPayment };
}

module.exports = { createPaidFetch };
