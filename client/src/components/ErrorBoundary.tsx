import { Component, type ErrorInfo, type ReactNode } from 'react';
import { TriangleAlert } from 'lucide-react';
import { Logo } from './ui';

interface ErrorBoundaryProps {
  /** The error is cleared when this changes (the current path), so navigating away recovers. */
  resetKey: string;
  children: ReactNode;
}

interface ErrorBoundaryState {
  error: Error | null;
}

/** Shows a recovery screen instead of a blank page when a page crashes or its code cannot be loaded. */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null };

  static getDerivedStateFromError(error: unknown): ErrorBoundaryState {
    return { error: error instanceof Error ? error : new Error(String(error)) };
  }

  componentDidCatch(error: unknown, info: ErrorInfo) {
    console.error('Page crashed:', error, info.componentStack);
  }

  componentDidUpdate(previous: ErrorBoundaryProps) {
    if (this.state.error && previous.resetKey !== this.props.resetKey) this.setState({ error: null });
  }

  render() {
    const { error } = this.state;
    if (!error) return this.props.children;
    // After a new release the previous build's code files are gone; reloading fetches the current ones.
    const outdated = /dynamically imported module|importing a module script failed/i.test(error.message);
    return (
      <main className="not-found" role="alert">
        <Logo size={48} />
        <TriangleAlert size={56} className="muted" />
        <h1>{outdated ? 'TitoDocs has been updated' : 'Something went wrong'}</h1>
        <p className="muted">
          {outdated ? 'Reload the page to load the latest version.' : 'This page ran into a problem. Reload it to continue.'}
        </p>
        <div className="dialog-actions">
          <a className="btn" href="/">
            Go to TitoDocs home
          </a>
          <button className="btn btn-primary" type="button" onClick={() => window.location.reload()}>
            Reload
          </button>
        </div>
      </main>
    );
  }
}
