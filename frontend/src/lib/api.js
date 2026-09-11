import { BACKEND_URL } from "../config";

async function request(path, options = {}) {
  const res = await fetch(`${BACKEND_URL}${path}`, {
    ...options,
    headers: { Accept: "application/json", ...(options.headers || {}) },
  });
  const body = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(body.error || `Request failed (${res.status})`);
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
  revealUrl: (id) => `${BACKEND_URL}/api/listings/${id}/reveal`,
};
