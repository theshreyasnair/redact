export function SkeletonCard() {
  return (
    <div className="index-row">
      <div className="flex flex-col gap-3">
        <div className="skeleton h-7 w-3/5" />
        <div className="skeleton h-4 w-full" />
        <div className="skeleton h-4 w-1/2" />
      </div>
      <div className="flex flex-col gap-2 sm:items-end">
        <div className="skeleton h-4 w-24" />
        <div className="skeleton h-3 w-20" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="index">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonLine({ className = "" }) {
  return <div className={`skeleton h-4 ${className}`} />;
}
