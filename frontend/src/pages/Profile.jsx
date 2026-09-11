import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useWallet } from "../lib/wallet";
import { listPurchases } from "../lib/storage";
import { formatUsdc, sameAddress, shortHash, trustLabel } from "../lib/format";
import { EXPLORER_URL } from "../config";
import RequireWallet from "../components/RequireWallet";
import ListingCard from "../components/ListingCard";
import { SkeletonGrid, SkeletonLine } from "../components/Skeleton";

function Stat({ label, value }) {
  return (
    <div className="card p-5">
      <span className="caps">{label}</span>
      <div className="mono mt-2 text-3xl">{value}</div>
    </div>
  );
}

function ProfileBody() {
  const { address } = useWallet();
  const [rep, setRep] = useState(null);
  const [mine, setMine] = useState(null);
  const [purchases, setPurchases] = useState([]);
  const [error, setError] = useState(null);

  useEffect(() => {
    let alive = true;
    setRep(null);
    setMine(null);
    setPurchases(listPurchases(address));
    Promise.all([api.reputation(address), api.listings()])
      .then(([r, listings]) => {
        if (!alive) return;
        setRep(r);
        setMine(listings.filter((l) => sameAddress(l.listedBy, address)));
      })
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [address]);

  return (
    <div className="page mx-auto max-w-[1200px] px-6 py-16">
      <span className="caps">Profile</span>
      <h1 className="mono mt-2 break-all text-2xl md:text-3xl">{address}</h1>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      <section className="mt-12">
        <h2 className="serif text-3xl">Reputation</h2>
        <p className="mt-1 text-sm text-dim">
          On-chain reputation is tracked per seller address. In this prototype listings are created by the backend
          wallet, so sales show up under that address rather than yours.
        </p>
        {!rep ? (
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            {[0, 1, 2, 3].map((i) => (
              <div key={i} className="card p-5">
                <SkeletonLine className="w-16" />
                <div className="skeleton mt-3 h-8 w-12" />
              </div>
            ))}
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">
            <Stat label="Sales" value={rep.totalSales} />
            <Stat label="Disputes" value={rep.totalDisputes} />
            <Stat label="Disputes lost" value={rep.disputesLost} />
            <Stat label="Trust score" value={trustLabel(rep)} />
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="serif text-3xl">Your listings</h2>
        {mine === null ? (
          <div className="mt-5">
            <SkeletonGrid count={3} />
          </div>
        ) : mine.length === 0 ? (
          <p className="mt-3 text-sm text-mute">
            Nothing listed yet.{" "}
            <Link to="/sell" className="text-accent hover:underline">
              Sell a finding
            </Link>
            .
          </p>
        ) : (
          <div className="mt-5 grid grid-cols-1 gap-4 md:grid-cols-3">
            {mine.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="serif text-3xl">Your purchases</h2>
        <p className="mt-1 text-sm text-dim">Saved in this browser after each purchase.</p>
        {purchases.length === 0 ? (
          <p className="mt-3 text-sm text-mute">No purchases from this wallet on this device.</p>
        ) : (
          <ul className="mt-5 flex flex-col divide-y divide-line border border-line rounded-lg">
            {purchases.map((p) => (
              <li key={p.listingId} className="flex flex-wrap items-center justify-between gap-3 px-5 py-4 text-sm">
                <Link to={`/listing/${p.listingId}`} className="hover:text-accent">
                  <span className="mono text-dim">#{p.listingId}</span> {p.title || "Listing"}
                </Link>
                <span className="flex items-center gap-4 text-xs">
                  <span className="mono text-mute">{shortHash(p.contentHash)}</span>
                  {p.txHash && (
                    <a href={`${EXPLORER_URL}/tx/${p.txHash}`} target="_blank" rel="noreferrer" className="mono text-accent hover:underline">
                      tx
                    </a>
                  )}
                </span>
              </li>
            ))}
          </ul>
        )}
      </section>
    </div>
  );
}

export default function Profile() {
  return (
    <RequireWallet title="Profile">
      <ProfileBody />
    </RequireWallet>
  );
}
