import { useLayoutEffect, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { X } from 'lucide-react';

interface DialogProps {
  title: string;
  onClose: () => void;
  children: ReactNode;
  footer?: ReactNode;
  wide?: boolean;
  className?: string;
}

/** A modal dialog built on the native <dialog> element (focus trapping and Escape handling for free). */
export function Dialog({ title, onClose, children, footer, wide, className = '' }: DialogProps) {
  const ref = useRef<HTMLDialogElement>(null);
  // The content is added once the dialog is open, as `autoFocus` can't focus anything in a closed dialog.
  const [open, setOpen] = useState(false);
  useLayoutEffect(() => {
    const dialog = ref.current;
    if (dialog && !dialog.open) dialog.showModal();
    setOpen(true);
  }, []);
  return (
    <dialog
      ref={ref}
      className={`dialog ${wide ? 'dialog-wide' : ''} ${className}`}
      aria-label={title}
      onCancel={(event) => {
        event.preventDefault();
        onClose();
      }}
      onPointerDown={(event) => {
        // Clicking the backdrop (the dialog element itself, outside its content box) closes it.
        if (event.target === ref.current) {
          const rect = ref.current.getBoundingClientRect();
          const inside =
            event.clientX >= rect.left && event.clientX <= rect.right && event.clientY >= rect.top && event.clientY <= rect.bottom;
          if (!inside) onClose();
        }
      }}
    >
      <header className="dialog-header">
        <h2>{title}</h2>
        <button className="icon-btn" aria-label="Close" onClick={onClose}>
          <X size={18} />
        </button>
      </header>
      <div className="dialog-body">{open && children}</div>
      {open && footer && <footer className="dialog-footer">{footer}</footer>}
    </dialog>
  );
}

interface PromptProps {
  title: string;
  label: string;
  initial?: string;
  confirmLabel?: string;
  placeholder?: string;
  onSubmit: (value: string) => void | Promise<void>;
  onClose: () => void;
  multiline?: boolean;
}

export function PromptDialog({ title, label, initial = '', confirmLabel = 'OK', placeholder, onSubmit, onClose, multiline }: PromptProps) {
  const [value, setValue] = useState(initial);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      await onSubmit(value);
      onClose();
    } catch (caught) {
      // Validation errors thrown by onSubmit keep the dialog open.
      setError(caught instanceof Error ? caught.message : 'Something went wrong.');
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog title={title} onClose={onClose}>
      <form onSubmit={submit} className="form">
        <label className="field">
          <span>{label}</span>
          {multiline ? (
            <textarea autoFocus value={value} placeholder={placeholder} rows={6} onChange={(event) => setValue(event.target.value)} />
          ) : (
            <input
              autoFocus
              value={value}
              placeholder={placeholder}
              onChange={(event) => {
                setValue(event.target.value);
                setError('');
              }}
              onFocus={(event) => event.target.select()}
            />
          )}
        </label>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <div className="dialog-actions">
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="submit" className="btn btn-primary" disabled={busy}>
            {confirmLabel}
          </button>
        </div>
      </form>
    </Dialog>
  );
}

interface ConfirmProps {
  title: string;
  message: ReactNode;
  confirmLabel?: string;
  danger?: boolean;
  onConfirm: () => void | Promise<void>;
  onClose: () => void;
}

export function ConfirmDialog({ title, message, confirmLabel = 'Confirm', danger, onConfirm, onClose }: ConfirmProps) {
  const [busy, setBusy] = useState(false);
  return (
    <Dialog title={title} onClose={onClose}>
      <p className="dialog-message">{message}</p>
      <div className="dialog-actions">
        <button className="btn" onClick={onClose}>
          Cancel
        </button>
        <button
          className={`btn ${danger ? 'btn-danger' : 'btn-primary'}`}
          disabled={busy}
          autoFocus
          onClick={async () => {
            setBusy(true);
            try {
              await onConfirm();
              onClose();
            } finally {
              setBusy(false);
            }
          }}
        >
          {confirmLabel}
        </button>
      </div>
    </Dialog>
  );
}
