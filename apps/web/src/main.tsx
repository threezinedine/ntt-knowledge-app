// First: applies a staged settings import before any store reads localStorage.
import './settings/bootImport';
import { MutationCache, QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import type { SyncStatus } from '@km/core';
import { keys } from './api/queries';
import { noteEdit } from './features/sync/syncStore';
import { App } from './App';
import { LocalGate } from './features/local/LocalGate';
import { I18nProvider } from './i18n/I18nProvider';
import '@xyflow/react/dist/style.css';
import './styles.css';

let syncRefresh: ReturnType<typeof setTimeout> | undefined;
const queryClient: QueryClient = new QueryClient({
  mutationCache: new MutationCache({
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
    // Answers come from this device (the engine Worker): no network to retry.
    queries: { staleTime: 5_000, retry: false, refetchOnWindowFocus: true },
  },
});

const root = document.getElementById('root');
if (!root) throw new Error('#root element missing');

createRoot(root).render(
  <StrictMode>
    <I18nProvider>
      <QueryClientProvider client={queryClient}>
        <LocalGate>
          <BrowserRouter>
            <App />
          </BrowserRouter>
        </LocalGate>
      </QueryClientProvider>
    </I18nProvider>
  </StrictMode>,
);
