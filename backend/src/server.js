require("dotenv").config();

const fs = require("fs");
const path = require("path");
const express = require("express");
const cors = require("cors");
const { paymentMiddleware, x402ResourceServer } = require("@x402/express");
const { HTTPFacilitatorClient } = require("@x402/core/server");
const { ExactEvmScheme } = require("@x402/evm/exact/server");

const contract = require("./contract");
const store = require("./store");
const tee = require("./tee");

const { ethers } = contract;

const PORT = Number(process.env.PORT) || 4021;
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;
const FACILITATOR_URL = process.env.FACILITATOR_URL || "https://x402.org/facilitator";
const NETWORK = "eip155:84532"; // base-sepolia in CAIP-2 form (required by @x402 v2)

if (!WALLET_ADDRESS || !ethers.isAddress(WALLET_ADDRESS)) {
  throw new Error("WALLET_ADDRESS is missing or not a valid address");
}

const app = express();
// Expose the x402 headers so the browser paywall client can read them.
app.use(cors({ exposedHeaders: ["PAYMENT-REQUIRED", "PAYMENT-RESPONSE", "X-PAYMENT-RESPONSE"] }));
app.use(express.json({ limit: "5mb" }));

// ---------- helpers ----------

function parseListingId(raw) {
  const id = Number(raw);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function sendError(res, status, message) {
  return res.status(status).json({ error: message });
}

function reputationScore(rep) {
  if (!rep.totalSales) return null;
  return ((rep.totalSales - rep.disputesLost) / rep.totalSales) * 100;
}

// Tiny TTL cache so the pre-check, the dynamic price function and the
// handler don't each hit the RPC for the same listing on one request.
const listingCache = new Map();
const LISTING_TTL_MS = 15_000;
async function getListingCached(id) {
  const hit = listingCache.get(id);
  if (hit && hit.expires > Date.now()) return hit.value;
  const value = await contract.getListing(id);
  listingCache.set(id, { value, expires: Date.now() + LISTING_TTL_MS });
  return value;
}

async function withReputation(listing) {
  const reputation = await contract.getSellerReputation(listing.seller);
  return { ...listing, reputation };
}

// ---------- read caches (cut RPC load; public RPC rate-limits us) ----------

const CACHE_TTL_MS = 15_000;

// One entry for the whole active-listings array plus derived stats.
const listingsCache = { value: null, at: 0 };
// Per-address seller reputation.
const reputationCache = new Map(); // address(lowercased) -> { value, at }

/**
 * Fresh within the TTL. On expiry it reloads; if the reload hits an RPC
 * rate-limit and we still hold a previous value, it serves that stale value
 * instead of failing. Returns { value, stale }.
 */
async function cached(entry, ttl, loader) {
  const now = Date.now();
  if (entry.value !== null && now - entry.at < ttl) return { value: entry.value, stale: false };
  try {
    const value = await loader();
    entry.value = value;
    entry.at = now;
    return { value, stale: false };
  } catch (err) {
    if (contract.isRateLimitError(err) && entry.value !== null) {
      console.warn("[cache] RPC rate-limited; serving stale");
      return { value: entry.value, stale: true };
    }
    throw err;
  }
}

// Builds the active listings, seller reputation, and stats in one pass.
// staticNetwork + batchMaxCount on the provider collapse these reads into
// one or two HTTP requests.
async function loadListings() {
  const count = await contract.getListingCount();
  const ids = Array.from({ length: count }, (_, i) => i + 1);
  const listings = await Promise.all(ids.map((id) => contract.getListing(id)));

  // Read the content store once, then keep only active listings that have content here.
  const contentStore = store.readStore();
  const activeAll = listings.filter((l) => l && l.statusCode === 0);
  const active = [];
  const skipped = [];
  for (const l of activeAll) {
    if (contentStore[String(l.id)]) active.push(l);
    else skipped.push(l.id);
  }
  if (skipped.length) {
    console.warn(`[listings] skipped ${skipped.length} active listing(s) with no content in the store: ${skipped.join(", ")}`);
  }

  const sellers = [...new Set(active.map((l) => l.seller))];
  const reps = await Promise.all(sellers.map((s) => contract.getSellerReputation(s)));
  const repBySeller = Object.fromEntries(sellers.map((s, i) => [s, reps[i]]));

  const items = active.map((l) => ({
    ...l,
    listedBy: contentStore[String(l.id)]?.sellerAddress ?? null,
    reputation: repBySeller[l.seller],
  }));

  let purchases = 0;
  let disputes = 0;
  for (const s of sellers) {
    purchases += repBySeller[s].totalSales;
    disputes += repBySeller[s].totalDisputes;
  }
  // Stats reflect the same set that is shown: active listings that have content.
  return { items, stats: { listings: items.length, purchases, disputes } };
}

async function getListingsCached() {
  return cached(listingsCache, CACHE_TTL_MS, loadListings);
}

async function getReputationCached(address) {
  const key = address.toLowerCase();
  let entry = reputationCache.get(key);
  if (!entry) {
    entry = { value: null, at: 0 };
    reputationCache.set(key, entry);
  }
  return cached(entry, CACHE_TTL_MS, () => contract.getSellerReputation(address));
}

// Drop cached reads after any write we make, so the next request reflects it.
function invalidateCaches() {
  listingsCache.value = null;
  listingsCache.at = 0;
  reputationCache.clear();
  listingCache.clear(); // the per-id reveal-precheck cache above
}

/**
 * Pulls the payer address out of the x402 payment header.
 * The header is base64 JSON. For the "exact" EVM scheme the signer is
 * payload.authorization.from (EIP-3009) or payload.permit2Authorization.from (Permit2).
 */
function extractPayerAddress(req) {
  const header = req.header("payment-signature") || req.header("x-payment");
  if (!header) return null;
  try {
    const decoded = JSON.parse(Buffer.from(header, "base64").toString("utf8"));
    const inner = decoded?.payload ?? {};
    const from = inner.authorization?.from || inner.permit2Authorization?.from || decoded.payer;
    return from && ethers.isAddress(from) ? ethers.getAddress(from) : null;
  } catch (err) {
    console.error("[reveal] could not decode payment header:", err.message);
    return null;
  }
}

// ---------- x402 setup ----------

const facilitatorClient = new HTTPFacilitatorClient({ url: FACILITATOR_URL });
const resourceServer = new x402ResourceServer(facilitatorClient).register(NETWORK, new ExactEvmScheme());

const REVEAL_ROUTE = "/api/listings/:id/reveal";
const REVEAL_PATH_RE = /^\/api\/listings\/(\d+)\/reveal\/?$/;

// Runs BEFORE the payment middleware so a bad id yields a clean 404/400
// instead of a 402 (or a 500 from the price resolver).
app.get(REVEAL_ROUTE, async (req, res, next) => {
  const id = parseListingId(req.params.id);
  if (!id) return sendError(res, 400, "Invalid listing id");
  try {
    const listing = await getListingCached(id);
    if (!listing) return sendError(res, 404, "Listing not found");
    if (listing.statusCode !== 0) return sendError(res, 410, "Listing is delisted");
    req.listing = listing;
    next();
  } catch (err) {
    console.error("[reveal] pre-check failed:", err);
    return sendError(res, 502, contract.contractErrorMessage(err));
  }
});

app.use(
  paymentMiddleware(
    {
      [`GET ${REVEAL_ROUTE}`]: {
        accepts: {
          scheme: "exact",
          network: NETWORK,
          payTo: WALLET_ADDRESS,
          maxTimeoutSeconds: 120,
          // Dynamic per-listing price: resolved on every request from the on-chain listing.
          price: async (context) => {
            const path = context.path || context.adapter.getPath();
            const match = REVEAL_PATH_RE.exec(path);
            const id = match ? Number(match[1]) : null;
            const listing = id ? await getListingCached(id) : null;
            if (!listing) throw new Error(`Listing ${id} not found while pricing`);
            return `$${listing.price}`; // e.g. "$0.10" -> USDC on base-sepolia
          },
        },
        description: "Reveal the full research content for this listing",
        mimeType: "application/json",
      },
    },
    resourceServer,
    { appName: "Redact", testnet: true }
  )
);

// ---------- routes ----------

app.get("/health", (_req, res) => {
  res.json({ ok: true, recorder: contract.signer.address, contract: process.env.CONTRACT_ADDRESS });
});

// 1. All active listings (no content)
app.get("/api/listings", async (_req, res) => {
  try {
    const { value, stale } = await getListingsCached();
    if (stale) res.set("X-Cache", "stale");
    res.json(value.items);
  } catch (err) {
    console.error("[GET /api/listings]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// Live stats for the marketplace ticker. Derived from the cached listings pass.
app.get("/api/stats", async (_req, res) => {
  try {
    const { value, stale } = await getListingsCached();
    if (stale) res.set("X-Cache", "stale");
    res.json(value.stats);
  } catch (err) {
    console.error("[GET /api/stats]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// 2. Single listing (no content)
app.get("/api/listings/:id", async (req, res) => {
  const id = parseListingId(req.params.id);
  if (!id) return sendError(res, 400, "Invalid listing id");
  try {
    const listing = await contract.getListing(id);
    if (!listing) return sendError(res, 404, "Listing not found");
    const full = await withReputation(listing);
    res.json({ ...full, listedBy: store.getEntry(id)?.sellerAddress ?? null });
  } catch (err) {
    // On an RPC rate-limit, fall back to the cached listings array if this id is in it.
    if (contract.isRateLimitError(err) && listingsCache.value) {
      const hit = listingsCache.value.items.find((l) => l.id === id);
      if (hit) {
        res.set("X-Cache", "stale");
        return res.json(hit);
      }
    }
    console.error("[GET /api/listings/:id]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// 3. Create listing
app.post("/api/listings", async (req, res) => {
  const { title, description, category, price, content, sellerAddress } = req.body ?? {};

  if (typeof title !== "string" || !title.trim()) return sendError(res, 400, "title is required");
  if (typeof description !== "string") return sendError(res, 400, "description must be a string");
  if (typeof category !== "string" || !category.trim()) return sendError(res, 400, "category is required");
  if (typeof content !== "string" || !content.trim()) return sendError(res, 400, "content is required");
  if (price === undefined || price === null || Number.isNaN(Number(price)) || Number(price) <= 0) {
    return sendError(res, 400, "price must be a positive number (USDC)");
  }
  if (!ethers.isAddress(sellerAddress ?? "")) return sendError(res, 400, "sellerAddress must be a valid address");

  let priceBaseUnits;
  try {
    priceBaseUnits = contract.usdcToBaseUnits(price);
  } catch {
    return sendError(res, 400, "price has too many decimals (USDC supports 6)");
  }
  if (priceBaseUnits <= 0n) return sendError(res, 400, "price is below 1 base unit of USDC");

  // Hash the plaintext before encrypting; the on-chain commitment is keccak256 of the plaintext.
  const contentHash = ethers.keccak256(ethers.toUtf8Bytes(content));

  try {
    const { listingId, txHash } = await contract.createListing({
      contentHash,
      title: title.trim(),
      description,
      category: category.trim(),
      priceUsdc: price,
    });

    store.setEntry(listingId, {
      content: tee.encrypt(content), // encrypted at rest with the enclave key
      contentHash,
      sellerAddress: ethers.getAddress(sellerAddress),
      createdAt: new Date().toISOString(),
    });

    invalidateCaches();
    res.status(201).json({ listingId, contentHash, txHash });
  } catch (err) {
    console.error("[POST /api/listings]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// 4. Reveal (paid). Reached only after the pre-check above and a verified x402 payment.
app.get(REVEAL_ROUTE, async (req, res) => {
  const listing = req.listing;
  const entry = store.getEntry(listing.id);
  if (!entry) {
    // Returning >= 400 makes the x402 middleware cancel settlement, so the buyer is not charged.
    return sendError(res, 404, "Content for this listing is not available on this server");
  }

  const buyer = extractPayerAddress(req);
  let txHash = null;
  let recordError = null;

  if (!buyer) {
    recordError = "Could not determine buyer address from payment payload";
    console.error(`[reveal] listing ${listing.id}: ${recordError}`);
  } else {
    try {
      txHash = await contract.recordPurchase(listing.id, buyer);
      invalidateCaches(); // sale bumps seller reputation and the stats counts
      console.log(`[reveal] recorded purchase listing=${listing.id} buyer=${buyer} tx=${txHash}`);
    } catch (err) {
      // Buyer paid; still deliver the content. Common cause: already purchased.
      recordError = contract.contractErrorMessage(err);
      console.error(`[reveal] recordPurchase failed listing=${listing.id} buyer=${buyer}: ${recordError}`);
    }
  }

  // Decrypt only here, after payment verified. Legacy plaintext entries pass through.
  let content;
  try {
    content = tee.isEncrypted(entry.content) ? tee.decrypt(entry.content) : entry.content;
  } catch (err) {
    // A decrypt failure returns >= 400, which cancels x402 settlement so the buyer is not charged.
    console.error(`[reveal] decrypt failed listing=${listing.id}: ${err.message}`);
    return sendError(res, 500, "Content could not be decrypted on this server");
  }

  res.json({
    listingId: listing.id,
    buyer,
    content,
    contentHash: listing.contentHash,
    txHash,
    ...(recordError ? { recordError } : {}),
  });
});

// TEE attestation: the TDX quote plus which image is running. 200 even outside a TEE.
app.get("/api/attestation", async (_req, res) => {
  try {
    res.json(await tee.getAttestation());
  } catch (err) {
    console.error("[GET /api/attestation]", err);
    sendError(res, 502, err.message || "Could not produce attestation");
  }
});

// Small status for the frontend footer: is the enclave active, where is the key from.
app.get("/api/tee-status", (_req, res) => {
  res.json(tee.teeStatus());
});

// 5. Reputation
app.get("/api/reputation/:address", async (req, res) => {
  const { address } = req.params;
  if (!ethers.isAddress(address)) return sendError(res, 400, "Invalid address");
  try {
    const { value: rep, stale } = await getReputationCached(address);
    if (stale) res.set("X-Cache", "stale");
    res.json({ address: ethers.getAddress(address), ...rep, score: reputationScore(rep) });
  } catch (err) {
    console.error("[GET /api/reputation]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// 6. Purchase lookup
app.get("/api/purchases/:listingId/:buyer", async (req, res) => {
  const id = parseListingId(req.params.listingId);
  const { buyer } = req.params;
  if (!id) return sendError(res, 400, "Invalid listing id");
  if (!ethers.isAddress(buyer)) return sendError(res, 400, "Invalid buyer address");
  try {
    const purchase = await contract.getPurchase(id, buyer);
    res.json({ listingId: id, buyer: ethers.getAddress(buyer), ...purchase });
  } catch (err) {
    console.error("[GET /api/purchases]", err);
    sendError(res, 502, contract.contractErrorMessage(err));
  }
});

// ---------- agent event stream ----------

// The 20 most recent agent runs, persisted to disk so they survive a restart.
const AGENT_RUNS_CAP = 20;
const AGENT_RUNS_PATH = path.join(__dirname, "..", "data", "agent-runs.json");
const agentRuns = new Map(); // runId -> { runId, startedAt, events: [] }

// Load persisted runs on startup (oldest first, so Map insertion order = age).
(function loadAgentRuns() {
  try {
    const raw = fs.readFileSync(AGENT_RUNS_PATH, "utf8");
    const runs = raw.trim() ? JSON.parse(raw) : [];
    for (const run of runs) {
      if (run && typeof run.runId === "string") agentRuns.set(run.runId, run);
    }
    console.log(`  agent runs:             loaded ${agentRuns.size} from disk`);
  } catch (err) {
    if (err.code !== "ENOENT") console.error("[agent-runs] could not load:", err.message);
  }
})();

// Atomic write of the current runs (oldest first) to disk.
function saveAgentRuns() {
  try {
    fs.mkdirSync(path.dirname(AGENT_RUNS_PATH), { recursive: true });
    const tmp = `${AGENT_RUNS_PATH}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify([...agentRuns.values()], null, 2));
    fs.renameSync(tmp, AGENT_RUNS_PATH);
  } catch (err) {
    console.error("[agent-runs] could not persist:", err.message);
  }
}

// POST /api/agent/events — body { runId, event }. No auth.
app.post("/api/agent/events", (req, res) => {
  const { runId, event } = req.body ?? {};
  if (typeof runId !== "string" || !runId.trim()) return sendError(res, 400, "runId is required");
  if (!event || typeof event !== "object") return sendError(res, 400, "event object is required");

  let run = agentRuns.get(runId);
  if (!run) {
    run = { runId, startedAt: new Date().toISOString(), events: [] };
    agentRuns.set(runId, run);
    // Evict the oldest runs beyond the cap (Map preserves insertion order).
    while (agentRuns.size > AGENT_RUNS_CAP) {
      agentRuns.delete(agentRuns.keys().next().value);
    }
  }
  run.events.push(event);
  saveAgentRuns();
  res.status(202).json({ ok: true });
});

// GET /api/agent/runs — all runs, most recent first.
app.get("/api/agent/runs", (_req, res) => {
  const runs = [...agentRuns.values()].reverse();
  res.json(runs);
});

// ---------- fallbacks ----------

app.use((_req, res) => sendError(res, 404, "Not found"));

// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, _next) => {
  if (err?.type === "entity.parse.failed") return sendError(res, 400, "Invalid JSON body");
  console.error("[unhandled]", err);
  sendError(res, 500, "Internal server error");
});

// Encrypt any plaintext content left in the store from before encryption existed.
function migratePlaintextContent() {
  const all = store.readStore();
  let changed = 0;
  for (const [id, entry] of Object.entries(all)) {
    if (typeof entry === "string") {
      // A bare-string entry: wrap it as an encrypted content object.
      all[id] = { content: tee.encrypt(entry), contentHash: null, sellerAddress: null, createdAt: null };
      changed++;
    } else if (typeof entry.content === "string") {
      entry.content = tee.encrypt(entry.content);
      changed++;
    }
  }
  if (changed) {
    store.writeStore(all);
    console.log(`[tee] encrypted ${changed} plaintext listing(s) at rest`);
  }
}

async function start() {
  await tee.initEncryption();
  migratePlaintextContent();
  const status = tee.teeStatus();

  app.listen(PORT, () => {
    console.log(`Redact backend listening on http://localhost:${PORT}`);
    console.log(`  recorder/seller wallet: ${contract.signer.address}`);
    console.log(`  contract:               ${process.env.CONTRACT_ADDRESS}`);
    console.log(`  x402 payTo:             ${WALLET_ADDRESS} (${NETWORK} via ${FACILITATOR_URL})`);
    console.log(`  content key source:     ${status.keySource} (TEE ${status.tee ? "active" : "inactive"})`);
  });
}

start().catch((err) => {
  console.error(`Startup failed: ${err.message}`);
  process.exit(1);
});
