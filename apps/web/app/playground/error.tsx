'use client';

export default function PlaygroundError({ error }: { error: Error }) {
  return (
    <main className="grid h-dvh place-items-center p-6 text-center">
      <div>
        <h1 className="text-xl font-semibold tracking-tight">The playground could not start</h1>
        <p className="mt-2 text-sm text-muted-foreground">It needs a browser with WebGL enabled.</p>
        <p className="mt-4 font-mono text-xs text-muted-foreground">{error.message}</p>
      </div>
    </main>
  );
}
