// Seeds the marketplace by POSTing data/seed-listings.json to /api/listings.
// createListing calls share one nonce on the backend wallet, so each POST must
// confirm before the next is sent. The backend already awaits tx.wait() inside
// the request, so posting sequentially is enough to serialize the nonce.
require("dotenv").config();

const fs = require("fs");
const path = require("path");

// --url overrides everything, so you can seed a remote backend. Default is localhost.
function urlFlag(argv) {
  const i = argv.indexOf("--url");
  if (i !== -1 && argv[i + 1]) return argv[i + 1];
  const eq = argv.find((a) => a.startsWith("--url="));
  return eq ? eq.slice("--url=".length) : null;
}

const PORT = Number(process.env.PORT) || 4021;
const BACKEND_URL = (urlFlag(process.argv.slice(2)) || process.env.BACKEND_URL || `http://localhost:${PORT}`).replace(
  /\/$/,
  ""
);
const WALLET_ADDRESS = process.env.WALLET_ADDRESS;

async function main() {
  if (!WALLET_ADDRESS) throw new Error("WALLET_ADDRESS is not set in .env");

  const file = path.join(__dirname, "..", "data", "seed-listings.json");
  const listings = JSON.parse(fs.readFileSync(file, "utf8"));
  if (!Array.isArray(listings) || listings.length === 0) {
    throw new Error("data/seed-listings.json is empty or not an array");
  }

  console.log(`Seeding ${listings.length} listing(s) to ${BACKEND_URL}`);
  console.log(`sellerAddress: ${WALLET_ADDRESS}\n`);

  for (let i = 0; i < listings.length; i++) {
    const l = listings[i];
    process.stdout.write(`[${i + 1}/${listings.length}] "${l.title}" … `);
    let res;
    try {
      res = await fetch(`${BACKEND_URL}/api/listings`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json" },
        body: JSON.stringify({ ...l, sellerAddress: WALLET_ADDRESS }),
      });
    } catch (err) {
      throw new Error(`could not reach ${BACKEND_URL} (${err.cause?.code || err.message}). Is the backend running?`);
    }
    const body = await res.json().catch(() => ({}));
    if (!res.ok) {
      console.log("failed");
      throw new Error(`listing ${i + 1} rejected (${res.status}): ${body.error || "unknown error"}`);
    }
    // The POST already waited for the createListing tx to confirm.
    console.log(`listingId ${body.listingId}  tx ${body.txHash}`);
  }

  console.log("\nDone.");
}

main().catch((err) => {
  console.error(`\nseed stopped: ${err.message}`);
  process.exit(1);
});
