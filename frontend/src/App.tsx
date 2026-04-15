import { Routes, Route, NavLink, Navigate } from 'react-router-dom'
import OverviewPage from './pages/Overview'
import TeamsPage from './pages/Teams'
import TeamProfilePage from './pages/TeamProfile'
import SuggestionsPage from './pages/Suggestions'
import SuggestionDetailPage from './pages/SuggestionDetail'
import ReportsPage from './pages/Reports'
import ReportDetailPage from './pages/ReportDetail'

const NAV = [
  { to: '/overview', label: 'Overview' },
  { to: '/teams', label: 'Teams' },
  { to: '/suggestions', label: 'Suggestions' },
  { to: '/reports', label: 'Reports' },
]

export default function App() {
  return (
    <div className="app">
      <aside className="sidebar">
        <div className="sidebar-brand">
          <h1>AllyClaw</h1>
          <p>Intelligence</p>
        </div>
        <nav className="sidebar-nav">
          {NAV.map(n => (
            <NavLink key={n.to} to={n.to} className={({ isActive }) => `nav-link ${isActive ? 'active' : ''}`}>
              {n.label}
            </NavLink>
          ))}
        </nav>
        <div className="sidebar-footer">v0.1 · Phase 2 W12</div>
      </aside>

      <main className="main">
        <Routes>
          <Route path="/" element={<Navigate to="/overview" replace />} />
          <Route path="/overview" element={<OverviewPage />} />
          <Route path="/teams" element={<TeamsPage />} />
          <Route path="/teams/:id" element={<TeamProfilePage />} />
          <Route path="/suggestions" element={<SuggestionsPage />} />
          <Route path="/suggestions/:id" element={<SuggestionDetailPage />} />
          <Route path="/reports" element={<ReportsPage />} />
          <Route path="/reports/:id" element={<ReportDetailPage />} />
        </Routes>
      </main>
    </div>
  )
}
