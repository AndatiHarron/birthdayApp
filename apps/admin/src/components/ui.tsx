import { useEffect, useState, type ReactNode } from 'react';
import { ApiError } from '../lib/api';
import { humanise, tone } from '../lib/format';

export function Badge({ value }: { value: string | null | undefined }) {
  return <span className={`badge ${tone(value)}`}>{humanise(value)}</span>;
}

export function PageHeader({ title, subtitle, actions }: { title: string; subtitle?: string; actions?: ReactNode }) {
  return (
    <div className="topbar">
      <div>
        <h1>{title}</h1>
        {subtitle ? <p>{subtitle}</p> : null}
      </div>
      {actions ? <div className="toolbar">{actions}</div> : null}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  if (!error) return null;
  const message = error instanceof ApiError ? error.message : error instanceof Error ? error.message : 'Something went wrong.';
  const fields = error instanceof ApiError && error.fieldErrors ? Object.entries(error.fieldErrors) : [];
  return (
    <div className="error-box" role="alert">
      {message}
      {fields.length > 0 ? (
        <ul style={{ margin: '6px 0 0', paddingLeft: 18 }}>
          {fields.map(([field, messages]) => (
            <li key={field}>
              <strong>{field.replace(/^body\./, '')}</strong>: {messages.join(', ')}
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function LoadingRows({ columns, rows = 6 }: { columns: number; rows?: number }) {
  return (
    <>
      {Array.from({ length: rows }, (_, row) => (
        <tr key={row}>
          {Array.from({ length: columns }, (_, column) => (
            <td key={column}>
              <div className="skeleton" style={{ width: `${50 + ((row + column) % 4) * 12}%` }} />
            </td>
          ))}
        </tr>
      ))}
    </>
  );
}

export function EmptyRow({ columns, message }: { columns: number; message: string }) {
  return (
    <tr>
      <td colSpan={columns} className="empty">
        {message}
      </td>
    </tr>
  );
}

export function Drawer({ title, onClose, children }: { title: ReactNode; onClose: () => void; children: ReactNode }) {
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => event.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);
  return (
    <div className="drawer-backdrop" onClick={onClose}>
      <aside className="drawer" role="dialog" aria-modal="true" onClick={(event) => event.stopPropagation()}>
        <div className="drawer-head">
          <h2>{title}</h2>
          <button className="btn btn-sm" onClick={onClose} aria-label="Close">
            ✕
          </button>
        </div>
        <div className="drawer-body">{children}</div>
      </aside>
    </div>
  );
}

export function Stat({ label, value, sub }: { label: string; value: ReactNode; sub?: ReactNode }) {
  return (
    <div className="card stat">
      <div className="stat-label">{label}</div>
      <div className="stat-value">{value}</div>
      {sub ? <div className="stat-sub">{sub}</div> : null}
    </div>
  );
}

/** Cursor pager: keeps a stack of cursors so "Previous" works. */
export function useCursorPager() {
  const [stack, setStack] = useState<Array<string | undefined>>([undefined]);
  const cursor = stack[stack.length - 1];
  return {
    cursor,
    page: stack.length,
    next: (nextCursor: string | null | undefined) => nextCursor && setStack((current) => [...current, nextCursor]),
    previous: () => setStack((current) => (current.length > 1 ? current.slice(0, -1) : current)),
    reset: () => setStack([undefined]),
  };
}

export function Pager({ page, hasNext, onNext, onPrevious }: { page: number; hasNext: boolean; onNext: () => void; onPrevious: () => void }) {
  return (
    <div className="pager">
      <span className="muted" style={{ alignSelf: 'center' }}>
        Page {page}
      </span>
      <button className="btn btn-sm" disabled={page <= 1} onClick={onPrevious}>
        Previous
      </button>
      <button className="btn btn-sm" disabled={!hasNext} onClick={onNext}>
        Next
      </button>
    </div>
  );
}

export function useDebounced<T>(value: T, delay = 350): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const timer = setTimeout(() => setDebounced(value), delay);
    return () => clearTimeout(timer);
  }, [value, delay]);
  return debounced;
}

export function ConfirmButton({
  label,
  confirm,
  onConfirm,
  className = 'btn btn-sm',
  disabled,
}: {
  label: string;
  confirm: string;
  onConfirm: () => void;
  className?: string;
  disabled?: boolean;
}) {
  return (
    <button
      className={className}
      disabled={disabled}
      onClick={() => {
        if (window.confirm(confirm)) onConfirm();
      }}
    >
      {label}
    </button>
  );
}
