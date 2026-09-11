const { loadConfig, EXPLORER_URL } = require("./config");
const { createEmitter } = require("./events");
const { createChain, keccakOf, revertReason } = require("./chain");
const { createPaidFetch } = require("./x402client");
const { scoreListing, evaluateContent } = require("./llm");

async function fetchJson(url, headers = {}) {
  let res;
  try {
    res = await fetch(url, { headers: { Accept: "application/json", ...headers } });
  } catch (err) {
    throw new Error(`could not reach ${url} (${err.cause?.code || err.message}). Is the backend running?`);
  }
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `${url} returned ${res.status}`);
  return body;
}

/**
 * Re-fetches content this wallet already paid for. Signs
 * "redact:reveal:<listingId>:<unixTimestamp>" and calls the owner path,
 * which checks the on-chain purchase record instead of charging through x402.
 */
async function fetchOwnedContent({ backendUrl, wallet, listingId }) {
  const timestamp = Math.floor(Date.now() / 1000);
  const signature = await wallet.signMessage(`redact:reveal:${listingId}:${timestamp}`);
  return fetchJson(`${backendUrl}/api/listings/${listingId}/content`, {
    "X-Owner-Address": wallet.address,
    "X-Owner-Signature": signature,
    "X-Owner-Timestamp": String(timestamp),
  });
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
  // First event of the run. The Agent page reads role, goal and budget from it.
  emit("start", {
    message: `buyer run: "${config.goal}" with ${config.budget} USDC`,
    data: { role: "buyer", goal: config.goal, budget: config.budget, wallet: chain.address },
  });
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
  let listings;
  if (config.listing) {
    const one = await fetchJson(`${config.backendUrl}/api/listings/${config.listing}`);
    if (one.statusCode !== 0)
      throw new Error(`listing ${config.listing} is not active (status ${one.status ?? one.statusCode})`);
    listings = [one];
    console.log(`--listing ${config.listing}: "${one.title}" for ${one.price} USDC, scoring skipped\n`);
  } else {
    const all = await fetchJson(`${config.backendUrl}/api/listings`);
    listings = all.filter((l) => l.statusCode === 0);
    console.log(`${listings.length} active listing(s)\n`);
  }

  // ---- score ----
  const scored = [];
  for (const listing of listings) {
    if (config.listing) {
      // Direct buy: no model call, treat as worth buying with a perfect score.
      scored.push({
        listing,
        relevance: 10,
        credibility: 10,
        worth_buying: true,
        reason: "selected with --listing",
        score: 100,
      });
      emit("scored", {
        listingId: listing.id,
        message: `scoring skipped (--listing ${config.listing})`,
        data: { price: listing.price, title: listing.title },
      });
      continue;
    }
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
  const stats = { scored: scored.length, bought: 0, refetched: 0, verified: 0, disputed: 0, spent: 0 };
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
      emit("skipped", {
        listingId: listing.id,
        message: `score ${Math.sqrt(entry.score).toFixed(1)} below minimum ${config.minScore}`,
      });
      continue;
    }
    if ((listing.listedBy || "").toLowerCase() === chain.address.toLowerCase()) {
      emit("skipped", { listingId: listing.id, message: "own listing (listed by this wallet)" });
      continue;
    }

    // Never pay twice: check the on-chain purchase record for this wallet first.
    let owned = null;
    try {
      const purchase = await fetchJson(`${config.backendUrl}/api/purchases/${listing.id}/${chain.address}`);
      if (Number(purchase.timestamp) > 0) owned = purchase;
    } catch (err) {
      emit("error", { listingId: listing.id, message: `purchase lookup failed, not buying: ${err.message}` });
      continue;
    }

    let body;
    if (owned) {
      // Already paid. The dispute window is 7 days from purchase, so re-fetch
      // through the signed owner path (no payment) and run the same checks.
      try {
        body = await fetchOwnedContent({ backendUrl: config.backendUrl, wallet: chain.wallet, listingId: listing.id });
        stats.refetched += 1;
        emit("refetched", {
          listingId: listing.id,
          message: `already purchased ${new Date(owned.timestamp * 1000).toISOString().slice(0, 10)} (${owned.status}), re-fetched via signed owner path (${body.content?.length ?? 0} chars)`,
          data: { timestamp: owned.timestamp, status: owned.status },
        });
      } catch (err) {
        emit("error", { listingId: listing.id, message: `owner re-fetch failed: ${err.message}` });
        continue;
      }
    } else if (price > remaining) {
      emit("skipped", {
        listingId: listing.id,
        message: `price ${price} USDC exceeds remaining budget ${remaining.toFixed(6)}`,
      });
      continue;
    } else {
      // Buy.
      emit("buying", {
        listingId: listing.id,
        message: `"${listing.title}" for ${listing.price} USDC`,
        data: { price },
      });
      try {
        const url = `${config.backendUrl}/api/listings/${listing.id}/reveal`;
        const first = await fetch(url, { headers: { Accept: "application/json" } });
        const firstBody = await first.text().catch(() => "");
        emit("buying", {
          listingId: listing.id,
          message: `GET reveal -> ${first.status}${first.status === 402 ? ", paying" : ""}`,
        });
        let res;
        try {
          res = await fetchWithPayment(url, { headers: { Accept: "application/json" } });
        } catch (err) {
          // The x402 wrapper threw before/while retrying. Dump the original 402 so the
          // payment requirements it was working from are visible.
          log402("initial 402 (payment retry threw)", first, firstBody);
          throw err;
        }
        const text = await res.text().catch(() => "");
        try {
          body = JSON.parse(text);
        } catch {
          body = {};
        }
        if (!res.ok) {
          log402("initial 402", first, firstBody);
          log402(`paid retry -> ${res.status}`, res, text);
          throw new Error(body.error || `reveal returned ${res.status} after payment retry`);
        }
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
    emit("verified", {
      listingId: listing.id,
      message: `content hash matches on-chain commitment`,
      data: { hash: localHash },
    });

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
      const why = !verdict.delivered
        ? "not delivered"
        : verdict.already_public
          ? "already public"
          : `quality ${verdict.quality} below 4`;
      await dispute(listing.id, why);
    }
  }

  function log402(label, res, text) {
    const headers = Object.fromEntries(res.headers.entries());
    console.error(`\n[402 debug] ${label}: HTTP ${res.status} ${res.statusText}`);
    console.error("[402 debug] headers:", JSON.stringify(headers, null, 2));
    console.error("[402 debug] body:", text || "(empty)");
    emit("error", {
      message: `[402 debug] ${label}: HTTP ${res.status}`,
      data: { status: res.status, headers, body: text },
    });
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
    refetched: stats.refetched,
    verified: stats.verified,
    disputed: stats.disputed,
    usdcSpent: Number(stats.spent.toFixed(6)),
    usdcRemaining: Number(remaining.toFixed(6)),
  };
  console.log("");
  console.table(summary);
  emit("summary", {
    message: `scored ${summary.listingsScored}, bought ${summary.bought}, refetched ${summary.refetched}, verified ${summary.verified}, disputed ${summary.disputed}, spent ${summary.usdcSpent} USDC, remaining ${summary.usdcRemaining} USDC`,
    data: summary,
  });
  console.log(`wallet on Basescan: ${EXPLORER_URL}/address/${chain.address}`);
  await flush();
}

main().catch(async (err) => {
  console.error(`\nagent stopped: ${err.message}`);
  process.exit(1);
});
