/** Reusable skeleton loading placeholders */

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className = "" }: SkeletonProps) {
  return <div className={`skeleton-pulse rounded ${className}`} />;
}

/** Skeleton for the MarketInfo panel */
export function MarketInfoSkeleton() {
  return (
    <div className="position-card rounded-xl p-6 space-y-6 animate-in">
      <div>
        <div className="flex items-center justify-between mb-2">
          <Skeleton className="h-5 w-24" />
          <Skeleton className="h-3 w-20" />
        </div>
        <div className="flex items-baseline gap-2">
          <Skeleton className="h-9 w-36" />
          <Skeleton className="h-4 w-14" />
        </div>
      </div>
      <div className="space-y-3">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-16" />
          </div>
        ))}
      </div>
      <div className="pt-4 border-t border-shadow-600 space-y-2">
        <Skeleton className="h-4 w-32 mb-3" />
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between items-center">
            <Skeleton className="h-3 w-20" />
            <Skeleton className="h-5 w-16 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the TradingPanel */
export function TradingPanelSkeleton() {
  return (
    <div className="position-card rounded-xl p-6 animate-in">
      <Skeleton className="h-6 w-32 mb-6" />
      {/* Direction toggle */}
      <div className="grid grid-cols-2 gap-2 mb-6">
        <Skeleton className="h-12 rounded-lg" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
      {/* Size input */}
      <div className="mb-6">
        <Skeleton className="h-4 w-28 mb-2" />
        <Skeleton className="h-12 rounded-lg" />
      </div>
      {/* Leverage slider */}
      <div className="mb-6">
        <div className="flex justify-between mb-2">
          <Skeleton className="h-4 w-16" />
          <Skeleton className="h-5 w-10" />
        </div>
        <Skeleton className="h-2 rounded-full" />
      </div>
      {/* Summary */}
      <div className="bg-shadow-700 rounded-lg p-4 mb-6 space-y-3">
        {Array.from({ length: 4 }).map((_, i) => (
          <div key={i} className="flex justify-between">
            <Skeleton className="h-4 w-24" />
            <Skeleton className="h-4 w-20" />
          </div>
        ))}
      </div>
      {/* Button */}
      <Skeleton className="h-14 rounded-lg" />
    </div>
  );
}

/** Skeleton for position cards */
export function PositionsListSkeleton() {
  return (
    <div className="space-y-6 animate-in">
      <div className="position-card rounded-xl p-6">
        <div className="flex items-center justify-between mb-4">
          <Skeleton className="h-6 w-36" />
          <Skeleton className="h-4 w-16" />
        </div>
        {Array.from({ length: 2 }).map((_, i) => (
          <div key={i} className="bg-shadow-700 rounded-lg p-4 mb-4">
            <div className="flex items-center gap-3 mb-4">
              <Skeleton className="h-6 w-8 rounded" />
              <Skeleton className="h-5 w-20 rounded-full" />
              <Skeleton className="h-4 w-32" />
            </div>
            <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
              {Array.from({ length: 4 }).map((_, j) => (
                <div key={j}>
                  <Skeleton className="h-3 w-16 mb-1" />
                  <Skeleton className="h-4 w-20" />
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

/** Skeleton for the price chart area */
export function ChartSkeleton() {
  return (
    <div className="position-card rounded-xl overflow-hidden animate-in">
      <div className="flex items-center justify-between px-4 py-2.5 border-b border-shadow-600">
        <div className="flex items-center gap-2">
          {Array.from({ length: 6 }).map((_, i) => (
            <Skeleton key={i} className="h-7 w-20 rounded-lg" />
          ))}
        </div>
        <Skeleton className="h-6 w-32 rounded" />
      </div>
      <div className="h-[560px] xl:h-[640px] flex items-center justify-center bg-shadow-800">
        <div className="flex flex-col items-center gap-3">
          <div className="w-10 h-10 rounded-full border-2 border-accent-purple/30 border-t-accent-purple animate-spin" />
          <Skeleton className="h-4 w-36" />
        </div>
      </div>
    </div>
  );
}
