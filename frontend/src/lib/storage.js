const PREFIX = "bbb:purchase:";

function key(listingId, address) {
  return `${PREFIX}${listingId}:${address.toLowerCase()}`;
}

export function savePurchase(listingId, address, data) {
  try {
    localStorage.setItem(key(listingId, address), JSON.stringify({ ...data, savedAt: Date.now() }));
  } catch {
    /* storage unavailable; the content is still shown this session */
  }
}

export function loadPurchase(listingId, address) {
  try {
    const raw = localStorage.getItem(key(listingId, address));
    return raw ? JSON.parse(raw) : null;
  } catch {
    return null;
  }
}

export function listPurchases(address) {
  const out = [];
  try {
    const suffix = `:${address.toLowerCase()}`;
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (k && k.startsWith(PREFIX) && k.endsWith(suffix)) {
        const listingId = Number(k.slice(PREFIX.length, -suffix.length));
        out.push({ listingId, ...JSON.parse(localStorage.getItem(k)) });
      }
    }
  } catch {
    /* ignore */
  }
  return out.sort((a, b) => (b.savedAt || 0) - (a.savedAt || 0));
}
