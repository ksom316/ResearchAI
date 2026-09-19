import type { ReactNode } from 'react'
import { Brand } from '#/components/brand'
import { Card, CardContent } from '#/components/ui/card'

export function AuthCard({
  title,
  description,
  children,
  footer,
}: {
  title: string
  description: string
  children: ReactNode
  footer: ReactNode
}) {
  return (
    <main className="grid min-h-screen lg:grid-cols-[1.1fr_1fr]">
      <aside className="relative hidden flex-col justify-between bg-sidebar p-12 text-sidebar-foreground lg:flex">
        <Brand tone="light" />
        <div className="max-w-md space-y-4">
          <h2 className="font-heading text-4xl leading-tight font-medium text-white">
            Read less noise. Find the signal in your research.
          </h2>
          <p className="text-sidebar-foreground/80">
            Organize papers, compare findings, and keep your evidence in one
            focused workspace.
          </p>
        </div>
        <p className="text-sm text-sidebar-foreground/60">
          © {new Date().getFullYear()} ResearchAI
        </p>
      </aside>
      <section className="flex items-center justify-center px-4 py-10">
        <div className="w-full max-w-sm space-y-6">
          <Brand className="lg:hidden" />
          <Card>
            <CardContent className="space-y-5 pt-6">
              <div className="space-y-1">
                <h1 className="text-2xl font-semibold">{title}</h1>
                <p className="text-sm text-muted-foreground">{description}</p>
              </div>
              {children}
            </CardContent>
          </Card>
          <p className="text-center text-sm text-muted-foreground">{footer}</p>
        </div>
      </section>
    </main>
  )
}
