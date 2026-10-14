import { useEffect, useMemo, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { io } from 'socket.io-client';
import { Activity, ArrowLeft, ArrowRight, CalendarDays, Check, ChevronDown, Clock3, Filter, Link2, MessageSquare, Pencil, Plus, Search, Send, Settings, Shield, Trash2, Users, X } from 'lucide-react';
import {
  type Goal,
  getGetGoalHistoryQueryKey,
  getGetGoalQueryKey,
  getGetWorkspaceQueryKey,
  getGetWorkspaceSummaryQueryKey,
  getListActivityQueryKey,
  getListGoalsQueryKey,
  getListJoinRequestsQueryKey,
  getListMembersQueryKey,
  getListMessagesQueryKey,
  useCreateGoal,
  useCreateInvitation,
  useCreateMessage,
  useDecideJoinRequest,
  useDeleteGoal,
  useDeleteMessage,
  useEditMessage,
  useGetCurrentUser,
  useGetGoalHistory,
  useGetGoal,
  useGetWorkspace,
  useGetWorkspaceSummary,
  useListActivity,
  useListGoals,
  useListJoinRequests,
  useListMembers,
  useListMessages,
  useLogout,
  useRemoveMember,
  useRevokeInvitation,
  useUpdateGoal,
  useUpdateMemberPermissions,
  useUpdateMemberRole,
  useUpdateWorkspace,
} from '@workspace/api-client-react';
import { Avatar, EmptyState, ErrorState, LoadingRows, Modal, PageHeading, StatusPill, WorkspaceShell } from '@/components/goalspace';

const periods = ['daily', 'weekly', 'monthly'] as const;
const permissionLabels: Record<string, string> = {
  viewGoals: 'View goals',
  createGoals: 'Create goals',
  editOwnGoals: 'Edit own goals',
  editAnyGoals: 'Edit any goals',
  deleteOwnGoals: 'Delete own goals',
  deleteAnyGoals: 'Delete any goals',
  assignGoals: 'Assign goals',
  changeGoalStatus: 'Change goal status',
  sendMessages: 'Send messages',
  editOwnMessages: 'Edit own messages',
  deleteOwnMessages: 'Delete own messages',
  moderateChat: 'Moderate chat',
  inviteMembers: 'Invite members',
  approveJoinRequests: 'Approve join requests',
  manageMemberPermissions: 'Manage member permissions',
};

function dateLabel(value?: string | null) {
  if (!value) return 'No deadline';
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(value));
}

function timeLabel(value: string) {
  return new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' }).format(new Date(value));
}

function actionText(action: string) {
  return action.replaceAll('_', ' ').replaceAll('-', ' ');
}

export default function WorkspacePage() {
  const params = useParams<{ workspaceId: string; goalId?: string }>();
  const workspaceId = params.workspaceId ?? '';
  const goalId = params.goalId ?? '';
  const [location, setLocation] = useLocation();
  const queryClient = useQueryClient();
  const current = useGetCurrentUser();
  const logout = useLogout();
  const workspaceQuery = useGetWorkspace(workspaceId);
  const summaryQuery = useGetWorkspaceSummary(workspaceId);
  const user = current.data?.user;
  const workspace = workspaceQuery.data;
  const online = useWorkspaceSocket(workspaceId, queryClient);
  const path = location.replace(`/w/${workspaceId}/`, '');
  const period = periods.find((value) => path === `goals/${value}`);
  const isHistory = path.endsWith('/history') && !!goalId;
  const statusFilter = useMemo(() => ({}), []);
  const goalsQuery = useListGoals(workspaceId, { ...(period ? { period } : {}), ...statusFilter }, { query: { enabled: !!workspaceId && (!!period || path === 'overview'), queryKey: getListGoalsQueryKey(workspaceId, { ...(period ? { period } : {}), ...statusFilter }) } });
  const membersQuery = useListMembers(workspaceId, { query: { enabled: !!workspaceId && ['members', 'permissions', 'goals/daily', 'goals/weekly', 'goals/monthly'].includes(path), queryKey: getListMembersQueryKey(workspaceId) } });
  const activityParams = useMemo(() => ({}), []);
  const activityQuery = useListActivity(workspaceId, activityParams, { query: { enabled: !!workspaceId && ['overview', 'activity'].includes(path), queryKey: getListActivityQueryKey(workspaceId, activityParams) } });
  const joinRequestsQuery = useListJoinRequests(workspaceId, { query: { enabled: !!workspaceId && path === 'members', queryKey: getListJoinRequestsQueryKey(workspaceId) } });
  const messagesParams = useMemo(() => ({ limit: 100 }), []);
  const messagesQuery = useListMessages(workspaceId, messagesParams, { query: { enabled: !!workspaceId && path === 'chat', queryKey: getListMessagesQueryKey(workspaceId, messagesParams) } });
  const historyQuery = useGetGoalHistory(workspaceId, goalId, { query: { enabled: !!workspaceId && !!goalId && isHistory, queryKey: getGetGoalHistoryQueryKey(workspaceId, goalId) } });
  const goalQuery = useGetGoal(workspaceId, goalId, { query: { enabled: !!workspaceId && !!goalId && isHistory, queryKey: getGetGoalQueryKey(workspaceId, goalId) } });
  const createGoal = useCreateGoal();
  const updateGoal = useUpdateGoal();
  const deleteGoal = useDeleteGoal();
  const createInvitation = useCreateInvitation();
  const revokeInvitation = useRevokeInvitation();
  const decideRequest = useDecideJoinRequest();
  const updateRole = useUpdateMemberRole();
  const updatePermissions = useUpdateMemberPermissions();
  const removeMember = useRemoveMember();
  const createMessage = useCreateMessage();
  const editMessage = useEditMessage();
  const deleteMessage = useDeleteMessage();
  const updateWorkspace = useUpdateWorkspace();
  const [goalModal, setGoalModal] = useState(false);
  const [editingGoalId, setEditingGoalId] = useState<string | null>(null);
  const [goalTitle, setGoalTitle] = useState('');
  const [goalDescription, setGoalDescription] = useState('');
  const [goalDeadline, setGoalDeadline] = useState('');
  const [goalPriority, setGoalPriority] = useState('medium');
  const [goalProgress, setGoalProgress] = useState(0);
  const [goalAssignees, setGoalAssignees] = useState<string[]>([]);
  const [goalPeriod, setGoalPeriod] = useState<'daily' | 'weekly' | 'monthly'>((period ?? 'daily') as 'daily' | 'weekly' | 'monthly');
  const [statusSelection, setStatusSelection] = useState('all');
  const [search, setSearch] = useState('');
  const [messageText, setMessageText] = useState('');
  const [editingMessageId, setEditingMessageId] = useState<string | null>(null);
  const [editingMessageText, setEditingMessageText] = useState('');
  const [invitation, setInvitation] = useState<{ id: string; code: string } | null>(null);
  const [workspaceName, setWorkspaceName] = useState('');
  const [approvalRequired, setApprovalRequired] = useState(false);
  const [activityAction, setActivityAction] = useState('');

  useEffect(() => {
    if (workspace) {
      setWorkspaceName(workspace.name);
      setApprovalRequired(workspace.approvalRequired);
    }
  }, [workspace?.id, workspace?.name, workspace?.approvalRequired]);

  const invalidateGoals = () => queryClient.invalidateQueries({ queryKey: getListGoalsQueryKey(workspaceId, { ...(period ? { period } : {}), ...statusFilter }) });
  const submitGoal = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (editingGoalId) {
      const old = goalsQuery.data?.items.find((item) => item.id === editingGoalId);
      updateGoal.mutate({ workspaceId, goalId: editingGoalId, data: { title: goalTitle.trim(), description: goalDescription, deadline: goalDeadline || null, priority: goalPriority as 'low' | 'medium' | 'high', progress: goalProgress, assigneeIds: goalAssignees, expectedVersion: old?.version } }, { onSuccess: () => { void invalidateGoals(); setGoalModal(false); } });
    } else {
      createGoal.mutate({ workspaceId, data: { title: goalTitle.trim(), description: goalDescription, period: goalPeriod, deadline: goalDeadline || null, priority: goalPriority as 'low' | 'medium' | 'high', progress: goalProgress, assigneeIds: goalAssignees } }, { onSuccess: () => { void invalidateGoals(); setGoalModal(false); } });
    }
  };
  const openGoalModal = (goal?: Goal) => {
    const selected = goal;
    setEditingGoalId(selected?.id ?? null);
    setGoalTitle(selected?.title ?? '');
    setGoalDescription(selected?.description ?? '');
    setGoalDeadline(selected?.deadline ? selected.deadline.slice(0, 10) : '');
    setGoalPriority(selected?.priority ?? 'medium');
    setGoalProgress(selected?.progress ?? 0);
    setGoalAssignees(selected?.assignees?.map((person: { userId: string }) => person.userId) ?? []);
    setGoalPeriod((selected?.period ?? period ?? 'daily') as 'daily' | 'weekly' | 'monthly');
    setGoalModal(true);
  };
  const changeStatus = (goal: Goal, status: Goal['status']) => updateGoal.mutate({ workspaceId, goalId: goal.id, data: { status, progress: status === 'completed' ? 100 : goal.progress, expectedVersion: goal.version } }, { onSuccess: () => { void invalidateGoals(); } });
  const onSendMessage = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!messageText.trim()) return;
    createMessage.mutate({ workspaceId, data: { text: messageText.trim() } }, { onSuccess: () => { setMessageText(''); void queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(workspaceId, messagesParams) }); } });
  };
  const sectionName = period ? `${period[0].toUpperCase()}${period.slice(1)} goals` : '';
  const base = `/w/${workspaceId}`;

  if (workspaceQuery.isError) {
    return <div className="min-h-screen p-8"><ErrorState onRetry={() => workspaceQuery.refetch()} /></div>;
  }
  if (workspaceQuery.isLoading || current.isLoading) {
    return <div className="min-h-screen bg-background p-6"><div className="mx-auto max-w-4xl"><div className="skeleton mb-6 h-8 w-56" /><LoadingRows count={4} /></div></div>;
  }
  if (!workspace || !user) {
    return <div className="grid min-h-screen place-items-center p-5"><div className="panel max-w-md p-7 text-center"><h1 className="font-display text-xl font-bold">Workspace unavailable</h1><p className="mt-2 text-sm text-muted-foreground">Sign in with a team account or choose another workspace.</p><Link href="/login" className="button button-primary mt-5" data-testid="link-workspace-sign-in">Sign in</Link></div></div>;
  }

  const content = () => {
    if (period) {
      const goals = goalsQuery.data?.items ?? [];
      const filteredGoals = goals.filter((goal) => (statusSelection === 'all' || goal.status === statusSelection) && (!search || `${goal.title} ${goal.description} ${goal.assignees.map((person) => person.name).join(' ')}`.toLowerCase().includes(search.toLowerCase())));
      return <section className="fade-in">
        <PageHeading eyebrow={`${workspace.name} / goals`} title={sectionName} description={`Keep ${period} priorities visible, owned, and moving.`} action={<button className="button button-primary" onClick={() => openGoalModal()} data-testid="button-create-goal"><Plus size={15} /> Add goal</button>} />
        <div className="mb-4 flex flex-wrap items-center gap-2.5">
          <span className="relative min-w-[190px] flex-1 sm:max-w-[310px]"><Search size={14} className="absolute left-3 top-2.5 text-muted-foreground" /><input className="field !py-2 !pl-9" placeholder="Search goals or owners" value={search} onChange={(event) => setSearch(event.target.value)} data-testid="input-search-goals" /></span>
          <span className="relative"><Filter size={13} className="pointer-events-none absolute left-3 top-[11px] text-muted-foreground" /><select className="field !w-auto !py-2 !pl-8 pr-8 capitalize" value={statusSelection} onChange={(event) => setStatusSelection(event.target.value)} data-testid="select-goal-status"><option value="all">All statuses</option><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></span>
          <span className="ml-auto text-[11px] text-muted-foreground" data-testid="text-goal-count">{goals.length} {goals.length === 1 ? 'goal' : 'goals'}</span>
        </div>
        {goalsQuery.isLoading && <LoadingRows />}
        {goalsQuery.isError && <ErrorState onRetry={() => goalsQuery.refetch()} />}
        {!goalsQuery.isLoading && !goalsQuery.isError && filteredGoals.length === 0 && <EmptyState title={goals.length ? 'No goals match this view' : 'A clear next step starts here'} detail={goals.length ? 'Adjust the status or search to see another goal.' : `Add a ${period} goal so ownership and progress are easy to follow.`} action={!goals.length ? <button className="button button-primary" onClick={() => openGoalModal()} data-testid="button-empty-create-goal"><Plus size={14} /> Add the first goal</button> : undefined} />}
        {filteredGoals.length > 0 && <div className="panel overflow-hidden"><div className="hidden grid-cols-[minmax(230px,1.8fr)_minmax(110px,.8fr)_120px_105px_120px_36px] gap-4 border-b bg-[#f8f9fb] px-5 py-3 text-[9px] font-bold uppercase tracking-[.13em] text-muted-foreground md:grid"><span>Goal</span><span>Owner</span><span>Deadline</span><span>Priority</span><span>Status</span><span /></div>{filteredGoals.map((goal) => <article key={goal.id} className="group grid gap-3 border-b px-4 py-4 last:border-0 hover:bg-[#fbfcfe] md:grid-cols-[minmax(230px,1.8fr)_minmax(110px,.8fr)_120px_105px_120px_36px] md:items-center md:gap-4 md:px-5" data-testid={`row-goal-${goal.id}`}><div className="min-w-0"><Link href={`${base}/goals/${goal.id}/history`} className="truncate font-semibold text-[13px] hover:text-primary" data-testid={`link-goal-history-${goal.id}`}>{goal.title}</Link><p className="mt-1 line-clamp-1 text-[11px] text-muted-foreground">{goal.description || 'No description'}</p><div className="mt-2 flex items-center gap-2 md:hidden"><StatusPill status={goal.status} /><span className="text-[10px] text-muted-foreground">Due {dateLabel(goal.deadline)}</span></div><div className="mt-2.5 flex items-center gap-2"><div className="h-1.5 flex-1 overflow-hidden rounded-full bg-slate-100 md:max-w-[140px]"><div className="h-full rounded-full bg-[#5279b7] transition-all" style={{ width: `${goal.progress}%` }} /></div><span className="text-[10px] font-semibold tabular-nums text-muted-foreground">{goal.progress}%</span></div></div><div className="flex items-center gap-2">{goal.assignees.length ? <>{goal.assignees.slice(0, 3).map((person) => <Avatar key={person.userId} name={person.name} />)}<span className="truncate text-[11px] text-muted-foreground">{goal.assignees.map((person) => person.name).join(', ')}</span></> : <span className="text-[11px] text-muted-foreground">Unassigned</span>}</div><span className="hidden text-[11px] text-muted-foreground md:block">{dateLabel(goal.deadline)}</span><div className="hidden md:block"><StatusPill status={goal.priority} /></div><div className="hidden md:block"><select className="max-w-full rounded-md border bg-card px-2 py-1.5 text-[10px] capitalize outline-none focus:border-primary" value={goal.status} onChange={(event) => changeStatus(goal, event.target.value as Goal['status'])} aria-label={`Update ${goal.title} status`} data-testid={`select-goal-state-${goal.id}`}><option value="not-started">Not started</option><option value="in-progress">In progress</option><option value="blocked">Blocked</option><option value="completed">Completed</option></select></div><div className="flex justify-end gap-1"><button className="rounded-md p-2 text-muted-foreground opacity-100 transition hover:bg-accent hover:text-primary md:opacity-0 md:group-hover:opacity-100" onClick={() => openGoalModal(goal)} aria-label={`Edit ${goal.title}`} data-testid={`button-edit-goal-${goal.id}`}><Pencil size={14} /></button><button className="rounded-md p-2 text-muted-foreground opacity-100 transition hover:bg-rose-50 hover:text-destructive md:opacity-0 md:group-hover:opacity-100" onClick={() => { if (window.confirm(`Delete “${goal.title}”? This cannot be undone.`)) deleteGoal.mutate({ workspaceId, goalId: goal.id }, { onSuccess: () => { void invalidateGoals(); } }); }} aria-label={`Delete ${goal.title}`} data-testid={`button-delete-goal-${goal.id}`}><Trash2 size={14} /></button></div></article>)}</div>}
      </section>;
    }
    if (path === 'overview') return <OverviewPage summary={summaryQuery.data} summaryLoading={summaryQuery.isLoading} summaryError={summaryQuery.isError} onRetry={() => summaryQuery.refetch()} activity={activityQuery.data?.items ?? []} activityLoading={activityQuery.isLoading} workspaceId={workspaceId} />;
    if (isHistory) {
      const goal = goalQuery.data;
      const history = historyQuery.data ?? [];
      return <section className="fade-in"><Link href={`${base}/goals/${goal?.period ?? 'daily'}`} className="mb-5 inline-flex items-center gap-1.5 text-xs text-muted-foreground hover:text-primary"><ArrowLeft size={14} /> Back to goals</Link><PageHeading eyebrow="Audit trail" title={goal?.title ?? 'Goal history'} description="A reliable record of every change to this goal." /><div className="panel p-5 md:p-7">{(goalQuery.isLoading || historyQuery.isLoading) && <LoadingRows count={3} />}{(goalQuery.isError || historyQuery.isError) && <ErrorState onRetry={() => { void goalQuery.refetch(); void historyQuery.refetch(); }} />}{!goalQuery.isLoading && !historyQuery.isLoading && history.length === 0 && <EmptyState title="No changes recorded yet" detail="Updates to this goal will appear here as a permanent timeline." />}{history.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}</div></section>;
    }
    if (path === 'activity') return <ActivityPage items={activityQuery.data?.items ?? []} loading={activityQuery.isLoading} error={activityQuery.isError} onRetry={() => activityQuery.refetch()} action={activityAction} onActionChange={setActivityAction} />;
    if (path === 'chat') return <ChatPage messages={messagesQuery.data?.items ?? []} loading={messagesQuery.isLoading} error={messagesQuery.isError} onRetry={() => messagesQuery.refetch()} currentUserId={user.id} messageText={messageText} setMessageText={setMessageText} onSend={onSendMessage} createPending={createMessage.isPending} editingMessageId={editingMessageId} setEditingMessageId={setEditingMessageId} editingText={editingMessageText} setEditingText={setEditingMessageText} onEdit={(messageId, text) => editMessage.mutate({ workspaceId, messageId, data: { text } }, { onSuccess: () => { setEditingMessageId(null); void queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(workspaceId, messagesParams) }); } })} onDelete={(messageId) => { if (window.confirm('Delete this message?')) deleteMessage.mutate({ workspaceId, messageId }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(workspaceId, messagesParams) }); } }); }} />;
    if (path === 'members' || path === 'permissions') return <MembersPage members={membersQuery.data ?? []} loading={membersQuery.isLoading} error={membersQuery.isError} onRetry={() => membersQuery.refetch()} path={path} requests={joinRequestsQuery.data ?? []} requestsLoading={joinRequestsQuery.isLoading} requestError={joinRequestsQuery.isError} onDecision={(requestId, decision) => decideRequest.mutate({ workspaceId, requestId, data: { decision } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListJoinRequestsQueryKey(workspaceId) }); void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(workspaceId) }); } })} onRole={(userId, role) => updateRole.mutate({ workspaceId, userId, data: { role } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(workspaceId) }); } })} onPermission={(member, key, value) => updatePermissions.mutate({ workspaceId, userId: member.id, data: { permissions: { ...member.permissions, [key]: value } } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(workspaceId) }); } })} onRemove={(member) => { if (window.confirm(`Remove ${member.name} from this workspace?`)) removeMember.mutate({ workspaceId, userId: member.id }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(workspaceId) }); } }); }} invitation={invitation} onInvite={() => createInvitation.mutate({ workspaceId, data: { expiresInDays: 7, usageLimit: null } }, { onSuccess: (result) => setInvitation({ id: result.id, code: result.code }) })} onRevoke={() => { if (invitation && window.confirm('Revoke this invitation link?')) revokeInvitation.mutate({ workspaceId, invitationId: invitation.id }, { onSuccess: () => setInvitation(null) }); }} onCopy={() => { if (invitation) void navigator.clipboard?.writeText(`${window.location.origin}/join?code=${invitation.code}`); }} />;
    if (path === 'settings') return <section className="fade-in"><PageHeading eyebrow="Manage workspace" title="Workspace settings" description="Keep the space accurately named and decide how new people join." /><div className="panel max-w-2xl p-5 md:p-7"><form className="space-y-5" onSubmit={(event) => { event.preventDefault(); updateWorkspace.mutate({ workspaceId, data: { name: workspaceName.trim(), approvalRequired } }, { onSuccess: () => { void queryClient.invalidateQueries({ queryKey: getGetWorkspaceQueryKey(workspaceId) }); } }); }}><label className="block"><span className="mb-1.5 block text-xs font-semibold">Workspace name</span><input className="field" value={workspaceName} onChange={(event) => setWorkspaceName(event.target.value)} required minLength={2} maxLength={120} data-testid="input-settings-name" /></label><div className="flex items-start justify-between gap-4 rounded-xl border p-4"><span><span className="block text-sm font-semibold">Require approval to join</span><span className="mt-1 block text-xs text-muted-foreground">New invitation requests wait for an owner or admin to approve.</span></span><input type="checkbox" className="mt-1 h-4 w-4 accent-[#315895]" checked={approvalRequired} onChange={(event) => setApprovalRequired(event.target.checked)} data-testid="input-settings-approval" /></div><div className="flex items-center justify-between border-t pt-4"><div><p className="text-[10px] font-bold uppercase tracking-wider text-muted-foreground">Workspace code</p><p className="mt-1 font-mono text-sm" data-testid="text-workspace-code">{workspace.workspaceCode}</p></div><span className="rounded-full bg-accent px-2.5 py-1 text-[10px] font-bold capitalize text-primary">{workspace.role}</span></div>{updateWorkspace.error && <p role="alert" className="text-xs text-destructive">{(updateWorkspace.error as Error).message}</p>}<button className="button button-primary" disabled={updateWorkspace.isPending} data-testid="button-save-settings">{updateWorkspace.isPending ? 'Saving…' : 'Save changes'}</button></form></div></section>;
    return <EmptyState title="This workspace view isn’t available" detail="Use the navigation to return to your goals, conversations, and team." action={<Link href={`${base}/overview`} className="button button-primary">Go to overview</Link>} />;
  };

  return <WorkspaceShell workspaceId={workspaceId} workspaceName={workspace.name} online={online} userName={user.name} role={workspace.role} onLogout={() => logout.mutate(undefined, { onSuccess: () => { void queryClient.clear(); setLocation('/login'); } })}>
    {content()}
    {goalModal && <Modal title={editingGoalId ? 'Edit goal' : 'Create a goal'} onClose={() => setGoalModal(false)}><form className="space-y-4" onSubmit={submitGoal}><label className="block"><span className="mb-1.5 block text-xs font-semibold">Goal title</span><input className="field" required minLength={1} maxLength={200} value={goalTitle} onChange={(event) => setGoalTitle(event.target.value)} placeholder="Make the next release easier to ship" data-testid="input-goal-title" autoFocus /></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Description</span><textarea className="field min-h-[86px] resize-y" maxLength={5000} value={goalDescription} onChange={(event) => setGoalDescription(event.target.value)} placeholder="What will be different when this is done?" data-testid="input-goal-description" /></label><div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold">Period</span><select className="field capitalize" value={goalPeriod} onChange={(event) => setGoalPeriod(event.target.value as 'daily' | 'weekly' | 'monthly')} data-testid="select-goal-period">{periods.map((value) => <option value={value} key={value}>{value}</option>)}</select></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Deadline</span><input className="field" type="date" value={goalDeadline} onChange={(event) => setGoalDeadline(event.target.value)} data-testid="input-goal-deadline" /></label></div><div className="grid grid-cols-2 gap-3"><label className="block"><span className="mb-1.5 block text-xs font-semibold">Priority</span><select className="field capitalize" value={goalPriority} onChange={(event) => setGoalPriority(event.target.value)} data-testid="select-goal-priority"><option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option></select></label><label className="block"><span className="mb-1.5 block text-xs font-semibold">Owners</span><select multiple className="field min-h-[42px] py-2" value={goalAssignees} onChange={(event) => setGoalAssignees(Array.from(event.target.selectedOptions, (option) => option.value))} data-testid="select-goal-assignees">{(membersQuery.data ?? []).map((member) => <option value={member.id} key={member.id}>{member.name}</option>)}</select></label></div><label className="block"><span className="mb-1.5 flex justify-between text-xs font-semibold"><span>Progress</span><span className="tabular-nums text-muted-foreground">{goalProgress}%</span></span><input className="w-full accent-[#315895]" type="range" min={0} max={100} step={5} value={goalProgress} onChange={(event) => setGoalProgress(Number(event.target.value))} data-testid="input-goal-progress" /></label>{(createGoal.error || updateGoal.error) && <p role="alert" className="text-xs text-destructive">{((createGoal.error || updateGoal.error) as Error).message}</p>}<div className="flex justify-end gap-2 pt-1"><button className="button button-quiet" type="button" onClick={() => setGoalModal(false)} data-testid="button-cancel-goal">Cancel</button><button className="button button-primary" disabled={createGoal.isPending || updateGoal.isPending} data-testid="button-save-goal">{createGoal.isPending || updateGoal.isPending ? 'Saving…' : editingGoalId ? 'Save changes' : 'Create goal'}</button></div></form></Modal>}
  </WorkspaceShell>;
}

function useWorkspaceSocket(workspaceId: string, queryClient: ReturnType<typeof useQueryClient>) {
  const [connected, setConnected] = useState(false);
  useEffect(() => {
    if (!workspaceId) return;
    const socket = io({ path: '/socket.io', withCredentials: true, transports: ['websocket', 'polling'] });
    const refresh = () => {
      void queryClient.invalidateQueries({ queryKey: getGetWorkspaceSummaryQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: getListGoalsQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: getListActivityQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: getListMessagesQueryKey(workspaceId) });
      void queryClient.invalidateQueries({ queryKey: getListMembersQueryKey(workspaceId) });
    };
    socket.on('connect', () => { setConnected(true); socket.emit('workspace:join', { workspaceId }); refresh(); });
    socket.on('disconnect', () => setConnected(false));
    socket.on('connect_error', () => setConnected(false));
    ['workspace:update', 'workspace:presence', 'goals:update', 'goal:created', 'goal:updated', 'goal:deleted', 'activity:update', 'chat:message', 'message:created', 'message:updated', 'message:deleted', 'members:update'].forEach((eventName) => socket.on(eventName, refresh));
    return () => { socket.emit('workspace:leave', { workspaceId }); socket.disconnect(); };
  }, [workspaceId, queryClient]);
  return connected;
}

function OverviewPage({ summary, summaryLoading, summaryError, onRetry, activity, activityLoading, workspaceId }: { summary: any; summaryLoading: boolean; summaryError: boolean; onRetry: () => void; activity: any[]; activityLoading: boolean; workspaceId: string }) {
  const metrics = summary ? [
    { label: 'Active goals', value: summary.pendingGoals, note: `${summary.totalGoals} total tracked`, icon: Check, tone: 'text-[#365f9e] bg-[#edf2fa]' },
    { label: 'Completed', value: summary.completedGoals, note: `${summary.completionPercent}% completion`, icon: Activity, tone: 'text-emerald-700 bg-emerald-50' },
    { label: 'Overdue', value: summary.overdueGoals, note: 'Needs a fresh look', icon: Clock3, tone: 'text-amber-700 bg-amber-50' },
    { label: 'Team members', value: summary.memberCount, note: 'In this workspace', icon: Users, tone: 'text-slate-700 bg-slate-100' },
  ] : [];
  return <section className="fade-in">
    <PageHeading eyebrow="Team pulse" title="Good work moves in view." description={new Intl.DateTimeFormat(undefined, { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date())} action={<Link href={`/w/${workspaceId}/goals/daily`} className="button button-primary" data-testid="link-start-goal"><Plus size={15} /> Plan a goal</Link>} />
    {summaryError && <ErrorState onRetry={onRetry} />}
    {summaryLoading && <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{[0, 1, 2, 3].map((item) => <div className="panel p-5" key={item}><div className="skeleton mb-4 h-9 w-9 rounded-xl" /><div className="skeleton mb-2 h-3 w-24" /><div className="skeleton h-7 w-16" /></div>)}</div>}
    {summary && <><div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">{metrics.map(({ label, value, note, icon: Icon, tone }) => <div className="panel p-4.5 transition hover:-translate-y-0.5 hover:shadow-md" key={label} data-testid={`metric-${label.toLowerCase().replace(' ', '-')}`}><div className="flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{label}</span><span className={`grid h-8 w-8 place-items-center rounded-lg ${tone}`}><Icon size={15} /></span></div><div className="mt-4 flex items-baseline gap-2"><span className="font-display text-[27px] font-bold tracking-[-.04em] tabular-nums">{value}</span><span className="text-[10px] text-muted-foreground">{note}</span></div></div>)}</div><div className="mt-5 grid gap-5 xl:grid-cols-[1.35fr_.9fr]"><div className="panel"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-display text-sm font-bold">Coming up</h2><p className="mt-1 text-[11px] text-muted-foreground">Work with a deadline on the horizon</p></div><Link href={`/w/${workspaceId}/goals/weekly`} className="text-[11px] font-semibold text-primary hover:underline" data-testid="link-all-upcoming">All goals <ArrowRight size={12} className="ml-1 inline" /></Link></div>{summary.upcoming.length === 0 ? <div className="px-5 py-10 text-center"><p className="text-sm font-semibold">Nothing is due soon</p><p className="mt-1 text-xs text-muted-foreground">Upcoming deadlines will surface here.</p></div> : summary.upcoming.slice(0, 6).map((goal: any) => <div key={goal.id} className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0" data-testid={`upcoming-goal-${goal.id}`}><span className="grid h-8 w-8 shrink-0 place-items-center rounded-lg bg-accent text-primary"><CalendarDays size={15} /></span><span className="min-w-0 flex-1"><Link href={`/w/${workspaceId}/goals/${goal.id}/history`} className="block truncate text-xs font-semibold hover:text-primary">{goal.title}</Link><span className="mt-1 block text-[10px] text-muted-foreground">{goal.assignees.map((person: any) => person.name).join(', ') || 'Unassigned'}</span></span><span className="text-right"><span className="block text-[10px] font-semibold">{dateLabel(goal.deadline)}</span><span className="mt-1 block"><StatusPill status={goal.status} /></span></span></div>)}</div><div className="panel"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-display text-sm font-bold">Recent activity</h2><p className="mt-1 text-[11px] text-muted-foreground">The latest changes across your space</p></div><Link href={`/w/${workspaceId}/activity`} className="text-[11px] font-semibold text-primary hover:underline" data-testid="link-full-activity">View all <ArrowRight size={12} className="ml-1 inline" /></Link></div><div className="px-5 py-1">{activityLoading && <LoadingRows count={2} />}{!activityLoading && activity.length === 0 && <p className="py-9 text-center text-xs text-muted-foreground">Activity will appear as the team makes progress.</p>}{activity.slice(0, 5).map((entry) => <ActivityRow key={entry.id} entry={entry} compact />)}</div></div></div></>}
  </section>;
}

function ActivityRow({ entry, compact = false }: { entry: any; compact?: boolean }) {
  return <div className={`flex gap-3 border-b border-border/70 py-3.5 last:border-0 ${compact ? '' : 'py-4'}`} data-testid={`activity-entry-${entry.id}`}><Avatar name={entry.actorName} /><div className="min-w-0 flex-1"><p className="text-[12px] leading-5"><span className="font-semibold">{entry.actorName}</span>{' '}<span className="text-muted-foreground">{actionText(entry.action)}</span>{entry.goalTitle && <span className="font-semibold text-foreground"> {entry.goalTitle}</span>}</p>{entry.changes?.length > 0 && !compact && <p className="mt-1 text-[10px] text-muted-foreground">{entry.changes.map((change: any) => `${change.field}: ${change.previousValue ?? '—'} → ${change.newValue ?? '—'}`).join(' · ')}</p>}<p className="mt-1 text-[10px] text-muted-foreground">{timeLabel(entry.createdAt)}</p></div></div>;
}

function ActivityPage({ items, loading, error, onRetry, action, onActionChange }: { items: any[]; loading: boolean; error: boolean; onRetry: () => void; action: string; onActionChange: (value: string) => void }) {
  const filtered = items.filter((item) => !action || item.action === action);
  const actions = [...new Set(items.map((item) => item.action))];
  return <section className="fade-in"><PageHeading eyebrow="Workspace record" title="Activity" description="A transparent timeline of changes and decisions." action={<span className="grid h-10 w-10 place-items-center rounded-xl bg-accent text-primary"><Activity size={18} /></span>} /><div className="panel overflow-hidden"><div className="flex flex-wrap items-center justify-between gap-3 border-b px-5 py-3.5"><span className="text-xs font-semibold">Workspace timeline</span><label className="relative"><Filter size={13} className="pointer-events-none absolute left-3 top-2.5 text-muted-foreground" /><select className="field !w-auto !py-1.5 !pl-8 pr-8 text-[11px]" value={action} onChange={(event) => onActionChange(event.target.value)} data-testid="select-activity-action"><option value="">All activity</option>{actions.map((value) => <option key={value} value={value}>{actionText(value)}</option>)}</select></label></div><div className="px-5">{loading && <LoadingRows count={5} />}{error && <ErrorState onRetry={onRetry} />}{!loading && !error && filtered.length === 0 && <p className="py-16 text-center text-sm text-muted-foreground">No activity matches this filter.</p>}{filtered.map((entry) => <ActivityRow key={entry.id} entry={entry} />)}</div></div></section>;
}

function ChatPage({ messages, loading, error, onRetry, currentUserId, messageText, setMessageText, onSend, createPending, editingMessageId, setEditingMessageId, editingText, setEditingText, onEdit, onDelete }: { messages: any[]; loading: boolean; error: boolean; onRetry: () => void; currentUserId: string; messageText: string; setMessageText: (value: string) => void; onSend: (event: React.FormEvent<HTMLFormElement>) => void; createPending: boolean; editingMessageId: string | null; setEditingMessageId: (value: string | null) => void; editingText: string; setEditingText: (value: string) => void; onEdit: (id: string, text: string) => void; onDelete: (id: string) => void }) {
  const sorted = [...messages].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  return <section className="fade-in"><PageHeading eyebrow="Together, in the moment" title="Team chat" description="Short updates keep the work moving between check-ins." action={<span className="flex items-center gap-2 rounded-full bg-emerald-50 px-3 py-1.5 text-[10px] font-bold text-emerald-700"><span className="h-1.5 w-1.5 rounded-full bg-emerald-500" /> Live conversation</span>} /><div className="panel mx-auto flex min-h-[min(660px,calc(100dvh-210px))] max-w-[900px] flex-col overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-3"><div className="flex items-center gap-2"><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-primary"><MessageSquare size={15} /></span><div><p className="text-xs font-semibold">Workspace conversation</p><p className="text-[10px] text-muted-foreground">Messages are saved with the team record</p></div></div><span className="text-[10px] text-muted-foreground">{messages.length} messages</span></div><div className="flex-1 space-y-1 overflow-y-auto px-4 py-4 md:px-6">{loading && <LoadingRows count={3} />}{error && <ErrorState onRetry={onRetry} />}{!loading && !error && sorted.length === 0 && <div className="flex h-full min-h-64 flex-col items-center justify-center text-center"><span className="mb-3 grid h-11 w-11 place-items-center rounded-xl bg-accent text-primary"><MessageSquare size={19} /></span><p className="text-sm font-semibold">Start the conversation</p><p className="mt-1 max-w-xs text-xs leading-5 text-muted-foreground">Share a quick update, ask a question, or unblock someone.</p></div>}{sorted.map((message, index) => { const mine = message.senderId === currentUserId; const previous = sorted[index - 1]; const grouped = previous?.senderId === message.senderId && new Date(message.createdAt).getTime() - new Date(previous.createdAt).getTime() < 5 * 60 * 1000; return <div key={message.id} className={`group flex gap-2.5 ${grouped ? 'pt-1' : 'pt-4'}`} data-testid={`message-${message.id}`}>{!grouped ? <Avatar name={message.senderName} /> : <span className="w-7 shrink-0" />}<div className="min-w-0 max-w-[min(82%,620px)]"><div className="mb-1 flex items-baseline gap-2">{!grouped && <span className="text-[11px] font-bold">{message.senderName}</span>}<span className="text-[9px] text-muted-foreground">{timeLabel(message.createdAt)}{message.editedAt ? ' · edited' : ''}</span></div>{message.deleted ? <p className="rounded-lg bg-muted px-3 py-2 text-xs italic text-muted-foreground">This message was deleted.</p> : editingMessageId === message.id ? <div className="flex gap-2"><input className="field !py-2" value={editingText} onChange={(event) => setEditingText(event.target.value)} data-testid={`input-edit-message-${message.id}`} /><button className="button button-primary !px-2.5" onClick={() => onEdit(message.id, editingText)} data-testid={`button-save-message-${message.id}`}><Check size={14} /></button><button className="button button-quiet !px-2.5" onClick={() => setEditingMessageId(null)} data-testid={`button-cancel-message-${message.id}`}><X size={14} /></button></div> : <div className={`relative rounded-xl px-3.5 py-2.5 text-[12px] leading-5 ${mine ? 'bg-[#eaf0fa] text-[#203958]' : 'bg-[#f3f5f8]'}`}><p className="whitespace-pre-wrap break-words">{message.text}</p>{mine && <div className="absolute -right-[76px] top-1 hidden gap-1 group-hover:flex"><button className="rounded p-1 text-muted-foreground hover:bg-white" onClick={() => { setEditingMessageId(message.id); setEditingText(message.text); }} aria-label="Edit message" data-testid={`button-edit-message-${message.id}`}><Pencil size={12} /></button><button className="rounded p-1 text-muted-foreground hover:bg-white hover:text-destructive" onClick={() => onDelete(message.id)} aria-label="Delete message" data-testid={`button-delete-message-${message.id}`}><Trash2 size={12} /></button></div>}</div>}</div></div>; })}</div><form className="border-t bg-[#fafbfc] p-3.5 md:p-4" onSubmit={onSend}><div className="flex items-end gap-2 rounded-xl border bg-card p-2 shadow-sm focus-within:border-primary/40 focus-within:ring-2 focus-within:ring-primary/10"><textarea className="max-h-32 min-h-[38px] flex-1 resize-y border-0 bg-transparent px-2 py-2 text-xs outline-none placeholder:text-muted-foreground" value={messageText} onChange={(event) => setMessageText(event.target.value)} maxLength={4000} placeholder="Write a message to your team…" data-testid="input-chat-message" /><button className="button button-primary !px-3 !py-2" disabled={!messageText.trim() || createPending} aria-label="Send message" data-testid="button-send-message">{createPending ? 'Sending…' : <Send size={14} />}</button></div></form></div></section>;
}

function MembersPage({ members, loading, error, onRetry, path, requests, requestsLoading, requestError, onDecision, onRole, onPermission, onRemove, invitation, onInvite, onRevoke, onCopy }: { members: any[]; loading: boolean; error: boolean; onRetry: () => void; path: string; requests: any[]; requestsLoading: boolean; requestError: boolean; onDecision: (requestId: string, decision: 'approve' | 'reject') => void; onRole: (userId: string, role: 'admin' | 'member') => void; onPermission: (member: any, key: string, value: boolean) => void; onRemove: (member: any) => void; invitation: { id: string; code: string } | null; onInvite: () => void; onRevoke: () => void; onCopy: () => void }) {
  const permissionsMode = path === 'permissions';
  return <section className="fade-in"><PageHeading eyebrow="Your people" title={permissionsMode ? 'Permissions' : 'Members'} description={permissionsMode ? 'Set the boundaries that keep ownership clear and work moving.' : `${members.length} people share this workspace.`} action={!permissionsMode && <button className="button button-primary" onClick={onInvite} data-testid="button-create-invitation"><Plus size={15} /> Invite people</button>} />
    {permissionsMode ? <div className="space-y-3">{loading && <LoadingRows />}{error && <ErrorState onRetry={onRetry} />}{!loading && members.map((member) => <div className="panel overflow-hidden" key={member.id} data-testid={`permissions-member-${member.id}`}><div className="flex flex-wrap items-center gap-3 border-b px-4 py-4"><Avatar name={member.name} size="md" /><div className="min-w-0 flex-1"><p className="text-sm font-semibold">{member.name}</p><p className="text-[11px] text-muted-foreground">{member.email}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold capitalize">{member.role}</span>{member.role !== 'owner' && <select className="field !w-auto !py-1.5 text-[11px]" value={member.role} onChange={(event) => onRole(member.id, event.target.value as 'admin' | 'member')} aria-label={`Change role for ${member.name}`} data-testid={`select-role-${member.id}`}><option value="member">Member</option><option value="admin">Admin</option></select>}</div><div className="grid gap-x-7 gap-y-1 px-4 py-4 sm:grid-cols-2 lg:grid-cols-3">{Object.entries(permissionLabels).map(([key, label]) => <label className={`flex items-center justify-between gap-3 rounded-md px-2 py-2 text-[11px] ${member.role === 'owner' ? 'opacity-50' : 'hover:bg-muted/60'}`} key={key}><span>{label}</span><input type="checkbox" className="h-3.5 w-3.5 accent-[#315895]" checked={Boolean(member.permissions[key])} disabled={member.role === 'owner'} onChange={(event) => onPermission(member, key, event.target.checked)} data-testid={`toggle-permission-${member.id}-${key}`} /></label>)}</div></div>)}{!loading && !error && members.length === 0 && <EmptyState title="No members yet" detail="Invite your team to share goals and updates." />}</div> : <div className="grid gap-5 xl:grid-cols-[1.25fr_.75fr]"><div className="panel overflow-hidden"><div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="font-display text-sm font-bold">Workspace members</h2><p className="mt-1 text-[11px] text-muted-foreground">People with access to this space</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-bold tabular-nums">{members.length}</span></div>{loading && <div className="p-4"><LoadingRows count={3} /></div>}{error && <div className="p-4"><ErrorState onRetry={onRetry} /></div>}{!loading && !error && members.length === 0 && <p className="px-5 py-10 text-center text-xs text-muted-foreground">Invite your first teammate to work together.</p>}{members.map((member) => <div key={member.id} className="flex items-center gap-3 border-b px-5 py-3.5 last:border-0" data-testid={`member-${member.id}`}><Avatar name={member.name} size="md" /><div className="min-w-0 flex-1"><p className="truncate text-xs font-semibold">{member.name}</p><p className="mt-1 truncate text-[10px] text-muted-foreground">{member.email}</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-[10px] font-semibold capitalize">{member.role}</span>{member.role !== 'owner' && <button className="rounded-md p-2 text-muted-foreground hover:bg-rose-50 hover:text-destructive" onClick={() => onRemove(member)} aria-label={`Remove ${member.name}`} data-testid={`button-remove-member-${member.id}`}><X size={14} /></button>}</div>)}</div><div className="space-y-5"><div className="panel p-5"><div className="flex items-start justify-between"><div><h2 className="font-display text-sm font-bold">Invitation link</h2><p className="mt-1 max-w-xs text-[11px] leading-4 text-muted-foreground">Invite teammates with a time-limited link.</p></div><span className="grid h-8 w-8 place-items-center rounded-lg bg-accent text-primary"><Link2 size={15} /></span></div>{invitation ? <><div className="mt-4 rounded-lg border bg-muted/40 p-3"><p className="text-[9px] font-bold uppercase tracking-wider text-muted-foreground">Invite code</p><p className="mt-1 break-all font-mono text-sm font-semibold" data-testid="text-invitation-code">{invitation.code}</p></div><div className="mt-3 flex gap-2"><button className="button button-primary flex-1" onClick={onCopy} data-testid="button-copy-invitation">Copy invite link</button><button className="button button-quiet" onClick={onRevoke} data-testid="button-revoke-invitation">Revoke</button></div></> : <button className="button button-quiet mt-4 w-full" onClick={onInvite} data-testid="button-generate-invitation"><Plus size={14} /> Generate invitation</button>}</div><div className="panel overflow-hidden"><div className="border-b px-5 py-4"><h2 className="font-display text-sm font-bold">Join requests</h2><p className="mt-1 text-[11px] text-muted-foreground">Review people asking to join</p></div>{requestsLoading && <div className="p-4"><LoadingRows count={2} /></div>}{requestError && <p className="px-5 py-4 text-xs text-destructive">Join requests could not be loaded.</p>}{!requestsLoading && !requestError && requests.length === 0 && <p className="px-5 py-8 text-center text-xs text-muted-foreground">No pending requests.</p>}{requests.map((request) => <div className="border-b px-5 py-3.5 last:border-0" key={request.id} data-testid={`join-request-${request.id}`}><p className="text-xs font-semibold">{request.name}</p><p className="mt-1 text-[10px] text-muted-foreground">{request.email} · {dateLabel(request.createdAt)}</p><div className="mt-3 flex gap-2"><button className="button button-primary !px-3 !py-1.5 !text-[10px]" onClick={() => onDecision(request.id, 'approve')} data-testid={`button-approve-request-${request.id}`}><Check size={12} /> Approve</button><button className="button button-quiet !px-3 !py-1.5 !text-[10px]" onClick={() => onDecision(request.id, 'reject')} data-testid={`button-reject-request-${request.id}`}>Decline</button></div></div>)}</div></div></div>}</section>;
}
