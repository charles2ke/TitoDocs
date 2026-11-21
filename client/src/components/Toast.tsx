import { createContext, use, useCallback, useEffect, useEffectEvent, useMemo, useRef, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
  duration: number;
  action?: { label: string; onClick(): void };
}

interface ToastApi {
  show(message: string, options?: { kind?: ToastKind; action?: Toast['action']; duration?: number }): void;
  error(error: unknown): void;
}

const ToastContext = createContext<ToastApi | null>(null);
let nextId = 1;

export function ToastProvider({ children }: { children: ReactNode }) {
  const [toasts, setToasts] = useState<Toast[]>([]);

  const dismiss = useCallback((id: number) => setToasts((list) => list.filter((toast) => toast.id !== id)), []);

  const show = useCallback<ToastApi['show']>((message, { kind = 'info', action, duration = action ? 8000 : 4000 } = {}) => {
    const id = nextId++;
    setToasts((list) => [...list.slice(-3), { id, message, kind, duration, action }]);
  }, []);

  const api = useMemo<ToastApi>(
    () => ({
      show,
      error: (error) => show(error instanceof Error ? error.message : String(error), { kind: 'error', duration: 6000 }),
    }),
    [show],
  );

  return (
    <ToastContext value={api}>
      {children}
      <div className="toasts" role="status" aria-live="polite">
        {toasts.map((toast) => (
          <ToastItem key={toast.id} toast={toast} onDismiss={dismiss} />
        ))}
      </div>
    </ToastContext>
  );
}

/** Counts down only while the pointer and focus are elsewhere, so there is time to read the toast and reach its action. */
function ToastItem({ toast, onDismiss }: { toast: Toast; onDismiss(id: number): void }) {
  const [hovered, setHovered] = useState(false);
  const [focused, setFocused] = useState(false);
  const remaining = useRef(toast.duration);
  const expire = useEffectEvent(() => onDismiss(toast.id));

  useEffect(() => {
    if (hovered || focused) return;
    const start = Date.now();
    const timer = setTimeout(() => expire(), remaining.current);
    return () => {
      clearTimeout(timer);
      remaining.current -= Date.now() - start;
    };
  }, [hovered, focused]);

  return (
    <div
      className={`toast toast-${toast.kind}`}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      onFocus={() => setFocused(true)}
      onBlur={(event) => !event.currentTarget.contains(event.relatedTarget) && setFocused(false)}
    >
      <span>{toast.message}</span>
      {toast.action && (
        <button
          className="btn btn-link"
          onClick={() => {
            toast.action!.onClick();
            onDismiss(toast.id);
          }}
        >
          {toast.action.label}
        </button>
      )}
      <button className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => onDismiss(toast.id)}>
        <X size={14} />
      </button>
    </div>
  );
}

export function useToast(): ToastApi {
  const value = use(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
