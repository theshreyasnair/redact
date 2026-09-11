# Redact — frontend

React + Vite client for the research marketplace. Listings and reputation come
from the backend at `http://localhost:4021`. Purchases go through x402, so a
buyer signs one USDC authorization and the content comes back in the same
request. Disputes and delisting are sent straight to the contract from the
user's wallet.

## Run it

```bash
npm install
npm run dev        # http://localhost:5173
npm run build      # production bundle in dist/
```

The backend has to be running first. Its URL lives in `src/config.js` along
with the contract address, chain id, RPC and explorer URLs.

You need MetaMask (or any injected wallet) on Base Sepolia with a little test
USDC. The header offers a "Switch network" button if you are on the wrong chain.

## Stack

| Piece | Choice |
| --- | --- |
| UI | React 18, React Router 7, Tailwind CSS 4 |
| Chain | ethers v6 for the wallet and direct contract calls |
| Payments | `@x402/fetch` + `@x402/evm` 2.25.0 |
| Fonts | Instrument Serif, Inter, JetBrains Mono via Google Fonts |

## How a purchase works

1. The buyer clicks Purchase on a listing page.
2. `paidFetch` in `src/lib/x402.js` wraps `fetch` with `wrapFetchWithPaymentFromConfig`.
   The EVM scheme wants a signer with an `address` and a `signTypedData` method.
   The app builds that from the ethers `JsonRpcSigner`, dropping the `EIP712Domain`
   entry from the types because ethers adds it itself.
3. The wrapped fetch hits `/api/listings/:id/reveal`, receives a 402, asks
   MetaMask to sign the USDC transfer authorization, and retries with the
   `PAYMENT-SIGNATURE` header.
4. The response holds the content, the on-chain hash, and the transaction that
   recorded the purchase. It is saved in `localStorage` under
   `bbb:purchase:<listingId>:<address>` so a revisit shows it without paying again.
5. "Verify integrity" hashes the content with keccak256 and compares it to the
   listing's `contentHash`.

MetaMask refuses to sign typed data whose `chainId` differs from the active
chain, so the wallet has to be on Base Sepolia before the Purchase button works.

## The black box

`src/components/HashStream.jsx` draws an isometric cube made of hash text on a
canvas that fills its parent section. Three faces are visible: the top
rhombus and the left and right parallelograms, at standard 30° angles. Each
face is a polygon in canvas space with an affine transform so text rows run
parallel to that face's edges. The face is clipped, the transform applied,
rows of fragments drawn 22px apart, then the context restored. There are no
fills or outlines. The cube's edges come from where text stops and from the
brightness step between faces: top `#2A2C34`, left `#222429`, right `#1A1C21`.

Fragments look like chain data: short hex runs, 40-char addresses, 64-char
hashes, and `nonce:` and `block:` entries. Each row is a loop, so the text
drifts along the face at 5px/s and wraps. The top and right faces drift one
way, the left face the other. About 10% of fragments are flagged to vanish
whenever they touch a face boundary, which keeps the silhouette from being
razor clean. Within 140px of the cursor, fragments brighten toward `#FF7A59`
with quadratic falloff, measured in canvas space so the glow crosses faces.
The cube itself never moves.

Where it is used:

- Marketplace hero: 520px tall, centred vertically, at 78% of the viewport
  width so it sits beside the headline.
- Listing page: 360px, anchored on the purchase panel's top-right corner at
  50% opacity. The panel is slightly translucent there. The listing's
  `contentHash` is written across consecutive rows of the top face at full
  accent brightness every 8 seconds and held for about 5.

Below 900px the cube is not drawn. A rolling frame-time average watches the
60fps budget; if it is exceeded, row spacing grows in 6px steps up to 44px
and the faces are rebuilt with fewer rows. An IntersectionObserver pauses
drawing while the section is off screen.

## Pages

- `/` hero, category tabs, listing grid, live stats bar (refreshes every 15s).
- `/listing/:id` details, purchase panel, revealed content, verify, dispute, delist.
- `/sell` wallet-gated form. Posts to the backend with the connected address as `sellerAddress`.
- `/profile` reputation, your listings (matched on `listedBy`), your purchases from `localStorage`.

## Known limitations

- The backend wallet is the on-chain seller for every listing. The "Delist"
  button appears for the address that created a listing, but the contract will
  reject the call because that address is not the on-chain seller. The UI shows
  the revert reason.
- Reputation on the profile page is looked up by the connected address, which
  stays at zero for the same reason. The number shown on listing cards is the
  backend wallet's reputation.
- Purchase history lives only in the browser that made the purchase.
