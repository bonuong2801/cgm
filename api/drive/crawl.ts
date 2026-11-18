import {
  ApiHttpError,
  isServerSupabaseConfigured,
  verifyRequestUser,
} from '../_lib/supabaseAdmin.ts';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';
const VALID_DRIVE_ID = /^[-\w]{15,120}$/;
const MAX_CRAWL_DEPTH = 5;
const FOLDER_CONCURRENCY = 5;
const CACHE_TTL_MS = 60_000;

interface RawDriveFile {
  id: string;
  name: string;
  mimeType: string;
  thumbnailLink?: string;
  imageMediaMetadata?: {
    width?: number;
    height?: number;
  };
  videoMediaMetadata?: {
    width?: number;
    height?: number;
    durationMillis?: string | number;
  };
}

export interface CrawledFolderDTO {
  id: string;
  name: string;
  isRoot?: boolean;
}

export interface CrawledMediaDTO {
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
}

export interface CrawlApiResponse {
  rootFolderId: string;
  folders: CrawledFolderDTO[];
  items: CrawledMediaDTO[];
}

// ponytail: in-memory TTL cache per isolate; move to Edge Cache / KV only if multi-region hit rate matters
const crawlCache = new Map<
  string,
  { expiresAt: number; payload: CrawlApiResponse }
>();

function getServerDriveApiKey(): string {
  const candidates = [
    process.env.GOOGLE_API_KEY,
    process.env.VITE_GOOGLE_API_KEY,
  ];
  for (const raw of candidates) {
    const trimmed = raw?.trim();
    if (
      trimmed &&
      trimmed !== 'your_google_drive_api_key_here' &&
      trimmed !== 'MY_GOOGLE_API_KEY'
    ) {
      return trimmed;
    }
  }
  return '';
}

function buildThumbnailUrls(
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

async function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function fetchDrivePageWithRetry(
  url: string,
  maxAttempts = 3
): Promise<Response> {
  let lastRes: Response | null = null;
  for (let attempt = 0; attempt < maxAttempts; attempt++) {
    const res = await fetch(url);
    if (res.ok) return res;
    lastRes = res;

    // Retry on transient 429 or 5xx
    if (res.status === 429 || res.status >= 500) {
      await sleep(300 * Math.pow(2, attempt));
      continue;
    }
    if (res.status === 403) {
      const cloned = res.clone();
      try {
        const errBody = await cloned.json();
        const reason = JSON.stringify(errBody?.error || '').toLowerCase();
        if (reason.includes('ratelimit') || reason.includes('userratelimit')) {
          await sleep(400 * Math.pow(2, attempt));
          continue;
        }
      } catch {
        // non-json error
      }
    }
    break;
  }
  return lastRes!;
}

/**
 * Fetches ALL children inside a Drive folder, following every `nextPageToken` page.
 */
async function fetchAllFolderChildren(
  parentId: string,
  apiKey: string
): Promise<RawDriveFile[]> {
  const allFiles: RawDriveFile[] = [];
  let pageToken: string | undefined = undefined;

  const query = `'${parentId}' in parents and trashed = false`;
  const fields =
    'nextPageToken,files(id,name,mimeType,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))';

  do {
    const params = new URLSearchParams({
      q: query,
      pageSize: '1000',
      orderBy: 'name',
      fields,
      includeItemsFromAllDrives: 'true',
      supportsAllDrives: 'true',
      key: apiKey,
    });
    if (pageToken) {
      params.set('pageToken', pageToken);
    }

    const res = await fetchDrivePageWithRetry(
      `${DRIVE_API_BASE}?${params.toString()}`
    );

    if (!res.ok) {
      let errorDetail = '';
      try {
        const errJson = await res.json();
        errorDetail = errJson?.error?.message || '';
      } catch {
        // ignore
      }

      if (res.status === 401 || res.status === 403) {
        if (errorDetail.toLowerCase().includes('quota')) {
          throw new Error(
            'Thư mục Google Drive đang có quá nhiều lượt tải cùng lúc. Vui lòng đợi ít phút rồi thử lại.'
          );
        }
        throw new Error(
          "Không thể mở thư mục này. Vui lòng kiểm tra thư mục Google Drive đã bật quyền chia sẻ công khai 'Bất kỳ ai có đường liên kết đều có thể xem'."
        );
      }
      if (res.status === 404) {
        throw new Error(
          "Không tìm thấy thư mục Google Drive. Đường dẫn không tồn tại hoặc chưa bật chia sẻ 'Bất kỳ ai có đường liên kết đều có thể xem'."
        );
      }
      throw new Error(
        'Không thể kết nối tới Google Drive lúc này. Vui lòng kiểm tra lại đường dẫn và thử lại.'
      );
    }

    const data = (await res.json()) as {
      nextPageToken?: string;
      files?: RawDriveFile[];
    };
    if (data.files && data.files.length > 0) {
      allFiles.push(...data.files);
    }
    pageToken = data.nextPageToken;
  } while (pageToken);

  return allFiles;
}

function mapRawToDto(
  raw: RawDriveFile,
  folderId: string,
  folderName: string
): CrawledMediaDTO | null {
  const isImage = raw.mimeType.startsWith('image/');
  const isVideo = raw.mimeType.startsWith('video/');
  if (!isImage && !isVideo) return null;

  const { gridThumbUrl, previewUrl } = buildThumbnailUrls(
    raw.id,
    raw.thumbnailLink
  );
  const width =
    raw.imageMediaMetadata?.width || raw.videoMediaMetadata?.width || 1600;
  const height =
    raw.imageMediaMetadata?.height || raw.videoMediaMetadata?.height || 1067;
  const durationRaw = raw.videoMediaMetadata?.durationMillis;

  return {
    id: raw.id,
    name: raw.name,
    folderId,
    folderName,
    mimeType: raw.mimeType,
    mediaType: isVideo ? 'video' : 'image',
    gridThumbUrl,
    previewUrl,
    downloadUrl: `/api/drive/stream?id=${encodeURIComponent(raw.id)}`,
    width,
    height,
    durationMillis: durationRaw !== undefined ? Number(durationRaw) : undefined,
  };
}

function jsonResponse(body: unknown, status = 200, extraHeaders?: Record<string, string>): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      'Content-Type': 'application/json; charset=utf-8',
      ...extraHeaders,
    },
  });
}

export async function GET(request: Request): Promise<Response> {
  const url = new URL(request.url);
  const folderId = (url.searchParams.get('folderId') || '').trim();

  if (!VALID_DRIVE_ID.test(folderId)) {
    return jsonResponse(
      { error: 'Mã thư mục Google Drive không hợp lệ.' },
      400
    );
  }

  if (isServerSupabaseConfigured()) {
    try {
      await verifyRequestUser(request);
    } catch (err: any) {
      const status = err instanceof ApiHttpError ? err.status : 401;
      return jsonResponse(
        { error: err?.message || 'Vui lòng đăng nhập tài khoản.' },
        status
      );
    }
  }

  const apiKey = getServerDriveApiKey();
  if (!apiKey) {
    return jsonResponse(
      {
        error:
          'Tính năng tải trực tiếp từ Google Drive hiện đang tạm bảo trì. Vui lòng tải ảnh từ máy tính hoặc thử lại sau ít phút.',
        code: 'MISSING_API_KEY',
      },
      503
    );
  }

  const now = Date.now();
  const cached = crawlCache.get(folderId);
  if (cached && cached.expiresAt > now) {
    return jsonResponse(cached.payload, 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      'X-Crawl-Cache': 'HIT',
    });
  }

  try {
    const folders: CrawledFolderDTO[] = [];
    const items: CrawledMediaDTO[] = [];
    const visitedIds = new Set<string>([folderId]);

    interface QueueNode {
      id: string;
      displayName: string;
      depth: number;
      isRoot: boolean;
    }

    let currentLevel: QueueNode[] = [
      { id: folderId, displayName: 'Thư mục gốc', depth: 0, isRoot: true },
    ];

    while (currentLevel.length > 0) {
      const nextLevel: QueueNode[] = [];
      let cursor = 0;

      const worker = async () => {
        while (cursor < currentLevel.length) {
          const node = currentLevel[cursor++];
          if (!node) break;

          const children = await fetchAllFolderChildren(node.id, apiKey);
          const subFolders = children.filter((c) => c.mimeType === FOLDER_MIME);
          const mediaFiles = children.filter(
            (c) =>
              c.mimeType.startsWith('image/') || c.mimeType.startsWith('video/')
          );

          if (mediaFiles.length > 0) {
            folders.push({
              id: node.id,
              name: node.displayName,
              isRoot: node.isRoot || undefined,
            });
            for (const raw of mediaFiles) {
              const dto = mapRawToDto(raw, node.id, node.displayName);
              if (dto) items.push(dto);
            }
          }

          if (node.depth < MAX_CRAWL_DEPTH) {
            for (const sub of subFolders) {
              if (visitedIds.has(sub.id)) continue;
              visitedIds.add(sub.id);
              const subDisplayName = node.isRoot
                ? sub.name
                : `${node.displayName}/${sub.name}`;
              nextLevel.push({
                id: sub.id,
                displayName: subDisplayName,
                depth: node.depth + 1,
                isRoot: false,
              });
            }
          }
        }
      };

      await Promise.all(
        Array.from(
          { length: Math.min(FOLDER_CONCURRENCY, currentLevel.length) },
          () => worker()
        )
      );

      nextLevel.sort((a, b) => a.displayName.localeCompare(b.displayName, 'vi'));
      currentLevel = nextLevel;
    }

    // Ensure stable folder ordering (root first, then alphabetical)
    folders.sort((a, b) => {
      if (a.isRoot && !b.isRoot) return -1;
      if (!a.isRoot && b.isRoot) return 1;
      return a.name.localeCompare(b.name, 'vi');
    });

    if (items.length === 0) {
      return jsonResponse(
        {
          error:
            "Không tìm thấy file Ảnh hoặc Video nào trong thư mục này (đã quét đệ quy các thư mục con). Hãy kiểm tra quyền chia sẻ công khai 'Bất kỳ ai có đường liên kết đều có thể xem'.",
        },
        404
      );
    }

    const payload: CrawlApiResponse = {
      rootFolderId: folderId,
      folders,
      items,
    };

    if (crawlCache.size > 100) {
      const oldestKey = crawlCache.keys().next().value;
      if (oldestKey) crawlCache.delete(oldestKey);
    }
    crawlCache.set(folderId, { expiresAt: now + CACHE_TTL_MS, payload });

    return jsonResponse(payload, 200, {
      'Cache-Control': 'public, s-maxage=60, stale-while-revalidate=300',
      'X-Crawl-Cache': 'MISS',
    });
  } catch (err: any) {
    return jsonResponse(
      {
        error:
          err?.message || 'Lỗi không xác định khi quét thư mục Google Drive.',
      },
      502
    );
  }
}

export default { fetch: GET };
