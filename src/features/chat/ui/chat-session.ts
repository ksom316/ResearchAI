import { queryField } from '#/features/search/schemas'
import type { AskOutcome } from '../types'

/** The exact shape sent to the backend: a question and a project scope. Nothing else. */
export type AskRequest = {
  question: string
  scope: { type: 'project'; projectId: string }
}
export type AskFn = (options: { data: AskRequest }) => Promise<AskOutcome>

export type ChatTurn = {
  id: number
  question: string
  /** null while the request is running. */
  outcome: AskOutcome | null
}

export type ChatSnapshot = {
  turns: readonly ChatTurn[]
  busy: boolean
}

export type SubmitResult = 'sent' | 'busy' | 'invalid'

/** Client-side check mirroring the server's question rules (the server re-validates). */
export function validateQuestion(raw: string): boolean {
  return queryField.safeParse(raw).success
}

/**
 * In-memory, per-project conversation. Every submission is ONE independent
 * askResearchFn call carrying only { question, scope }: earlier turns are displayed
 * but never sent anywhere. No persistence, no retries.
 */
export class ChatSession {
  private snapshot: ChatSnapshot = { turns: [], busy: false }
  private readonly listeners = new Set<() => void>()
  private nextId = 1

  constructor(
    private readonly projectId: string,
    private readonly ask: AskFn,
  ) {}

  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = () => this.snapshot

  private set(next: ChatSnapshot) {
    this.snapshot = next
    this.listeners.forEach((listener) => listener())
  }

  async submit(raw: string): Promise<SubmitResult> {
    // Synchronous guard: a second call while one is running never reaches the backend.
    if (this.snapshot.busy) return 'busy'
    const question = raw.trim()
    if (!validateQuestion(question)) return 'invalid'

    const id = this.nextId++
    this.set({
      turns: [...this.snapshot.turns, { id, question, outcome: null }],
      busy: true,
    })

    let outcome: AskOutcome
    try {
      outcome = await this.ask({
        data: {
          question,
          scope: { type: 'project', projectId: this.projectId },
        },
      })
    } catch {
      // Never surface the raw error.
      outcome = { ok: false, error: 'answer_unavailable' }
    }

    this.set({
      turns: this.snapshot.turns.map((turn) =>
        turn.id === id ? { ...turn, outcome } : turn,
      ),
      busy: false,
    })
    return 'sent'
  }
}
