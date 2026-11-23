import { Navigate, NavLink, Route, Routes } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { GraphPage } from './features/graph/GraphPage';
import { NodePage } from './features/node/NodePage';
import { TagsPage } from './features/tags/TagsPage';
import { useI18n } from './i18n/context';
import { LanguagePicker } from './i18n/LanguagePicker';

export function App() {
  const { t } = useI18n();
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">◆ Knowledge Manager</span>
        <nav className="app-nav">
          <NavLink to="/" end>
            {t('app.nav.graph')}
          </NavLink>
          <NavLink to="/tags">{t('app.nav.tags')}</NavLink>
        </nav>
        <LanguagePicker />
      </header>
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<GraphPage />} />
          <Route path="/nodes/:id" element={<NodePage />} />
          <Route path="/tags" element={<TagsPage />} />
          <Route path="/categories" element={<Navigate to="/tags" replace />} />
          <Route path="*" element={<p className="empty">{t('app.notFound')}</p>} />
        </Routes>
      </main>
    </div>
  );
}
