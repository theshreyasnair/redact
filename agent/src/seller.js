// Seller agent. Takes a raw research finding, writes the listing copy, prices
// it, checks the copy does not give the finding away, and submits it.
//
//   node src/seller.js --file ./findings/example.md
//   cat finding.md | node src/seller.js
//   flags: --price 0.25   --dry-run   --backend http://localhost:4021
const fs = require("fs");
const path = require("path");
const { ethers } = require("ethers");
const { parseArgs, EXPLORER_URL } = require("./config");
const { createEmitter } = require("./events");
const { draftListing, leakCheck } = require("./sellerLlm");

const MARKETPLACE_URL = "https://redact-lime.vercel.app";
const MAX_REDRAFTS = 2;
const PRICE_MIN = 0.05;
const PRICE_MAX = 1;

function readStdin() {
  return new Promise((resolve, reject) => {
    let data = "";
    process.stdin.setEncoding("utf8");
    process.stdin.on("data", (chunk) => (data += chunk));
    process.stdin.on("end", () => resolve(data));
    process.stdin.on("error", reject);
  });
}

async function loadFinding(args) {
  if (args.file) {
    const file = path.resolve(args.file);
    return { text: fs.readFileSync(file, "utf8"), source: path.basename(file) };
  }
  if (process.stdin.isTTY) throw new Error("Pass --file <path> or pipe the finding on stdin");
  return { text: await readStdin(), source: "stdin" };
}

function loadSellerConfig() {
  const args = parseArgs(process.argv.slice(2));
  const backendUrl = (args.backend ?? process.env.BACKEND_URL ?? "http://localhost:4021").replace(/\/$/, "");
  const dryRun = args["dry-run"] === "true";
  const price = args.price !== undefined ? Number(args.price) : null;

  const problems = [];
  if (price !== null && !(price >= PRICE_MIN && price <= PRICE_MAX)) problems.push(`--price must be between ${PRICE_MIN} and ${PRICE_MAX} USDC`);
  if (!process.env.AGENT_PRIVATE_KEY) problems.push("AGENT_PRIVATE_KEY is missing");
  if (!process.env.ANTHROPIC_API_KEY) problems.push("ANTHROPIC_API_KEY is missing");
  if (problems.length) throw new Error(problems.join("\n"));

  return { args, backendUrl, dryRun, price, privateKey: process.env.AGENT_PRIVATE_KEY };
}

function printListing(listing, price) {
  console.log("");
  console.log(`title:       ${listing.title}`);
  console.log(`category:    ${listing.category}`);
  console.log(`price:       ${price} USDC (suggested ${listing.suggestedPriceUsdc}: ${listing.priceReason})`);
  console.log(`description: ${listing.description}`);
  console.log("");
}

async function main() {
  const config = loadSellerConfig();
  const { text: finding, source } = await loadFinding(config.args);
  if (!finding.trim()) throw new Error("The finding is empty");

  const wallet = new ethers.Wallet(config.privateKey);
  const { emit, runId, flush } = createEmitter({ backendUrl: config.backendUrl });

  console.log(`run ${runId}`);
  console.log(`source:  ${source} (${finding.length} chars)`);
  console.log(`wallet:  ${wallet.address}`);
  console.log(`backend: ${config.backendUrl}${config.dryRun ? "  (dry run, nothing is submitted)" : ""}`);
  // First event of the run. The Agent page reads role from it.
  emit("start", {
    message: `seller run from ${source}${config.dryRun ? " (dry run)" : ""}`,
    data: { role: "seller", source, chars: finding.length, wallet: wallet.address, dryRun: config.dryRun },
  });

  // ---- draft, then check the copy for leaks; redraft with the flagged details excluded ----
  let listing = null;
  let check = null;
  let avoid = [];
  for (let attempt = 0; attempt <= MAX_REDRAFTS; attempt++) {
    listing = await draftListing({ finding, avoid });
    const words = listing.description.trim().split(/\s+/).length;
    emit(attempt === 0 ? "drafted" : "redrafted", {
      message: `"${listing.title}" · ${listing.category} · ${listing.suggestedPriceUsdc} USDC · ${words} words`,
      data: { title: listing.title, category: listing.category, price: listing.suggestedPriceUsdc, priceReason: listing.priceReason, attempt },
    });

    check = await leakCheck({ description: listing.description });
    emit("leak_check", {
      message: check.reconstructable
        ? `leaks: ${check.leakedDetails.join("; ") || check.reason}`
        : `clean. ${check.reason}`,
      data: { ...check, attempt },
    });
    if (!check.reconstructable) break;
    avoid = [...new Set([...avoid, ...check.leakedDetails])];
  }

  if (check.reconstructable) {
    printListing(listing, config.price ?? listing.suggestedPriceUsdc);
    emit("error", {
      message: `stopped: the description still gives the finding away after ${MAX_REDRAFTS} redrafts. ${check.reason}`,
      data: { leakedDetails: check.leakedDetails },
    });
    await flush();
    process.exit(1);
  }

  const price = config.price ?? Math.min(PRICE_MAX, Math.max(PRICE_MIN, Number(listing.suggestedPriceUsdc.toFixed(2))));
  printListing(listing, price);

  if (config.dryRun) {
    console.log("dry run: not submitted.");
    await flush();
    return;
  }

  // ---- submit ----
  let body;
  try {
    const res = await fetch(`${config.backendUrl}/api/listings`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Accept: "application/json" },
      body: JSON.stringify({
        title: listing.title,
        description: listing.description,
        category: listing.category,
        price,
        content: finding,
        sellerAddress: wallet.address,
      }),
    });
    body = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(body.error || `POST /api/listings returned ${res.status}`);
  } catch (err) {
    emit("error", { message: `submit failed: ${err.message}` });
    await flush();
    process.exit(1);
  }

  const txUrl = `${EXPLORER_URL}/tx/${body.txHash}`;
  const listingUrl = `${MARKETPLACE_URL}/listing/${body.listingId}`;
  emit("listed", {
    listingId: body.listingId,
    message: `listed for ${price} USDC. tx ${txUrl} · ${listingUrl}`,
    data: { listingId: body.listingId, contentHash: body.contentHash, txHash: body.txHash, txUrl, listingUrl, price },
  });
  console.log("");
  console.log(`listingId:   ${body.listingId}`);
  console.log(`contentHash: ${body.contentHash}`);
  console.log(`tx:          ${txUrl}`);
  console.log(`listing:     ${listingUrl}`);
  await flush();
}

main().catch(async (err) => {
  console.error(`\nseller stopped: ${err.message}`);
  process.exit(1);
});
