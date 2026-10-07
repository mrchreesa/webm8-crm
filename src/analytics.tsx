import { useEffect, useRef, useState } from 'react';
import { BarChart3, ExternalLink, RefreshCw, UsersRound } from 'lucide-react';
import { Button } from './ui';
import { resolveAnalyticsUrl } from './analytics-config';

// Public dashboard address only. No CRM records or credentials cross this boundary.

export function PlatformTabs({
  active,
  onChange,
}: {
  active: 'crm' | 'analytics';
  onChange: (platform: 'crm' | 'analytics') => void;
}) {
  const tabs = [
    { id: 'crm' as const, label: 'CRM', icon: UsersRound },
    { id: 'analytics' as const, label: 'Analytics', icon: BarChart3 },
  ];
  return (
    <div className="platform-tabs" role="tablist" aria-label="Platforms">
      {tabs.map(({ id, label, icon: Icon }, index) => (
        <button
          key={id}
          id={`${id}-tab`}
          type="button"
          role="tab"
          aria-selected={active === id}
          aria-controls={`${id}-panel`}
          tabIndex={active === id ? 0 : -1}
          onClick={() => onChange(id)}
          onKeyDown={(event) => {
            if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
            event.preventDefault();
            const next = event.key === 'Home' ? 0 : event.key === 'End' ? 1 : 1 - index;
            const target = tabs[next].id;
            onChange(target);
            document.getElementById(`${target}-tab`)?.focus();
          }}
        >
          <Icon size={17} aria-hidden="true" />
          {label}
        </button>
      ))}
    </div>
  );
}

export function AnalyticsWorkspace({ url, unified = false }: { url?: string; unified?: boolean }) {
  const analyticsUrl = resolveAnalyticsUrl(url || import.meta.env.VITE_ANALYTICS_URL);
  const analyticsOrigin = new URL(analyticsUrl).origin;
  const frame = useRef<HTMLIFrameElement>(null);
  const [attempt, setAttempt] = useState(0);
  const [status, setStatus] = useState<'loading' | 'ready' | 'unavailable'>('loading');
  const connect = () =>
    frame.current?.contentWindow?.postMessage({ type: 'webm8:embed:init' }, analyticsOrigin);

  useEffect(() => {
    setStatus('loading');
    let ready = false;
    const receive = (event: MessageEvent) => {
      if (
        event.origin !== analyticsOrigin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'webm8:embed:ready'
      )
        return;
      ready = true;
      setStatus('ready');
      clearInterval(ping);
    };
    window.addEventListener('message', receive);
    const ping = window.setInterval(connect, 500);
    const timeout = window.setTimeout(() => {
      clearInterval(ping);
      if (!ready) setStatus('unavailable');
    }, 15000);
    return () => {
      window.removeEventListener('message', receive);
      clearInterval(ping);
      clearTimeout(timeout);
    };
  }, [attempt]);

  return (
    <section className="analytics-workspace" aria-label="Website analytics workspace">
      <div className="analytics-toolbar">
        <div>
          <h1>Website analytics</h1>
          <p className="muted">Explore visits, pages and time spent on your websites.</p>
        </div>
        <div className="analytics-actions">
          <Button variant="outline" onClick={() => setAttempt((value) => value + 1)}>
            <RefreshCw size={15} /> Reload
          </Button>
          <a
            className="button outline"
            href={analyticsUrl}
            target="_blank"
            rel="noopener noreferrer"
          >
            Open separately <ExternalLink size={15} aria-hidden="true" />
          </a>
        </div>
      </div>
      <p className="analytics-note">
        {unified
          ? 'Your workspace sign-in is shared with Analytics.'
          : 'Use your Analytics sign-in if prompted.'}{' '}
        Website activity is not yet linked to individual CRM leads.
      </p>
      <div className="analytics-frame-wrap" aria-busy={status === 'loading'}>
        {status !== 'ready' && (
          <div className="analytics-frame-status" role="status">
            <BarChart3 size={24} aria-hidden="true" />
            <strong>
              {status === 'loading' ? 'Opening Analytics…' : 'Analytics has not connected'}
            </strong>
            <p>
              {status === 'loading'
                ? 'Your CRM stays open while your reports load.'
                : 'Try Reload, or open Analytics separately if your browser blocks the embedded workspace.'}
            </p>
          </div>
        )}
        <iframe
          key={attempt}
          ref={frame}
          title="WebM8 website analytics"
          src={analyticsUrl}
          className={status === 'ready' ? 'analytics-frame ready' : 'analytics-frame'}
          onLoad={connect}
          referrerPolicy="no-referrer"
        />
      </div>
    </section>
  );
}
