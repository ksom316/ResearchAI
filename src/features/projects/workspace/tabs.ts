import {
  FileText,
  GitCompare,
  LayoutList,
  PenLine,
  Quote,
  Sparkles,
} from 'lucide-react'

export const WORKSPACE_TABS = [
  { value: 'overview', label: 'Overview', icon: LayoutList },
  { value: 'papers', label: 'Papers', icon: FileText },
  { value: 'ai-research', label: 'AI Research', icon: Sparkles },
  { value: 'evidence', label: 'Evidence', icon: Quote },
  { value: 'comparisons', label: 'Comparisons', icon: GitCompare },
  { value: 'writing', label: 'Writing', icon: PenLine },
] as const

export type WorkspaceTab = (typeof WORKSPACE_TABS)[number]['value']

export function parseWorkspaceTab(value: unknown): WorkspaceTab {
  return WORKSPACE_TABS.some((tab) => tab.value === value)
    ? (value as WorkspaceTab)
    : 'overview'
}
