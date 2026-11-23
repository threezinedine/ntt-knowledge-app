import { NavLink, Route, Routes } from 'react-router';
import { Sidebar } from './components/Sidebar';
import { CategoriesPage } from './features/categories/CategoriesPage';
import { GraphPage } from './features/graph/GraphPage';
import { NodePage } from './features/node/NodePage';

export function App() {
  return (
    <div className="app">
      <header className="app-header">
        <span className="brand">◆ Knowledge Manager</span>
        <nav className="app-nav">
          <NavLink to="/" end>
            Graph
          </NavLink>
          <NavLink to="/categories">Categories</NavLink>
        </nav>
      </header>
      <Sidebar />
      <main className="app-main">
        <Routes>
          <Route path="/" element={<GraphPage />} />
          <Route path="/nodes/:id" element={<NodePage />} />
          <Route path="/categories" element={<CategoriesPage />} />
          <Route path="*" element={<p className="empty">Page not found.</p>} />
        </Routes>
      </main>
    </div>
  );
}
