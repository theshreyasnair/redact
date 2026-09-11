import { useEffect, useMemo, useState } from "react";
import { api } from "../lib/api";
import { CATEGORIES } from "../config";
import { sentenceCase } from "../lib/format";
import HashStream from "../components/HashStream";
import ListingCard from "../components/ListingCard";
import StatsBar from "../components/StatsBar";
import EmptyState from "../components/EmptyState";
import { SkeletonGrid } from "../components/Skeleton";

const TABS = ["All", ...CATEGORIES];

// A redacted phrase. The text is real (and fictional) but painted bar-on-bar until hovered.
function Redacted({ children }) {
  return (
    <span className="redact" tabIndex={0}>
      {children}
    </span>
  );
}

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
          <h1 className="serif max-w-[820px] text-[26px] leading-[1.35] md:text-[34px]">
            A researcher found that <Redacted>nested persona instructions</Redacted> on{" "}
            <Redacted>Meridian-4</Redacted> drops refusal behavior when{" "}
            <Redacted>the outer frame says stay in character</Redacted>. They measured it on{" "}
            <Redacted>140</Redacted> items. The <Redacted>input-classifier</Redacted> mitigation brought it to{" "}
            <Redacted>6%</Redacted>. None of this is public.
          </h1>
          <p className="mt-6 max-w-[640px] text-[17px] leading-relaxed text-mute">
            A market for LLM research findings like that one, sold before they&apos;re public. Pay before you see. Verify
            against the chain.
          </p>
          <p className="mt-3 text-sm text-mute">Example only. The model and numbers are not real.</p>
        </div>
      </section>
      <div className="relative z-10 mx-auto max-w-[1200px] px-6 pb-24">

        <div className="mb-8 flex flex-wrap gap-x-6 gap-y-2 border-b border-line">
          {TABS.map((t) => (
            <button
              key={t}
              onClick={() => setTab(t)}
              className={`-mb-px border-b pb-3 text-sm ${
                tab === t ? "border-accent text-ink" : "border-transparent text-mute hover:text-ink"
              }`}
            >
              {sentenceCase(t)}
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
            hint={tab === "All" ? "Be the first to sell a finding." : `Nothing under ${sentenceCase(tab)} right now.`}
          />
        ) : (
          <div className="index">
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
