import { Handle, Position } from '@xyflow/react'
import type { NodeProps } from '@xyflow/react'
import { AlertTriangle, Database, FileText, ListChecks, Tag, Wrench } from 'lucide-react'
import { cn } from 'cn'
import type { GraphNode, GraphNodeKind } from '../graph-view-model'

/**
 * Custom React Flow node renderers. Every kind is distinguishable by an icon AND a text
 * label (never color alone). Paper nodes are visually dominant (larger, bolder, on
 * their own row); term and finding nodes are intentionally smaller.
 */

const KIND_ICON: Record<GraphNodeKind, typeof FileText> = {
  paper: FileText,
  concept: Tag,
  methodology: Wrench,
  dataset: Database,
  finding: ListChecks,
}

/**
 * Displayed as-is (a CSS `uppercase` class handles the visual capitalization, so these
 * stay short and readable in the DOM/in tests too).
 */
const KIND_LABEL: Record<GraphNodeKind, string> = {
  paper: 'Paper',
  concept: 'Concept',
  methodology: 'Method',
  dataset: 'Dataset',
  finding: 'Finding',
}

type FlowNode = { data: GraphNode['data']; selected?: boolean; dimmed?: boolean }

function BaseNode({
  kind,
  data,
  selected,
  dimmed,
  className,
}: FlowNode & { kind: GraphNodeKind; className?: string }) {
  const Icon = KIND_ICON[kind]
  return (
    <div
      className={cn(
        'rounded-lg border bg-card px-3 py-2 text-center shadow-sm transition-opacity',
        selected && 'border-primary ring-2 ring-primary/40',
        dimmed && 'opacity-30',
        className,
      )}
    >
      <Handle type="target" position={Position.Top} className="opacity-0" />
      <div className="flex items-center justify-center gap-1.5 text-[10px] font-semibold tracking-wide text-muted-foreground uppercase">
        <Icon className="size-3" aria-hidden="true" />
        {KIND_LABEL[kind]}
        {data.isStale && (
          <AlertTriangle
            className="size-3 text-amber-600 dark:text-amber-500"
            aria-label="out of date"
          />
        )}
      </div>
      <div className="mt-0.5 text-sm break-words">{data.label}</div>
      {data.paperCount !== undefined && (
        <div className="mt-0.5 text-xs text-muted-foreground">
          {data.paperCount} {data.paperCount === 1 ? 'paper' : 'papers'}
        </div>
      )}
      {data.statusLabel && (
        <div className="mt-0.5 text-xs text-muted-foreground">{data.statusLabel}</div>
      )}
      <Handle type="source" position={Position.Bottom} className="opacity-0" />
    </div>
  )
}

export function PaperFlowNode(props: NodeProps & { data: FlowNode['data'] }) {
  return (
    <BaseNode
      kind="paper"
      data={props.data}
      selected={props.selected}
      dimmed={(props.data as { dimmed?: boolean }).dimmed}
      className="min-w-40 border-2 py-3 font-medium"
    />
  )
}

export function TermFlowNode(
  props: NodeProps & { data: FlowNode['data'] & { kind: 'concept' | 'methodology' | 'dataset' } },
) {
  return (
    <BaseNode
      kind={props.data.kind}
      data={props.data}
      selected={props.selected}
      dimmed={(props.data as { dimmed?: boolean }).dimmed}
      className="min-w-32"
    />
  )
}

export function FindingFlowNode(props: NodeProps & { data: FlowNode['data'] }) {
  return (
    <BaseNode
      kind="finding"
      data={props.data}
      selected={props.selected}
      dimmed={(props.data as { dimmed?: boolean }).dimmed}
      className="min-w-28 py-1.5 text-xs"
    />
  )
}

export const NODE_TYPES = {
  paper: PaperFlowNode,
  concept: TermFlowNode,
  methodology: TermFlowNode,
  dataset: TermFlowNode,
  finding: FindingFlowNode,
}
