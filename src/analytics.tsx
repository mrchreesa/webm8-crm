import { useEffect, useRef, useState } from 'react';
import { BarChart3, UsersRound } from 'lucide-react';
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

export function AnalyticsWorkspace({
  url,
  refreshVersion,
}: {
  url?: string;
  refreshVersion: number;
}) {
  const analyticsUrl = resolveAnalyticsUrl(url || import.meta.env.VITE_ANALYTICS_URL);
  const analyticsOrigin = new URL(analyticsUrl).origin;
  const frame = useRef<HTMLIFrameElement>(null);
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
  }, [refreshVersion, analyticsUrl]);

  return (
    <section className="analytics-workspace" aria-label="Website analytics workspace">
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
                : 'Use Refresh analytics in the navigation bar to try again.'}
            </p>
          </div>
        )}
        <iframe
          key={refreshVersion}
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
