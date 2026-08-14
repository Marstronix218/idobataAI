type PostMediaGridProps = {
  urls: string[];
  alt: string;
  className?: string;
};

export function PostMediaGrid({ urls, alt, className = "" }: PostMediaGridProps) {
  if (!urls.length) return null;

  return <div className={`grid overflow-hidden rounded-2xl border border-line bg-canvas ${urls.length === 1 ? "grid-cols-1" : "grid-cols-2"} ${className}`.trim()}>
    {urls.map((url, index) => <div key={`${url}-${index}`} className={`relative min-h-44 overflow-hidden ${urls.length === 3 && index === 0 ? "row-span-2" : ""}`}>
      {/* Signed Storage URLs are short-lived bearer URLs and intentionally bypass the Next image optimizer/cache. */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={url}
        alt={`${alt}${urls.length > 1 ? ` (${index + 1} of ${urls.length})` : ""}`}
        className="absolute inset-0 h-full w-full object-cover"
        loading="lazy"
        decoding="async"
        referrerPolicy="no-referrer"
      />
    </div>)}
  </div>;
}
