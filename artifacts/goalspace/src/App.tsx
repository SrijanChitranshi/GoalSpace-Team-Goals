import { type ReactNode } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import NotFound from '@/pages/not-found';
import EntryPage from '@/pages/EntryPage';
import AuthPage from '@/pages/AuthPage';
import WorkspacePage from '@/pages/WorkspacePage';
import { Route, Switch, useLocation, Router as WouterRouter } from 'wouter';

const queryClient = new QueryClient({
  defaultOptions: {
    queries: {
      staleTime: 20_000,
      retry: 1,
      refetchOnWindowFocus: true,
    },
  },
});

function Router() {
  return (
    <RoutedErrorBoundary>
      <Switch>
        <Route path="/" component={EntryPage} />
        <Route path="/login" component={AuthPage} />
        <Route path="/register" component={AuthPage} />
        <Route path="/join" component={AuthPage} />
        <Route path="/w/:workspaceId/overview" component={WorkspacePage} />
        <Route path="/w/:workspaceId/goals/daily" component={WorkspacePage} />
        <Route path="/w/:workspaceId/goals/weekly" component={WorkspacePage} />
        <Route path="/w/:workspaceId/goals/monthly" component={WorkspacePage} />
        <Route path="/w/:workspaceId/goals/:goalId/history" component={WorkspacePage} />
        <Route path="/w/:workspaceId/chat" component={WorkspacePage} />
        <Route path="/w/:workspaceId/members" component={WorkspacePage} />
        <Route path="/w/:workspaceId/permissions" component={WorkspacePage} />
        <Route path="/w/:workspaceId/activity" component={WorkspacePage} />
        <Route path="/w/:workspaceId/settings" component={WorkspacePage} />
        <Route component={NotFound} />
      </Switch>
    </RoutedErrorBoundary>
  );
}

function RoutedErrorBoundary({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  return <ErrorBoundary resetKey={location}>{children}</ErrorBoundary>;
}

function App() {
  return (
    <QueryClientProvider client={queryClient}>
      <TooltipProvider>
        <WouterRouter base={import.meta.env.BASE_URL.replace(/\/$/, '')}>
          <Router />
        </WouterRouter>
        <Toaster />
      </TooltipProvider>
    </QueryClientProvider>
  );
}

export default App;
