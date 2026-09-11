import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { EXPLORER_URL } from "../config";
import { readProvider } from "../lib/contract";
import HashStream from "../components/HashStream";
import { SkeletonLine } from "../components/Skeleton";

const POLL_MS = 3000;
// How often to ask the backend whether an open dispute has been arbitrated.
const DISPUTE_POLL_MS = 15_000;
const BASESCAN_RE = /https?:\/\/(?:[a-z0-9-]+\.)*basescan\.org\/[^\s)"']*/gi;

// Type → text colour. Everything else falls back to the primary text colour.
const TYPE_CLASS = {
  buying: "text-accent",
  paid: "text-accent",
  verified: "text-mint",
  disputed: "text-bad",
  resolved: "text-mint",
  hash_mismatch: "text-bad",
  error: "text-bad",
  skipped: "text-mute",
  scored: "text-ink",
  start: "text-mute",
  // seller
  drafted: "text-ink",
  leak_check: "text-mute",
  redrafted: "text-accent",
  listed: "text-mint",
};

/** "Buyer" or "Seller", from the first event's data.role. Older runs have no role. */
function runRole(run) {
  return run.events[0]?.data?.role === "seller" ? "Seller" : "Buyer";
}

function typeClass(type) {
  return TYPE_CLASS[type] || "text-ink";
}

function formatTime(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleTimeString("en-US", { hour12: false, hour: "2-digit", minute: "2-digit", second: "2-digit" });
}

function formatStarted(iso) {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "2-digit", minute: "2-digit", hour12: false });
}

function summaryLine(run) {
  const ev = run.events.find((e) => e.type === "summary");
  if (!ev) return null;
  const d = ev.data || {};
  if (d.listingsScored == null && d.bought == null) return ev.message || null;
  const parts = [
    `scored ${d.listingsScored ?? 0}`,
    `bought ${d.bought ?? 0}`,
    `disputed ${d.disputed ?? 0}`,
    `${Number(d.usdcSpent ?? 0)} USDC`,
  ];
  return parts.join(" · ");
}

/** Splits a message into text and Basescan anchors. */
function Linkified({ text }) {
  if (!text) return null;
  const out = [];
  let last = 0;
  for (const m of text.matchAll(BASESCAN_RE)) {
    const start = m.index;
    if (start > last) out.push(text.slice(last, start));
    out.push(
      <a key={start} href={m[0]} target="_blank" rel="noreferrer" className="mono text-xs text-accent hover:underline">
        {m[0].replace(/^https?:\/\//, "")}
      </a>
    );
    last = start + m[0].length;
  }
  if (last < text.length) out.push(text.slice(last));
  return out;
}

// txHash -> buyer address. The agent's disputed event carries the openDispute
// tx, and the sender of that tx is the buyer.
const buyerByTx = new Map();
async function buyerForTx(txHash) {
  if (buyerByTx.has(txHash)) return buyerByTx.get(txHash);
  const tx = await readProvider.getTransaction(txHash);
  const buyer = tx?.from ?? null;
  if (buyer) buyerByTx.set(txHash, buyer);
  return buyer;
}

/**
 * Watches a run's disputed events and returns the arbitrator's verdicts as
 * they land, keyed by "runId:listingId:txHash". Polls until every dispute in
 * the run has a resolution.
 */
function useResolutions(run) {
  const [resolutions, setResolutions] = useState({});
  const targets = run
    ? run.events
        .filter((e) => e.type === "disputed" && e.listingId != null && e.data?.txHash)
        .map((e) => `${run.runId}:${e.listingId}:${e.data.txHash}`)
    : [];
  const key = targets.join("|");

  useEffect(() => {
    if (!key) return;
    let alive = true;
    let timer = 0;
    const done = new Set();
    const tick = async () => {
      let open = 0;
      for (const item of key.split("|")) {
        if (done.has(item)) continue;
        const [, listingId, txHash] = item.split(":");
        try {
          const buyer = await buyerForTx(txHash);
          if (!buyer) {
            open++;
            continue;
          }
          const found = await api.dispute(listingId, buyer);
          if (!alive) return;
          done.add(item);
          setResolutions((prev) => ({ ...prev, [item]: found }));
        } catch {
          open++;
        }
      }
      if (alive && open > 0) timer = setTimeout(tick, DISPUTE_POLL_MS);
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, [key]);

  return resolutions;
}

/** The run's events plus one synthetic "resolved" row per arbitrated dispute. Nothing is written back. */
function withResolutions(run, resolutions) {
  const extra = [];
  for (const e of run.events) {
    if (e.type !== "disputed" || e.listingId == null || !e.data?.txHash) continue;
    const r = resolutions[`${run.runId}:${e.listingId}:${e.data.txHash}`];
    if (!r) continue;
    const outcome = r.buyerWins ? "buyer wins" : "seller wins";
    const pct = Math.round(Number(r.confidence) * 100);
    extra.push({
      ts: r.resolvedAt,
      type: "resolved",
      listingId: e.listingId,
      message: `${outcome}, ${pct}% confidence. ${r.reason} ${EXPLORER_URL}/tx/${r.txHash}`,
    });
  }
  return extra.length ? [...run.events, ...extra] : run.events;
}

function RunCard({ run, selected, onSelect, index }) {
  const summary = summaryLine(run);
  return (
    <button
      type="button"
      onClick={onSelect}
      style={{ animationDelay: `${index * 40}ms` }}
      className={`card fade-up flex w-full flex-col gap-2 p-5 text-left ${selected ? "border-line-hover" : ""}`}
    >
      <div className="flex items-center justify-between gap-3">
        <span className="flex items-center gap-2">
          <span className={`mono text-sm ${selected ? "text-ink" : "text-mute"}`}>{run.runId}</span>
          <span className="caps">{runRole(run)}</span>
        </span>
        <span className="text-xs text-dim">{formatStarted(run.startedAt)}</span>
      </div>
      {summary ? (
        <p className="text-sm text-mute">{summary}</p>
      ) : (
        <p className="text-sm text-dim">
          {run.events.length} event{run.events.length === 1 ? "" : "s"} · running
        </p>
      )}
    </button>
  );
}

function EventRow({ event }) {
  const isSummary = event.type === "summary";
  const color = typeClass(event.type);
  return (
    <li className={`flex gap-4 py-3 text-sm ${isSummary ? "mt-3" : ""}`}>
      <span className="mono w-[72px] shrink-0 pt-px text-xs text-dim">{formatTime(event.ts)}</span>
      {isSummary ? (
        <div className="card flex min-w-0 flex-1 flex-col gap-2 p-4">
          <span className="caps">summary</span>
          <p className="leading-relaxed text-ink">
            <Linkified text={event.message} />
          </p>
        </div>
      ) : (
        <div className="flex min-w-0 flex-1 flex-wrap items-baseline gap-x-3 gap-y-1">
          <span className={`mono shrink-0 text-xs ${color}`}>[{event.type}]</span>
          {event.listingId != null && (
            <Link to={`/listing/${event.listingId}`} className="mono shrink-0 text-xs text-mute hover:text-accent">
              #{event.listingId}
            </Link>
          )}
          <span className={`min-w-0 break-words leading-relaxed ${color}`}>
            <Linkified text={event.message} />
          </span>
        </div>
      )}
    </li>
  );
}

function RunHeader({ run }) {
  const first = run.events[0]?.data || {};
  const role = runRole(run);
  const headline = typeof first.goal === "string" && first.goal.length > 0 ? first.goal : first.source ? `Listing ${first.source}` : null;
  return (
    <div className="border-b border-line pb-5">
      <span className="caps">{role} run</span>
      {headline ? (
        <>
          <h2 className="serif mt-2 text-3xl leading-tight">{headline}</h2>
          <div className="mt-2 flex flex-wrap items-center gap-4 text-sm">
            {first.budget != null && <span className="mono text-mint">{first.budget} USDC budget</span>}
            <span className="mono text-dim">{run.runId}</span>
          </div>
        </>
      ) : (
        <h2 className="mono mt-2 text-2xl">{run.runId}</h2>
      )}
    </div>
  );
}

function Empty() {
  return (
    <div className="relative mx-auto flex min-h-[520px] max-w-[1200px] flex-col items-center justify-center overflow-hidden px-6 text-center">
      <HashStream size={420} opacity={0.35} center={(W, H) => ({ x: W / 2, y: H / 2 })} />
      <div className="relative z-10 flex flex-col items-center gap-4">
        <h2 className="serif text-4xl">No agent runs yet</h2>
        <code className="mono text-sm text-mute">node src/agent.js --goal "..." --budget 0.5</code>
        <code className="mono text-sm text-mute">node src/seller.js --file ./findings/example.md</code>
      </div>
    </div>
  );
}

export default function Agent() {
  const [runs, setRuns] = useState(null);
  const [error, setError] = useState(null);
  const [selectedId, setSelectedId] = useState(null);

  useEffect(() => {
    let alive = true;
    let timer = 0;
    const tick = async () => {
      try {
        const data = await api.agentRuns();
        if (!alive) return;
        setRuns(Array.isArray(data) ? data : []);
        setError(null);
      } catch (err) {
        if (alive) setError(err.message);
      } finally {
        if (alive) timer = setTimeout(tick, POLL_MS);
      }
    };
    tick();
    return () => {
      alive = false;
      clearTimeout(timer);
    };
  }, []);

  // Most recent run selected by default; keep the selection if that run is still present.
  const selected = runs?.find((r) => r.runId === selectedId) || runs?.[0] || null;
  const resolutions = useResolutions(selected);
  const timeline = selected ? withResolutions(selected, resolutions) : [];

  return (
    <div className="page mx-auto max-w-[1200px] px-6 py-16">
      <span className="caps">Agent</span>
      <h1 className="serif mt-2 text-5xl">Runs</h1>
      <p className="mt-2 text-sm text-dim">The buyer agent reports every step here. Updates every few seconds while this page is open.</p>
      {error && <p className="mt-4 text-sm text-bad">Could not reach the backend. {error}</p>}

      {runs === null ? (
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3">
            {[0, 1, 2].map((i) => (
              <div key={i} className="card flex flex-col gap-3 p-5">
                <SkeletonLine className="w-20" />
                <SkeletonLine className="w-3/4" />
              </div>
            ))}
          </div>
          <div className="flex flex-col gap-4">
            <div className="skeleton h-8 w-1/2" />
            <SkeletonLine className="w-full" />
            <SkeletonLine className="w-5/6" />
            <SkeletonLine className="w-2/3" />
          </div>
        </div>
      ) : runs.length === 0 ? (
        <div className="mt-6">
          <Empty />
        </div>
      ) : (
        <div className="mt-10 grid grid-cols-1 gap-8 md:grid-cols-[320px_1fr]">
          <div className="flex flex-col gap-3 md:sticky md:top-6 md:self-start">
            {runs.map((r, i) => (
              <RunCard
                key={r.runId}
                run={r}
                index={i}
                selected={selected?.runId === r.runId}
                onSelect={() => setSelectedId(r.runId)}
              />
            ))}
          </div>
          <div className="min-w-0">
            {selected && (
              <>
                <RunHeader run={selected} />
                <ol className="divide-y divide-line">
                  {timeline.map((e, i) => (
                    <EventRow key={`${e.ts}-${i}`} event={e} />
                  ))}
                </ol>
              </>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
