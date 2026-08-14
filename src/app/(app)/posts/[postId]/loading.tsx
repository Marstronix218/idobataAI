export default function PostLoading() {
  return <div className="min-w-0 border-x border-line bg-canvas">
    <div className="min-h-14 border-b border-line" />
    <div className="animate-pulse space-y-4 border-b border-line p-5" aria-label="Loading post">
      <div className="h-10 w-10 rounded-full bg-surface-raised" />
      <div className="h-4 w-2/3 rounded bg-surface-raised" />
      <div className="h-4 w-full rounded bg-surface-raised" />
      <div className="h-20 rounded-2xl bg-surface-raised" />
    </div>
  </div>;
}
