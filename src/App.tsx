import { WorkspaceLogin, announceSignOut } from './workspace-login';
import { createContext, useContext, useEffect, useState } from 'react';
import {
  NavLink,
  Routes,
  Route,
  Link,
  useLocation,
  useSearchParams,
  Navigate,
} from 'react-router-dom';
import {
  LayoutDashboard,
  UsersRound,
  Workflow,
  Radio,
  BookOpen,
  ArrowUpRight,
  LogOut,
  RefreshCw,
} from 'lucide-react';
import { api, post, setCSRF } from './api';
import {
  Button,
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
import { AnalyticsWorkspace, PlatformTabs } from './analytics';
const WorkspaceContext = createContext<any>(null);
export const useWorkspace = () => useContext(WorkspaceContext);
export function App() {
  const [owner, setOwner] = useState<{ name: string; email: string; id?: string } | null>(null),
    [loading, setLoading] = useState(true),
    [locked, setLocked] = useState(false),
    [connectionError, setConnectionError] = useState(''),
    [auth, setAuth] = useState({ mode: 'owner', analytics_url: '' }),
    [authError, setAuthError] = useState(''),
    [mfa, setMfa] = useState(false);
  const check = () => {
    setLoading(true);
    setConnectionError('');
    api('/auth/config')
      .then((config) => {
        setAuth(config);
        return api('/auth/session');
      })
      .then((s) => {
        setCSRF(s.csrf_token);
        setOwner(s.owner);
      })
      .catch((e) => {
        if (e.status !== 401 && e.status !== 403) setConnectionError(e.message);
        if (e.status === 403) setAuthError(e.message);
        setMfa(e.code === 'MFA_REQUIRED');
      })
      .finally(() => setLoading(false));
  };
  useEffect(() => {
    check();
    const expired = () => setLocked(true);
    window.addEventListener('crm:expired', expired);
    return () => window.removeEventListener('crm:expired', expired);
  }, []);
  useEffect(() => {
    if (auth.mode !== 'supabase') return;
    let active = true,
      checking = false;
    const channel = new BroadcastChannel('webm8-workspace-session');
    channel.onmessage = (event) => {
      if (event.data?.type === 'signed-out') {
        setOwner(null);
        setLocked(false);
        setCSRF('');
      }
    };
    const verify = async () => {
      if (!owner || checking || document.hidden) return;
      checking = true;
      try {
        const session = await api('/auth/session');
        if (active && session.owner.id !== owner.id) window.location.reload();
      } catch (error: any) {
        if (!active) return;
        if (error.status === 401) {
          setMfa(error.code === 'MFA_REQUIRED');
          setLocked(true);
        }
        if (error.status === 403) {
          setOwner(null);
          setCSRF('');
          setAuthError(error.message);
        }
      } finally {
        checking = false;
      }
    };
    const timer = window.setInterval(verify, 30000);
    window.addEventListener('focus', verify);
    return () => {
      active = false;
      channel.close();
      clearInterval(timer);
      window.removeEventListener('focus', verify);
    };
  }, [auth.mode, owner]);
  const signedIn = (s: any) => {
    if (owner?.id && owner.id !== s.owner.id) {
      window.location.reload();
      return;
    }
    setAuthError('');
    setCSRF(s.csrf_token);
    setOwner(s.owner);
    setLocked(false);
  };
  if (loading) return <Loading />;
  if (connectionError) return <ErrorState error={connectionError} retry={check} />;
  if (!owner)
    return auth.mode === 'supabase' ? (
      <main className="login-page">
        <div className="login-card">
          <WorkspaceLogin onSignedIn={signedIn} mfa={mfa} initialError={authError} />
        </div>
      </main>
    ) : (
      <Login onSignedIn={signedIn} />
    );
  return (
    <NavigationGuard>
      <Workspace
        owner={owner}
        analyticsUrl={auth.analytics_url}
        unified={auth.mode === 'supabase'}
        onLogout={() => {
          setOwner(null);
          setCSRF('');
          if (auth.mode === 'supabase') announceSignOut();
        }}
      />
      {locked && (
        <Modal title="Sign in to continue" locked onClose={() => {}}>
          <p className="muted">
            Your session expired. Sign back in with the same account to keep your unsaved edits.
          </p>
          {auth.mode === 'supabase' ? (
            <WorkspaceLogin onSignedIn={signedIn} mfa={mfa} />
          ) : (
            <Login compact onSignedIn={signedIn} />
          )}
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
  analyticsUrl,
  unified,
}: {
  owner: { name: string; email: string };
  onLogout: () => void;
  analyticsUrl: string;
  unified: boolean;
}) {
  const [platform, setPlatform] = useState<'crm' | 'analytics'>('crm');
  const [analyticsOpened, setAnalyticsOpened] = useState(false);
  const [analyticsRefresh, setAnalyticsRefresh] = useState(0);
  const openPlatform = (next: 'crm' | 'analytics') => {
    if (next === 'analytics') setAnalyticsOpened(true);
    setPlatform(next);
  };
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
    setPlatform('crm');
  }, [location.pathname]);
  useEffect(() => {
    if (
      integration.data &&
      !params.has('data') &&
      ['/', '/leads', '/overview'].includes(location.pathname)
    ) {
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
    { to: '/leads', label: 'Leads', icon: UsersRound },
    { to: '/overview', label: 'Overview', icon: LayoutDashboard },
    { to: '/integration', label: 'Meta integration', icon: Workflow },
    { to: '/sync', label: 'Sync log', icon: Radio },
  ];
  const title = location.pathname.startsWith('/leads/')
    ? 'Lead detail'
    : location.pathname === '/import'
      ? 'Import leads'
      : links.find((l) => l.to === location.pathname)?.label || 'Owner guide';
  useEffect(() => {
    document.title = platform === 'analytics' ? 'Analytics — WebM8' : `${title} — WebM8 CRM`;
  }, [title, platform]);
  const link = (path: string) => {
    const p =
      path.startsWith('/leads') && location.pathname.startsWith('/leads')
        ? new URLSearchParams(params)
        : new URLSearchParams({ data: scope });
    for (const key of ['return', 'activityVisit', 'activityPage', 'activityVisits']) p.delete(key);
    if (path.startsWith('/leads/')) p.set('return', `/leads?${p}`);
    return `${path}?${p}`;
  };
  return (
    <WorkspaceContext.Provider value={{ demo, scope, integration, link, owner }}>
      <div className="app-shell">
        <aside className="sidebar">
          <Link
            className="brand"
            to={link('/')}
            aria-label="WebM8 lead desk"
            onClick={() => openPlatform('crm')}
          >
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
              WebM8<small>{unified ? 'Team access' : 'Owner access'}</small>
            </div>
          </div>
          <span className="nav-label">WORKSPACE</span>
          <nav aria-label="Main navigation">
            {links.map((l) => (
              <NavLink
                key={l.to}
                to={link(l.to)}
                end={l.to === '/'}
                onClick={() => openPlatform('crm')}
                className={({ isActive }) => (isActive && platform === 'crm' ? 'active' : '')}
              >
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
            <Link to={link('/guide')} onClick={() => openPlatform('crm')}>
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
                <small>{unified ? 'WebM8 team' : 'Workspace owner'}</small>
              </div>
            </div>
          </div>
        </aside>
        <div className="workspace-main">
          <header className={`topbar ${platform === 'analytics' ? 'analytics-active' : ''}`}>
            <nav aria-label="Platform switcher">
              <PlatformTabs active={platform} onChange={openPlatform} />
            </nav>
            <div className="breadcrumb">
              Workspace <span>/</span>{' '}
              <strong>{platform === 'analytics' ? 'Analytics' : title}</strong>
            </div>
            <div className="topbar-right">
              {platform === 'analytics' && (
                <Button
                  variant="outline"
                  className="analytics-refresh"
                  aria-label="Refresh analytics"
                  title="Refresh analytics"
                  onClick={() => setAnalyticsRefresh((value) => value + 1)}
                >
                  <RefreshCw size={18} aria-hidden="true" />
                </Button>
              )}
              <span
                hidden={platform === 'analytics'}
                className={`connection ${integration.data?.connected ? 'connected' : ''}`}
              >
                <span className="dot" />
                {integration.data?.connected
                  ? `Meta · ${integration.data.settings.mode} mode`
                  : 'Meta disconnected'}
              </span>
              <label hidden={platform === 'analytics'} className="scope-control">
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
          {demo && platform === 'crm' && (
            <div className="demo-banner" role="region" aria-label="Demo data notice">
              <span className="demo-tag">DEMO</span>Synthetic leads for exploring your CRM. These
              records are never sent to Meta.
            </div>
          )}
          <main id="main-content" aria-label="WebM8 workspace">
            <div
              id="crm-panel"
              role="tabpanel"
              aria-labelledby="crm-tab"
              hidden={platform !== 'crm'}
            >
              <Routes>
                <Route path="/" element={<Navigate to={`/leads${location.search}`} replace />} />
                <Route path="/overview" element={<Overview />} />
                <Route path="/leads" element={<Leads />}>
                  <Route path=":id" element={<LeadDetail />} />
                </Route>
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
            </div>
            <div
              id="analytics-panel"
              role="tabpanel"
              aria-labelledby="analytics-tab"
              hidden={platform !== 'analytics'}
            >
              {analyticsOpened && (
                <AnalyticsWorkspace url={analyticsUrl} refreshVersion={analyticsRefresh} />
              )}
            </div>
          </main>
          <footer className="app-footer">
            WebM8 CRM <span>GBP · Europe/London</span>
          </footer>
        </div>
      </div>
    </WorkspaceContext.Provider>
  );
}
