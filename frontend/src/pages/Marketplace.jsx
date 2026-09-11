import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { CATEGORIES } from "../config";
import HashStream from "../components/HashStream";
import ListingCard from "../components/ListingCard";
import StatsBar from "../components/StatsBar";
import EmptyState from "../components/EmptyState";
import { SkeletonGrid } from "../components/Skeleton";

const TABS = ["All", ...CATEGORIES];

export default function Marketplace() {
  const [listings, setListings] = useState(null);
  const [error, setError] = useState(null);
  const [tab, setTab] = useState("All");

  useEffect(() => {
    let alive = true;
    api
      .listings()
      .then((data) => alive && setListings(data))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, []);

  const visible = useMemo(() => {
    if (!listings) return [];
    const active = listings.filter((l) => l.statusCode === 0);
    return tab === "All" ? active : active.filter((l) => l.category === tab);
  }, [listings, tab]);

  return (
    <div className="page relative">
      <section className="relative flex min-h-[420px] items-center overflow-hidden md:min-h-[640px]">
        <HashStream size={520} center={(W, H) => ({ x: W * 0.78, y: H / 2 })} />
        <div className="relative z-10 mx-auto w-full max-w-[1200px] px-6 py-20">
          <h1 className="serif text-[56px] leading-[0.95] md:text-[96px]">Redact</h1>
          <p className="mt-6 max-w-[560px] text-lg text-mute">
            Buy and sell discoveries about frontier AI models. Pay before you see.
          </p>
        </div>
      </section>
      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24">

        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b pb-3 text-sm ${
                tab === t ? "border-accent text-paper" : "border-transparent text-mute hover:text-paper"
              }`}
            >
              {t}
            </button>
          ))}
        </div>

        {error ? (
          <div className="card p-6 text-sm text-bad">
            Could not reach the backend. {error}
          </div>
        ) : listings === null ? (
          <SkeletonGrid />
        ) : visible.length === 0 ? (
          <EmptyState
            title="No listings yet"
            hint={tab === "All" ? "Be the first to sell a finding." : `Nothing under ${tab} right now.`}
          />
        ) : (
          <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
            {visible.map((l, i) => (
              <ListingCard key={l.id} listing={l} index={i} />
            ))}
          </div>
        )}
      </div>
      <StatsBar />
    </div>
  );
}
