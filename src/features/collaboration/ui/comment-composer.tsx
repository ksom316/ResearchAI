import { useRef, useState } from 'react'
import { Button } from '#/components/ui/button'
import { Textarea } from '#/components/ui/textarea'
import type { ProjectMember } from '#/features/projects/collaboration'
import {
  extractMentionedUserIds,
  findActiveMentionQuery,
  insertMentionToken,
} from '../mention-tokens'

/**
 * A textarea with @mention autocomplete. Typing "@" opens a list of project
 * members filtered by what follows; picking one inserts a structural token
 * (see mention-tokens.ts) rather than leaving the body as free text to parse
 * later.
 */
export function CommentComposer({
  members,
  placeholder = 'Write a comment…',
  submitLabel = 'Comment',
  onSubmit,
  autoFocus,
}: {
  members: readonly ProjectMember[]
  placeholder?: string
  submitLabel?: string
  onSubmit: (input: { body: string; mentionedUserIds: string[] }) => Promise<void> | void
  autoFocus?: boolean
}) {
  const [body, setBody] = useState('')
  const [query, setQuery] = useState<{ start: number; query: string } | null>(null)
  const [submitting, setSubmitting] = useState(false)
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  const matches = query
    ? members
        .filter((m) => (m.profile?.full_name ?? '').toLowerCase().includes(query.query.toLowerCase()))
        .slice(0, 6)
    : []

  function handleChange(value: string, cursor: number) {
    setBody(value)
    setQuery(findActiveMentionQuery(value, cursor))
  }

  function pickMention(member: ProjectMember) {
    if (!query || !textareaRef.current) return
    const { text, cursor } = insertMentionToken(
      body,
      query.start,
      query.start + 1 + query.query.length,
      member.user_id,
      member.profile?.full_name || 'Researcher',
    )
    setBody(text)
    setQuery(null)
    requestAnimationFrame(() => {
      textareaRef.current?.focus()
      textareaRef.current?.setSelectionRange(cursor, cursor)
    })
  }

  async function submit() {
    const trimmed = body.trim()
    if (trimmed === '' || submitting) return
    setSubmitting(true)
    try {
      await onSubmit({ body: trimmed, mentionedUserIds: extractMentionedUserIds(trimmed) })
      setBody('')
      setQuery(null)
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <div className="relative space-y-2">
      <Textarea
        ref={textareaRef}
        value={body}
        placeholder={placeholder}
        autoFocus={autoFocus}
        rows={3}
        onChange={(e) => handleChange(e.target.value, e.target.selectionStart)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
            e.preventDefault()
            void submit()
          }
        }}
      />
      {query && matches.length > 0 && (
        <div className="absolute z-10 w-64 max-w-full rounded-md border bg-popover p-1 shadow-md">
          {matches.map((member) => (
            <button
              key={member.user_id}
              type="button"
              className="flex w-full items-center rounded-sm px-2 py-1.5 text-left text-sm hover:bg-accent hover:text-accent-foreground"
              onClick={() => pickMention(member)}
            >
              {member.profile?.full_name || 'Researcher'}
            </button>
          ))}
        </div>
      )}
      <div className="flex items-center justify-between">
        <p className="text-xs text-muted-foreground">Type @ to mention a collaborator</p>
        <Button size="sm" disabled={body.trim() === '' || submitting} onClick={() => void submit()}>
          {submitLabel}
        </Button>
      </div>
    </div>
  )
}
