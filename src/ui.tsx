import {
  createContext,
  useContext,
  useEffect,
  useId,
  useRef,
  useState,
  type ReactNode,
  type FormEvent,
  type ButtonHTMLAttributes,
} from 'react';
import { useBlocker, useSearchParams } from 'react-router-dom';
import {
  X,
  LoaderCircle,
  CheckCircle2,
  AlertCircle,
  ChevronLeft,
  ChevronRight,
} from 'lucide-react';
import { api, APIError } from './api';
import { STATUS_LABELS } from './format';
import type { Stage } from './domain';

const ToastContext = createContext<(message: string) => void>(() => {});
export function ToastProvider({ children }: { children: ReactNode }) {
  const [message, setMessage] = useState('');
  useEffect(() => {
    if (!message) return;
    const t = setTimeout(() => setMessage(''), 5500);
    return () => clearTimeout(t);
  }, [message]);
  return (
    <ToastContext.Provider value={setMessage}>
      {children}
      <div className={`toast ${message ? 'visible' : ''}`} role="status" aria-live="polite">
        {message && (
          <>
            <CheckCircle2 size={18} />
            <span>{message}</span>
            <button aria-label="Dismiss message" onClick={() => setMessage('')}>
              <X size={16} />
            </button>
          </>
        )}
      </div>
    </ToastContext.Provider>
  );
}
export const useToast = () => useContext(ToastContext);
const GuardContext = createContext({
  dirty: (_id: string, _value: boolean) => {},
  go: (_action: () => void) => {},
});
export function NavigationGuard({ children }: { children: ReactNode }) {
  const dirty = useRef(new Set<string>()),
    [pending, setPending] = useState<(() => void) | null>(null);
  const blocker = useBlocker(({ currentLocation, nextLocation }) => {
    // Website-history paging changes only this mounted lead's read-only panel.
    // Every other route or filter change retains the existing draft guard.
    if (
      currentLocation.pathname === nextLocation.pathname &&
      /^\/leads\/[^/]+$/.test(currentLocation.pathname) &&
      currentLocation.hash === nextLocation.hash
    ) {
      const stable = (search: string) => {
        const values = new URLSearchParams(search);
        for (const name of ['activityVisit', 'activityPage', 'activityVisits']) values.delete(name);
        values.sort();
        return values.toString();
      };
      if (stable(currentLocation.search) === stable(nextLocation.search)) return false;
    }
    return dirty.current.size > 0;
  });
  const go = (action: () => void) => {
    if (dirty.current.size) setPending(() => action);
    else action();
  };
  useEffect(() => {
    const unload = (e: BeforeUnloadEvent) => {
      if (dirty.current.size) {
        e.preventDefault();
        e.returnValue = '';
      }
    };
    window.addEventListener('beforeunload', unload);
    return () => {
      window.removeEventListener('beforeunload', unload);
    };
  }, []);
  const cancel = () => {
    setPending(null);
    if (blocker.state === 'blocked') blocker.reset();
  };
  return (
    <GuardContext.Provider
      value={{
        dirty: (id, value) => {
          if (value) dirty.current.add(id);
          else dirty.current.delete(id);
        },
        go,
      }}
    >
      {children}
      {(pending || blocker.state === 'blocked') && (
        <Modal title="Discard unsaved changes?" onClose={cancel}>
          <p>Your edits have not been saved.</p>
          <div className="form-actions">
            <Button autoFocus onClick={cancel}>
              Keep editing
            </Button>
            <Button
              variant="danger"
              onClick={() => {
                dirty.current.clear();
                if (pending) pending();
                else if (blocker.state === 'blocked') blocker.proceed();
                setPending(null);
              }}
            >
              Discard changes
            </Button>
          </div>
        </Modal>
      )}
    </GuardContext.Provider>
  );
}
export const useGuard = () => useContext(GuardContext);
export function Button({
  variant = 'primary',
  busy,
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'outline' | 'ghost' | 'danger';
  busy?: boolean;
}) {
  return (
    <button
      {...props}
      className={`button ${variant} ${props.className || ''}`}
      disabled={props.disabled || busy}
      aria-busy={busy || undefined}
      data-autofocus={props.autoFocus || undefined}
    >
      {busy && <LoaderCircle size={16} className="spin busy-spinner" />}
      <span className="button-content" style={busy ? { opacity: 0 } : undefined}>
        {children}
      </span>
    </button>
  );
}
const ModalCloseContext = createContext(() => {});
export function ModalCancel() {
  const close = useContext(ModalCloseContext);
  return (
    <Button type="button" variant="outline" onClick={close}>
      Cancel
    </Button>
  );
}
export function Modal({
  title,
  children,
  onClose,
  locked = false,
}: {
  title: string;
  children: ReactNode;
  onClose: () => void;
  locked?: boolean;
}) {
  const ref = useRef<HTMLDialogElement>(null),
    id = useId(),
    [discard, setDiscard] = useState(false),
    trigger = useRef<Element | null>(null);
  const close = () => {
    if (locked) return;
    if (ref.current?.querySelector('[data-dirty="true"]')) setDiscard(true);
    else onClose();
  };
  useEffect(() => {
    trigger.current = document.activeElement;
    ref.current?.showModal();
    ref.current?.querySelector<HTMLElement>('[data-autofocus=true]')?.focus();
    return () => {
      ref.current?.close();
      if (trigger.current instanceof HTMLElement && trigger.current.isConnected)
        trigger.current.focus();
    };
  }, []);
  return (
    <ModalCloseContext.Provider value={close}>
      <dialog
        ref={ref}
        aria-labelledby={id}
        className="modal"
        onCancel={(e) => {
          e.preventDefault();
          close();
        }}
      >
        <div className="modal-header">
          <h2 id={id}>{title}</h2>
          {!locked && (
            <button className="icon-button" aria-label="Close dialog" onClick={close}>
              <X size={20} />
            </button>
          )}
        </div>
        <div className="modal-body">
          {children}
          {discard && (
            <div className="discard-box" role="alert">
              <p>You have unsaved changes. Discard them?</p>
              <Button variant="outline" onClick={() => setDiscard(false)}>
                Keep editing
              </Button>
              <Button variant="danger" onClick={onClose}>
                Discard changes
              </Button>
            </div>
          )}
        </div>
      </dialog>
    </ModalCloseContext.Provider>
  );
}
const FormContext = createContext({ busy: false, errors: {} as Record<string, string> });
export function Form({
  children,
  onSave,
  onSuccess,
  className = '',
  id,
}: {
  children: ReactNode;
  onSave: (data: FormData) => Promise<unknown>;
  onSuccess?: () => void;
  className?: string;
  id?: string;
  noValidate?: boolean;
}) {
  const form = useRef<HTMLFormElement>(null),
    guard = useGuard(),
    formId = useId(),
    [dirty, setDirty] = useState(false),
    [busy, setBusy] = useState(false),
    [error, setError] = useState(''),
    [errors, setErrors] = useState<Record<string, string>>({});
  const saving = useRef(false);
  useEffect(() => {
    guard.dirty(formId, dirty);
    return () => guard.dirty(formId, false);
  }, [dirty, formId]);
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (saving.current) return;
    saving.current = true;
    setBusy(true);
    setError('');
    setErrors({});
    try {
      await onSave(new FormData(form.current!));
      setDirty(false);
      guard.dirty(formId, false);
      onSuccess?.();
    } catch (e) {
      setError((e as Error).message);
      if (e instanceof APIError) {
        const fields = Object.fromEntries(
          Object.entries(e.fields).map(([key, value]) => [
            key === 'sale_minor' ? 'sale_gbp' : key.split('.')[0],
            value,
          ]),
        );
        setErrors(fields);
        setTimeout(() => {
          const name = Object.keys(fields)[0];
          const element = name ? form.current?.elements.namedItem(name) : null;
          if (element instanceof HTMLElement) element.focus();
        }, 0);
      }
    } finally {
      saving.current = false;
      setBusy(false);
    }
  };
  return (
    <FormContext.Provider value={{ busy, errors }}>
      <form
        ref={form}
        id={id}
        noValidate
        className={className}
        onSubmit={submit}
        data-dirty={dirty}
        onChange={() => setDirty(true)}
      >
        {error && (
          <div className="alert error" role="alert">
            <AlertCircle size={18} />
            <span>{error}</span>
          </div>
        )}
        {children}
      </form>
    </FormContext.Provider>
  );
}
export function Field({
  label,
  name,
  type = 'text',
  hint,
  options,
  textarea,
  ...props
}: {
  label: string;
  name: string;
  type?: string;
  hint?: string;
  options?: { value: string; label: string }[];
  textarea?: boolean;
} & Omit<React.InputHTMLAttributes<HTMLInputElement>, 'type'>) {
  const id = useId(),
    { errors } = useContext(FormContext),
    error = errors[name],
    [show, setShow] = useState(false);
  const common = {
    id,
    name,
    'aria-invalid': !!error,
    'aria-describedby': error ? `${id}-error` : hint ? `${id}-hint` : undefined,
  };
  return (
    <div className="field">
      <label htmlFor={id}>{label}</label>
      <div className={type === 'password' ? 'password-wrap' : ''}>
        {options ? (
          <select
            {...common}
            defaultValue={props.defaultValue}
            value={props.value}
            disabled={props.disabled}
            onChange={props.onChange as any}
          >
            {options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ) : textarea ? (
          <textarea
            {...common}
            {...(props as any)}
            className="resize-none"
            rows={5}
            style={{ resize: 'none' }}
          />
        ) : (
          <input
            {...props}
            {...common}
            data-autofocus={props.autoFocus || undefined}
            type={type === 'password' && show ? 'text' : type}
          />
        )}
        {type === 'password' && (
          <button
            type="button"
            aria-label={show ? 'Hide password' : 'Show password'}
            aria-pressed={show}
            onClick={() => setShow(!show)}
          >
            {show ? 'Hide' : 'Show'}
          </button>
        )}
      </div>
      {hint && <small id={`${id}-hint`}>{hint}</small>}
      {error && (
        <small className="field-error" id={`${id}-error`}>
          {error}
        </small>
      )}
    </div>
  );
}
export function Submit({
  children,
  variant = 'primary',
}: {
  children: ReactNode;
  variant?: 'primary' | 'danger';
}) {
  const { busy } = useContext(FormContext);
  return (
    <Button type="submit" variant={variant} busy={busy}>
      {children}
    </Button>
  );
}
export function Check({
  name,
  label,
  value,
  defaultChecked,
}: {
  name: string;
  label: string;
  value?: string;
  defaultChecked?: boolean;
}) {
  return (
    <label className="check">
      <input type="checkbox" name={name} value={value || 'yes'} defaultChecked={defaultChecked} />
      <span>{label}</span>
    </label>
  );
}
export function StageBadge({ stage }: { stage: Stage }) {
  return (
    <span className={`badge stage-${stage.toLowerCase().replaceAll(' ', '-')}`}>
      <span className="dot" />
      {stage}
    </span>
  );
}
export function SyncBadge({ status, testOnly = false }: { status: string; testOnly?: boolean }) {
  return (
    <span className={`sync-label sync-${status}`}>
      <span className="dot" />
      {testOnly ? 'Test · ' : ''}
      {STATUS_LABELS[status] || status}
    </span>
  );
}
export function Loading() {
  return (
    <div className="loading" role="status">
      <LoaderCircle size={24} className="spin" />
      <span>Loading your CRM…</span>
    </div>
  );
}
export function ErrorState({ error, retry }: { error: string; retry: () => void }) {
  return (
    <div className="empty error-state" role="alert">
      <AlertCircle size={26} />
      <h3>Could not load this view</h3>
      <p>{error}</p>
      <Button variant="outline" onClick={retry}>
        Try again
      </Button>
    </div>
  );
}
export function Empty({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="empty">
      <h3>{title}</h3>
      <p>{children}</p>
    </div>
  );
}
export function useLoad<T = any>(path: string, poll = false) {
  const [data, setData] = useState<T | null>(null),
    [loading, setLoading] = useState(true),
    [error, setError] = useState(''),
    [tick, setTick] = useState(0);
  useEffect(() => {
    const ctrl = new AbortController();
    setLoading(true);
    setError('');
    api<T>(path, { signal: ctrl.signal })
      .then((d) => {
        if (!ctrl.signal.aborted) {
          setData(d);
          setLoading(false);
        }
      })
      .catch((e) => {
        if (!ctrl.signal.aborted) {
          setError(e.message);
          setLoading(false);
        }
      });
    return () => ctrl.abort();
  }, [path, tick]);
  useEffect(() => {
    if (!poll) return;
    const t = setInterval(() => {
      if (document.visibilityState === 'visible') setTick((t) => t + 1);
    }, 20000);
    return () => clearInterval(t);
  }, [poll]);
  return { data, loading, error, refresh: () => setTick((t) => t + 1) };
}
export function Pagination({
  page,
  total,
  size = 20,
}: {
  page: number;
  total: number;
  size?: number;
}) {
  const [params, setParams] = useSearchParams(),
    pages = Math.max(1, Math.ceil(total / size));
  const move = (p: number) => {
    const next = new URLSearchParams(params);
    next.set('page', String(p));
    setParams(next);
  };
  return (
    <div className="pagination">
      <span>
        {total
          ? `${(page - 1) * size + 1}–${Math.min(page * size, total)} of ${total}`
          : '0 records'}
      </span>
      <nav aria-label="Table pages">
        <Button
          variant="ghost"
          disabled={page <= 1}
          onClick={() => move(page - 1)}
          aria-label="Previous page"
        >
          <ChevronLeft size={16} />
        </Button>
        <span>
          Page {page} of {pages}
        </span>
        <Button
          variant="ghost"
          disabled={page >= pages}
          onClick={() => move(page + 1)}
          aria-label="Next page"
        >
          <ChevronRight size={16} />
        </Button>
      </nav>
    </div>
  );
}
