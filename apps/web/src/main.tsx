// First: applies a staged settings import before any store reads localStorage.
import './settings/bootImport';
import { MutationCache, QueryCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { ApiError } from './api/client';
import type { SyncStatus } from '@km/core';
import { keys } from './api/queries';
import { noteEdit } from './features/sync/syncStore';
import { App } from './App';
import { AuthGate } from './features/auth/AuthGate';
import { I18nProvider } from './i18n/I18nProvider';
import '@xyflow/react/dist/style.css';
import './styles.css';

// A 401 means the session is gone (time up, signed out elsewhere): re-ask the
// server, and AuthGate asks for a code. Not for a wrong code at sign-in, and
// not while a status check is already running (many queries fail at once).
const onError = (error: unknown) => {
  if (!(error instanceof ApiError) || error.status !== 401) return;
  const reason = error.body?.error.reason;
  if (reason === 'CODE_INVALID' || reason === 'CODE_USED') return;
  if (queryClient.isFetching({ queryKey: keys.auth }) > 0) return;
  void queryClient.invalidateQueries({ queryKey: keys.auth });
};
let syncRefresh: ReturnType<typeof setTimeout> | undefined;
const queryClient: QueryClient = new QueryClient({
  queryCache: new QueryCache({ onError }),
  mutationCache: new MutationCache({
    onError,
    // Editing while the hub has a newer version: warn once (features/sync).
    onMutate: (_variables, mutation) => {
      if (mutation.meta?.notAnEdit === true) return;
      noteEdit(queryClient.getQueryData<SyncStatus>(keys.sync));
    },
    // ...and the title bar shows "changes not pushed" soon after an edit.
    onSuccess: (_data, _variables, _context, mutation) => {
      if (mutation.meta?.notAnEdit === true) return;
      clearTimeout(syncRefresh);
      syncRefresh = setTimeout(() => {
        void queryClient.invalidateQueries({ queryKey: keys.sync });
      }, 2_000);
    },
  }),
  defaultOptions: {
    queries: { staleTime: 5_000, retry: 1, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <AuthGate>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </AuthGate>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
