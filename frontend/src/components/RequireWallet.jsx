import { useWallet } from "../lib/wallet";

export default function RequireWallet({ children, title }) {
  const { isConnected, isCorrectNetwork, connect, switchNetwork, connecting, hasWallet, error } = useWallet();

  if (!isConnected) {
    return (
      <div className="page mx-auto max-w-[640px] px-6 py-24 text-center">
        <h1 className="serif text-5xl">{title}</h1>
        <p className="mt-4 text-mute">Connect a wallet to continue.</p>
        {!hasWallet && <p className="mt-2 text-sm text-bad">No wallet detected. Install MetaMask first.</p>}
        {error && <p className="mt-2 text-sm text-bad">{error}</p>}
        <button className="btn btn-primary mt-8" onClick={connect} disabled={connecting}>
          {connecting ? "Connecting…" : "Connect wallet"}
        </button>
      </div>
    );
  }

  if (!isCorrectNetwork) {
    return (
      <div className="page mx-auto max-w-[640px] px-6 py-24 text-center">
        <h1 className="serif text-5xl">{title}</h1>
        <p className="mt-4 text-mute">This app runs on Base Sepolia. Your wallet is on another network.</p>
        <button className="btn btn-primary mt-8" onClick={() => switchNetwork().catch(() => {})}>
          Switch to Base Sepolia
        </button>
      </div>
    );
  }

  return children;
}
