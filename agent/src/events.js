const { randomBytes } = require("crypto");

const COLORS = {
  reset: "\x1b[0m",
  gray: "\x1b[90m",
  amber: "\x1b[33m",
  green: "\x1b[32m",
  red: "\x1b[31m",
  cyan: "\x1b[36m",
  bold: "\x1b[1m",
};

const TYPE_COLOR = {
  start: COLORS.gray,
  scored: COLORS.cyan,
  skipped: COLORS.gray,
  buying: COLORS.amber,
  paid: COLORS.amber,
  refetched: COLORS.amber,
  verified: COLORS.green,
  hash_mismatch: COLORS.red,
  evaluated: COLORS.cyan,
  disputed: COLORS.red,
  summary: COLORS.bold,
  error: COLORS.red,
  // seller
  drafted: COLORS.cyan,
  leak_check: COLORS.gray,
  redrafted: COLORS.amber,
  listed: COLORS.green,
};

const useColor = process.stdout.isTTY && !process.env.NO_COLOR;

function paint(color, text) {
  return useColor ? `${color}${text}${COLORS.reset}` : text;
}

/**
 * Creates an emitter bound to one run. Every event goes to the console and is
 * POSTed to the backend. A failed POST is swallowed: logging must never crash the agent.
 */
function createEmitter({ backendUrl }) {
  const runId = randomBytes(4).toString("hex");
  const pending = new Set();

  function emit(type, { listingId = null, message, data = {} } = {}) {
    const event = { ts: new Date().toISOString(), listingId, type, message, data };

    const stamp = paint(COLORS.gray, event.ts.slice(11, 19));
    const tag = paint(TYPE_COLOR[type] || "", `[${type}]`.padEnd(15));
    const id = listingId != null ? paint(COLORS.gray, `#${listingId} `) : "";
    console.log(`${stamp} ${tag} ${id}${message}`);

    const p = fetch(`${backendUrl}/api/agent/events`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ runId, event }),
    })
      .catch(() => {})
      .finally(() => pending.delete(p));
    pending.add(p);
    return event;
  }

  // Let in-flight POSTs finish before the process exits.
  const flush = () => Promise.allSettled([...pending]);

  return { runId, emit, flush };
}

module.exports = { createEmitter };
