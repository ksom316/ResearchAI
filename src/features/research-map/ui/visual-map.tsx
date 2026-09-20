import { useMemo, useState } from 'react'
import {
  Background,
  Controls,
  ReactFlow,
  ReactFlowProvider,
} from '@xyflow/react'
import type { Edge, Node } from '@xyflow/react'
import '@xyflow/react/dist/style.css'
import { Button } from '#/components/ui/button'
import { EmptyState } from '#/components/empty-state'
import { Network } from 'lucide-react'
import { neighborhoodOf } from '../graph-view-model'
import type { GraphViewModel } from '../graph-view-model'
import type { EvidenceSelection } from '../view-model'
import { NODE_TYPES } from './graph-nodes'

/**
 * The interactive visual map. Pure presentation over an already-built GraphViewModel
 * (search/kind/stale filtering and findings visibility are decided by the caller, via
 * the same view-model used by the Relationship Index). Layout positions come straight
 * from the view-model, unchanged; this component only adds selection highlighting.
 */
export function VisualMap({
  graph,
  onViewEvidence,
  onSwitchToIndex,
}: {
  graph: GraphViewModel
  onViewEvidence: (selection: EvidenceSelection) => void
  onSwitchToIndex: () => void
}) {
  const [selected, setSelected] = useState<string | null>(null)

  if (graph.kind === 'empty') {
    return (
      <EmptyState
        icon={Network}
        title="Nothing to show"
        description="No papers match the current filters."
      />
    )
  }

  if (graph.kind === 'too_large') {
    return (
      <EmptyState
        icon={Network}
        title="Too many relationships to graph"
        description={`This project has ${graph.nodeCount} nodes, more than the ${graph.limit} a visual map can show clearly. Use the Relationship Index instead.`}
        action={
          <Button type="button" variant="outline" onClick={onSwitchToIndex}>
            Open Relationship Index
          </Button>
        }
      />
    )
  }

  const neighborhood = selected ? neighborhoodOf(selected, graph.edges) : null

  const nodes: Node[] = useMemo(
    () =>
      graph.nodes.map((n) => ({
        id: n.id,
        type: n.kind,
        position: n.position,
        selected: n.id === selected,
        draggable: false,
        connectable: false,
        data: {
          ...n.data,
          kind: n.kind,
          dimmed: neighborhood ? !neighborhood.nodeIds.has(n.id) : false,
        },
      })),
    [graph, selected],
  )

  const edges: Edge[] = useMemo(
    () =>
      graph.edges.map((e) => ({
        id: e.id,
        source: e.source,
        target: e.target,
        selectable: true,
        focusable: true,
        style: {
          opacity: neighborhood && !neighborhood.edgeIds.has(e.id) ? 0.15 : 1,
          strokeWidth: neighborhood?.edgeIds.has(e.id) ? 2 : 1,
        },
      })),
    [graph, selected],
  )

  return (
    <div className="space-y-2">
      <div className="h-[480px] overflow-hidden rounded-lg border bg-card sm:h-[560px]">
        <ReactFlowProvider>
          <ReactFlow
            nodes={nodes}
            edges={edges}
            nodeTypes={NODE_TYPES}
            fitView
            fitViewOptions={{ padding: 0.2 }}
            minZoom={0.3}
            maxZoom={1.5}
            proOptions={{ hideAttribution: true }}
            onNodeClick={(_e, node) => {
              setSelected((prev) => (prev === node.id ? null : node.id))
              const evidence = (node.data as { evidence?: EvidenceSelection }).evidence
              if (evidence) onViewEvidence(evidence)
            }}
            onEdgeClick={(_e, edge) => {
              const match = graph.edges.find((x) => x.id === edge.id)
              if (match) {
                setSelected(match.source)
                onViewEvidence(match.evidence)
              }
            }}
            onPaneClick={() => setSelected(null)}
          >
            <Background gap={24} size={1} />
            <Controls showInteractive={false} />
          </ReactFlow>
        </ReactFlowProvider>
      </div>
      <p className="text-xs text-muted-foreground">
        Click a paper or a shared term to highlight its relationships. Click a term,
        edge, or finding to inspect its supporting evidence.
      </p>
    </div>
  )
}
