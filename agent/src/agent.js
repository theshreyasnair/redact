const { loadConfig, EXPLORER_URL } = require("./config");
const { createEmitter } = require("./events");
const { createChain, keccakOf, revertReason } = require("./chain");
const { createPaidFetch } = require("./x402client");
const { scoreListing, evaluateContent } = require("./llm");

async function fetchJson(url) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json" } });
  } catch (err) {
    throw new Error(`could not reach ${url} (${err.cause?.code || err.message}). Is the backend running?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${url} returned ${res.status}`);
  return body;
}

async function main() {
  const config = loadConfig();
  const { emit, runId, flush } = createEmitter({ backendUrl: config.backendUrl });
  const chain = createChain(config.privateKey);
  const { address: payerAddress, fetchWithPayment } = createPaidFetch(config.privateKey);

  if (payerAddress.toLowerCase() !== chain.address.toLowerCase()) {
    throw new Error("x402 signer and ethers wallet derived different addresses");
  }

  // ---- preflight ----
  console.log(`run ${runId}`);
  console.log(`goal:    ${config.goal}`);
  console.log(`budget:  ${config.budget} USDC   min score: ${config.minScore}`);
  console.log(`wallet:  ${chain.address}`);
  const bal = await chain.balances();
  console.log(`balance: ${bal.usdc} USDC, ${bal.eth} ETH`);
  if (bal.ethWei === 0n) throw new Error("Wallet has no ETH for gas. Fund it before running.");
  if (Number(bal.usdc) < config.budget) {
    throw new Error(`Wallet holds ${bal.usdc} USDC but the budget is ${config.budget}. Fund it or lower --budget.`);
  }
  console.log("");

  // ---- discover ----
  const all = await fetchJson(`${config.backendUrl}/api/listings`);
  const listings = all.filter((l) => l.statusCode === 0);
  console.log(`${listings.length} active listing(s)\n`);

  // ---- score ----
  const scored = [];
  for (const listing of listings) {
    try {
      const s = await scoreListing({ goal: config.goal, listing });
      const score = s.relevance * s.credibility;
      scored.push({ listing, ...s, score });
      emit("scored", {
        listingId: listing.id,
        message: `relevance ${s.relevance} credibility ${s.credibility} worth_buying=${s.worth_buying} (${listing.price} USDC) ${s.reason}`,
        data: { ...s, score, price: listing.price, title: listing.title },
      });
    } catch (err) {
      emit("error", { listingId: listing.id, message: `scoring failed: ${err.message}` });
    }
  }
  scored.sort((a, b) => b.score - a.score);

  // ---- buy, verify, evaluate, dispute ----
  const stats = { scored: scored.length, bought: 0, verified: 0, disputed: 0, spent: 0 };
  let remaining = config.budget;
  // score is 0..100; MIN_SCORE is on the 0..10 scale, so compare against the geometric mean.
  const meetsMin = (s) => Math.sqrt(s.score) >= config.minScore;

  for (const entry of scored) {
    const { listing } = entry;
    const price = Number(listing.price);

    if (!entry.worth_buying) {
      emit("skipped", { listingId: listing.id, message: "model said not worth buying" });
      continue;
    }
    if (!meetsMin(entry)) {
      emit("skipped", { listingId: listing.id, message: `score ${Math.sqrt(entry.score).toFixed(1)} below minimum ${config.minScore}` });
      continue;
    }
    if (price > remaining) {
      emit("skipped", { listingId: listing.id, message: `price ${price} USDC exceeds remaining budget ${remaining.toFixed(6)}` });
      continue;
    }

    // Buy.
    emit("buying", { listingId: listing.id, message: `"${listing.title}" for ${listing.price} USDC`, data: { price } });
    let body;
    try {
      const url = `${config.backendUrl}/api/listings/${listing.id}/reveal`;
      const first = await fetch(url, { headers: { Accept: "application/json" } });
      emit("buying", { listingId: listing.id, message: `GET reveal -> ${first.status}${first.status === 402 ? ", paying" : ""}` });
      const res = await fetchWithPayment(url, { headers: { Accept: "application/json" } });
      body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `reveal returned ${res.status}`);
      const paymentResponse = res.headers.get("payment-response");
      remaining -= price;
      stats.bought += 1;
      stats.spent += price;
      emit("paid", {
        listingId: listing.id,
        message: `paid ${listing.price} USDC, content received (${body.content?.length ?? 0} chars). recordPurchase tx ${body.txHash || "none"}`,
        data: { txHash: body.txHash, recordError: body.recordError, settled: Boolean(paymentResponse), remaining },
      });
    } catch (err) {
      emit("error", { listingId: listing.id, message: `purchase failed: ${err.message}` });
      continue;
    }

    // Verify the hash.
    const localHash = keccakOf(body.content ?? "");
    const matches = localHash === (listing.contentHash || "").toLowerCase();
    if (!matches) {
      emit("hash_mismatch", {
        listingId: listing.id,
        message: `keccak256 of content ${localHash} does not match on-chain ${listing.contentHash}`,
        data: { localHash, onChain: listing.contentHash },
      });
      await dispute(listing.id, "hash mismatch");
      continue;
    }
    stats.verified += 1;
    emit("verified", { listingId: listing.id, message: `content hash matches on-chain commitment`, data: { hash: localHash } });

    // Evaluate.
    let verdict;
    try {
      verdict = await evaluateContent({ goal: config.goal, listing, content: body.content });
      emit("evaluated", {
        listingId: listing.id,
        message: `delivered=${verdict.delivered} quality=${verdict.quality} already_public=${verdict.already_public}. ${verdict.reason}`,
        data: verdict,
      });
    } catch (err) {
      emit("error", { listingId: listing.id, message: `evaluation failed: ${err.message}` });
      continue;
    }

    if (!verdict.delivered || verdict.quality < 4 || verdict.already_public) {
      const why = !verdict.delivered ? "not delivered" : verdict.already_public ? "already public" : `quality ${verdict.quality} below 4`;
      await dispute(listing.id, why);
    }
  }

  async function dispute(listingId, why) {
    try {
      const { txHash, url } = await chain.openDispute(listingId);
      stats.disputed += 1;
      emit("disputed", { listingId, message: `${why}. dispute opened: ${url}`, data: { txHash, url, reason: why } });
    } catch (err) {
      emit("error", { listingId, message: `openDispute failed (${why}): ${revertReason(err)}` });
    }
  }

  // ---- summary ----
  const summary = {
    listingsScored: stats.scored,
    bought: stats.bought,
    verified: stats.verified,
    disputed: stats.disputed,
    usdcSpent: Number(stats.spent.toFixed(6)),
    usdcRemaining: Number(remaining.toFixed(6)),
  };
  console.log("");
  console.table(summary);
  emit("summary", { message: `scored ${summary.listingsScored}, bought ${summary.bought}, verified ${summary.verified}, disputed ${summary.disputed}, spent ${summary.usdcSpent} USDC, remaining ${summary.usdcRemaining} USDC`, data: summary });
  console.log(`wallet on Basescan: ${EXPLORER_URL}/address/${chain.address}`);
  await flush();
}

main().catch(async (err) => {
  console.error(`\nagent stopped: ${err.message}`);
  process.exit(1);
});
