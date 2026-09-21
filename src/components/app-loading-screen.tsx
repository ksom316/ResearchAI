export function AppLoadingScreen() {
  return (
    <main
      className="fixed inset-0 z-50 flex min-h-svh items-center justify-center overflow-hidden bg-background px-6"
      role="status"
      aria-live="polite"
      aria-label="ResearchAI is loading"
    >
      <div className="flex flex-col items-center text-center">
        <div className="relative flex size-28 items-center justify-center" aria-hidden="true">
          <span className="absolute top-2 left-1/2 h-8 w-px -translate-x-1/2 bg-gradient-to-b from-transparent to-primary/30" />
          <span className="absolute top-1/2 right-2 h-px w-8 -translate-y-1/2 bg-gradient-to-r from-primary/30 to-transparent" />
          <span className="absolute bottom-2 left-1/2 h-8 w-px -translate-x-1/2 bg-gradient-to-t from-transparent to-primary/30" />
          <span className="absolute top-1/2 left-2 h-px w-8 -translate-y-1/2 bg-gradient-to-l from-primary/30 to-transparent" />

          <span className="absolute top-0 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-primary/60 motion-safe:animate-pulse motion-reduce:animate-none" />
          <span className="absolute top-1/2 right-0 size-2.5 -translate-y-1/2 rounded-full bg-primary/45 motion-safe:animate-pulse motion-reduce:animate-none [animation-delay:300ms]" />
          <span className="absolute bottom-0 left-1/2 size-2.5 -translate-x-1/2 rounded-full bg-primary/35 motion-safe:animate-pulse motion-reduce:animate-none [animation-delay:600ms]" />
          <span className="absolute top-1/2 left-0 size-2.5 -translate-y-1/2 rounded-full bg-primary/45 motion-safe:animate-pulse motion-reduce:animate-none [animation-delay:900ms]" />

          <span className="relative flex size-16 items-center justify-center rounded-2xl border bg-card shadow-lg shadow-primary/10 motion-safe:animate-pulse motion-reduce:animate-none">
            <img
              src="/researchai-icon.png"
              alt=""
              width={48}
              height={48}
              className="size-12 rounded-xl"
            />
          </span>
        </div>

        <p className="font-heading mt-5 text-2xl font-semibold">ResearchAI</p>
        <p className="mt-2 text-sm text-muted-foreground">
          Turning papers into evidence.
        </p>
      </div>
    </main>
  )
}
