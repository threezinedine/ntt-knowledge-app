import { useState } from 'react';
import { Navigate, NavLink, Route, Routes } from 'react-router';
import { AppCommands } from './commands/AppCommands';
import { openQuickInput } from './commands/quickInputStore';
import { QuickInput } from './commands/QuickInput';
import { ShortcutsPage } from './commands/ShortcutsPage';
import { TooltipLayer } from './commands/TooltipLayer';
import { useCommandTooltip } from './commands/useCommandTooltip';
import { readJson, writeJson } from './commands/storage';
import { Sidebar, SIDEBAR_SEARCH_ID } from './components/Sidebar';
import {
  GraphIcon,
  KeyboardIcon,
  SearchIcon,
  SettingsIcon,
  SidebarIcon,
  ReviewIcon,
  TagIcon,
} from './components/icons';
import { Toast } from './components/toast';
import { LocalFileCommands } from './features/local/LocalFileCommands';
import { LevelUpCelebration } from './features/exp/LevelUpCelebration';
import { GraphPage } from './features/graph/GraphPage';
import { GraphSettingsPage } from './features/graph/GraphSettingsPanel';
import { NodePage } from './features/node/NodePage';
import { TagsPage } from './features/tags/TagsPage';
import { ReviewPage, useReviewCount } from './features/review/ReviewPage';
import { useReadOnly } from './features/readOnly';
import { useI18n } from './i18n/context';
import { SettingsCommands } from './settings/SettingsTransfer';
import { SyncHost, SyncIndicator, useCanSync } from './features/sync/SyncHost';
import { LanguagePicker } from './i18n/LanguagePicker';
import { useSyncPendingWikilinks } from './api/queries';

const SIDEBAR_KEY = 'km.sidebarVisible';

export function App() {
  const { t } = useI18n();
  const readOnly = useReadOnly();
  useSyncPendingWikilinks(!readOnly);
  const canSync = useCanSync();
  const graphTip = useCommandTooltip('km.go.graph', { always: true });
  const tagsTip = useCommandTooltip('km.go.tags', { always: true });
  const reviewTip = useCommandTooltip('km.go.review', { always: true });
  const reviewCount = useReviewCount();
  const paletteTip = useCommandTooltip('workbench.action.showCommands', { always: true });
  // Icon-only: they need the tooltip even when unbound.
  const sidebarTip = useCommandTooltip('workbench.action.toggleSidebarVisibility', {
    always: true,
  });
  const keysTip = useCommandTooltip('workbench.action.openGlobalKeybindings', { always: true });
  const [sidebarVisible, setSidebarVisibleState] = useState(() => readJson(SIDEBAR_KEY) !== false);
  const setSidebarVisible = (visible: boolean) => {
    setSidebarVisibleState(visible);
    writeJson(SIDEBAR_KEY, visible);
  };

  return (
    <div className={`app${sidebarVisible ? '' : ' sidebar-hidden'}`}>
      <AppCommands
        onToggleSidebar={() => {
          setSidebarVisible(!sidebarVisible);
        }}
        onFocusSearch={() => {
          setSidebarVisible(true);
          // After the sidebar is shown again (next frame).
          requestAnimationFrame(() => {
            document.getElementById(SIDEBAR_SEARCH_ID)?.focus();
          });
        }}
      />
      <header className="app-header">
        <span className="brand" aria-hidden="true">
          ◆
        </span>
        {/* VS Code's command center: the title bar's search box opens the palette. */}
        <button
          type="button"
          className="command-center"
          {...paletteTip}
          onClick={() => {
            openQuickInput('>');
          }}
        >
          <SearchIcon size={14} />
          <span className="command-center-text">{t('cmd.showCommands')}</span>
        </button>
        <div className="header-end">
          {canSync && <SyncIndicator />}
          <LanguagePicker />
        </div>
      </header>
      <nav className="activity-bar" aria-label={t('app.nav.label')}>
        <NavLink to="/" end aria-label={t('app.nav.graph')} {...graphTip}>
          <GraphIcon size={22} />
        </NavLink>
        {/* The tags page is for editing the tree; read-only mode has none. */}
        {!readOnly && (
          <NavLink to="/tags" aria-label={t('app.nav.tags')} {...tagsTip}>
            <TagIcon size={22} />
          </NavLink>
        )}
        {/* Answering a card writes, so the phone app has no review. */}
        {!readOnly && (
          <NavLink to="/review" aria-label={t('app.nav.review')} {...reviewTip}>
            <ReviewIcon size={22} />
            {reviewCount > 0 && (
              <span className="activity-badge" aria-hidden="true">
                {reviewCount}
              </span>
            )}
          </NavLink>
        )}
        {/* The phone app tunes the graph's look on its own tab, not over the graph. */}
        {readOnly && (
          <NavLink to="/graph-settings" aria-label={t('graphSettings.title')}>
            <SettingsIcon size={22} />
          </NavLink>
        )}
        <span className="activity-bar-spacer" />
        <button
          type="button"
          className={`activity-button${sidebarVisible ? ' active' : ''}`}
          aria-label={t('cmd.toggleSidebar')}
          aria-pressed={sidebarVisible}
          {...sidebarTip}
          onClick={() => {
            setSidebarVisible(!sidebarVisible);
          }}
        >
          <SidebarIcon size={22} />
        </button>
        <NavLink to="/shortcuts" aria-label={t('cmd.openKeybindings')} {...keysTip}>
          <KeyboardIcon size={22} />
        </NavLink>
      </nav>
      {/* Hidden, not unmounted: its commands (e.g. New Node) keep working. */}
      <Sidebar hidden={!sidebarVisible} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<GraphPage />} />
          <Route path="/nodes/:id" element={<NodePage />} />
          <Route path="/tags" element={readOnly ? <Navigate to="/" replace /> : <TagsPage />} />
          <Route path="/review" element={readOnly ? <Navigate to="/" replace /> : <ReviewPage />} />
          <Route path="/shortcuts" element={<ShortcutsPage />} />
          <Route
            path="/graph-settings"
            element={readOnly ? <GraphSettingsPage /> : <Navigate to="/" replace />}
          />
          <Route path="/categories" element={<Navigate to="/tags" replace />} />
          <Route path="*" element={<p className="empty">{t('app.notFound')}</p>} />
        </Routes>
      </main>
      <QuickInput />
      <TooltipLayer />
      <Toast />
      <LocalFileCommands />
      <SettingsCommands />
      <SyncHost />
      <LevelUpCelebration />
    </div>
  );
}
