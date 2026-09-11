import { Link } from "react-router-dom";
import { formatUsdc, reputationLabel } from "../lib/format";

export default function ListingCard({ listing, index = 0 }) {
  return (
    <Link
      to={`/listing/${listing.id}`}
      className="card fade-up flex flex-col gap-3 p-6"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <span className="caps">{listing.category}</span>
      <h3 className="serif text-2xl leading-tight">{listing.title}</h3>
      <p className="clamp-2 text-sm leading-relaxed text-mute">{listing.description || "No description."}</p>
      <div className="redaction-row" aria-hidden="true">
        <span style={{ width: 42 }} />
        <span style={{ width: 28 }} />
        <span style={{ width: 56 }} />
      </div>
      <div className="mt-auto flex items-center justify-between pt-3 text-sm">
        <span className="mono text-mint">{formatUsdc(listing.price)}</span>
        <span className="text-mute">{reputationLabel(listing.reputation)}</span>
      </div>
    </Link>
  );
}
