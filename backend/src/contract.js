// Ethers v6 wiring for the ResearchMarketplace contract on Base Sepolia.
const { ethers } = require("ethers");
const abi = require("../abi/ResearchMarketplace.json");

const { PRIVATE_KEY, CONTRACT_ADDRESS, BASE_SEPOLIA_RPC_URL } = process.env;

if (!CONTRACT_ADDRESS) throw new Error("CONTRACT_ADDRESS is not set");
if (!PRIVATE_KEY) throw new Error("PRIVATE_KEY is not set");

// Base Sepolia. staticNetwork stops ethers from re-requesting eth_chainId on
// every call; batchMaxCount coalesces the per-listing reads into one or two
// HTTP requests instead of one request per call.
const BASE_SEPOLIA = ethers.Network.from(84532);
const provider = new ethers.JsonRpcProvider(
  BASE_SEPOLIA_RPC_URL || "https://sepolia.base.org",
  BASE_SEPOLIA,
  { staticNetwork: BASE_SEPOLIA, batchMaxCount: 20 }
);
const signer = new ethers.Wallet(PRIVATE_KEY, provider);

/** True when an error looks like an RPC rate-limit (HTTP 429 or "over rate limit"). */
function isRateLimitError(err) {
  const text = `${err?.info?.error?.message || ""} ${err?.error?.message || ""} ${err?.shortMessage || ""} ${err?.message || ""}`.toLowerCase();
  return (
    err?.info?.responseStatus === 429 ||
    err?.info?.error?.code === 429 ||
    err?.code === "SERVER_ERROR" && /rate limit|too many requests/.test(text) ||
    /over rate limit|rate limit|too many requests|429/.test(text)
  );
}

// Read-only instance (provider) and signing instance (backend wallet).
const readContract = new ethers.Contract(CONTRACT_ADDRESS, abi, provider);
const writeContract = new ethers.Contract(CONTRACT_ADDRESS, abi, signer);

const USDC_DECIMALS = 6;
const ListingStatus = { 0: "Active", 1: "Delisted" };
const PurchaseStatus = { 0: "None", 1: "Completed", 2: "Disputed", 3: "Resolved" };

/** Human-readable USDC string/number -> base units (bigint, 6 decimals). */
function usdcToBaseUnits(price) {
  return ethers.parseUnits(String(price), USDC_DECIMALS);
}

/** Base units (bigint) -> human-readable USDC string, e.g. "0.25". */
function baseUnitsToUsdc(units) {
  return ethers.formatUnits(units, USDC_DECIMALS);
}

function formatReputation(rep) {
  return {
    totalSales: Number(rep.totalSales),
    totalDisputes: Number(rep.totalDisputes),
    disputesLost: Number(rep.disputesLost),
  };
}

function formatListing(l) {
  return {
    id: Number(l.id),
    seller: l.seller,
    contentHash: l.contentHash,
    title: l.title,
    description: l.description,
    category: l.category,
    price: baseUnitsToUsdc(l.price),
    priceBaseUnits: l.price.toString(),
    timestamp: Number(l.timestamp),
    status: ListingStatus[Number(l.status)] ?? Number(l.status),
    statusCode: Number(l.status),
  };
}

function formatPurchase(p) {
  return {
    timestamp: Number(p.timestamp),
    status: PurchaseStatus[Number(p.status)] ?? Number(p.status),
    statusCode: Number(p.status),
    exists: Number(p.timestamp) > 0,
  };
}

async function getListingCount() {
  return Number(await readContract.listingCount());
}

/** Returns formatted listing or null if the id is out of range / empty. */
async function getListing(id) {
  try {
    const l = await readContract.getListing(id);
    if (Number(l.id) === 0 && l.seller === ethers.ZeroAddress) return null;
    return formatListing(l);
  } catch (err) {
    // The contract reverts with "Listing does not exist" for unknown ids.
    if (/does not exist/i.test(contractErrorMessage(err))) return null;
    throw err;
  }
}

async function getSellerReputation(address) {
  return formatReputation(await readContract.getSellerReputation(address));
}

async function getPurchase(listingId, buyer) {
  return formatPurchase(await readContract.getPurchase(listingId, buyer));
}

/**
 * Creates a listing with the backend signer as the on-chain seller.
 * Returns { listingId, txHash }.
 */
async function createListing({ contentHash, title, description, category, priceUsdc }) {
  const price = usdcToBaseUnits(priceUsdc);
  const tx = await writeContract.createListing(contentHash, title, description, category, price);
  const receipt = await tx.wait();

  let listingId = null;
  for (const log of receipt.logs) {
    try {
      const parsed = writeContract.interface.parseLog(log);
      if (parsed && parsed.name === "ListingCreated") {
        listingId = Number(parsed.args.listingId);
        break;
      }
    } catch {
      /* not one of ours */
    }
  }
  if (listingId === null) {
    // Fallback: the new listing is the latest one.
    listingId = await getListingCount();
  }
  return { listingId, txHash: receipt.hash };
}

/** Records a purchase; only the recorder wallet may call this. Returns txHash. */
async function recordPurchase(listingId, buyer) {
  const tx = await writeContract.recordPurchase(listingId, buyer);
  const receipt = await tx.wait();
  return receipt.hash;
}

/** Extracts a readable revert reason from an ethers error. */
function contractErrorMessage(err) {
  return (
    err?.reason ||
    err?.shortMessage ||
    err?.info?.error?.message ||
    err?.message ||
    "Contract call failed"
  );
}

module.exports = {
  ethers,
  provider,
  signer,
  readContract,
  writeContract,
  usdcToBaseUnits,
  baseUnitsToUsdc,
  getListingCount,
  getListing,
  getSellerReputation,
  getPurchase,
  createListing,
  recordPurchase,
  contractErrorMessage,
  isRateLimitError,
};
