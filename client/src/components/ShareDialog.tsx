import { useEffect, useState, type FormEvent } from 'react';
import { Globe, Link2, Lock, Trash2 } from 'lucide-react';
import { canEdit, type FileMeta, type LinkAccess, type MemberRole, type PublicUser, type SharingInfo } from '@shared/types';
import { api } from '../api';
import { useUser } from '../auth';
import { absoluteUrl, fileUrl, useDebounced } from '../lib/util';
import { Dialog } from './Dialog';
import { useToast } from './Toast';
import { Avatar, Spinner } from './ui';

const ROLE_LABELS: Record<MemberRole, string> = { viewer: 'Viewer', commenter: 'Commenter', editor: 'Editor' };

interface ShareDialogProps {
  file: FileMeta;
  /** For pages: the workspace whose permissions apply. */
  workspace?: FileMeta | null;
  onClose: () => void;
}

export function ShareDialog({ file, workspace, onClose }: ShareDialogProps) {
  const me = useUser();
  const toast = useToast();
  const [info, setInfo] = useState<SharingInfo | null>(null);
  const [username, setUsername] = useState('');
  const [role, setRole] = useState<MemberRole>('editor');
  const [suggestions, setSuggestions] = useState<PublicUser[]>([]);
  const debounced = useDebounced(username.trim(), 200);
  const manage = canEdit(file.role);

  useEffect(() => {
    api.sharing(file.id).then(setInfo, (error) => toast.error(error));
  }, [file.id, toast]);

  useEffect(() => {
    if (debounced.length < 2) {
      setSuggestions([]);
      return;
    }
    let cancelled = false;
    api.searchUsers(debounced).then(({ users }) => {
      if (!cancelled) setSuggestions(users.filter((user) => user.id !== me.id));
    });
    return () => {
      cancelled = true;
    };
  }, [debounced, me.id]);

  const run = async (action: () => Promise<SharingInfo>) => {
    try {
      setInfo(await action());
    } catch (error) {
      toast.error(error);
    }
  };

  const invite = async (event: FormEvent) => {
    event.preventDefault();
    const name = username.trim();
    if (!name) return;
    await run(() => api.addMember(file.id, name, role));
    setUsername('');
    setSuggestions([]);
  };

  const copyLink = async () => {
    await navigator.clipboard.writeText(absoluteUrl(fileUrl(file)));
    toast.show('Link copied', { kind: 'success' });
  };

  const linkMode: 'restricted' | 'anyone' = info?.linkAccess === 'none' ? 'restricted' : 'anyone';

  return (
    <Dialog title={`Share “${file.title}”`} onClose={onClose} className="share-dialog">
      {file.type === 'page' && workspace && (
        <p className="hint">
          Pages use the sharing settings of the workspace <strong>{workspace.title}</strong>.
        </p>
      )}
      {manage && (
        <form className="share-invite" onSubmit={invite}>
          <div className="autocomplete">
            <input
              aria-label="Add people by username"
              placeholder="Add people by username"
              value={username}
              onChange={(event) => setUsername(event.target.value)}
              autoFocus
            />
            {suggestions.length > 0 && (
              <ul className="autocomplete-list" role="listbox">
                {suggestions.map((user) => (
                  <li key={user.id}>
                    <button
                      type="button"
                      role="option"
                      aria-selected={false}
                      onClick={() => {
                        setUsername(user.username);
                        setSuggestions([]);
                      }}
                    >
                      <Avatar user={{ name: user.displayName, color: user.color }} size={24} />
                      <span>
                        {user.displayName} <span className="muted">@{user.username}</span>
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>
          <select aria-label="Role for new people" value={role} onChange={(event) => setRole(event.target.value as MemberRole)}>
            {Object.entries(ROLE_LABELS).map(([value, label]) => (
              <option key={value} value={value}>
                {label}
              </option>
            ))}
          </select>
          <button className="btn btn-primary" type="submit" disabled={!username.trim()}>
            Share
          </button>
        </form>
      )}

      {!info ? (
        <Spinner />
      ) : (
        <>
          <h3 className="section-title">People with access</h3>
          <ul className="member-list">
            <li>
              <Avatar user={{ name: info.owner.displayName, color: info.owner.color }} />
              <div className="member-name">
                {info.owner.displayName}
                {info.owner.id === me.id && ' (you)'}
                <span className="muted">@{info.owner.username}</span>
              </div>
              <span className="muted">Owner</span>
            </li>
            {info.members.map(({ user, role: memberRole }) => (
              <li key={user.id}>
                <Avatar user={{ name: user.displayName, color: user.color }} />
                <div className="member-name">
                  {user.displayName}
                  {user.id === me.id && ' (you)'}
                  <span className="muted">@{user.username}</span>
                </div>
                {manage ? (
                  <select
                    aria-label={`Role for ${user.displayName}`}
                    value={memberRole}
                    onChange={(event) => run(() => api.updateMember(file.id, user.id, event.target.value as MemberRole))}
                  >
                    {Object.entries(ROLE_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>
                        {label}
                      </option>
                    ))}
                  </select>
                ) : (
                  <span className="muted">{ROLE_LABELS[memberRole]}</span>
                )}
                {(manage || user.id === me.id) && (
                  <button
                    className="icon-btn"
                    aria-label={user.id === me.id ? 'Remove my access' : `Remove ${user.displayName}`}
                    title={user.id === me.id ? 'Remove my access' : 'Remove access'}
                    onClick={() => run(() => api.removeMember(file.id, user.id))}
                  >
                    <Trash2 size={16} />
                  </button>
                )}
              </li>
            ))}
          </ul>

          <h3 className="section-title">General access</h3>
          <div className="general-access">
            <span className="access-icon">{linkMode === 'restricted' ? <Lock size={18} /> : <Globe size={18} />}</span>
            <div className="access-controls">
              <select
                aria-label="General access"
                disabled={!manage}
                value={linkMode}
                onChange={(event) =>
                  run(() => api.setLinkAccess(file.id, event.target.value === 'restricted' ? 'none' : 'view'))
                }
              >
                <option value="restricted">Restricted</option>
                <option value="anyone">Anyone with the link</option>
              </select>
              <span className="muted">
                {linkMode === 'restricted'
                  ? 'Only people with access can open it'
                  : 'Anyone signed in to TitoDocs with the link can open it'}
              </span>
            </div>
            {linkMode === 'anyone' && (
              <select
                aria-label="Link role"
                disabled={!manage}
                value={info.linkAccess}
                onChange={(event) => run(() => api.setLinkAccess(file.id, event.target.value as LinkAccess))}
              >
                <option value="view">Viewer</option>
                <option value="comment">Commenter</option>
                <option value="edit">Editor</option>
              </select>
            )}
          </div>
        </>
      )}

      <div className="dialog-actions">
        <button className="btn" onClick={copyLink}>
          <Link2 size={16} /> Copy link
        </button>
        <button className="btn btn-primary" onClick={onClose}>
          Done
        </button>
      </div>
    </Dialog>
  );
}
