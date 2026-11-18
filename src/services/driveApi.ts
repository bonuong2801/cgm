import {
  DEFAULT_EDIT_CONFIG,
  type DriveFolder,
  type DriveMediaItem,
  type LogoLayer,
  cloneLogoLayers,
} from '../types/media.ts';
import { getAuthHeaders } from '../lib/supabaseClient.ts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  imageMediaMetadata?: { width?: number; height?: number };
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string | number;
  };
}

/**
 * Extracts a Google Drive Folder ID from any standard share URL or ID string.
 */
export function extractDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const folderPathMatch = trimmed.match(/\/folders\/([-\w]{15,})/);
  if (folderPathMatch?.[1]) return folderPathMatch[1];

  const idParamMatch = trimmed.match(/[?&]id=([-\w]{15,})/);
  if (idParamMatch?.[1]) return idParamMatch[1];

  const genericMatch = trimmed.match(/^[-\w]{15,}$/);
  return genericMatch ? genericMatch[0] : null;
}

export function buildOptimizedThumbnailUrls(
  fileId: string,
  thumbnailLink?: string
): { gridThumbUrl: string; previewUrl: string } {
  if (thumbnailLink) {
    if (/=s\d+/.test(thumbnailLink)) {
      return {
        gridThumbUrl: thumbnailLink.replace(/=s\d+.*$/, '=s480'),
        previewUrl: thumbnailLink.replace(/=s\d+.*$/, '=s2400'),
      };
    }
    return {
      gridThumbUrl: `${thumbnailLink}=s480`,
      previewUrl: `${thumbnailLink}=s2400`,
    };
  }

  return {
    gridThumbUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w480`,
    previewUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w2400`,
  };
}

function getFallbackClientDriveApiKey(): string {
  const envKey = (import.meta as any).env?.VITE_GOOGLE_API_KEY;
  if (
    envKey &&
    typeof envKey === 'string' &&
    envKey.trim() !== '' &&
    envKey !== 'your_google_drive_api_key_here'
  ) {
    return envKey.trim();
  }
  return '';
}

async function fetchAllFolderChildrenDirect(
  parentId: string,
  apiKey: string
): Promise<RawDriveFile[]> {
  const all: RawDriveFile[] = [];
  let pageToken: string | undefined;

  do {
    const params = new URLSearchParams({
      q: `'${parentId}' in parents and trashed = false`,
      pageSize: '1000',
      orderBy: 'name',
      fields:
        'nextPageToken,files(id,name,mimeType,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))',
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      key: apiKey,
    });
    if (pageToken) params.set('pageToken', pageToken);

    const response = await fetch(`${DRIVE_API_BASE}?${params.toString()}`);
    if (!response.ok) {
      throw new Error(
        response.status === 404
          ? "Không tìm thấy thư mục Google Drive hoặc thư mục chưa bật 'Bất kỳ ai có đường liên kết đều có thể xem'."
          : 'Không thể tải dữ liệu từ Google Drive lúc này. Vui lòng thử lại sau.'
      );
    }
    const data = (await response.json()) as {
      nextPageToken?: string;
      files?: RawDriveFile[];
    };
    if (data.files) all.push(...data.files);
    pageToken = data.nextPageToken;
  } while (pageToken);

  return all;
}

export interface CrawlDriveResult {
  rootFolderId: string;
  folders: DriveFolder[];
  items: DriveMediaItem[];
}

/**
 * Primary path: Securely crawls via `/api/drive/crawl` (server-side hidden GOOGLE_API_KEY,
 * full nextPageToken pagination, recursive multi-level folder crawl, stream proxy URLs).
 * Fallback path: Direct paginated recursive crawl if running static-only with VITE_GOOGLE_API_KEY.
 */
export async function crawlGoogleDriveFolder(
  urlOrId: string,
  initialLogos: LogoLayer[] = [],
  onStatusUpdate?: (message: string) => void
): Promise<CrawlDriveResult> {
  const rootFolderId = extractDriveFolderId(urlOrId);
  if (!rootFolderId) {
    throw new Error(
      'Đường dẫn Google Drive không hợp lệ. Vui lòng dán link thư mục Google Drive hợp lệ (ví dụ: https://drive.google.com/drive/folders/...).'
    );
  }

  onStatusUpdate?.(
    'Đang quét đệ quy toàn bộ cấu trúc thư mục & phân trang từ Google Drive...'
  );

  try {
    const res = await fetch(
      `/api/drive/crawl?folderId=${encodeURIComponent(rootFolderId)}`,
      { headers: getAuthHeaders() }
    );
    const contentType = res.headers.get('content-type') || '';

    if (contentType.includes('application/json')) {
      const payload = await res.json();
      if (res.ok && payload?.items) {
        const items: DriveMediaItem[] = payload.items.map((dto: any) => ({
          ...dto,
          status: 'kept',
          rating: 0,
          edit: {
            ...DEFAULT_EDIT_CONFIG,
            logos:
              dto.mediaType === 'image' ? cloneLogoLayers(initialLogos) : [],
          },
        }));
        return {
          rootFolderId: payload.rootFolderId,
          folders: payload.folders,
          items,
        };
      }

      // Only fall back to client key if server specifically lacks GOOGLE_API_KEY
      if (payload?.code !== 'MISSING_API_KEY') {
        throw new Error(
          payload?.error || 'Không thể tải dữ liệu từ Google Drive.'
        );
      }
    }
  } catch (err: any) {
    // Re-throw real Drive errors from /api
    if (
      err?.message &&
      !err.message.includes('Failed to fetch') &&
      !err.message.includes('NetworkError')
    ) {
      throw err;
    }
  }

  // Static-only fallback if VITE_GOOGLE_API_KEY is present in client build
  const fallbackKey = getFallbackClientDriveApiKey();
  if (!fallbackKey) {
    throw new Error(
      'Tính năng tải trực tiếp từ Google Drive hiện đang tạm bảo trì. Vui lòng tải ảnh từ máy tính hoặc thử lại sau ít phút.'
    );
  }

  const folders: DriveFolder[] = [];
  const items: DriveMediaItem[] = [];
  let queue: Array<{ id: string; name: string; depth: number; isRoot: boolean }> =
    [{ id: rootFolderId, name: 'Thư mục gốc', depth: 0, isRoot: true }];

  while (queue.length > 0) {
    const nextQueue: typeof queue = [];
    const batchResults = await Promise.all(
      queue.slice(0, 5).map(async (node) => ({
        node,
        children: await fetchAllFolderChildrenDirect(node.id, fallbackKey),
      }))
    );
    queue = queue.slice(5);

    for (const { node, children } of batchResults) {
      const mediaRaw = children.filter(
        (f) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
      );
      const subFolders = children.filter((f) => f.mimeType === FOLDER_MIME);

      if (mediaRaw.length > 0) {
        folders.push({
          id: node.id,
          name: node.name,
          isRoot: node.isRoot || undefined,
        });
        for (const raw of mediaRaw) {
          const isVideo = raw.mimeType.startsWith('video/');
          const { gridThumbUrl, previewUrl } = buildOptimizedThumbnailUrls(
            raw.id,
            raw.thumbnailLink
          );
          items.push({
            id: raw.id,
            name: raw.name,
            folderId: node.id,
            folderName: node.name,
            mimeType: raw.mimeType,
            mediaType: isVideo ? 'video' : 'image',
            gridThumbUrl,
            previewUrl,
            downloadUrl: `${DRIVE_API_BASE}/${raw.id}?alt=media&acknowledgeAbuse=true&key=${encodeURIComponent(
              fallbackKey
            )}`,
            width:
              raw.imageMediaMetadata?.width ||
              raw.videoMediaMetadata?.width ||
              1600,
            height:
              raw.imageMediaMetadata?.height ||
              raw.videoMediaMetadata?.height ||
              1067,
            durationMillis:
              raw.videoMediaMetadata?.durationMillis !== undefined
                ? Number(raw.videoMediaMetadata.durationMillis)
                : undefined,
            status: 'kept',
            rating: 0,
            edit: {
              ...DEFAULT_EDIT_CONFIG,
              logos: isVideo ? [] : cloneLogoLayers(initialLogos),
            },
          });
        }
      }

      if (node.depth < 5) {
        for (const sub of subFolders) {
          nextQueue.push({
            id: sub.id,
            name: node.isRoot ? sub.name : `${node.name}/${sub.name}`,
            depth: node.depth + 1,
            isRoot: false,
          });
        }
      }
    }
    queue.push(...nextQueue);
  }

  if (items.length === 0) {
    throw new Error(
      "Không tìm thấy file Ảnh hoặc Video nào trong thư mục này. Hãy kiểm tra quyền chia sẻ 'Bất kỳ ai có đường liên kết đều có thể xem'."
    );
  }

  return { rootFolderId, folders, items };
}
