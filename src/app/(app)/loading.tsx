// The root loading skeleton renders outside AppShell, so it never receives the
// `app-theme` class that supplies the dark palette. Every authenticated route
// transition therefore flashed a full-screen cream skeleton over the dark app.
// This boundary keeps the app's own theme during navigation.
export default function AppLoading() {
  return (
    <div className="app-theme app-page animate-pulse bg-canvas" aria-busy="true" aria-label="Loading">
      <div className="h-4 w-32 rounded-full bg-line" />
      <div className="mt-4 h-10 w-64 rounded-xl bg-line" />
      <div className="mt-8 space-y-4">
        <div className="card h-36 bg-surface" />
        <div className="card h-48 bg-surface" />
        <div className="card h-48 bg-surface" />
      </div>
    </div>
  );
}
