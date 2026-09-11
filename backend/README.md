# Redact — backend

Express server for an LLM research marketplace. Listings live on the
`ResearchMarketplace` contract on Base Sepolia; research content lives in
`data/research-store.json` and is paywalled with [x402](https://x402.org)
(USDC on Base Sepolia).

## Setup

```bash
npm install
cp .env.example .env   # fill in WALLET_ADDRESS and PRIVATE_KEY
npm start              # http://localhost:4021   (npm run dev = auto-reload)
```

| Variable | Purpose |
| --- | --- |
| `WALLET_ADDRESS` | receives x402 USDC payments (`payTo`) |
| `PRIVATE_KEY` | backend signer; must be the contract's `recorder` |
| `CONTRACT_ADDRESS` | ResearchMarketplace on Base Sepolia |
| `BASE_SEPOLIA_RPC_URL` | JSON-RPC endpoint |
| `FACILITATOR_URL` | x402 facilitator (verify + settle) |

## Endpoints

| Method | Path | Paid | Notes |
| --- | --- | --- | --- |
| GET | `/api/listings` | no | active listings + seller reputation, no content |
| GET | `/api/listings/:id` | no | one listing + reputation, no content |
| POST | `/api/listings` | no | `{ title, description, category, price, content, sellerAddress }` → `{ listingId, contentHash, txHash }` |
| GET | `/api/listings/:id/reveal` | **x402** | `{ listingId, buyer, content, contentHash, txHash }` |
| GET | `/api/reputation/:address` | no | `{ totalSales, totalDisputes, disputesLost, score }` (score = % sales not lost to disputes, `null` if no sales) |
| GET | `/api/purchases/:listingId/:buyer` | no | `{ timestamp, status, exists }` |
| GET | `/health` | no | recorder + contract addresses |

Prices are human-readable USDC strings in every response (`"0.25"`); the
contract stores 6-decimal base units and the server converts both ways.
`priceBaseUnits` is also returned for convenience.

Errors are always `{ "error": "message" }`: 400 bad input, 404 unknown
listing, 410 delisted listing, 502 contract/RPC failure.

## x402 flow for `/reveal`

Stack: `@x402/express` 2.25.0 + `@x402/core` + `@x402/evm` (the `ExactEvmScheme`),
network `eip155:84532` (base-sepolia), facilitator `https://x402.org/facilitator`.

1. A pre-check middleware loads the listing and returns 400/404/410 before any
   payment logic runs.
2. `paymentMiddleware` resolves the price **dynamically per request** — the
   route's `price` is an async function that reads the listing's on-chain
   price, so the 402 always quotes the exact listing price.
3. Without a valid `PAYMENT-SIGNATURE` header the middleware answers
   `402` with a base64 `PAYMENT-REQUIRED` header describing the requirements.
4. With a valid payment the handler runs: it decodes the payer address from
   the payment payload (`authorization.from` for EIP-3009, or
   `permit2Authorization.from`), calls `recordPurchase(listingId, buyer)` with
   the backend signer, and returns the content plus `contentHash` so the
   client can verify `keccak256(utf8(content)) === contentHash`.
5. The middleware buffers the handler's response, settles with the
   facilitator, then releases the response with a `PAYMENT-RESPONSE` header.
   If the handler returns ≥ 400 settlement is cancelled and the buyer is not
   charged.

If `recordPurchase` reverts (e.g. buyer already purchased) the content is still
returned with `txHash: null` and a `recordError` field, and the failure is logged.

### Seeing the 402 with curl

```bash
# headers + body (body is {} for non-browser clients)
curl -i -H 'Accept: application/json' http://localhost:4021/api/listings/1/reveal

# decode the payment requirements
curl -s -D - -o /dev/null -H 'Accept: application/json' \
  http://localhost:4021/api/listings/1/reveal \
  | grep -i '^payment-required' | cut -d' ' -f2 | tr -d '\r' | base64 -d | jq
```

Example decoded header:

```json
{
  "x402Version": 2,
  "error": "Payment required",
  "resource": { "url": "http://localhost:4021/api/listings/1/reveal", "mimeType": "application/json", ... },
  "accepts": [{
    "scheme": "exact",
    "network": "eip155:84532",
    "amount": "250000",
    "asset": "0x036CbD53842c5426634e7929541eC2318f3dCF7e",
    "payTo": "<WALLET_ADDRESS>",
    "maxTimeoutSeconds": 120,
    "extra": { "name": "USDC", "version": "2" }
  }]
}
```

Requesting the route from a browser (`Accept: text/html`) returns a basic
paywall page instead; install `@x402/paywall` for the full wallet UI.

To complete a purchase, use an x402 client (`@x402/fetch` + `@x402/evm`) with a
Base Sepolia wallet holding test USDC; it retries the request with a signed
`PAYMENT-SIGNATURE` header automatically.

## Known limitations (prototype)

- **The backend wallet is the on-chain seller.** `createListing` is sent by
  the server signer, so `listing.seller` and seller reputation are attributed
  to the backend wallet, not the user. The user-supplied `sellerAddress` is
  stored in `research-store.json` and returned as `listedBy`. The frontend
  `delist` call would also have to come from the backend wallet.
- `recordPurchase` is sent while the handler runs, i.e. before facilitator
  settlement. Payment is already *verified* at that point, so a failed
  settlement after a successful record is unlikely but possible.
- Content is stored in plain JSON on disk; there is no auth on `POST /api/listings`.
- `GET /api/listings` does one `getListing` call per listing id; fine for a
  prototype, slow for thousands of listings.

## Running in a TEE (Phala Cloud / dstack)

The research content is encrypted at rest with AES-256-GCM. Inside an Intel TDX
confidential VM the key is derived from the dstack socket and never leaves the
enclave. Outside a TEE the server falls back to `CONTENT_KEY_DEV` from `.env`
and prints a warning that content is not enclave-protected.

The on-chain `contentHash` stays keccak256 of the plaintext. It is computed
before encryption, so buyers still verify what they receive.

### dstack SDK

`@phala/dstack-sdk` (`DstackClient`). Methods used:

- `isReachable()` to detect whether the dstack socket is present.
- `getKey("redact/content-v1", "content-encryption")` for the deterministic
  content key. The returned bytes are hashed with SHA-256 to a 32-byte AES key.
- `getQuote(reportData)` for the TDX quote at `/api/attestation`.
- `info()` for the app id, instance id, and compose measurement.

Socket path: `/var/run/dstack.sock`. Set `DSTACK_SIMULATOR_ENDPOINT` to point
at the simulator during development.

### Endpoints

- `GET /api/tee-status` returns `{ tee, keySource }`. The frontend footer polls it once.
- `GET /api/attestation` returns the TDX quote, app id, compose hash, and RTMRs,
  plus a `verify` link to the t16z quote explorer. Outside a TEE it returns
  `{ tee: false, reason: "not running in dstack" }` with a 200.

### Build and push

```bash
docker build -t DOCKERHUB_USERNAME/redact-backend:v1 .
docker push DOCKERHUB_USERNAME/redact-backend:v1
```

Set the same tag in `docker-compose.yml` (the `image:` line).

### Deploy to Phala Cloud

```bash
phala cvms create \
  --name redact-backend \
  --compose docker-compose.yml \
  --env-file .env
```

Phala encrypts the env file to the CVM. `docker-compose.yml` lists every
variable the server needs in a comment at the top. Do not put `CONTENT_KEY_DEV`
there; inside the TEE the key comes from the enclave.

### Local check before pushing

```bash
docker compose -f docker-compose.local.yml up --build
```

This builds the image, runs with the dev key, and does not mount the dstack
socket, so it reports `tee: false`. Confirm the endpoints:

```bash
curl localhost:4021/health
curl localhost:4021/api/tee-status     # {"tee":false,"keySource":"dev"}
curl localhost:4021/api/listings
```
