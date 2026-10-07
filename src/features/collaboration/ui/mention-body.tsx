import { renderMentionBody } from '../mention-tokens'

/** Renders a stored comment body, turning @[[id:name]] tokens into styled mention chips. */
export function MentionBody({ body }: { body: string }) {
  const segments = renderMentionBody(body)
  return (
    <p className="text-sm break-words whitespace-pre-wrap">
      {segments.map((segment, i) =>
        segment.kind === 'mention' ? (
          <span
            key={i}
            className="rounded bg-accent px-1 py-0.5 font-medium text-accent-foreground"
          >
            @{segment.displayName || 'collaborator'}
          </span>
        ) : (
          <span key={i}>{segment.text}</span>
        ),
      )}
    </p>
  )
}
