import { useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useRoute } from 'wouter';
import { ArrowLeft, ArrowRight, Check, Goal, LockKeyhole, Mail, UserRound } from 'lucide-react';
import { useJoinWithInvitation, useLogin, useRegister, getGetCurrentUserQueryKey, getListWorkspacesQueryKey } from '@workspace/api-client-react';
import { Brand } from '@/components/goalspace';

export default function AuthPage() {
  const [, setLocation] = useLocation();
  const [, registerRoute] = useRoute('/register');
  const [, joinRoute] = useRoute('/join');
  const queryClient = useQueryClient();
  const login = useLogin();
  const register = useRegister();
  const join = useJoinWithInvitation();
  const [name, setName] = useState('');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [code, setCode] = useState(() => new URLSearchParams(window.location.search).get('code') ?? '');
  const isRegister = !!registerRoute;
  const isJoin = !!joinRoute;
  const pending = login.isPending || register.isPending || join.isPending;
  const error = login.error || register.error || join.error;
  const submitAuth = (event: React.FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (isJoin) {
      join.mutate({ data: { code: code.trim() } }, { onSuccess: async (result) => {
        await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
        setLocation(result.workspace ? `/w/${result.workspace.id}/overview` : '/');
      } });
      return;
    }
    if (isRegister) {
      register.mutate({ data: { name: name.trim(), email: email.trim(), password } }, { onSuccess: async () => {
        await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
        setLocation('/');
      } });
      return;
    }
    login.mutate({ data: { email: email.trim(), password } }, { onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: getGetCurrentUserQueryKey() });
      await queryClient.invalidateQueries({ queryKey: getListWorkspacesQueryKey() });
      setLocation('/');
    } });
  };
  const title = isJoin ? 'Join your team' : isRegister ? 'Make space for better work' : 'Good to have you back';
  const description = isJoin ? 'Enter the invitation code your teammate sent you.' : isRegister ? 'Create your account and bring your team’s goals into focus.' : 'Sign in to pick up where your team left off.';
  return (
    <main className="grid min-h-[100dvh] bg-[#f3f5f8] lg:grid-cols-[minmax(420px,1fr)_minmax(400px,540px)]">
      <aside className="relative hidden overflow-hidden bg-[#1c2d49] px-12 py-10 text-white lg:flex lg:flex-col">
        <div className="absolute -right-28 -top-24 h-[530px] w-[530px] rounded-full border border-white/[.06]" />
        <div className="absolute -right-8 top-[-100px] h-[370px] w-[370px] rounded-full border border-white/[.08]" />
        <div className="absolute bottom-[-180px] left-[-150px] h-[520px] w-[520px] rounded-full bg-[#304e78]/40 blur-[2px]" />
        <Link href="/" className="relative flex w-fit items-center gap-2.5"><Brand /><span className="sr-only">GoalSpace home</span></Link>
        <div className="relative my-auto max-w-xl py-20">
          <p className="mb-5 text-[11px] font-bold uppercase tracking-[.22em] text-[#a7bfdf]">Clear goals. Shared momentum.</p>
          <h1 className="font-display text-[48px] font-bold leading-[1.07] tracking-[-.055em]">A little more focus.<br />A lot more forward.</h1>
          <p className="mt-6 max-w-md text-[15px] leading-7 text-white/65">The work is easier to move when everyone can see what matters, who owns it, and what changed.</p>
          <div className="mt-12 flex items-center gap-4 border-t border-white/15 pt-6">
            <span className="grid h-9 w-9 place-items-center rounded-full bg-white/10"><Check size={16} className="text-[#b4cbea]" /></span>
            <p className="text-xs leading-5 text-white/65">A steady, trustworthy record of team progress.</p>
          </div>
        </div>
        <p className="relative text-[10px] text-white/35">GoalSpace · Team work, in view.</p>
      </aside>
      <section className="flex min-h-[100dvh] flex-col justify-center px-5 py-10 sm:px-12 lg:px-16">
        <div className="mx-auto w-full max-w-[390px]">
          <div className="mb-10 flex items-center gap-3 lg:hidden"><Brand /></div>
          <Link href="/" className="mb-8 inline-flex items-center gap-1.5 text-xs text-muted-foreground transition hover:text-foreground"><ArrowLeft size={14} /> Back to workspaces</Link>
          <p className="mb-2 text-[10px] font-bold uppercase tracking-[.17em] text-primary">{isJoin ? 'Invitation' : 'GoalSpace account'}</p>
          <h2 className="font-display text-[30px] font-bold tracking-[-.045em]">{title}</h2>
          <p className="mt-2 max-w-sm text-[13px] leading-5 text-muted-foreground">{description}</p>
          <form className="mt-8 space-y-4" onSubmit={submitAuth}>
            {isRegister && <label className="block"><span className="mb-1.5 block text-xs font-semibold">Your name</span><span className="relative block"><UserRound size={15} className="absolute left-3 top-3 text-muted-foreground" /><input className="field pl-9" required minLength={2} maxLength={100} autoComplete="name" value={name} onChange={(event) => setName(event.target.value)} placeholder="Taylor Morgan" data-testid="input-name" /></span></label>}
            {isJoin ? <label className="block"><span className="mb-1.5 block text-xs font-semibold">Invitation code</span><span className="relative block"><Goal size={15} className="absolute left-3 top-3 text-muted-foreground" /><input className="field pl-9 font-mono tracking-wide" required minLength={8} value={code} onChange={(event) => setCode(event.target.value)} placeholder="Paste your code" data-testid="input-invitation-code" /></span></label> : <label className="block"><span className="mb-1.5 block text-xs font-semibold">Email address</span><span className="relative block"><Mail size={15} className="absolute left-3 top-3 text-muted-foreground" /><input className="field pl-9" type="email" required autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@company.com" data-testid="input-email" /></span></label>}
            {!isJoin && <label className="block"><span className="mb-1.5 block text-xs font-semibold">Password</span><span className="relative block"><LockKeyhole size={15} className="absolute left-3 top-3 text-muted-foreground" /><input className="field pl-9" type="password" required minLength={8} maxLength={128} autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder="At least 8 characters" data-testid="input-password" /></span></label>}
            {error && <p role="alert" className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2.5 text-xs text-rose-700" data-testid="text-auth-error">{(error as Error).message || 'Something went wrong. Please try again.'}</p>}
            {(login.isSuccess || register.isSuccess) && <p className="text-xs text-emerald-700" role="status">You’re all set. Opening your workspace…</p>}
            <button className="button button-primary w-full !py-3" disabled={pending} data-testid="button-submit-auth">{pending ? 'Working…' : isJoin ? 'Join workspace' : isRegister ? 'Create account' : 'Sign in'}{!pending && <ArrowRight size={15} />}</button>
          </form>
          {!isJoin && <p className="mt-6 text-center text-xs text-muted-foreground">{isRegister ? 'Already part of GoalSpace?' : 'New to GoalSpace?'}{' '}<Link href={isRegister ? '/login' : '/register'} className="font-semibold text-primary hover:underline" data-testid="link-auth-toggle">{isRegister ? 'Sign in' : 'Create an account'}</Link></p>}
          {!isJoin && <Link href="/join" className="mt-3 block text-center text-xs text-muted-foreground hover:text-primary" data-testid="link-join-workspace">Have an invitation code? Join a workspace</Link>}
        </div>
      </section>
    </main>
  );
}
