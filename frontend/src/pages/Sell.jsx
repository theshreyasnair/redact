import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../lib/api";
import { CATEGORIES, EXPLORER_URL } from "../config";
import { sentenceCase } from "../lib/format";
import { useWallet } from "../lib/wallet";
import { hashContent } from "../lib/contract";
import RequireWallet from "../components/RequireWallet";

const EMPTY = { title: "", category: CATEGORIES[0], description: "", price: "", content: "" };

function Field({ label, hint, children }) {
  return (
    <label className="flex flex-col gap-2">
      <span className="text-sm">{label}</span>
      {children}
      {hint && <span className="text-xs text-dim">{hint}</span>}
    </label>
  );
}

function SellForm() {
  const { address } = useWallet();
  const [form, setForm] = useState(EMPTY);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [result, setResult] = useState(null);

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const submit = async (e) => {
    e.preventDefault();
    setError(null);
    const price = Number(form.price);
    if (!form.title.trim()) return setError("Add a title.");
    if (!form.content.trim()) return setError("Add the research content.");
    if (!(price > 0)) return setError("Price must be more than zero.");
    setSubmitting(true);
    try {
      const localHash = hashContent(form.content);
      const res = await api.createListing({
        title: form.title.trim(),
        description: form.description.trim(),
        category: form.category,
        price,
        content: form.content,
        sellerAddress: address,
      });
      setResult({ ...res, localHash, hashMatches: res.contentHash?.toLowerCase() === localHash });
    } catch (err) {
      setError(err.message);
    } finally {
      setSubmitting(false);
    }
  };

  if (result) {
    return (
      <div className="fade-up border-t border-line pt-6">
        <span className="label">Listed</span>
        <h2 className="serif mt-2 text-4xl">Your research is on-chain.</h2>
        <dl className="mt-6 flex flex-col gap-3 text-sm">
          <div className="flex justify-between gap-4">
            <dt className="text-mute">Listing</dt>
            <dd className="mono">#{result.listingId}</dd>
          </div>
          <div className="flex flex-col gap-1">
            <dt className="text-mute">Content hash</dt>
            <dd className="mono break-all text-xs">{result.contentHash}</dd>
            {result.hashMatches === false && (
              <span className="text-xs text-bad">Server hash differs from the hash computed here.</span>
            )}
          </div>
          <div className="flex justify-between gap-4">
            <dt className="text-mute">Transaction</dt>
            <dd>
              <a href={`${EXPLORER_URL}/tx/${result.txHash}`} target="_blank" rel="noreferrer" className="mono text-xs text-accent hover:underline">
                View on Basescan
              </a>
            </dd>
          </div>
        </dl>
        <div className="mt-8 flex gap-3">
          <Link to={`/listing/${result.listingId}`} className="btn btn-primary">
            View listing
          </Link>
          <button className="btn btn-secondary" onClick={() => { setResult(null); setForm(EMPTY); }}>
            Sell another
          </button>
        </div>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="flex flex-col gap-6">
      <Field label="Title">
        <input className="field" value={form.title} onChange={set("title")} placeholder="A short, specific claim" maxLength={120} />
      </Field>
      <Field label="Category">
        <select className="field" value={form.category} onChange={set("category")}>
          {CATEGORIES.map((c) => (
            <option key={c} value={c}>
              {sentenceCase(c)}
            </option>
          ))}
        </select>
      </Field>
      <Field label="What buyers see before paying">
        <textarea className="field min-h-[96px]" value={form.description} onChange={set("description")} placeholder="Enough to judge whether it is worth the price. Not enough to reproduce it." />
      </Field>
      <Field label="Price in USDC">
        <input className="field mono" type="number" min="0.000001" step="0.01" value={form.price} onChange={set("price")} placeholder="0.10" />
      </Field>
      <Field
        label="The research — this is what's sold"
        hint="Hashed client-side. The hash is committed on-chain. Buyers verify what they receive against it."
      >
        <textarea className="field mono min-h-[280px] text-xs" value={form.content} onChange={set("content")} placeholder="Prompts, transcripts, reproduction steps, model versions." />
      </Field>

      {error && <p className="text-sm text-bad">{error}</p>}

      <div className="flex items-center justify-between gap-4">
        <span className="text-xs text-dim">
          Selling as <span className="mono">{address}</span>
        </span>
        <button className="btn btn-primary" type="submit" disabled={submitting}>
          {submitting ? "Publishing…" : "Publish listing"}
        </button>
      </div>
    </form>
  );
}

export default function Sell() {
  return (
    <RequireWallet title="Sell">
      <div className="page mx-auto max-w-[640px] px-6 py-16">
        <h1 className="serif text-5xl">Sell a finding</h1>
        <p className="mt-3 mb-10 text-mute">
          Buyers pay in USDC before the content is shown. The hash of what you write goes on-chain, so what they get is what you committed to.
        </p>
        <SellForm />
      </div>
    </RequireWallet>
  );
}
