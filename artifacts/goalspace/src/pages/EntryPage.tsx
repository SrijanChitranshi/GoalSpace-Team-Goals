import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Building2, Plus, Users } from 'lucide-react';
import { getHealthCheckQueryKey, getListWorkspacesQueryKey, useCreateWorkspace, useGetCurrentUser, useHealthCheck, useListWorkspaces } from '@workspace/api-client-react';
import { Avatar, Brand, EmptyState, LoadingRows, Modal } from '@/components/goalspace';

export default function EntryPage() {
  const [, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const current = useGetCurrentUser();
  const health = useHealthCheck({ query: { queryKey: getHealthCheckQueryKey() } });
  const workspaces = useListWorkspaces();
  const createWorkspace = useCreateWorkspace();
  const [creating, setCreating] = useState(false);
  const [workspaceName, setWorkspaceName] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const user = current.data?.user;
  const items = workspaces.data?.items ?? [];
  const create = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    createWorkspace.mutate({ data: { name: workspaceName.trim(), approvalRequired } }, { onSuccess: async (workspace) => {
      await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
      setCreating(false);
      setLocation(`/w/${workspace.id}/overview`);
    } });
  };
  return (
    <main className="min-h-[100dvh] bg-background">
      <header className="flex h-[66px] items-center justify-between border-b bg-card px-5 md:px-10">
        <Link href="/" className="flex items-center gap-3"><Brand /><span className="hidden h-5 w-px bg-border sm:block" /><span className="hidden text-xs text-muted-foreground sm:block">Your workspaces</span></Link>
        <div className="flex items-center gap-3">
          <Link href="/join" className="button button-quiet !py-2 text-xs" data-testid="link-join-workspace"><Users size={14} /> Join a workspace</Link>
          <span className="hidden items-center gap-1.5 text-[10px] text-muted-foreground lg:flex" data-testid="status-service"><span className={`h-1.5 w-1.5 rounded-full ${health.data?.status === 'ok' || health.data?.status === 'healthy' ? 'bg-emerald-500' : 'bg-slate-300'}`} />{health.data?.status === 'ok' || health.data?.status === 'healthy' ? 'All systems operational' : 'Checking connection'}</span>
          {user && <div className="hidden items-center gap-2 sm:flex"><Avatar name={user.name} /><span className="text-xs font-semibold" data-testid="text-current-user">{user.name}</span></div>}
        </div>
      </header>
      <section className="mx-auto max-w-[1040px] px-5 pb-16 pt-12 md:px-8 md:pt-16">
        <div className="mb-9 flex flex-wrap items-end justify-between gap-4">
          <div><p className="mb-2 text-[10px] font-bold uppercase tracking-[.17em] text-primary">Your team’s focus, together</p><h1 className="font-display text-3xl font-bold tracking-[-.05em] md:text-[38px]">Where are we working today?</h1><p className="mt-2 text-sm text-muted-foreground">Choose a workspace to pick up the thread.</p></div>
          {user && <button className="button button-primary" onClick={() => setCreating(true)} data-testid="button-create-workspace"><Plus size={15} /> New workspace</button>}
        </div>
        {!user && current.isLoading && <LoadingRows count={2} />}
        {!user && current.isError && <div className="panel p-7"><p className="font-display font-bold">Sign in to continue</p><p className="mt-1 text-sm text-muted-foreground">Your workspaces are connected to your account.</p><Link href="/login" className="button button-primary mt-4" data-testid="link-sign-in">Sign in <ArrowRight size={14} /></Link></div>}
        {user && workspaces.isLoading && <LoadingRows count={3} />}
        {user && workspaces.isError && <div className="panel p-6"><p className="font-semibold">Workspace list unavailable</p><p className="mt-1 text-sm text-muted-foreground">Reconnect to see your teams.</p><button className="button button-quiet mt-4" onClick={() => workspaces.refetch()} data-testid="button-retry-workspaces">Try again</button></div>}
        {user && !workspaces.isLoading && !workspaces.isError && items.length === 0 && <EmptyState title="Your next workspace starts here" detail="Create a shared home for goals, ownership, and the conversations that move work forward." action={<button className="button button-primary" onClick={() => setCreating(true)} data-testid="button-create-first-workspace"><Plus size={15} /> Create workspace</button>} />}
        {items.length > 0 && <div className="grid gap-3 md:grid-cols-2">{items.map((workspace, index) => <Link href={`/w/${workspace.id}/overview`} className="panel group flex min-h-[108px] items-center gap-4 p-5 transition duration-200 hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md" key={workspace.id} data-testid={`card-workspace-${workspace.id}`}><span className={`grid h-12 w-12 place-items-center rounded-[14px] ${index % 2 ? 'bg-[#edf1f8] text-[#4a6288]' : 'bg-[#eaf0fa] text-[#315895]'}`}><Building2 size={19} /></span><span className="min-w-0 flex-1"><span className="block truncate font-display text-base font-bold tracking-tight" data-testid={`text-workspace-name-${workspace.id}`}>{workspace.name}</span><span className="mt-1 block text-[11px] capitalize text-muted-foreground">{workspace.role} · {workspace.approvalRequired ? 'Request to join enabled' : 'Open invitation'}</span></span><ArrowRight size={17} className="text-muted-foreground transition group-hover:translate-x-1 group-hover:text-primary" /></Link>)}</div>}
      </section>
      {creating && <Modal title="Create a workspace" onClose={() => setCreating(false)}><form className="space-y-4" onSubmit={create}><label className="block"><span className="mb-1.5 block text-xs font-semibold">Workspace name</span><input className="field" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required minLength={2} maxLength={120} placeholder="Northstar Studio" data-testid="input-workspace-name" autoFocus /></label><label className="flex cursor-pointer items-start gap-3 rounded-xl border p-3.5"><input type="checkbox" checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} className="mt-0.5 accent-[#315895]" data-testid="input-approval-required" /><span><span className="block text-xs font-semibold">Review join requests</span><span className="mt-1 block text-[11px] leading-4 text-muted-foreground">Require an owner or admin to approve new members.</span></span></label>{createWorkspace.error && <p role="alert" className="text-xs text-destructive">{(createWorkspace.error as Error).message}</p>}<div className="flex justify-end gap-2 pt-1"><button className="button button-quiet" type="button" onClick={() => setCreating(false)} data-testid="button-cancel-workspace">Cancel</button><button className="button button-primary" disabled={createWorkspace.isPending} data-testid="button-submit-workspace">{createWorkspace.isPending ? 'Creating…' : 'Create workspace'} <ArrowRight size={14} /></button></div></form></Modal>}
    </main>
  );
}
