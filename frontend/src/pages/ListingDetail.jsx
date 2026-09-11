import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { api } from "../lib/api";
import { EXPLORER_URL } from "../config";
import { useWallet } from "../lib/wallet";
import { paidFetch } from "../lib/x402";
import { hashContent, revertReason, writeContract } from "../lib/contract";
import { loadPurchase, savePurchase } from "../lib/storage";
import { formatDate, formatUsdc, reputationLabel, sameAddress, shortAddress, shortHash, trustLabel } from "../lib/format";
import HashStream from "../components/HashStream";
import { SkeletonLine } from "../components/Skeleton";

function TxLink({ hash, children }) {
  if (!hash) return null;
  return (
    <a href={`${EXPLORER_URL}/tx/${hash}`} target="_blank" rel="noreferrer" className="mono text-xs text-accent hover:underline">
      {children || shortHash(hash)}
    </a>
  );
}

export default function ListingDetail() {
  const { id } = useParams();
  const wallet = useWallet();
  const [listing, setListing] = useState(null);
  const [error, setError] = useState(null);

  const [revealed, setRevealed] = useState(null);
  const [stage, setStage] = useState("idle"); // idle | signing | fetching | done | error
  const [purchaseError, setPurchaseError] = useState(null);

  const [verify, setVerify] = useState(null); // null | "match" | "mismatch"
  const [dispute, setDispute] = useState({ state: "idle", tx: null, error: null });
  const [delist, setDelist] = useState({ state: "idle", tx: null, error: null });

  useEffect(() => {
    let alive = true;
    setListing(null);
    setError(null);
    api
      .listing(id)
      .then((l) => alive && setListing(l))
      .catch((err) => alive && setError(err.message));
    return () => {
      alive = false;
    };
  }, [id]);

  // Restore a previous purchase for this wallet.
  useEffect(() => {
    setVerify(null);
    if (!wallet.address) {
      setRevealed(null);
      return;
    }
    const saved = loadPurchase(id, wallet.address);
    setRevealed(saved);
    setStage(saved ? "done" : "idle");
  }, [id, wallet.address]);

  const isSeller = listing && sameAddress(wallet.address, listing.listedBy);
  const isDelisted = listing && listing.statusCode !== 0;

  const purchase = useCallback(async () => {
    setPurchaseError(null);
    if (!wallet.isConnected) return wallet.connect();
    if (!wallet.isCorrectNetwork) return wallet.switchNetwork().catch(() => {});
    setStage("signing");
    try {
      const signer = await wallet.getSigner();
      const fetchPaid = paidFetch(signer, wallet.address, () => setStage("fetching"));
      const res = await fetchPaid(api.revealUrl(id), { headers: { Accept: "application/json" } });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(body.error || `Purchase failed (${res.status})`);
      const data = { content: body.content, contentHash: body.contentHash, txHash: body.txHash, title: listing?.title };
      savePurchase(id, wallet.address, data);
      setRevealed(data);
      setStage("done");
    } catch (err) {
      setPurchaseError(err?.shortMessage || err?.message || "Purchase failed");
      setStage("error");
    }
  }, [wallet, id, listing]);

  const runVerify = () => {
    if (!revealed || !listing) return;
    setVerify(hashContent(revealed.content) === listing.contentHash.toLowerCase() ? "match" : "mismatch");
  };

  const openDispute = async () => {
    setDispute({ state: "pending", tx: null, error: null });
    try {
      const signer = await wallet.getSigner();
      const tx = await writeContract(signer).openDispute(id);
      setDispute({ state: "mining", tx: tx.hash, error: null });
      await tx.wait();
      setDispute({ state: "done", tx: tx.hash, error: null });
    } catch (err) {
      setDispute({ state: "error", tx: null, error: revertReason(err) });
    }
  };

  const runDelist = async () => {
    setDelist({ state: "pending", tx: null, error: null });
    try {
      const signer = await wallet.getSigner();
      const tx = await writeContract(signer).delist(id);
      setDelist({ state: "mining", tx: tx.hash, error: null });
      await tx.wait();
      setDelist({ state: "done", tx: tx.hash, error: null });
      setListing((l) => (l ? { ...l, status: "Delisted", statusCode: 1 } : l));
    } catch (err) {
      setDelist({ state: "error", tx: null, error: revertReason(err) });
    }
  };

  if (error) {
    return (
      <div className="page mx-auto max-w-[1200px] px-6 py-24 text-center">
        <h1 className="serif text-5xl">Listing not found</h1>
        <p className="mt-4 text-mute">{error}</p>
        <Link to="/" className="btn btn-secondary mt-8">
          Back to marketplace
        </Link>
      </div>
    );
  }

  const buttonLabel =
    stage === "signing" ? "Waiting for signature…" : stage === "fetching" ? "Fetching research…" : "Purchase";

  return (
    <div className="page relative overflow-hidden">
      <HashStream
        size={360}
        opacity={0.5}
        highlights={listing ? [listing.contentHash] : []}
        center={(W) => {
          // Behind the sticky purchase panel: right column of the 1200px container.
          const left = Math.max(24, (W - 1200) / 2);
          const width = Math.min(1200, W - 48);
          // Anchored on the panel's top-right corner so it shows above and beside the panel.
          return { x: left + width - 20, y: 64 + 110 };
        }}
      />
      <div className="relative z-10 mx-auto grid max-w-[1200px] grid-cols-1 gap-12 px-6 py-16 lg:grid-cols-[1fr_380px]">
        <div className="min-w-0">
          {!listing ? (
            <div className="flex flex-col gap-4">
              <SkeletonLine className="w-24" />
              <div className="skeleton h-12 w-3/4" />
              <SkeletonLine className="w-full" />
              <SkeletonLine className="w-5/6" />
            </div>
          ) : (
            <>
              <span className="caps">{listing.category}</span>
              <h1 className="serif mt-3 text-4xl leading-[1.05] md:text-5xl">{listing.title}</h1>
              <p className="mt-6 max-w-[640px] text-base leading-relaxed text-mute">{listing.description}</p>
              <p className="mt-6 text-xs text-dim">
                Listed {formatDate(listing.timestamp)} · Listing <span className="mono">#{listing.id}</span>
                {isDelisted && <span className="ml-2 text-bad">Delisted</span>}
              </p>

              {revealed && (
                <section className="fade-up mt-12">
                  <div className="flex flex-wrap items-center justify-between gap-3">
                    <h2 className="serif text-3xl">Revealed</h2>
                    {revealed.txHash && (
                      <span className="text-xs text-mute">
                        Purchase recorded <TxLink hash={revealed.txHash} />
                      </span>
                    )}
                  </div>
                  <div className="card mt-4 whitespace-pre-wrap p-6 text-sm leading-relaxed">{revealed.content}</div>

                  <div className="mt-4 flex flex-wrap items-center gap-3">
                    <button className="btn btn-secondary" onClick={runVerify}>
                      Verify integrity
                    </button>
                    {verify === "match" && <span className="text-sm text-mint">Matches on-chain commitment</span>}
                    {verify === "mismatch" && (
                      <span className="text-sm text-bad">Hash mismatch. This content is not what was committed.</span>
                    )}
                  </div>

                  <div className="mt-6 border-t border-line pt-6">
                    <p className="text-sm text-mute">
                      Received something other than what was described? Open a dispute on-chain. The dispute counts
                      against the seller's reputation until it is resolved.
                    </p>
                    <div className="mt-3 flex flex-wrap items-center gap-3">
                      <button
                        className="btn btn-danger"
                        onClick={openDispute}
                        disabled={dispute.state === "pending" || dispute.state === "mining" || dispute.state === "done"}
                      >
                        {dispute.state === "pending"
                          ? "Waiting for signature…"
                          : dispute.state === "mining"
                            ? "Confirming…"
                            : dispute.state === "done"
                              ? "Dispute opened"
                              : "Open dispute"}
                      </button>
                      {dispute.tx && <TxLink hash={dispute.tx} />}
                      {dispute.error && <span className="text-sm text-bad">{dispute.error}</span>}
                    </div>
                  </div>
                </section>
              )}
            </>
          )}
        </div>

        <aside className="lg:sticky lg:top-8 lg:self-start">
          <div className="card p-6" style={{ background: "rgba(12, 13, 16, 0.85)", backdropFilter: "none" }}>
            {!listing ? (
              <div className="flex flex-col gap-4">
                <div className="skeleton h-10 w-40" />
                <SkeletonLine className="w-full" />
                <SkeletonLine className="w-2/3" />
              </div>
            ) : (
              <>
                <div className="mono text-3xl text-mint">{formatUsdc(listing.price)}</div>

                <div className="mt-6 flex flex-col gap-2 text-sm">
                  <div className="flex items-center justify-between">
                    <span className="text-mute">Seller</span>
                    <a
                      href={`${EXPLORER_URL}/address/${listing.listedBy || listing.seller}`}
                      target="_blank"
                      rel="noreferrer"
                      className="mono hover:text-accent"
                    >
                      {shortAddress(listing.listedBy || listing.seller)}
                    </a>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-mute">Reputation</span>
                    <span>{reputationLabel(listing.reputation)}</span>
                  </div>
                  <div className="flex items-center justify-between">
                    <span className="text-mute">Trust score</span>
                    <span className="mono">{listing ? trustLabel(listing.reputation) : "—"}</span>
                  </div>
                </div>

                <div className="mt-6 border-t border-line pt-5">
                  <span className="caps">How this works</span>
                  <ol className="mt-3 flex flex-col gap-2 text-sm text-mute">
                    <li className="flex gap-3">
                      <span className="mono text-dim">1</span> Pay with USDC through x402. One signature, no gas.
                    </li>
                    <li className="flex gap-3">
                      <span className="mono text-dim">2</span> The content is revealed here and saved in this browser.
                    </li>
                    <li className="flex gap-3">
                      <span className="mono text-dim">3</span> Verify it against the hash committed on-chain.
                    </li>
                  </ol>
                </div>

                <div className="mt-6 border-t border-line pt-5">
                  <span className="caps">On-chain commitment</span>
                  <a
                    href={`${EXPLORER_URL}/address/${listing.seller}`}
                    target="_blank"
                    rel="noreferrer"
                    className="mono mt-2 block break-all text-xs text-mute hover:text-accent"
                  >
                    {listing.contentHash}
                  </a>
                </div>

                <div className="mt-6">
                  {isSeller ? (
                    <>
                      <button
                        className="btn btn-secondary w-full"
                        onClick={runDelist}
                        disabled={isDelisted || delist.state === "pending" || delist.state === "mining"}
                      >
                        {isDelisted
                          ? "Delisted"
                          : delist.state === "pending"
                            ? "Waiting for signature…"
                            : delist.state === "mining"
                              ? "Confirming…"
                              : "Delist"}
                      </button>
                      {delist.tx && (
                        <p className="mt-2 text-xs">
                          <TxLink hash={delist.tx} />
                        </p>
                      )}
                      {delist.error && <p className="mt-2 text-xs text-bad">{delist.error}</p>}
                      <p className="mt-3 text-xs text-dim">
                        This is your listing. In this prototype the backend wallet is the on-chain seller, so a delist
                        from your wallet may be rejected by the contract.
                      </p>
                    </>
                  ) : revealed ? (
                    <div className="rounded-md border border-line px-4 py-3 text-center text-sm text-mute">
                      You own this research.
                    </div>
                  ) : (
                    <button
                      className="btn btn-primary w-full"
                      onClick={purchase}
                      disabled={isDelisted || stage === "signing" || stage === "fetching"}
                    >
                      {isDelisted ? "No longer for sale" : !wallet.isConnected ? "Connect wallet to purchase" : buttonLabel}
                    </button>
                  )}
                  {purchaseError && <p className="mt-3 text-xs text-bad">{purchaseError}</p>}
                </div>
              </>
            )}
          </div>
        </aside>
      </div>
    </div>
  );
}
