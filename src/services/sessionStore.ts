import type {
  CullingStatus,
  DriveFolder,
  DriveMediaItem,
  EditConfig,
  LogoLayer,
  LogoSetPreset,
  StarRating,
} from '../types/media.ts';

const DB_NAME = 'cgm_studio_db';
const DB_VERSION = 1;
const STORE_KV = 'kv_store';

const KEY_SESSION = 'active_workspace_session_v2';
const KEY_LOGO_PRESETS = 'saved_logo_set_presets_v2';

export interface PersistedDriveSession {
  driveUrlInput: string;
  folders: DriveFolder[];
  items: Array<{
    id: string;
    name: string;
    folderId: string;
    folderName: string;
    mimeType: string;
    mediaType: 'image' | 'video';
    gridThumbUrl: string;
    previewUrl: string;
    downloadUrl: string;
    width: number;
    height: number;
    durationMillis?: number;
    status: CullingStatus;
    rating: StarRating;
    aiReason?: string;
    edit: EditConfig;
  }>;
  globalLogos: LogoLayer[];
  updatedAt: number;
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === 'undefined') {
      reject(new Error('IndexedDB unavailable'));
      return;
    }
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_KV)) {
        db.createObjectStore(STORE_KV);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function idbGet<T>(key: string): Promise<T | null> {
  try {
    const db = await openDb();
    return await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readonly');
      const req = tx.objectStore(STORE_KV).get(key);
      req.onsuccess = () => resolve((req.result as T) ?? null);
      req.onerror = () => reject(req.error);
    });
  } catch {
    return null;
  }
}

async function idbSet<T>(key: string, value: T): Promise<void> {
  try {
    const db = await openDb();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_KV, 'readwrite');
      tx.objectStore(STORE_KV).put(value, key);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
    });
  } catch {
    // Ignore storage quota errors gracefully
  }
}

export async function loadSavedSession(): Promise<PersistedDriveSession | null> {
  return idbGet<PersistedDriveSession>(KEY_SESSION);
}

export async function saveWorkspaceSession(params: {
  driveUrlInput: string;
  folders: DriveFolder[];
  items: DriveMediaItem[];
  globalLogos: LogoLayer[];
}): Promise<void> {
  // Only persist remote Drive items across reloads (local File ObjectURLs expire on tab close)
  const remoteItems = params.items.filter((i) => !i.isLocal);
  const remoteFolderIds = new Set(remoteItems.map((i) => i.folderId));
  const remoteFolders = params.folders.filter((f) => remoteFolderIds.has(f.id));

  const payload: PersistedDriveSession = {
    driveUrlInput: params.driveUrlInput,
    folders: remoteFolders,
    items: remoteItems.map(({ rawFile: _r, isLocal: _l, ...rest }) => rest),
    globalLogos: params.globalLogos,
    updatedAt: Date.now(),
  };

  await idbSet(KEY_SESSION, payload);
}

export async function clearSavedSessionItems(
  globalLogos: LogoLayer[]
): Promise<void> {
  await idbSet<PersistedDriveSession>(KEY_SESSION, {
    driveUrlInput: '',
    folders: [],
    items: [],
    globalLogos,
    updatedAt: Date.now(),
  });
}

export async function loadLogoPresets(): Promise<LogoSetPreset[]> {
  const list = await idbGet<LogoSetPreset[]>(KEY_LOGO_PRESETS);
  return Array.isArray(list) ? list : [];
}

export async function saveLogoPresets(
  presets: LogoSetPreset[]
): Promise<void> {
  await idbSet(KEY_LOGO_PRESETS, presets);
}
