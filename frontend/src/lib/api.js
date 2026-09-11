import { BACKEND_URL } from "../config";

async function request(path, options = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(body.error || `Request failed (${res.status})`);
    err.status = res.status;
    throw err;
  }
  return body;
}

export const api = {
  listings: () => request("/api/listings"),
  listing: (id) => request(`/api/listings/${id}`),
  createListing: (data) =>
    request("/api/listings", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    }),
  reputation: (address) => request(`/api/reputation/${address}`),
  stats: () => request("/api/stats"),
  teeStatus: () => request("/api/tee-status"),
  purchase: (listingId, buyer) => request(`/api/purchases/${listingId}/${buyer}`),
  agentRuns: () => request("/api/agent/runs"),
  // Rejects with err.status === 404 when the arbitrator has not resolved this pair.
  dispute: (listingId, buyer) => request(`/api/disputes/${listingId}/${buyer}`),
  revealUrl: (id) => `${BACKEND_URL}/api/listings/${id}/reveal`,
  // Owner re-reveal: no payment, proves an existing on-chain purchase with a signed message.
  ownerContent: (id, { address, signature, timestamp }) =>
    request(`/api/listings/${id}/content`, {
      headers: {
        "X-Owner-Address": address,
        "X-Owner-Signature": signature,
        "X-Owner-Timestamp": String(timestamp),
      },
    }),
};
