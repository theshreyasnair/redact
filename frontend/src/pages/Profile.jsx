import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { useWallet } from "../lib/wallet";
import { listPurchases } from "../lib/storage";
import { sameAddress, shortHash, trustLabel } from "../lib/format";
import { EXPLORER_URL } from "../config";
import RequireWallet from "../components/RequireWallet";
import ListingCard from "../components/ListingCard";
import { SkeletonGrid, SkeletonLine } from "../components/Skeleton";

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
      <h1 className="mono break-all text-[22px] md:text-[28px]">{address}</h1>
      {error && <p className="mt-4 text-sm text-bad">{error}</p>}

      <section className="mt-12">
        <h2 className="label">Reputation</h2>
        {!rep ? (
          <div className="mt-2 flex flex-col gap-2">
            <SkeletonLine className="w-56" />
            <SkeletonLine className="w-24" />
          </div>
        ) : (
          <>
            <p className="mono mt-2 text-sm">
              {rep.totalSales} sales · {rep.totalDisputes} disputes · {rep.disputesLost} lost
            </p>
            <p className="mono mt-1 text-sm text-mute">{trustLabel(rep)}</p>
          </>
        )}
        <p className="mt-3 text-[13px] text-mute">
          Reputation is per seller address. This prototype lists everything from one backend wallet.
        </p>
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
          <div className="index mt-5">
            {mine.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} />
            ))}
          </div>
        )}
      </section>

      <section className="mt-14">
        <h2 className="serif text-3xl">Your purchases</h2>
        <p className="mt-1 text-sm text-mute">Saved in this browser after each purchase.</p>
        {purchases.length === 0 ? (
          <p className="mt-3 text-sm text-mute">No purchases from this wallet on this device.</p>
        ) : (
          <ul className="mt-5 flex flex-col border-t border-line">
            {purchases.map((p) => (
              <li key={p.listingId} className="flex flex-wrap items-center justify-between gap-3 border-b border-line py-4 text-sm">
                <Link to={`/listing/${p.listingId}`} className="hover:text-accent">
                  <span className="mono text-mute">#{p.listingId}</span> {p.title || "Listing"}
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
