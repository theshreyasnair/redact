export function SkeletonCard() {
  return (
    <div className="card flex flex-col gap-4 p-6">
      <div className="skeleton h-3 w-24" />
      <div className="skeleton h-7 w-4/5" />
      <div className="skeleton h-4 w-full" />
      <div className="skeleton h-4 w-2/3" />
      <div className="mt-2 flex justify-between">
        <div className="skeleton h-4 w-20" />
        <div className="skeleton h-4 w-28" />
      </div>
    </div>
  );
}

export function SkeletonGrid({ count = 6 }) {
  return (
    <div className="grid grid-cols-1 gap-4 md:grid-cols-3">
      {Array.from({ length: count }, (_, i) => (
        <SkeletonCard key={i} />
      ))}
    </div>
  );
}

export function SkeletonLine({ className = "" }) {
  return <div className={`skeleton h-4 ${className}`} />;
}
