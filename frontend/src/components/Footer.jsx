import { useEffect, useState } from "react";
import { CONTRACT_ADDRESS, EXPLORER_URL } from "../config";
import { shortAddress } from "../lib/format";
import { api } from "../lib/api";

// Polled once on mount. Shows whether the backend is running inside a TEE.
function TeeBadge() {
  const [status, setStatus] = useState(null);

  useEffect(() => {
    let alive = true;
    api
      .teeStatus()
      .then((s) => alive && setStatus(s))
      .catch(() => {});
    return () => {
      alive = false;
    };
  }, []);

  if (!status) return null;
  const secure = status.tee === true;
  return (
    <span className="flex items-center gap-1.5" title={`Content key source: ${status.keySource || "unknown"}`}>
      <span className={`h-1.5 w-1.5 rounded-full ${secure ? "bg-mint" : "bg-mute"}`} />
      {secure ? "Enclave-protected (TDX)" : "Not in TEE"}
    </span>
  );
}

export default function Footer() {
  return (
    <footer className="relative z-10 border-t border-line bg-page">
      <div className="mx-auto flex max-w-[1200px] flex-wrap items-center justify-between gap-3 px-6 py-5 text-xs text-mute">
        <a
          href={`${EXPLORER_URL}/address/${CONTRACT_ADDRESS}`}
          target="_blank"
          rel="noreferrer"
          className="mono hover:text-ink"
        >
          Contract {shortAddress(CONTRACT_ADDRESS, 6, 4)}
        </a>
        <div className="flex items-center gap-4">
          <TeeBadge />
          <span>Payments via x402 · Base Sepolia</span>
        </div>
      </div>
    </footer>
  );
}
