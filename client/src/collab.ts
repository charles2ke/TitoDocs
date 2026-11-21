import { HocuspocusProvider, HocuspocusProviderWebsocket, WebSocketStatus } from '@hocuspocus/provider';
import { useEffect, useState } from 'react';
import * as Y from 'yjs';
import type { PublicUser, StatelessMessage } from '@shared/types';

/** One collaboration document (`<fileId>` or `<fileId>:comments`) shared by every view that uses it. */
export interface Room {
  name: string;
  doc: Y.Doc;
  provider: HocuspocusProvider;
}

export interface AwarenessUser {
  id: string;
  name: string;
  color: string;
  colorLight: string;
}

interface Entry extends Room {
  refs: number;
  releaseTimer?: ReturnType<typeof setTimeout>;
  /** The server closed this document, or refused access to it, while the socket stayed open. */
  dropped?: boolean;
}

let socket: HocuspocusProviderWebsocket | null = null;
let localUser: AwarenessUser | null = null;
const rooms = new Map<string, Entry>();

const getSocket = (): HocuspocusProviderWebsocket =>
  (socket ??= new HocuspocusProviderWebsocket({
    url: `${location.protocol === 'https:' ? 'wss' : 'ws'}://${location.host}/collab`,
  }));

export const toAwarenessUser = (user: PublicUser): AwarenessUser => ({
  id: user.id,
  name: user.displayName,
  color: user.color,
  colorLight: `${user.color}33`,
});

export function setCollabUser(user: PublicUser | null): void {
  localUser = user && toAwarenessUser(user);
  for (const room of rooms.values()) room.provider.setAwarenessField('user', localUser);
}

/**
 * Stops using a document the server dropped. The provider leaves without the close message that `detach` would send:
 * the server queues messages for documents the socket has no connection to, and would replay that one against the
 * next connection to the document, closing it at once.
 */
function drop(entry: Entry): void {
  if (entry.dropped) return;
  entry.dropped = true;
  const { providerMap } = getSocket().configuration;
  if (providerMap.get(entry.provider.effectiveName) === entry.provider) providerMap.delete(entry.provider.effectiveName);
  entry.provider.detach();
}

/**
 * Joins a room, reusing the existing connection when another view already has it open
 * (e.g. the same Loop component embedded twice). Rooms are released after a short delay
 * so quick remounts do not reconnect.
 */
export function acquireRoom(name: string): { room: Room; release: () => void } {
  let entry = rooms.get(name);
  if (!entry) {
    const doc = new Y.Doc();
    const provider = new HocuspocusProvider({ websocketProvider: getSocket(), name, document: doc });
    const created: Entry = { name, doc, provider, refs: 0 };
    // A close while the socket stays open means the server dropped just this document (access lost, file deleted).
    provider.on('close', () => {
      if (getSocket().status === WebSocketStatus.Connected) drop(created);
    });
    provider.on('authenticationFailed', () => drop(created));
    provider.attach();
    if (localUser) provider.setAwarenessField('user', localUser);
    entry = created;
    rooms.set(name, entry);
  } else if (entry.dropped) {
    // Ask again: access may be back (e.g. the file was restored or shared again).
    entry.dropped = false;
    entry.provider.attach();
  }
  const current = entry;
  clearTimeout(current.releaseTimer);
  current.refs += 1;
  let released = false;
  return {
    room: current,
    release() {
      if (released) return;
      released = true;
      current.refs -= 1;
      if (current.refs > 0) return;
      current.releaseTimer = setTimeout(() => {
        if (current.refs > 0) return;
        rooms.delete(name);
        current.provider.destroy();
        current.doc.destroy();
      }, 2000);
    },
  };
}

export function useRoom(name: string | null): Room | null {
  const [room, setRoom] = useState<Room | null>(null);
  useEffect(() => {
    if (!name) return;
    const { room: acquired, release } = acquireRoom(name);
    setRoom(acquired);
    return () => {
      release();
      setRoom(null);
    };
  }, [name]);
  return room && room.name === name ? room : null;
}

export type ConnectionStatus = 'connecting' | 'connected' | 'disconnected';

export interface RoomStatus {
  synced: boolean;
  status: ConnectionStatus;
  /** Local changes not yet acknowledged by the server. */
  unsynced: boolean;
  /** Set when the server refused access to the document. */
  denied: string | null;
}

export function useRoomStatus(room: Room | null): RoomStatus {
  const read = (): RoomStatus => ({
    synced: !!room?.provider.isSynced,
    status: (room?.provider.configuration.websocketProvider.status as ConnectionStatus | undefined) ?? 'connecting',
    unsynced: !!room?.provider.hasUnsyncedChanges,
    denied: null,
  });
  const [state, setState] = useState<RoomStatus>(read);

  useEffect(() => {
    if (!room) return;
    const { provider } = room;
    setState(read());
    const update = (patch: Partial<RoomStatus>) => setState((previous) => ({ ...previous, ...patch }));
    const onSynced = ({ state: synced }: { state: boolean }) => update({ synced });
    const onStatus = ({ status }: { status: ConnectionStatus }) => update({ status });
    const onUnsynced = () => update({ unsynced: provider.hasUnsyncedChanges });
    const onDenied = ({ reason }: { reason: string }) => update({ denied: reason || 'forbidden' });
    provider.on('synced', onSynced);
    provider.on('status', onStatus);
    provider.on('unsyncedChanges', onUnsynced);
    provider.on('authenticationFailed', onDenied);
    return () => {
      provider.off('synced', onSynced);
      provider.off('status', onStatus);
      provider.off('unsyncedChanges', onUnsynced);
      provider.off('authenticationFailed', onDenied);
    };
  }, [room]);

  return state;
}

/** Calls `handler` for each server notification (`meta`, `tree`, `deleted`) sent over a room. */
export function useStateless(room: Room | null, handler: (message: StatelessMessage) => void): void {
  useEffect(() => {
    if (!room) return;
    const listener = ({ payload }: { payload: string }) => {
      try {
        handler(JSON.parse(payload) as StatelessMessage);
      } catch {
        // Ignore malformed messages.
      }
    };
    room.provider.on('stateless', listener);
    return () => {
      room.provider.off('stateless', listener);
    };
  }, [room, handler]);
}

/** Distinct people currently connected to a room (one entry per user, even with several tabs). */
export function usePresence(room: Room | null): AwarenessUser[] {
  const [people, setPeople] = useState<AwarenessUser[]>([]);
  useEffect(() => {
    const awareness = room?.provider.awareness;
    if (!awareness) return;
    const update = () => {
      const seen = new Map<string, AwarenessUser>();
      for (const [clientId, state] of awareness.getStates()) {
        const user = (state as { user?: AwarenessUser }).user;
        if (!user?.id || clientId === awareness.clientID || user.id === localUser?.id || seen.has(user.id)) continue;
        seen.set(user.id, user);
      }
      setPeople([...seen.values()]);
    };
    update();
    awareness.on('change', update);
    return () => awareness.off('change', update);
  }, [room]);
  return people;
}

/** Resolves once the room has loaded its content from the server. */
export function whenSynced(room: Room): Promise<void> {
  if (room.provider.isSynced) return Promise.resolve();
  return new Promise((resolve) => {
    const onSynced = ({ state }: { state: boolean }) => {
      if (!state) return;
      room.provider.off('synced', onSynced);
      resolve();
    };
    room.provider.on('synced', onSynced);
  });
}
