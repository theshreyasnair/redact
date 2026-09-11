// Minimal JSON-file content store: { [listingId]: { content, sellerAddress, contentHash, createdAt } }
const fs = require("fs");
const path = require("path");

const STORE_PATH = path.join(__dirname, "..", "data", "research-store.json");

function readStore() {
  try {
    const raw = fs.readFileSync(STORE_PATH, "utf8");
    return raw.trim() ? JSON.parse(raw) : {};
  } catch (err) {
    if (err.code === "ENOENT") return {};
    throw err;
  }
}

function writeStore(store) {
  fs.mkdirSync(path.dirname(STORE_PATH), { recursive: true });
  const tmp = `${STORE_PATH}.tmp`;
  fs.writeFileSync(tmp, JSON.stringify(store, null, 2));
  fs.renameSync(tmp, STORE_PATH);
}

function getEntry(listingId) {
  return readStore()[String(listingId)] ?? null;
}

function setEntry(listingId, entry) {
  const store = readStore();
  store[String(listingId)] = entry;
  writeStore(store);
}

module.exports = { getEntry, setEntry, readStore, writeStore, STORE_PATH };
