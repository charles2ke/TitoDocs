import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';
import { X } from 'lucide-react';

type ToastKind = 'info' | 'success' | 'error';

interface Toast {
  id: number;
  message: string;
  kind: ToastKind;
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

  const show = useCallback<ToastApi['show']>(
    (message, { kind = 'info', action, duration = 4000 } = {}) => {
      const id = nextId++;
      setToasts((list) => [...list.slice(-3), { id, message, kind, action }]);
      setTimeout(() => dismiss(id), duration);
    },
    [dismiss],
  );

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
          <div key={toast.id} className={`toast toast-${toast.kind}`}>
            <span>{toast.message}</span>
            {toast.action && (
              <button
                className="btn btn-link"
                onClick={() => {
                  toast.action!.onClick();
                  dismiss(toast.id);
                }}
              >
                {toast.action.label}
              </button>
            )}
            <button className="icon-btn icon-btn-sm" aria-label="Dismiss" onClick={() => dismiss(toast.id)}>
              <X size={14} />
            </button>
          </div>
        ))}
      </div>
    </ToastContext>
  );
}

export function useToast(): ToastApi {
  const value = use(ToastContext);
  if (!value) throw new Error('useToast must be used inside <ToastProvider>');
  return value;
}
