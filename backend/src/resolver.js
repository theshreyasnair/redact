// Automated dispute resolution. Runs inside the TEE.
//
// Every 30 seconds (and once on startup) this scans the contract for
// DisputeOpened events, asks Claude whether the delivered content matches the
// listing description, and calls resolveDispute with the verdict. The backend
// wallet is the contract owner, so it is the only address allowed to do this.
// The code is attested, so the arbitrator cannot be swapped out quietly.
//
// State on disk (backend/data):
//   resolver-state.json  last scanned block, pending disputes, handled pairs
//   disputes.json        every verdict this arbitrator has written on-chain
const fs = require("fs");
const path = require("path");
const Anthropic = require("@anthropic-ai/sdk");
const { zodOutputFormat } = require("@anthropic-ai/sdk/helpers/zod");
const { z } = require("zod");

const contract = require("./contract");
const store = require("./store");
const tee = require("./tee");

const { ethers, provider, readContract, writeContract } = contract;

const TICK_MS = 30_000;
const MODEL = "claude-sonnet-4-6";
const DATA_DIR = path.join(__dirname, "..", "data");
const STATE_PATH = path.join(DATA_DIR, "resolver-state.json");
const DISPUTES_PATH = path.join(DATA_DIR, "disputes.json");

// Log range per eth_getLogs call. Starts wide and halves whenever the RPC
// rejects the range (Alchemy's free tier allows 10 blocks). Never below MIN.
const CHUNK_START = 2000;
const CHUNK_MIN = 10;

const PURCHASE_DISPUTED = 2;

const SYSTEM_PROMPT =
  "You are resolving a dispute between a buyer who paid for research and a seller who delivered it. " +
  "The buyer claims the content did not deliver what the description promised. " +
  "Judge only whether the content substantively delivers the description's specific claims: named models, methods, numbers, artifacts. " +
  "Content that is generic, restates the description, defers specifics to a future version, or describes widely known material does not deliver. " +
  "If the content refers to an attachment, appendix, file, or blob that is not actually present in the content, treat that artifact as not delivered. A reference to an artifact is not the artifact. " +
  "Do not weigh price or tone. Buyer wins if the content fails to deliver.";

const Verdict = z.object({
  buyerWins: z.boolean().describe("true if the content fails to deliver what the description promised"),
  confidence: z.number().min(0).max(1).describe("How sure you are, from 0 to 1"),
  reason: z.string().describe("Why. Two sentences at most."),
});

// ---------- disk ----------

function readJson(file, fallback) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    return raw.trim() ? JSON.parse(raw) : fallback;
  } catch (err) {
    if (err.code === "ENOENT") return fallback;
    throw err;
  }
}

function writeJson(file, value) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const tmp = `${file}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(value, null, 2));
  fs.renameSync(tmp, file);
}

function readState() {
  const s = readJson(STATE_PATH, {});
  return {
    lastScannedBlock: Number.isInteger(s.lastScannedBlock) ? s.lastScannedBlock : null,
    pending: s.pending && typeof s.pending === "object" ? s.pending : {},
    handled: s.handled && typeof s.handled === "object" ? s.handled : {},
  };
}

function writeState(state) {
  writeJson(STATE_PATH, state);
}

function readDisputes() {
  const list = readJson(DISPUTES_PATH, []);
  return Array.isArray(list) ? list : [];
}

function appendDispute(record) {
  const list = readDisputes();
  list.push(record);
  writeJson(DISPUTES_PATH, list);
}

function pairKey(listingId, buyer) {
  return `${listingId}:${buyer.toLowerCase()}`;
}

// ---------- public reads (used by the API routes) ----------

/** All resolutions, newest first. */
function listResolutions() {
  return readDisputes().slice().reverse();
}

/** One resolution for a listing/buyer pair, or null. */
function getResolution(listingId, buyer) {
  const key = pairKey(listingId, buyer);
  return readDisputes().find((d) => pairKey(d.listingId, d.buyer) === key) ?? null;
}

// ---------- chain scanning ----------

const openedTopic = readContract.interface.getEvent("DisputeOpened").topicHash;
const resolvedTopic = readContract.interface.getEvent("DisputeResolved").topicHash;

function isRangeError(err) {
  const text = `${err?.info?.error?.message || ""} ${err?.error?.message || ""} ${err?.shortMessage || ""} ${err?.message || ""}`.toLowerCase();
  return /block range|range too large|too many blocks|exceeds|limited to|up to a \d+ block|query returned more than/.test(text);
}

let chunkSize = CHUNK_START;
let loggedChunkSize = CHUNK_START;

/**
 * Fetches DisputeOpened and DisputeResolved logs in [from, to] with one
 * eth_getLogs call per chunk. Shrinks the chunk when the RPC rejects it.
 */
async function fetchDisputeLogs(from, to) {
  const out = [];
  let cursor = from;
  while (cursor <= to) {
    const end = Math.min(to, cursor + chunkSize - 1);
    let logs;
    try {
      logs = await provider.getLogs({
        address: readContract.target,
        fromBlock: cursor,
        toBlock: end,
        topics: [[openedTopic, resolvedTopic]],
      });
    } catch (err) {
      if (isRangeError(err) && chunkSize > CHUNK_MIN) {
        chunkSize = Math.max(CHUNK_MIN, Math.floor(chunkSize / 2));
        continue;
      }
      throw err;
    }
    // Log the size once it is accepted, not on every step-down.
    if (chunkSize !== loggedChunkSize) {
      console.warn(`[resolver] RPC rejected the log range; chunk size settled at ${chunkSize} blocks`);
      loggedChunkSize = chunkSize;
    }
    for (const log of logs) {
      const parsed = readContract.interface.parseLog(log);
      if (!parsed) continue;
      out.push({
        name: parsed.name,
        listingId: Number(parsed.args.listingId),
        buyer: ethers.getAddress(parsed.args.buyer),
        buyerWins: parsed.name === "DisputeResolved" ? Boolean(parsed.args.buyerWins) : undefined,
        blockNumber: log.blockNumber,
        txHash: log.transactionHash,
      });
    }
    cursor = end + 1;
  }
  return out;
}

/** Applies a batch of logs to the pending set. Resolved pairs drop out. */
function applyLogs(state, logs) {
  for (const log of logs) {
    const key = pairKey(log.listingId, log.buyer);
    if (log.name === "DisputeOpened") {
      if (!state.handled[key] && !getResolution(log.listingId, log.buyer)) {
        state.pending[key] = { listingId: log.listingId, buyer: log.buyer, blockNumber: log.blockNumber, txHash: log.txHash };
      }
    } else if (log.name === "DisputeResolved") {
      delete state.pending[key];
    }
  }
}

// ---------- arbitration ----------

let anthropic = null;

/** Asks Claude for a verdict. Throws on any failure; the caller retries next tick. */
async function arbitrate({ title, description, category, content }) {
  const userText =
    `Listing title: ${title}\n` +
    `Category: ${category}\n\n` +
    `Description the buyer paid for:\n${description}\n\n` +
    `Content the seller delivered:\n${content}`;

  const response = await anthropic.messages.parse(
    {
      model: MODEL,
      max_tokens: 1024,
      system: SYSTEM_PROMPT,
      messages: [{ role: "user", content: userText }],
      output_config: { format: zodOutputFormat(Verdict) },
    },
    { timeout: 90_000 }
  );

  if (response.stop_reason === "refusal") throw new Error("model refused to arbitrate");
  const verdict = response.parsed_output;
  if (!verdict) throw new Error(`no structured verdict (stop_reason=${response.stop_reason})`);
  return verdict;
}

/**
 * Loads the plaintext content for a listing from the encrypted store.
 * Returns null when the store has no entry: the enclave never held the
 * content, so it cannot arbitrate and never will. Throws on decrypt failure.
 */
function loadContent(listingId) {
  const entry = store.getEntry(listingId);
  if (!entry) return null;
  return tee.isEncrypted(entry.content) ? tee.decrypt(entry.content) : entry.content;
}

/**
 * Resolves one pending dispute. Returns true when it should leave the pending
 * set (resolved, already resolved, or permanently failed). Returns false to
 * retry on the next tick.
 */
async function resolveOne(state, item, onResolved) {
  const { listingId, buyer } = item;
  const key = pairKey(listingId, buyer);
  const tag = `listing=${listingId} buyer=${buyer}`;

  // Already written by an earlier run that crashed before dropping it from pending.
  if (getResolution(listingId, buyer)) return true;

  // Confirm on-chain state before spending an arbitration call.
  const purchase = await contract.getPurchase(listingId, buyer);
  if (purchase.statusCode !== PURCHASE_DISPUTED) {
    console.log(`[resolver] ${tag}: purchase status is ${purchase.status}, nothing to resolve`);
    return true;
  }

  const listing = await contract.getListing(listingId);
  if (!listing) {
    console.error(`[resolver] ${tag}: listing not found on-chain`);
    return false;
  }

  let content;
  try {
    content = loadContent(listingId);
  } catch (err) {
    console.error(`[resolver] ${tag}: cannot load content (${err.message}); will retry`);
    return false;
  }
  if (content === null) {
    // Terminal: the enclave cannot arbitrate what it never held.
    console.error(`[resolver] ${tag}: no content in the store; skipped`);
    state.handled[key] = { skipped: true, reason: "no content", at: new Date().toISOString() };
    return true;
  }

  let verdict;
  try {
    verdict = await arbitrate({ title: listing.title, description: listing.description, category: listing.category, content });
  } catch (err) {
    const detail = err instanceof Anthropic.APIError ? `API ${err.status}: ${err.message}` : err.message;
    console.error(`[resolver] ${tag}: arbitration failed (${detail}); will retry next tick`);
    return false;
  }
  console.log(`[resolver] ${tag}: verdict buyerWins=${verdict.buyerWins} confidence=${verdict.confidence.toFixed(2)}`);

  let txHash;
  try {
    const tx = await writeContract.resolveDispute(listingId, buyer, verdict.buyerWins);
    const receipt = await tx.wait();
    txHash = receipt.hash;
  } catch (err) {
    const reason = contract.contractErrorMessage(err);
    // A revert means the chain will never accept this call as-is. Do not retry.
    if (err?.code === "CALL_EXCEPTION" || /revert|No open dispute|does not exist|Ownable/i.test(reason)) {
      console.error(`[resolver] ${tag}: resolveDispute reverted (${reason}); marked handled`);
      state.handled[key] = { reason, at: new Date().toISOString() };
      return true;
    }
    console.error(`[resolver] ${tag}: resolveDispute failed (${reason}); will retry next tick`);
    return false;
  }

  appendDispute({
    listingId,
    buyer,
    buyerWins: verdict.buyerWins,
    confidence: verdict.confidence,
    reason: verdict.reason,
    txHash,
    resolvedAt: new Date().toISOString(),
  });
  console.log(`[resolver] ${tag}: resolved on-chain tx=${txHash}`);
  if (onResolved) onResolved();
  return true;
}

// ---------- loop ----------

let running = false;
let timer = null;

async function tick(onResolved) {
  if (running) return;
  running = true;
  try {
    const state = readState();
    const latest = await provider.getBlockNumber();

    let from;
    if (state.lastScannedBlock !== null) {
      from = state.lastScannedBlock + 1;
    } else {
      const deploy = Number(process.env.CONTRACT_DEPLOY_BLOCK);
      if (Number.isInteger(deploy) && deploy >= 0) {
        from = deploy;
      } else {
        console.warn("[resolver] CONTRACT_DEPLOY_BLOCK is not set; starting from the current block");
        from = latest;
      }
    }

    if (from <= latest) {
      // Scan in slices and persist after each so a crash mid-scan never rescans from the start.
      const SLICE = 5000;
      let cursor = from;
      while (cursor <= latest) {
        const end = Math.min(latest, cursor + SLICE - 1);
        const logs = await fetchDisputeLogs(cursor, end);
        applyLogs(state, logs);
        state.lastScannedBlock = end;
        writeState(state);
        cursor = end + 1;
      }
    }

    const pending = Object.values(state.pending);
    for (const item of pending) {
      let done = false;
      try {
        done = await resolveOne(state, item, onResolved);
      } catch (err) {
        console.error(`[resolver] listing=${item.listingId} buyer=${item.buyer}: ${contract.contractErrorMessage(err)}; will retry next tick`);
      }
      if (done) delete state.pending[pairKey(item.listingId, item.buyer)];
      writeState(state);
    }
  } catch (err) {
    console.error(`[resolver] tick failed: ${contract.contractErrorMessage(err)}`);
  } finally {
    running = false;
  }
}

/**
 * Starts the loop. Returns false (and logs once) when ANTHROPIC_API_KEY is
 * missing. `onResolved` runs after each on-chain resolution.
 */
function start({ onResolved } = {}) {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey || !apiKey.trim()) {
    console.warn("[resolver] resolver disabled: ANTHROPIC_API_KEY is not set");
    return false;
  }
  anthropic = new Anthropic({ apiKey, maxRetries: 2 });

  const loop = async () => {
    await tick(onResolved);
    timer = setTimeout(loop, TICK_MS);
  };
  console.log(`[resolver] started: model ${MODEL}, every ${TICK_MS / 1000}s, arbitrator ${contract.signer.address}`);
  loop();
  return true;
}

function stop() {
  if (timer) clearTimeout(timer);
  timer = null;
}

module.exports = { start, stop, tick, listResolutions, getResolution, STATE_PATH, DISPUTES_PATH };
