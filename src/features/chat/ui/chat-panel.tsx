import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import type { KeyboardEvent } from 'react'
import { Link } from '@tanstack/react-router'
import { Loader2, SendHorizontal, Sparkles, User } from 'lucide-react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import { askResearchFn } from '../ask.functions'
import { AnswerView } from './answer-view'
import { ChatSession, validateQuestion } from './chat-session'
import type { AskFn } from './chat-session'
import { SUGGESTIONS } from './messages'

/** Project-scoped research chat. Conversation lives only in React memory. */
export function ChatPanel({
  projectId,
  ask = askResearchFn,
}: {
  projectId: string
  ask?: AskFn
}) {
  // One session per mounted panel (the workspace keys it by project).
  const [session] = useState(() => new ChatSession(projectId, ask))
  const { turns, busy } = useSyncExternalStore(
    session.subscribe,
    session.getSnapshot,
    session.getSnapshot,
  )
  const [draft, setDraft] = useState('')
  const [selected, setSelected] = useState<Record<number, string | null>>({})
  const endRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end', behavior: 'smooth' })
  }, [turns])

  const trimmed = draft.trim()
  const invalid = trimmed.length > 0 && !validateQuestion(trimmed)

  async function send() {
    if (busy || trimmed === '' || invalid) return
    const question = trimmed
    setDraft('')
    const result = await session.submit(question)
    if (result !== 'sent') setDraft(question)
  }

  function onKeyDown(event: KeyboardEvent<HTMLTextAreaElement>) {
    // Enter sends; Shift+Enter adds a newline; never mid-IME-composition.
    if (
      event.key === 'Enter' &&
      !event.shiftKey &&
      !event.nativeEvent.isComposing
    ) {
      event.preventDefault()
      void send()
    }
  }

  return (
    <div className="flex min-w-0 flex-col gap-4">
      <div>
        <h2 className="text-lg font-semibold">Research Chat</h2>
        <p className="text-sm text-muted-foreground">
          Ask questions about the papers in this project. Answers come only from
          your papers and cite their sources.
        </p>
      </div>

      <div
        className="flex min-w-0 flex-col gap-4"
        aria-live="polite"
        aria-busy={busy}
      >
        {turns.length === 0 && (
          <div className="rounded-xl border border-dashed bg-card/50 p-4">
            <p className="text-sm font-medium">Try asking</p>
            <div className="mt-3 flex flex-col gap-2 sm:flex-row sm:flex-wrap">
              {SUGGESTIONS.map((suggestion) => (
                <Button
                  key={suggestion}
                  type="button"
                  variant="outline"
                  size="sm"
                  className="h-auto min-w-0 justify-start py-2 text-left whitespace-normal"
                  disabled={busy}
                  onClick={() => setDraft(suggestion)}
                >
                  {suggestion}
                </Button>
              ))}
            </div>
          </div>
        )}

        {turns.map((turn) => (
          <div key={turn.id} className="flex min-w-0 flex-col gap-3">
            <div className="flex min-w-0 items-start gap-2 self-end rounded-xl bg-accent px-3 py-2 text-sm sm:max-w-[85%]">
              <User className="mt-0.5 size-4 shrink-0" />
              <p className="min-w-0 break-words whitespace-pre-wrap">
                {turn.question}
              </p>
            </div>
            <div className="flex min-w-0 items-start gap-2 rounded-xl border bg-card px-3 py-3">
              <Sparkles className="mt-0.5 size-4 shrink-0 text-primary" />
              <div className="min-w-0 flex-1">
                {turn.outcome === null ? (
                  <p className="flex items-center gap-2 text-sm text-muted-foreground">
                    <Loader2 className="size-4 animate-spin" />
                    Searching your research…
                  </p>
                ) : (
                  <AnswerView
                    outcome={turn.outcome}
                    selectedId={selected[turn.id] ?? null}
                    onSelectCitation={(id) =>
                      setSelected((current) => ({
                        ...current,
                        [turn.id]: current[turn.id] === id ? null : id,
                      }))
                    }
                    viewPaper={(paperId) => (
                      <Button asChild variant="outline" size="sm">
                        <Link to="/papers/$paperId" params={{ paperId }}>
                          View paper
                        </Link>
                      </Button>
                    )}
                  />
                )}
              </div>
            </div>
          </div>
        ))}
        <div ref={endRef} />
      </div>

      <form
        className="flex min-w-0 flex-col gap-2 sm:flex-row sm:items-end"
        onSubmit={(event) => {
          event.preventDefault()
          void send()
        }}
      >
        <div className="min-w-0 flex-1">
          <Textarea
            value={draft}
            onChange={(event) => setDraft(event.target.value)}
            onKeyDown={onKeyDown}
            rows={2}
            maxLength={2000}
            aria-label="Ask a question about your papers"
            aria-invalid={invalid}
            placeholder="Ask a question about your papers…"
            className="max-h-40 min-h-16 resize-none"
            disabled={busy}
          />
          {invalid && (
            <p className="mt-1 text-xs text-destructive">
              Enter a question of at least 2 characters (up to 1000).
            </p>
          )}
        </div>
        <Button
          type="submit"
          disabled={busy || trimmed === '' || invalid}
          className="w-full sm:w-auto"
        >
          {busy ? <Loader2 className="animate-spin" /> : <SendHorizontal />}
          Send
        </Button>
      </form>
    </div>
  )
}
