export function shortAddress(addr, head = 6, tail = 4) {
  if (!addr) return "";
  return `${addr.slice(0, head)}…${addr.slice(-tail)}`;
}

export function shortHash(hash) {
  if (!hash) return "";
  return `${hash.slice(0, 10)}…${hash.slice(-8)}`;
}

export function formatUsdc(price) {
  const n = Number(price);
  if (Number.isNaN(n)) return String(price);
  return `${n.toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 6 })} USDC`;
}

export function formatDate(unixSeconds) {
  if (!unixSeconds) return "";
  return new Date(unixSeconds * 1000).toLocaleDateString("en-US", {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function reputationLabel(rep) {
  if (!rep || !rep.totalSales) return "New seller";
  const s = rep.totalSales === 1 ? "sale" : "sales";
  const d = rep.totalDisputes === 1 ? "dispute" : "disputes";
  return `${rep.totalSales} ${s} · ${rep.totalDisputes} ${d}`;
}

export function trustScore(rep) {
  if (!rep || !rep.totalSales) return null;
  return ((rep.totalSales - rep.disputesLost) / rep.totalSales) * 100;
}

/**
 * "No sales yet" until the first sale, then the score. The score only counts
 * disputes that were lost, so any still-open disputes are called out next to it.
 */
export function trustLabel(rep) {
  const score = trustScore(rep);
  if (score === null) return "No sales yet";
  const open = Number(rep.totalDisputes || 0) - Number(rep.disputesLost || 0);
  const base = `${Math.round(score)}%`;
  if (open <= 0) return base;
  return `${base} · ${open} open dispute${open === 1 ? "" : "s"}`;
}

export function sameAddress(a, b) {
  return Boolean(a && b && a.toLowerCase() === b.toLowerCase());
}
