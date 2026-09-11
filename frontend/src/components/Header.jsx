import { Link, NavLink } from "react-router-dom";
import { useWallet } from "../lib/wallet";
import { shortAddress } from "../lib/format";

const navClass = ({ isActive }) =>
  `text-sm transition-colors ${isActive ? "text-ink" : "text-mute hover:text-ink"}`;

export default function Header() {
  const { isConnected, address, isCorrectNetwork, connect, connecting, switchNetwork, error } = useWallet();

  return (
    <header className="relative z-10 border-b border-line bg-page">
      <div className="mx-auto flex max-w-[1200px] items-center justify-between gap-6 px-6 py-4">
        <Link to="/" className="serif flex items-center gap-2.5 text-2xl leading-none">
          <span className="redaction-bar" aria-hidden="true" />
          Redact
        </Link>

        <nav className="hidden items-center gap-7 sm:flex">
          <NavLink to="/" end className={navClass}>
            Marketplace
          </NavLink>
          <NavLink to="/sell" className={navClass}>
            Sell
          </NavLink>
          <NavLink to="/agent" className={navClass}>
            Agent
          </NavLink>
          <NavLink to="/profile" className={navClass}>
            Profile
          </NavLink>
        </nav>

        <div className="flex items-center gap-3">
          {!isConnected ? (
            <button className="btn btn-secondary" onClick={connect} disabled={connecting} title={error || ""}>
              {connecting ? "Connecting…" : "Connect wallet"}
            </button>
          ) : isCorrectNetwork ? (
            <div className="flex items-center gap-2 text-sm">
              <span className="mono">{shortAddress(address)}</span>
              <span className="h-1.5 w-1.5 rounded-full bg-mint" />
              <span className="text-mute">Base Sepolia</span>
            </div>
          ) : (
            <div className="flex items-center gap-3 text-sm">
              <span className="mono">{shortAddress(address)}</span>
              <span className="text-bad" title="Wrong network">
                ▲
              </span>
              <button className="btn btn-secondary h-8 px-3 text-xs" onClick={() => switchNetwork().catch(() => {})}>
                Switch network
              </button>
            </div>
          )}
        </div>
      </div>
      <nav className="flex gap-6 px-6 pb-3 sm:hidden">
        <NavLink to="/" end className={navClass}>
          Marketplace
        </NavLink>
        <NavLink to="/sell" className={navClass}>
          Sell
        </NavLink>
        <NavLink to="/agent" className={navClass}>
          Agent
        </NavLink>
        <NavLink to="/profile" className={navClass}>
          Profile
        </NavLink>
      </nav>
    </header>
  );
}
