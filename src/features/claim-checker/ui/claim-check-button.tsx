import { useState } from 'react'
import { FileCheck2, Loader2 } from 'lucide-react'
import { Button } from '#/components/ui/button'
import type {
  GroundedDraftCitation,
  GroundedDraftUnit,
} from '#/features/writer/types'
import { checkClaimSupportFn } from '../claim-checker.functions'
import { buildClaimCheckRequest } from '../presentation'
import type { ClaimCheckClaimId, ClaimCheckResult } from '../types'
import { ClaimCheckSheet } from './claim-check-sheet'

export type ClaimCheckUnitCitation = {
  citation: GroundedDraftCitation
  number: number
}

export function ClaimCheckButton({
  projectId,
  unit,
  citations,
  onResult,
}: {
  projectId: string
  unit: GroundedDraftUnit
  citations: readonly ClaimCheckUnitCitation[]
  onResult?: (unitId: ClaimCheckClaimId, result: ClaimCheckResult) => void
}) {
  const [open, setOpen] = useState(false)
  const [checking, setChecking] = useState(false)
  const [result, setResult] = useState<ClaimCheckResult | null>(null)
  const request = buildClaimCheckRequest(
    projectId,
    unit.id,
    unit.text,
    citations.map(({ citation }) => ({
      citationId: citation.id,
      locator: citation.locator,
    })),
  )

  async function checkSupport() {
    if (!request || checking) return
    setOpen(true)
    setResult(null)
    setChecking(true)
    try {
      const nextResult = await checkClaimSupportFn({ data: request })
      setResult(nextResult)
      onResult?.(unit.id, nextResult)
    } catch {
      const nextResult: ClaimCheckResult = {
        ok: false,
        error: 'checker_unavailable',
      }
      setResult(nextResult)
      onResult?.(unit.id, nextResult)
    } finally {
      setChecking(false)
    }
  }

  return (
    <>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={!request || checking}
        aria-label="Check whether the cited evidence supports this generated statement"
        className="ml-1 h-7 align-baseline text-xs"
        onClick={() => void checkSupport()}
      >
        {checking ? (
          <Loader2 className="animate-spin" aria-hidden="true" />
        ) : (
          <FileCheck2 aria-hidden="true" />
        )}
        {checking ? 'Checking support…' : 'Check support'}
      </Button>
      <ClaimCheckSheet
        projectId={projectId}
        statement={unit.text}
        citations={citations}
        open={open}
        checking={checking}
        result={result}
        onOpenChange={setOpen}
        onCheck={() => void checkSupport()}
      />
    </>
  )
}
