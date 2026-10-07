import { useEffect, useRef, useState } from 'react';
import { api, post } from './api';
import { Button } from './ui';

export function announceSignOut() {
  const channel = new BroadcastChannel('webm8-workspace-session');
  channel.postMessage({ type: 'signed-out' });
  channel.close();
}

export function WorkspaceLogin({
  onSignedIn,
  mfa = false,
  initialError = '',
}: {
  onSignedIn: (session: any) => void;
  mfa?: boolean;
  initialError?: string;
}) {
  const frame = useRef<HTMLIFrameElement>(null);
  const [error, setError] = useState(initialError);
  const [attempt, setAttempt] = useState(0);
  const [useMfa, setUseMfa] = useState(mfa);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    let active = true;
    const receive = async (event: MessageEvent) => {
      if (
        event.origin !== window.location.origin ||
        event.source !== frame.current?.contentWindow ||
        event.data?.type !== 'webm8:auth:complete'
      )
        return;
      try {
        const session = await api('/auth/session');
        if (active) onSignedIn(session);
      } catch (caught) {
        if (active) setError((caught as Error).message);
      }
    };
    window.addEventListener('message', receive);
    const ping = window.setInterval(
      () =>
        frame.current?.contentWindow?.postMessage(
          { type: 'webm8:embed:init' },
          window.location.origin,
        ),
      500,
    );
    return () => {
      active = false;
      window.removeEventListener('message', receive);
      clearInterval(ping);
    };
  }, [attempt]);
  return (
    <section className="workspace-login" aria-label="Workspace sign-in">
      <p className="muted">One sign-in for CRM and Analytics.</p>
      {error && <p role="alert">{error}</p>}
      <iframe
        key={attempt}
        ref={frame}
        title="WebM8 workspace sign-in"
        src={`/${useMfa ? 'mfa' : 'login'}?next=/auth/complete`}
      />
      {error && (
        <Button
          variant="outline"
          disabled={busy}
          onClick={async () => {
            setBusy(true);
            setError('');
            try {
              await post('/auth/logout', {});
              announceSignOut();
              setUseMfa(false);
              setAttempt((value) => value + 1);
            } catch (caught) {
              setError((caught as Error).message);
            } finally {
              setBusy(false);
            }
          }}
        >
          Use another account
        </Button>
      )}
    </section>
  );
}
