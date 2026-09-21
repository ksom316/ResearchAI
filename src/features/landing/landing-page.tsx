import type { LucideIcon } from 'lucide-react'
import {
  ArrowRight,
  BookOpenCheck,
  CheckCircle2,
  FileSearch,
  GitBranch,
  Layers3,
  Library,
  Menu,
  MessageSquareText,
  Network,
  PenLine,
  SearchCheck,
  ShieldCheck,
  Sparkles,
} from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Button } from '#/components/ui/button'

const FEATURES: Array<{
  title: string
  description: string
  icon: LucideIcon
}> = [
  {
    title: 'Evidence Matrix',
    description:
      'Compare source-backed objectives, methods, datasets, findings, limitations, and future work.',
    icon: Layers3,
  },
  {
    title: 'Research Map',
    description:
      'Visualize direct relationships across papers, shared methods, datasets, and research concepts.',
    icon: Network,
  },
  {
    title: 'Research Gap Explorer',
    description:
      'Surface potential gaps and future directions supported by related papers in your current corpus.',
    icon: FileSearch,
  },
  {
    title: 'Grounded Research Chat',
    description:
      'Ask questions against indexed project evidence and inspect the passages behind every citation.',
    icon: MessageSquareText,
  },
  {
    title: 'Academic Writer',
    description:
      'Generate concise academic synthesis grounded in authorized evidence with traceable citations.',
    icon: PenLine,
  },
  {
    title: 'Claim Checker',
    description:
      'Inspect whether each cited source actually supports the generated statement it accompanies.',
    icon: SearchCheck,
  },
  {
    title: 'Research Quality Inspector',
    description:
      'Review evidence coverage, citation metadata, and draft-support concerns without an arbitrary score.',
    icon: BookOpenCheck,
  },
]

const WORKFLOW = [
  'Upload papers',
  'Extract evidence',
  'Connect research',
  'Discover potential gaps',
  'Ask grounded questions',
  'Write with citations',
  'Verify claims',
]

function ResearchAIMark({ light = false }: { light?: boolean }) {
  return (
    <span className="flex min-w-0 items-center gap-2.5">
      <img
        src="/researchai-icon.png"
        alt=""
        width={40}
        height={40}
        className="size-9 shrink-0 rounded-lg shadow-sm"
      />
      <span
        className={`font-heading text-xl font-semibold ${light ? 'text-white' : 'text-foreground'}`}
      >
        ResearchAI
      </span>
    </span>
  )
}

function PublicNavigation() {
  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur-md">
      <nav
        aria-label="Main navigation"
        className="mx-auto flex h-16 max-w-7xl items-center justify-between gap-4 px-4 sm:px-6 lg:px-8"
      >
        <a href="#top" aria-label="ResearchAI home" className="shrink-0">
          <ResearchAIMark />
        </a>

        <div className="hidden items-center gap-7 text-sm font-medium text-muted-foreground md:flex">
          <a className="transition-colors hover:text-foreground" href="#features">
            Features
          </a>
          <a className="transition-colors hover:text-foreground" href="#how-it-works">
            How it works
          </a>
          <a className="transition-colors hover:text-foreground" href="#why-researchai">
            Why ResearchAI
          </a>
        </div>

        <div className="hidden items-center gap-2 md:flex">
          <Button asChild variant="ghost">
            <Link to="/sign-in">Sign in</Link>
          </Button>
          <Button asChild>
            <Link to="/sign-up">Get started</Link>
          </Button>
        </div>

        <details className="group relative md:hidden">
          <summary className="flex size-10 cursor-pointer list-none items-center justify-center rounded-md border bg-background [&::-webkit-details-marker]:hidden">
            <Menu className="size-5" aria-hidden="true" />
            <span className="sr-only">Open navigation menu</span>
          </summary>
          <div className="absolute top-12 right-0 w-60 rounded-xl border bg-card p-2 shadow-xl">
            <div className="flex flex-col text-sm font-medium">
              <a className="rounded-md px-3 py-3 hover:bg-accent" href="#features">
                Features
              </a>
              <a className="rounded-md px-3 py-3 hover:bg-accent" href="#how-it-works">
                How it works
              </a>
              <a className="rounded-md px-3 py-3 hover:bg-accent" href="#why-researchai">
                Why ResearchAI
              </a>
              <div className="my-2 border-t" />
              <Link className="rounded-md px-3 py-3 hover:bg-accent" to="/sign-in">
                Sign in
              </Link>
              <Link
                className="mt-1 rounded-md bg-primary px-3 py-3 text-center text-primary-foreground"
                to="/sign-up"
              >
                Get started
              </Link>
            </div>
          </div>
        </details>
      </nav>
    </header>
  )
}

function ProductPreview() {
  return (
    <div
      className="relative mx-auto w-full max-w-xl"
      aria-label="ResearchAI evidence workspace preview"
    >
      <div className="absolute -inset-8 -z-10 rounded-full bg-primary/10 blur-3xl" />
      <div className="overflow-hidden rounded-2xl border bg-card shadow-2xl shadow-primary/10">
        <div className="flex items-center justify-between border-b px-4 py-3">
          <div className="flex items-center gap-2">
            <span className="size-2.5 rounded-full bg-primary/30" />
            <span className="size-2.5 rounded-full bg-primary/20" />
            <span className="size-2.5 rounded-full bg-primary/10" />
          </div>
          <span className="text-xs font-medium text-muted-foreground">
            Research project
          </span>
        </div>
        <div className="grid min-w-0 gap-4 p-4 sm:grid-cols-[0.8fr_1.2fr] sm:p-5">
          <div className="rounded-xl bg-sidebar p-4 text-sidebar-foreground">
            <p className="text-xs font-semibold tracking-wider text-sidebar-foreground/60 uppercase">
              Evidence
            </p>
            <div className="mt-4 space-y-3">
              {['Methodology', 'Findings', 'Limitations'].map((label, index) => (
                <div key={label} className="rounded-lg bg-white/8 p-3">
                  <div className="flex items-center justify-between gap-2">
                    <span className="text-xs font-medium">{label}</span>
                    <span className="rounded-full bg-white/10 px-2 py-0.5 text-[10px]">
                      {index + 2} claims
                    </span>
                  </div>
                  <span className="mt-2 block h-1.5 rounded-full bg-white/15" />
                  <span className="mt-1.5 block h-1.5 w-3/4 rounded-full bg-white/10" />
                </div>
              ))}
            </div>
          </div>
          <div className="min-w-0 space-y-3">
            <div className="rounded-xl border bg-background p-4">
              <div className="mb-4 flex items-center justify-between gap-3">
                <span className="text-sm font-semibold">Grounded synthesis</span>
                <span className="rounded-full bg-emerald-100 px-2 py-1 text-[10px] font-semibold text-emerald-800">
                  Current
                </span>
              </div>
              <p className="text-sm leading-6 text-muted-foreground">
                Related studies approach table structure through complementary
                representation and decoding strategies.
                <span className="ml-1 inline-flex rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                  [1]
                </span>
                <span className="ml-1 inline-flex rounded bg-primary/10 px-1.5 py-0.5 font-semibold text-primary">
                  [2]
                </span>
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3">
              <div className="rounded-xl border bg-background p-3">
                <GitBranch className="size-4 text-primary" aria-hidden="true" />
                <p className="mt-3 text-xs font-semibold">Shared methods</p>
                <p className="mt-1 text-2xl font-semibold">6</p>
              </div>
              <div className="rounded-xl border bg-background p-3">
                <CheckCircle2 className="size-4 text-emerald-600" aria-hidden="true" />
                <p className="mt-3 text-xs font-semibold">Traceable claims</p>
                <p className="mt-1 text-2xl font-semibold">12</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}

export function LandingPage() {
  return (
    <div id="top" className="min-h-screen overflow-x-clip bg-background">
      <PublicNavigation />

      <main>
        <section className="relative overflow-hidden border-b">
          <div className="absolute inset-0 -z-10 bg-[radial-gradient(circle_at_top_left,var(--color-primary),transparent_42%)] opacity-[0.07]" />
          <div className="mx-auto grid max-w-7xl items-center gap-12 px-4 py-16 sm:px-6 sm:py-24 lg:grid-cols-[1.05fr_0.95fr] lg:px-8 lg:py-28">
            <div className="min-w-0 max-w-3xl">
              <div className="mb-5 inline-flex items-center gap-2 rounded-full border bg-card px-3 py-1.5 text-xs font-semibold text-primary shadow-sm">
                <Sparkles className="size-3.5" aria-hidden="true" />
                Evidence-first research intelligence
              </div>
              <h1 className="text-4xl leading-[1.08] font-semibold tracking-tight sm:text-5xl lg:text-6xl">
                Turn research papers into evidence you can actually work with.
              </h1>
              <p className="mt-6 max-w-2xl text-base leading-7 text-muted-foreground sm:text-lg sm:leading-8">
                ResearchAI helps researchers organize papers, extract evidence,
                understand relationships across studies, discover potential research
                gaps, ask grounded questions, and write with traceable citations.
              </p>
              <div className="mt-8 flex flex-col gap-3 sm:flex-row">
                <Button asChild size="lg" className="w-full sm:w-auto">
                  <Link to="/sign-up">
                    Start researching
                    <ArrowRight aria-hidden="true" />
                  </Link>
                </Button>
                <Button asChild size="lg" variant="outline" className="w-full sm:w-auto">
                  <a href="#how-it-works">See how it works</a>
                </Button>
              </div>
              <p className="mt-4 text-xs text-muted-foreground">
                Grounded in the papers you add to your private research workspace.
              </p>
            </div>
            <ProductPreview />
          </div>
        </section>

        <section aria-labelledby="workflow-heading" className="border-b bg-card py-14 sm:py-18">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold text-primary">One connected workflow</p>
              <h2 id="workflow-heading" className="mt-2 text-3xl font-semibold sm:text-4xl">
                From uploaded paper to verified claim
              </h2>
            </div>
            <ol className="mt-10 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-7">
              {WORKFLOW.map((step, index) => (
                <li
                  key={step}
                  className="relative flex min-w-0 items-center gap-3 rounded-xl border bg-background p-4 lg:flex-col lg:items-start"
                >
                  <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
                    {index + 1}
                  </span>
                  <span className="text-sm font-medium leading-5">{step}</span>
                  {index < WORKFLOW.length - 1 && (
                    <ArrowRight
                      className="absolute top-1/2 -right-3 z-10 hidden size-4 -translate-y-1/2 text-muted-foreground lg:block"
                      aria-hidden="true"
                    />
                  )}
                </li>
              ))}
            </ol>
          </div>
        </section>

        <section id="features" aria-labelledby="features-heading" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="max-w-2xl">
              <p className="text-sm font-semibold text-primary">Research intelligence</p>
              <h2 id="features-heading" className="mt-2 text-3xl font-semibold sm:text-4xl">
                More than search. A workspace for the full literature workflow.
              </h2>
              <p className="mt-4 leading-7 text-muted-foreground">
                Each tool stays connected to the papers and evidence that produced it.
              </p>
            </div>
            <div className="mt-10 grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {FEATURES.map(({ title, description, icon: Icon }, index) => (
                <article
                  key={title}
                  className={`min-w-0 rounded-2xl border bg-card p-6 shadow-sm ${index === FEATURES.length - 1 ? 'sm:col-span-2 lg:col-span-1' : ''}`}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-primary/10 text-primary">
                    <Icon className="size-5" aria-hidden="true" />
                  </span>
                  <h3 className="mt-5 text-lg font-semibold">{title}</h3>
                  <p className="mt-2 text-sm leading-6 text-muted-foreground">
                    {description}
                  </p>
                </article>
              ))}
            </div>
          </div>
        </section>

        <section id="why-researchai" className="scroll-mt-20 bg-sidebar py-16 text-sidebar-foreground sm:py-24">
          <div className="mx-auto grid max-w-7xl gap-12 px-4 sm:px-6 lg:grid-cols-2 lg:px-8">
            <div className="max-w-xl">
              <p className="text-sm font-semibold text-sidebar-primary">Why ResearchAI</p>
              <h2 className="mt-2 text-3xl font-semibold text-white sm:text-4xl">
                Not simply “chat with PDFs.”
              </h2>
              <p className="mt-5 leading-7 text-sidebar-foreground/75">
                ResearchAI builds an evidence layer before producing insights. That
                means relationships, potential gaps, drafts, and support assessments
                remain inspectable instead of becoming disconnected AI output.
              </p>
            </div>
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
              {['Papers', 'Evidence', 'Relationships', 'Insights', 'Writing', 'Verification'].map(
                (item, index) => (
                  <div key={item} className="rounded-xl border border-white/10 bg-white/5 p-4">
                    <span className="text-xs text-sidebar-foreground/50">0{index + 1}</span>
                    <p className="mt-5 font-semibold text-white">{item}</p>
                  </div>
                ),
              )}
            </div>
          </div>
        </section>

        <section id="how-it-works" aria-labelledby="how-heading" className="scroll-mt-20 py-16 sm:py-24">
          <div className="mx-auto max-w-7xl px-4 sm:px-6 lg:px-8">
            <div className="mx-auto max-w-2xl text-center">
              <p className="text-sm font-semibold text-primary">How it works</p>
              <h2 id="how-heading" className="mt-2 text-3xl font-semibold sm:text-4xl">
                A clear path from literature to grounded work
              </h2>
            </div>
            <ol className="mt-12 grid gap-8 md:grid-cols-3">
              {[
                ['Build your research project', 'Upload and organize academic papers in a focused project workspace.', Library],
                ['Understand the literature', 'Process papers into searchable evidence and structured research intelligence.', GitBranch],
                ['Research and write with provenance', 'Explore relationships, ask grounded questions, draft synthesis, and trace claims back to evidence.', PenLine],
              ].map(([title, description, Icon], index) => {
                const StepIcon = Icon as LucideIcon
                return (
                  <li key={title as string} className="min-w-0">
                    <div className="flex items-center gap-3">
                      <span className="flex size-11 shrink-0 items-center justify-center rounded-xl bg-primary text-primary-foreground">
                        <StepIcon className="size-5" aria-hidden="true" />
                      </span>
                      <span className="text-sm font-semibold text-primary">Step {index + 1}</span>
                    </div>
                    <h3 className="mt-5 text-xl font-semibold">{title as string}</h3>
                    <p className="mt-3 text-sm leading-6 text-muted-foreground">
                      {description as string}
                    </p>
                  </li>
                )
              })}
            </ol>
          </div>
        </section>

        <section aria-labelledby="trust-heading" className="border-y bg-card py-16 sm:py-20">
          <div className="mx-auto grid max-w-7xl items-center gap-10 px-4 sm:px-6 lg:grid-cols-[0.8fr_1.2fr] lg:px-8">
            <div>
              <div className="flex size-12 items-center justify-center rounded-2xl bg-primary/10 text-primary">
                <ShieldCheck className="size-6" aria-hidden="true" />
              </div>
              <h2 id="trust-heading" className="mt-5 text-3xl font-semibold">
                Grounding you can inspect
              </h2>
              <p className="mt-3 leading-7 text-muted-foreground">
                AI assistance stays scoped to the research project and its authorized evidence.
              </p>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              {[
                ['Source-grounded AI', 'Generated work is constrained to selected project evidence.'],
                ['Traceable citations', 'Open the paper, section, page, and source excerpt behind a citation.'],
                ['Claim-level inspection', 'Assess how well cited evidence supports each generated statement.'],
                ['Private workspace', 'Research projects and papers sit behind authenticated project access.'],
              ].map(([title, description]) => (
                <div key={title} className="rounded-xl border bg-background p-5">
                  <div className="flex items-start gap-3">
                    <CheckCircle2 className="mt-0.5 size-5 shrink-0 text-primary" aria-hidden="true" />
                    <div className="min-w-0">
                      <h3 className="font-semibold">{title}</h3>
                      <p className="mt-1 text-sm leading-6 text-muted-foreground">{description}</p>
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>
        </section>

        <section className="px-4 py-16 sm:px-6 sm:py-24 lg:px-8">
          <div className="mx-auto max-w-5xl overflow-hidden rounded-3xl bg-primary px-6 py-12 text-center text-primary-foreground shadow-xl shadow-primary/15 sm:px-12 sm:py-16">
            <h2 className="text-3xl font-semibold sm:text-4xl">
              Turn your literature into a research workspace.
            </h2>
            <p className="mx-auto mt-4 max-w-2xl text-sm leading-6 text-primary-foreground/80 sm:text-base">
              Organize evidence, understand connections, and write with citations you can trace.
            </p>
            <div className="mt-8 flex flex-col justify-center gap-3 sm:flex-row">
              <Button asChild size="lg" variant="secondary" className="w-full sm:w-auto">
                <Link to="/sign-up">Start researching</Link>
              </Button>
              <Button
                asChild
                size="lg"
                variant="outline"
                className="w-full border-white/30 bg-transparent text-white hover:bg-white/10 hover:text-white sm:w-auto"
              >
                <Link to="/sign-in">Sign in</Link>
              </Button>
            </div>
          </div>
        </section>
      </main>

      <footer className="border-t bg-card">
        <div className="mx-auto flex max-w-7xl flex-col gap-6 px-4 py-10 sm:px-6 md:flex-row md:items-center md:justify-between lg:px-8">
          <div className="max-w-md">
            <ResearchAIMark />
            <p className="mt-3 text-sm text-muted-foreground">
              A provenance-first workspace for evidence-grounded academic research.
            </p>
          </div>
          <div className="flex flex-wrap items-center gap-x-5 gap-y-3 text-sm text-muted-foreground">
            <a href="#features" className="hover:text-foreground">Features</a>
            <a href="#how-it-works" className="hover:text-foreground">How it works</a>
            <Link to="/sign-in" className="hover:text-foreground">Sign in</Link>
            <span>© {new Date().getFullYear()} ResearchAI</span>
          </div>
        </div>
      </footer>
    </div>
  )
}
