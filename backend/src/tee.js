// dstack (Phala TEE) integration: content encryption key + attestation.
//
// Inside an Intel TDX confidential VM, the content key is derived from the
// dstack socket and never leaves the enclave. Outside a TEE (local dev) we
// fall back to a key from CONTENT_KEY_DEV and warn that content is not
// enclave-protected.
const crypto = require("crypto");
const { DstackClient, getComposeHash } = require("@phala/dstack-sdk");

// Fixed derivation path. Change it and every stored ciphertext becomes unreadable.
const KEY_PATH = "redact/content-v1";
const KEY_PURPOSE = "content-encryption";

// The DstackClient constructor throws when the socket is missing, so build it
// lazily inside a try/catch. With no argument it finds /var/run/dstack.sock (and
// a few fallbacks). Override with DSTACK_SIMULATOR_ENDPOINT for the simulator.
let client = null; // set on init when the socket is present
let contentKey = null; // 32-byte Buffer
let keySource = null; // "dstack" | "dev"
let teeAvailable = false;

/**
 * Derives the content key. Call once on startup before any encrypt/decrypt.
 * Uses the enclave key when the dstack socket answers, otherwise CONTENT_KEY_DEV.
 */
async function initEncryption() {
  let reachable = false;
  try {
    client = new DstackClient(); // throws if the socket file is absent
    reachable = await client.isReachable();
  } catch {
    client = null;
    reachable = false;
  }

  if (reachable) {
    // getKey returns deterministic raw bytes for this path. Hash to a fixed 32-byte AES key.
    const { key } = await client.getKey(KEY_PATH, KEY_PURPOSE);
    contentKey = crypto.createHash("sha256").update(Buffer.from(key)).digest();
    keySource = "dstack";
    teeAvailable = true;
    console.log(`[tee] content key derived inside the enclave (dstack, path "${KEY_PATH}")`);
    return;
  }

  const dev = process.env.CONTENT_KEY_DEV;
  if (!dev || !dev.trim()) {
    throw new Error(
      "No dstack socket and CONTENT_KEY_DEV is unset. Set CONTENT_KEY_DEV in .env for local dev, or run inside a dstack TEE."
    );
  }
  contentKey = crypto.createHash("sha256").update(dev).digest();
  keySource = "dev";
  teeAvailable = false;
  console.warn("=".repeat(70));
  console.warn("[tee] WARNING: no dstack socket found. Content is NOT enclave-protected.");
  console.warn("[tee] Using CONTENT_KEY_DEV from .env. Local development only.");
  console.warn("=".repeat(70));
}

/** AES-256-GCM. Returns { iv, ciphertext, tag }, all base64. */
function encrypt(plaintext) {
  if (!contentKey) throw new Error("Encryption key not initialized; call initEncryption() first");
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", contentKey, iv);
  const ciphertext = Buffer.concat([cipher.update(String(plaintext), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    ciphertext: ciphertext.toString("base64"),
    tag: cipher.getAuthTag().toString("base64"),
  };
}

/** Reverses encrypt(). Throws if the tag does not verify. */
function decrypt(enc) {
  if (!contentKey) throw new Error("Encryption key not initialized; call initEncryption() first");
  const iv = Buffer.from(enc.iv, "base64");
  const decipher = crypto.createDecipheriv("aes-256-gcm", contentKey, iv);
  decipher.setAuthTag(Buffer.from(enc.tag, "base64"));
  const out = Buffer.concat([decipher.update(Buffer.from(enc.ciphertext, "base64")), decipher.final()]);
  return out.toString("utf8");
}

/** True for the { iv, ciphertext, tag } shape. */
function isEncrypted(value) {
  return (
    value &&
    typeof value === "object" &&
    typeof value.iv === "string" &&
    typeof value.ciphertext === "string" &&
    typeof value.tag === "string"
  );
}

function teeStatus() {
  return { tee: teeAvailable, keySource };
}

/**
 * TDX quote plus app identity. Anyone can verify which image is running.
 * Returns { tee: false, reason } when not in a TEE.
 */
async function getAttestation() {
  if (!teeAvailable) return { tee: false, reason: "not running in dstack" };

  // report_data binds the app name into the quote. 64 bytes max.
  const reportData = crypto.createHash("sha256").update("redact-backend").digest();
  const quote = await client.getQuote(reportData);

  let info = null;
  try {
    info = await client.info();
  } catch (err) {
    console.error("[tee] info() failed:", err.message);
  }

  const appId = info?.app_id ?? null;
  let composeHash = null;
  const appCompose = info?.tcb_info?.app_compose ?? null;
  if (appCompose) {
    try {
      composeHash = getComposeHash(JSON.parse(appCompose));
    } catch {
      composeHash = null;
    }
  }

  return {
    tee: true,
    quote: quote.quote,
    eventLog: quote.event_log,
    appId,
    appName: info?.app_name ?? null,
    instanceId: info?.instance_id ?? null,
    composeHash,
    rtmrs: info?.tcb_info
      ? {
          mrtd: info.tcb_info.mrtd,
          rtmr0: info.tcb_info.rtmr0,
          rtmr1: info.tcb_info.rtmr1,
          rtmr2: info.tcb_info.rtmr2,
          rtmr3: info.tcb_info.rtmr3,
        }
      : null,
    // Paste the quote into the t16z explorer to check the measurements.
    verify: "https://proof.t16z.com/",
    ...(appId ? { trustCenter: `https://cloud.phala.network/dashboard/cvms/${appId}` } : {}),
  };
}

module.exports = {
  KEY_PATH,
  initEncryption,
  encrypt,
  decrypt,
  isEncrypted,
  teeStatus,
  getAttestation,
};
