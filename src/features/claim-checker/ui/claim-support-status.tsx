import {
  CircleCheck,
  CircleDashed,
  CircleX,
  TriangleAlert,
} from 'lucide-react'
import { Badge } from '#/components/ui/badge'
import { CLAIM_SUPPORT_LABELS } from '../presentation'
import type { ClaimSupport } from '../types'

const STATUS_ICONS = {
  supported: CircleCheck,
  partially_supported: TriangleAlert,
  unsupported: CircleX,
  insufficient_evidence: CircleDashed,
} as const

export function ClaimSupportStatus({ support }: { support: ClaimSupport }) {
  const Icon = STATUS_ICONS[support]
  return (
    <Badge
      variant={support === 'unsupported' ? 'destructive' : 'outline'}
      className="max-w-full whitespace-normal"
    >
      <Icon aria-hidden="true" />
      {CLAIM_SUPPORT_LABELS[support]}
    </Badge>
  )
}
