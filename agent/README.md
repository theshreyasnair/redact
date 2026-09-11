# Redact — buyer agent

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
6. Hashes the content with keccak256 and compares it to the listing's on-chain hash.
   A mismatch opens a dispute immediately.
7. Asks Claude whether the content delivered what the description promised.
   If not delivered, quality under 4, or already public, opens a dispute.
8. Prints a summary table.

Every step is an event: `{ ts, listingId, type, message, data }`. Events print to
the console and are POSTed to `BACKEND_URL/api/agent/events` as `{ runId, event }`.
A rejected POST is ignored.

## Files

- `src/agent.js` the loop
- `src/llm.js` the two Claude calls. The system prompts are exported constants.
- `src/x402client.js` builds the paying fetch from the private key
- `src/chain.js` ethers wallet, balances, `openDispute`, keccak helper
- `src/events.js` console and backend event emitter
- `src/config.js` env and flag parsing, model name, addresses
