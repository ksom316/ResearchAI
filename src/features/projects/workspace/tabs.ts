import {
  FileText,
  GitCompare,
  LayoutList,
  Lightbulb,
  Network,
  PenLine,
  Quote,
  ScanSearch,
  Sparkles,
} from 'lucide-react'

export const WORKSPACE_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutList },
  { value: 'papers', label: 'Papers', icon: FileText },
  { value: 'ai-research', label: 'Research Chat', icon: Sparkles },
  { value: 'evidence', label: 'Evidence Matrix', icon: Quote },
  { value: 'research-map', label: 'Research Map', icon: Network },
  { value: 'research-gaps', label: 'Research Gaps', icon: Lightbulb },
  { value: 'comparisons', label: 'Comparisons', icon: GitCompare },
  { value: 'writing', label: 'Academic Writer', icon: PenLine },
  { value: 'quality-inspector', label: 'Quality Inspector', icon: ScanSearch },
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['value']

export function parseWorkspaceTab(value: unknown): WorkspaceTab {
  return WORKSPACE_TABS.some((tab) => tab.value === value)
    ? (value as WorkspaceTab)
    : 'overview'
}
