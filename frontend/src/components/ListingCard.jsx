import { Link } from "react-router-dom";
import { formatUsdc, sentenceCase, truncateWords } from "../lib/format";

// Roughly two lines at 15px in the widest column; the CSS max-height is the safety net.
const DESC_CHARS = 170;

/** One entry in a listing index. Title, cut-off description with bars, price and category on the right. */
export default function ListingCard({ listing, index = 0 }) {
  const desc = truncateWords(listing.description, DESC_CHARS);
  return (
    <Link
      to={`/listing/${listing.id}`}
      className="index-row fade-up"
      style={{ animationDelay: `${index * 40}ms` }}
    >
      <div className="min-w-0">
        <h3 className="serif text-[26px] leading-tight">{listing.title}</h3>
        <p className="index-desc mt-3 text-[15px] leading-normal text-mute">
          {desc || "No description."}
          <span className="redaction-row" aria-hidden="true">
            <span style={{ width: 48 }} />
            <span style={{ width: 72 }} />
            <span style={{ width: 36 }} />
          </span>
        </p>
      </div>
      <div className="sm:text-right">
        <div className="mono text-base text-mint">{formatUsdc(listing.price)}</div>
        <div className="mt-1.5 text-[13px] text-mute">{sentenceCase(listing.category)}</div>
      </div>
    </Link>
  );
}
