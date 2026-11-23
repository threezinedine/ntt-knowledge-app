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
import { Toast } from './components/toast';
import { GraphPage } from './features/graph/GraphPage';
import { NodePage } from './features/node/NodePage';
import { TagsPage } from './features/tags/TagsPage';
import { useI18n } from './i18n/context';
import { LanguagePicker } from './i18n/LanguagePicker';

const SIDEBAR_KEY = 'km.sidebarVisible';

export function App() {
  const { t } = useI18n();
  const graphTip = useCommandTooltip('km.go.graph');
  const tagsTip = useCommandTooltip('km.go.tags');
  const paletteTip = useCommandTooltip('workbench.action.showCommands', { always: true });
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
        <span className="brand">◆ Knowledge Manager</span>
        <nav className="app-nav">
          <NavLink to="/" end {...graphTip}>
            {t('app.nav.graph')}
          </NavLink>
          <NavLink to="/tags" {...tagsTip}>
            {t('app.nav.tags')}
          </NavLink>
        </nav>
        <button
          type="button"
          className="subtle small palette-button"
          aria-label={t('cmd.showCommands')}
          {...paletteTip}
          onClick={() => {
            openQuickInput('>');
          }}
        >
          &gt;_
        </button>
        <LanguagePicker />
      </header>
      {/* Hidden, not unmounted: its commands (e.g. New Node) keep working. */}
      <Sidebar hidden={!sidebarVisible} />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<GraphPage />} />
          <Route path="/nodes/:id" element={<NodePage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/shortcuts" element={<ShortcutsPage />} />
          <Route path="/categories" element={<Navigate to="/tags" replace />} />
          <Route path="*" element={<p className="empty">{t('app.notFound')}</p>} />
        </Routes>
      </main>
      <QuickInput />
      <TooltipLayer />
      <Toast />
    </div>
  );
}
