# Redact — buyer and seller agents

An autonomous buyer for the Redact research marketplace. Give it a research
goal and a USDC budget. It reads the listings, asks Claude which ones are
worth paying for, pays through x402 from its own wallet, checks the delivered
content against the hash committed on-chain, asks Claude whether the content
delivered what was promised, and opens a dispute on-chain when it did not.

No browser and no MetaMask. The private key signs USDC transfer
authorizations locally and the x402 facilitator settles them.

## Fund the wallet

1. Create a fresh wallet and put its private key in `.env` as `AGENT_PRIVATE_KEY`.
   Do not reuse the backend recorder key.
2. Send it Base Sepolia ETH for gas. Disputes are on-chain transactions.
   A faucet is at https://www.alchemy.com/faucets/base-sepolia.
3. Send it Base Sepolia USDC (`0x036CbD53842c5426634e7929541eC2318f3dCF7e`).
   Circle's faucet at https://faucet.circle.com hands out test USDC on Base Sepolia.

The agent refuses to start if USDC is below the budget or ETH is zero.

## Run

```bash
npm install
cp .env.example .env    # fill in AGENT_PRIVATE_KEY and ANTHROPIC_API_KEY
npm start
```

Override the goal and budget from the command line:

```bash
node src/agent.js --goal "prompt injection against tool-using agents" --budget 0.5
```

Buy one specific listing directly, skipping discovery and scoring:

```bash
node src/agent.js --listing 7 --budget 0.5
```

Other flags: `--min-score 7`, `--backend http://localhost:4021`.

## What it does, in order

1. Prints the wallet address and USDC and ETH balances.
2. Fetches `GET /api/listings` and keeps the active ones.
3. Scores each listing with Claude: relevance and credibility, 0 to 10, plus a worth-buying flag.
4. Sorts by relevance × credibility. Buys each listing where worth-buying is true,
   the score clears `MIN_SCORE`, and the price fits the remaining budget.
   `MIN_SCORE` is on the 0 to 10 scale and is compared against the geometric mean
   of relevance and credibility.
5. Buys by calling the reveal endpoint through an x402-wrapped fetch. The first
   request returns 402, the wrapper signs a USDC authorization, retries, and gets 200.
   If the wallet already holds an on-chain purchase for the listing it does not pay
   again: it signs `redact:reveal:<id>:<timestamp>` and fetches the content through
   `GET /api/listings/:id/content` instead (event type `refetched`). The dispute
   window is 7 days from purchase, so the checks below still apply.
6. Hashes the content with keccak256 and compares it to the listing's on-chain hash.
   A mismatch opens a dispute immediately.
7. Asks Claude whether the content delivered what the description promised.
   If not delivered, quality under 4, or already public, opens a dispute.
8. Prints a summary table.

Every step is an event: `{ ts, listingId, type, message, data }`. Events print to
the console and are POSTed to `BACKEND_URL/api/agent/events` as `{ runId, event }`.
A rejected POST is ignored.

## Seller agent

Takes a raw research finding, writes the listing copy, prices it, checks that
the copy does not give the finding away, and submits it to the marketplace.
The backend wallet is the on-chain seller; the agent's wallet is recorded as
the listing owner.

```bash
npm run sell -- --file ./findings/example.md
cat finding.md | node src/seller.js
```

Flags: `--price 0.25` overrides the suggested price. `--dry-run` prints the
listing and submits nothing. `--backend http://localhost:4021` picks the backend.
Needs `AGENT_PRIVATE_KEY` and `ANTHROPIC_API_KEY` in `.env`. No ETH or USDC is
needed; listing costs nothing on the seller side.

What it does, in order:

1. Drafts title, description, category and a suggested price from the finding.
2. Runs a leak check on the description alone: could a buyer who has not paid
   reproduce or act on the finding?
3. If the check finds a leak, redrafts with the flagged details excluded, up to
   two times. If the copy still leaks, it stops and prints the problem.
4. `POST /api/listings` with the copy, the price and the full finding as content.
5. Prints the listing id, content hash, Basescan link and marketplace link.

Events: `start`, `drafted`, `leak_check`, `redrafted`, `listed`, `error`. The
first event carries `data.role = "seller"`. The buyer's first event carries
`data.role = "buyer"`.

## Files

- `src/agent.js` the loop
- `src/llm.js` the buyer's two Claude calls. The system prompts are exported constants.
- `src/seller.js` the seller flow
- `src/sellerLlm.js` the seller's draft and leak-check calls. Both system prompts are exported.
- `findings/example.md` a sample finding for the seller
- `src/x402client.js` builds the paying fetch from the private key
- `src/chain.js` ethers wallet, balances, `openDispute`, keccak helper
- `src/events.js` console and backend event emitter
- `src/config.js` env and flag parsing, model name, addresses
