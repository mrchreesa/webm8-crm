import { createContext, useContext, useEffect, useState } from 'react';
import { NavLink, Routes, Route, Link, useLocation, useSearchParams } from 'react-router-dom';
import {
  LayoutDashboard,
  UsersRound,
  Workflow,
  Radio,
  BookOpen,
  ArrowUpRight,
  LogOut,
} from 'lucide-react';
import { api, post, setCSRF } from './api';
import {
  Field,
  Form,
  Submit,
  Loading,
  Modal,
  NavigationGuard,
  useLoad,
  ErrorState,
  useGuard,
  useToast,
} from './ui';
import { Overview, Leads, ImportPage } from './lists';
import { LeadDetail } from './detail';
import { Integration, SyncLog, OwnerGuide } from './integration';
const WorkspaceContext = createContext<any>(null);
export const useWorkspace = () => useContext(WorkspaceContext);
export function App() {
  const [owner, setOwner] = useState<{ name: string; email: string } | null>(null),
    [loading, setLoading] = useState(true),
    [locked, setLocked] = useState(false),
    [connectionError, setConnectionError] = useState('');
  const check = () => {
    setLoading(true);
    setConnectionError('');
    api('/auth/session')
      .then((s) => {
        setCSRF(s.csrf_token);
        setOwner(s.owner);
      })
      .catch((e) => {
        if (e.status !== 401) setConnectionError(e.message);
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    check();
    const expired = () => setLocked(true);
    window.addEventListener('crm:expired', expired);
    return () => window.removeEventListener('crm:expired', expired);
  }, []);
  const signedIn = (s: any) => {
    setCSRF(s.csrf_token);
    setOwner(s.owner);
    setLocked(false);
  };
  if (loading) return <Loading />;
  if (connectionError) return <ErrorState error={connectionError} retry={check} />;
  if (!owner) return <Login onSignedIn={signedIn} />;
  return (
    <NavigationGuard>
      <Workspace
        owner={owner}
        onLogout={() => {
          setOwner(null);
          setCSRF('');
        }}
      />
      {locked && (
        <Modal title="Sign in to continue" locked onClose={() => {}}>
          <p className="muted">Your session expired. Your unsaved edits are still here.</p>
          <Login compact onSignedIn={signedIn} />
        </Modal>
      )}
    </NavigationGuard>
  );
}
function Login({
  onSignedIn,
  compact = false,
}: {
  onSignedIn: (s: any) => void;
  compact?: boolean;
}) {
  useEffect(() => {
    if (!compact) document.title = 'Sign in — WebM8 CRM';
  }, []);
  const content = (
    <>
      <div className="brand-mark">
        w<span>8</span>
      </div>
      {!compact && (
        <>
          <span className="eyebrow">WEBM8 · LEADS & OUTCOMES</span>
          <h1>
            A little clarity.
            <br />A better follow-up.
          </h1>
          <p className="muted">Your leads, appointments and sales, in one place.</p>
        </>
      )}
      <Form
        noValidate
        onSave={async (f) => {
          const email = String(f.get('email') || ''),
            password = String(f.get('password') || '');
          if (!email || !password) throw new Error('Enter your owner email and password.');
          onSignedIn(await post('/auth/login', { email, password }));
        }}
      >
        <Field
          label="Owner email"
          name="email"
          type="email"
          autoComplete="username"
          required
          autoFocus
        />
        <Field
          label="Password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
        />
        <Submit>
          Sign in <ArrowUpRight size={17} />
        </Submit>
      </Form>
      {!compact && (
        <p className="login-help">
          First time here? Run <code>npm run setup</code> on the server to create owner access.
        </p>
      )}
    </>
  );
  return compact ? (
    <div className="login-compact">{content}</div>
  ) : (
    <main className="login-page">
      <div className="login-card">{content}</div>
      <p className="login-footer">A simple loop. Lead → conversation → outcome.</p>
    </main>
  );
}
function Workspace({
  owner,
  onLogout,
}: {
  owner: { name: string; email: string };
  onLogout: () => void;
}) {
  const integration = useLoad('/integration'),
    [params, setParams] = useSearchParams(),
    location = useLocation(),
    guard = useGuard(),
    toast = useToast();
  const signOut = () =>
    guard.go(() => {
      post('/auth/logout', {})
        .then(onLogout)
        .catch((e) => toast(e.message));
    });
  const demo = params.get('data') === 'demo',
    scope = demo ? 'demo' : 'business';
  useEffect(() => {
    if (integration.data && !params.has('data') && location.pathname === '/') {
      const p = new URLSearchParams(params);
      p.set(
        'data',
        integration.data.settings.mode === 'demo' && integration.data.has_demo_data
          ? 'demo'
          : 'business',
      );
      setParams(p, { replace: true });
    }
  }, [integration.data]);
  const links = [
    { to: '/', label: 'Overview', icon: LayoutDashboard },
    { to: '/leads', label: 'Leads', icon: UsersRound },
    { to: '/integration', label: 'Meta integration', icon: Workflow },
    { to: '/sync', label: 'Sync log', icon: Radio },
  ];
  const title = location.pathname.startsWith('/leads/')
    ? 'Lead detail'
    : location.pathname === '/import'
      ? 'Import leads'
      : links.find((l) => l.to === location.pathname)?.label || 'Owner guide';
  useEffect(() => {
    document.title = `${title} — WebM8 CRM`;
  }, [title]);
  const link = (path: string) => {
    const p = new URLSearchParams({ data: scope });
    if (path.startsWith('/leads/') && location.pathname === '/leads')
      p.set('return', location.pathname + location.search);
    return `${path}?${p}`;
  };
  return (
    <WorkspaceContext.Provider value={{ demo, scope, integration, link, owner }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link className="brand" to={link('/')} aria-label="WebM8 CRM overview">
            <span className="brand-mark">
              w<span>8</span>
            </span>
            <span>
              webm8<span className="brand-sub">LEADS & OUTCOMES</span>
            </span>
          </Link>
          <div className="workspace-name">
            <span className="workspace-icon">W</span>
            <div>
              Your workspace<small>Owner access</small>
            </div>
          </div>
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="Main navigation">
            {links.map((l) => (
              <NavLink key={l.to} to={link(l.to)} end={l.to === '/'}>
                <l.icon size={19} />
                {l.label}
              </NavLink>
            ))}
          </nav>
          <div className="sidebar-bottom">
            <div className="sidebar-tip">
              <span className="tip-symbol">↗</span>
              <p>
                Good leads.
                <br />
                Better feedback.
              </p>
              <small>Record the outcome. Keep the loop moving.</small>
            </div>
            <Link to={link('/guide')}>
              <BookOpen size={17} />
              Owner setup guide
            </Link>
            <button onClick={signOut}>
              <LogOut size={17} />
              Sign out
            </button>
            <div className="owner">
              <span>{owner.name.charAt(0)}</span>
              <div>
                {owner.name}
                <small>Workspace owner</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className="topbar">
            <div className="breadcrumb">
              Workspace <span>/</span> <strong>{title}</strong>
            </div>
            <div className="topbar-right">
              <span className={`connection ${integration.data?.connected ? 'connected' : ''}`}>
                <span className="dot" />
                {integration.data?.connected
                  ? `Meta · ${integration.data.settings.mode} mode`
                  : 'Meta disconnected'}
              </span>
              <label className="scope-control">
                <span className="sr-only">Lead data</span>
                <select
                  value={scope}
                  onChange={(e) => {
                    const p = new URLSearchParams(params);
                    p.set('data', e.target.value);
                    p.delete('page');
                    setParams(p);
                  }}
                >
                  <option value="business">Your leads</option>
                  <option value="demo">Demo data</option>
                </select>
              </label>
              <button className="icon-button mobile-only" aria-label="Sign out" onClick={signOut}>
                <LogOut size={16} />
              </button>
            </div>
          </header>
          {demo && (
            <div className="demo-banner" role="region" aria-label="Demo data notice">
              <span className="demo-tag">DEMO</span>Synthetic leads for exploring your CRM. These
              records are never sent to Meta.
            </div>
          )}
          <main id="main-content">
            <Routes>
              <Route path="/" element={<Overview />} />
              <Route path="/leads" element={<Leads />} />
              <Route path="/leads/:id" element={<LeadDetail />} />
              <Route path="/import" element={<ImportPage />} />
              <Route path="/integration" element={<Integration />} />
              <Route path="/sync" element={<SyncLog />} />
              <Route path="/guide" element={<OwnerGuide />} />
              <Route
                path="*"
                element={
                  <div className="empty">
                    <h1>Page not found</h1>
                    <Link to={link('/')}>Return to overview</Link>
                  </div>
                }
              />
            </Routes>
          </main>
          <footer className="app-footer">
            WebM8 CRM <span>GBP · Europe/London</span>
          </footer>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
