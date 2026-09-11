import { useEffect, useState } from "react";
import { api } from "../lib/api";
import { STATS_REFRESH_MS } from "../config";

// Served from the backend's cached stats, so the browser stops hitting the
// public RPC directly every refresh.
async function loadStats() {
  return api.stats();
}

function Stat({ label, value }) {
  return (
    <div className="flex items-baseline gap-2">
      <span className="label">{label}</span>
      <span className="mono text-sm">{value == null ? "—" : value.toLocaleString("en-US")}</span>
    </div>
  );
}

export default function StatsBar() {
  const [stats, setStats] = useState(null);

  useEffect(() => {
    let alive = true;
    const tick = () =>
      loadStats()
        .then((s) => alive && setStats(s))
        .catch(() => {});
    tick();
    const id = setInterval(tick, STATS_REFRESH_MS);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // In normal flow, directly above the footer, so it never covers page content.
  return (
    <div className="border-t border-line bg-page">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center gap-x-8 gap-y-1 px-6 py-2">
        <Stat label="Listings" value={stats?.listings} />
        <Stat label="Purchases" value={stats?.purchases} />
        <Stat label="Disputes" value={stats?.disputes} />
        <span className="ml-auto flex items-center gap-2 text-[11px] text-dim">
          <span className="h-1.5 w-1.5 rounded-full bg-mint" />
          live from Base Sepolia
        </span>
      </div>
    </div>
  );
}
