import { useState } from 'react'
import { Copy, Link2, UserPlus, X } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '#/components/ui/button'
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '#/components/ui/dialog'
import { Input } from '#/components/ui/input'
import { Label } from '#/components/ui/label'
import { useChangeProjectMemberRole, useInviteProjectMember, useRemoveProjectMember, projectActivityQuery, projectMembersQuery } from '../queries'
import type { ProjectRole } from '../collaboration'
import { useQuery } from '@tanstack/react-query'

export function CollaborationDialog({ projectId, open, onOpenChange, owner }: { projectId: string; open: boolean; onOpenChange: (open: boolean) => void; owner: boolean }) {
  const members = useQuery({ ...projectMembersQuery(projectId), enabled: open })
  const activity = useQuery({ ...projectActivityQuery(projectId), enabled: open })
  const invite = useInviteProjectMember(projectId)
  const changeRole = useChangeProjectMemberRole(projectId)
  const remove = useRemoveProjectMember(projectId)
  const [email, setEmail] = useState('')
  const [role, setRole] = useState<Exclude<ProjectRole, 'OWNER'>>('EDITOR')
  const [link, setLink] = useState<string | null>(null)
  async function submit(e: React.FormEvent) { e.preventDefault(); try { const result = await invite.mutateAsync({ email, role }); setLink(result.link); setEmail('') } catch { /* toast is handled by the mutation */ } }
  return <Dialog open={open} onOpenChange={onOpenChange}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg"><DialogHeader><DialogTitle>Members</DialogTitle><DialogDescription>Share this private project with researchers by email.</DialogDescription></DialogHeader>
    {owner && <form className="space-y-3 rounded-lg border p-3" onSubmit={(e) => void submit(e)}><div className="flex items-center gap-2"><UserPlus className="size-4" /><span className="text-sm font-medium">Invite researcher</span></div><div className="grid gap-2 sm:grid-cols-[1fr_auto]"><div><Label htmlFor="invite-email">Email</Label><Input id="invite-email" type="email" required value={email} onChange={(e) => setEmail(e.target.value)} placeholder="researcher@example.com" /></div><div><Label htmlFor="invite-role">Role</Label><select id="invite-role" className="h-9 rounded-md border bg-background px-2 text-sm" value={role} onChange={(e) => setRole(e.target.value as typeof role)}><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select></div></div><Button type="submit" disabled={invite.isPending}>Send invitation</Button>{link && <div className="flex items-center gap-2 rounded-md bg-muted p-2 text-xs"><Link2 className="size-4 shrink-0" /><span className="min-w-0 flex-1 truncate">{link}</span><Button type="button" size="icon" variant="ghost" aria-label="Copy invitation link" onClick={() => { void navigator.clipboard.writeText(link); toast.success('Invitation link copied') }}><Copy /></Button></div>}</form>}
    <div className="space-y-2"><h3 className="text-sm font-medium">{members.data?.length ?? 0} members</h3>{members.data?.map((member) => <div key={member.user_id} className="flex items-center gap-2 rounded-md border p-2"><div className="min-w-0 flex-1"><p className="truncate text-sm">{member.profile?.full_name || 'Researcher'}</p><p className="truncate text-xs text-muted-foreground">{member.role}</p></div>{owner && member.role !== 'OWNER' && <><select aria-label={`Role for ${member.profile?.full_name || member.user_id}`} className="h-8 rounded-md border bg-background px-2 text-xs" value={member.role} onChange={(e) => changeRole.mutate({ userId: member.user_id, role: e.target.value as Exclude<ProjectRole, 'OWNER'> })}><option value="EDITOR">Editor</option><option value="VIEWER">Viewer</option></select><Button size="icon" variant="ghost" aria-label="Remove member" onClick={() => remove.mutate(member.user_id)}><X /></Button></>}</div>)}</div>
    <div className="space-y-2 border-t pt-3"><h3 className="text-sm font-medium">Recent activity</h3>{activity.data?.length ? activity.data.map((event) => <div key={event.id} className="text-xs text-muted-foreground"><span className="text-foreground">{event.event_type.replaceAll('_', ' ')}</span> · {new Date(event.created_at).toLocaleString()}</div>) : <p className="text-xs text-muted-foreground">No activity yet.</p>}</div>
  </DialogContent></Dialog>
}
