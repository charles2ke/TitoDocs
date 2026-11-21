import { useEffect, useState, type FormEvent } from 'react';
import { Link, Navigate, useNavigate, useSearchParams } from 'react-router';
import { api, errorMessage } from '../api';
import { useAuth } from '../auth';
import { Logo } from '../components/ui';

export function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { user, setUser } = useAuth();
  const navigate = useNavigate();
  const [params] = useSearchParams();
  const [username, setUsername] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [allowRegistration, setAllowRegistration] = useState(true);

  useEffect(() => {
    api.config().then((config) => setAllowRegistration(config.allowRegistration), () => undefined);
  }, []);

  const next = params.get('next');
  // Only allow same-site relative redirects.
  const destination = next && next.startsWith('/') && !next.startsWith('//') ? next : '/';
  if (user) return <Navigate to={destination} replace />;

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result =
        mode === 'login'
          ? await api.login(username, password)
          : await api.register(username, password, displayName.trim() || username);
      setUser(result.user);
      navigate(destination, { replace: true });
    } catch (caught) {
      setError(errorMessage(caught));
    } finally {
      setBusy(false);
    }
  };

  const otherLink = `${mode === 'login' ? '/register' : '/login'}${next ? `?next=${encodeURIComponent(next)}` : ''}`;

  return (
    <main className="auth-page">
      <form className="auth-card" onSubmit={submit}>
        <div className="auth-brand">
          <Logo size={44} />
          <span>TitoDocs</span>
        </div>
        <h1>{mode === 'login' ? 'Sign in' : 'Create your account'}</h1>
        <p className="muted">Documents, code and Loop-style workspaces – together, in real time.</p>
        {error && (
          <p className="form-error" role="alert">
            {error}
          </p>
        )}
        <label className="field">
          <span>Username</span>
          <input
            name="username"
            autoComplete="username"
            value={username}
            onChange={(event) => setUsername(event.target.value)}
            required
            minLength={mode === 'register' ? 3 : 1}
            maxLength={32}
            autoFocus
          />
        </label>
        {mode === 'register' && (
          <label className="field">
            <span>Display name</span>
            <input
              name="displayName"
              autoComplete="name"
              value={displayName}
              onChange={(event) => setDisplayName(event.target.value)}
              maxLength={64}
              placeholder="How others see you"
            />
          </label>
        )}
        <label className="field">
          <span>Password</span>
          <input
            name="password"
            type="password"
            autoComplete={mode === 'login' ? 'current-password' : 'new-password'}
            value={password}
            onChange={(event) => setPassword(event.target.value)}
            required
            minLength={mode === 'register' ? 8 : 1}
          />
        </label>
        <button className="btn btn-primary btn-block" type="submit" disabled={busy}>
          {mode === 'login' ? 'Sign in' : 'Create account'}
        </button>
        {(mode === 'register' || allowRegistration) && (
          <p className="auth-switch">
            {mode === 'login' ? 'New to TitoDocs?' : 'Already have an account?'}{' '}
            <Link to={otherLink}>{mode === 'login' ? 'Create an account' : 'Sign in'}</Link>
          </p>
        )}
      </form>
    </main>
  );
}
