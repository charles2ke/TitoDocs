import { useEffect, useState, type FormEvent, type ReactNode } from 'react';
import { Link } from 'react-router';
import { Cloud, CloudOff, Eye, LoaderCircle, Lock, LogOut, Monitor, Moon, Star, Sun, UserRound, Users } from 'lucide-react';
import { canEdit, type FileMeta } from '@shared/types';
import { api, errorMessage } from '../api';
import { useAuth, useUser } from '../auth';
import type { AwarenessUser, RoomStatus } from '../collab';
import { useTheme } from '../theme';
import { Dialog } from './Dialog';
import { Dropdown, separator } from './Menu';
import { ShareDialog } from './ShareDialog';
import { useToast } from './Toast';
import { Avatar, Logo, PresenceStack } from './ui';

export function UserMenu() {
  const user = useUser();
  const { logout } = useAuth();
  const { setting, setSetting } = useTheme();
  const [profileOpen, setProfileOpen] = useState(false);
  return (
    <>
      <Dropdown
        align="end"
        label="Account"
        trigger={(props) => (
          <button className="avatar-button" aria-label={`Account: ${user.displayName}`} {...props}>
            <Avatar user={{ name: user.displayName, color: user.color }} size={32} />
          </button>
        )}
        items={[
          { type: 'label', label: `${user.displayName} (@${user.username})` },
          { label: 'Profile & password…', icon: <UserRound size={16} />, onSelect: () => setProfileOpen(true) },
          separator,
          { label: 'Light theme', icon: <Sun size={16} />, checked: setting === 'light', onSelect: () => setSetting('light') },
          { label: 'Dark theme', icon: <Moon size={16} />, checked: setting === 'dark', onSelect: () => setSetting('dark') },
          { label: 'Use system theme', icon: <Monitor size={16} />, checked: setting === 'system', onSelect: () => setSetting('system') },
          separator,
          { label: 'Sign out', icon: <LogOut size={16} />, onSelect: () => void logout(), testId: 'sign-out' },
        ]}
      />
      {profileOpen && <ProfileDialog onClose={() => setProfileOpen(false)} />}
    </>
  );
}

function ProfileDialog({ onClose }: { onClose: () => void }) {
  const user = useUser();
  const { setUser } = useAuth();
  const toast = useToast();
  const [displayName, setDisplayName] = useState(user.displayName);
  const [color, setColor] = useState(user.color);
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [error, setError] = useState('');

  const saveProfile = async (event: FormEvent) => {
    event.preventDefault();
    try {
      setUser((await api.updateProfile({ displayName, color })).user);
      toast.show('Profile updated', { kind: 'success' });
      onClose();
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  const savePassword = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await api.changePassword(currentPassword, newPassword);
      toast.show('Password changed. Other devices were signed out.', { kind: 'success' });
      setCurrentPassword('');
      setNewPassword('');
    } catch (caught) {
      setError(errorMessage(caught));
    }
  };

  return (
    <Dialog title="Profile" onClose={onClose}>
      {error && <p className="form-error">{error}</p>}
      <form className="form" onSubmit={saveProfile}>
        <label className="field">
          <span>Display name</span>
          <input value={displayName} maxLength={64} onChange={(event) => setDisplayName(event.target.value)} required />
        </label>
        <label className="field field-inline">
          <span>Cursor colour</span>
          <input type="color" value={color} onChange={(event) => setColor(event.target.value)} />
        </label>
        <div className="dialog-actions">
          <button className="btn btn-primary" type="submit">
            Save profile
          </button>
        </div>
      </form>
      <hr />
      <form className="form" onSubmit={savePassword}>
        <h3 className="section-title">Change password</h3>
        <label className="field">
          <span>Current password</span>
          <input
            type="password"
            autoComplete="current-password"
            value={currentPassword}
            onChange={(event) => setCurrentPassword(event.target.value)}
            required
          />
        </label>
        <label className="field">
          <span>New password (at least 8 characters)</span>
          <input
            type="password"
            autoComplete="new-password"
            minLength={8}
            value={newPassword}
            onChange={(event) => setNewPassword(event.target.value)}
            required
          />
        </label>
        <div className="dialog-actions">
          <button className="btn" type="submit">
            Change password
          </button>
        </div>
      </form>
    </Dialog>
  );
}

export function SaveStatus({ status, readOnly }: { status: RoomStatus; readOnly: boolean }) {
  // Avoid flashing "Saving…" for every keystroke: only show it once changes stay pending briefly.
  const [showSaving, setShowSaving] = useState(false);
  useEffect(() => {
    if (!status.unsynced) {
      setShowSaving(false);
      return;
    }
    const timer = setTimeout(() => setShowSaving(true), 400);
    return () => clearTimeout(timer);
  }, [status.unsynced]);

  let content: ReactNode;
  if (status.denied) content = <><Lock size={14} /> No access</>;
  else if (status.status === 'disconnected')
    content = <><CloudOff size={14} /> Offline – changes will sync when you reconnect</>;
  else if (!status.synced) content = <><LoaderCircle size={14} className="spin" /> Connecting…</>;
  else if (readOnly) content = <><Eye size={14} /> View only</>;
  else if (showSaving) content = <><LoaderCircle size={14} className="spin" /> Saving…</>;
  else content = <><Cloud size={14} /> Saved</>;

  return (
    <span className="save-status" data-testid="save-status" role="status">
      {content}
    </span>
  );
}

interface TitleInputProps {
  title: string;
  editable: boolean;
  onRename: (title: string) => Promise<void> | void;
  className?: string;
}

/** A document title that renames the file when edited (like Google Docs). */
export function TitleInput({ title, editable, onRename, className = '' }: TitleInputProps) {
  const [value, setValue] = useState(title);
  useEffect(() => setValue(title), [title]);
  const commit = () => {
    const next = value.trim();
    if (!next) setValue(title);
    else if (next !== title) void onRename(next);
  };
  return (
    <input
      className={`title-input ${className}`}
      aria-label="File name"
      value={value}
      readOnly={!editable}
      size={Math.max(8, Math.min(value.length + 1, 48))}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') (event.target as HTMLInputElement).blur();
        if (event.key === 'Escape') {
          setValue(title);
          requestAnimationFrame(() => (event.target as HTMLInputElement).blur());
        }
      }}
    />
  );
}

export function StarButton({ file, onChange }: { file: FileMeta; onChange: (starred: boolean) => void }) {
  const toast = useToast();
  return (
    <button
      className={`icon-btn star-btn ${file.starred ? 'starred' : ''}`}
      aria-label={file.starred ? 'Remove star' : 'Star'}
      aria-pressed={file.starred}
      title={file.starred ? 'Starred' : 'Star'}
      onClick={async () => {
        try {
          onChange((await api.star(file.id, !file.starred)).starred);
        } catch (error) {
          toast.error(error);
        }
      }}
    >
      <Star size={18} />
    </button>
  );
}

interface AppHeaderProps {
  file: FileMeta;
  workspace?: FileMeta | null;
  status: RoomStatus;
  people: AwarenessUser[];
  onFileChange: (update: (file: FileMeta) => FileMeta) => void;
  menubar?: ReactNode;
  actions?: ReactNode;
  icon: ReactNode;
}

export function AppHeader({ file, workspace, status, people, onFileChange, menubar, actions, icon }: AppHeaderProps) {
  const toast = useToast();
  const [sharing, setSharing] = useState(false);
  const rename = async (title: string) => {
    try {
      const { file: updated } = await api.updateFile(file.id, { title });
      onFileChange((current) => ({ ...current, title: updated.title }));
    } catch (error) {
      toast.error(error);
    }
  };
  return (
    <header className="app-header">
      <Link to="/" className="header-logo" aria-label="TitoDocs home" title="TitoDocs home">
        <Logo size={34} />
      </Link>
      <div className="header-main">
        <div className="header-title-row">
          <span className="header-type-icon">{icon}</span>
          <TitleInput title={file.title} editable={canEdit(file.role) && !file.trashedAt} onRename={rename} />
          <StarButton file={file} onChange={(starred) => onFileChange((current) => ({ ...current, starred }))} />
          <SaveStatus status={status} readOnly={!canEdit(file.role)} />
        </div>
        {menubar}
      </div>
      <div className="header-actions">
        <PresenceStack people={people} />
        {actions}
        <button className="btn btn-primary share-btn" onClick={() => setSharing(true)}>
          {file.linkAccess === 'none' ? <Lock size={16} /> : <Users size={16} />} Share
        </button>
        <UserMenu />
      </div>
      {sharing && <ShareDialog file={file} workspace={workspace} onClose={() => setSharing(false)} />}
    </header>
  );
}
