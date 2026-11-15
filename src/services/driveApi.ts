import {
  DEFAULT_EDIT_CONFIG,
  DriveFolder,
  DriveMediaItem,
} from '../types/media';

const DRIVE_API_BASE = 'https://www.googleapis.com/drive/v3/files';
const FOLDER_MIME = 'application/vnd.google-apps.folder';

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

/**
 * Extracts a Google Drive Folder or File ID using regex /[-\w]{25,}/
 * Supports URLs like:
 * - https://drive.google.com/drive/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p?usp=sharing
 * - https://drive.google.com/drive/u/0/folders/1a2b3c4d5e6f7g8h9i0j1k2l3m4n5o6p
 * - Or direct folder ID string
 */
export function extractDriveFolderId(input: string): string | null {
  const trimmed = input.trim();
  if (!trimmed) return null;

  const folderPathMatch = trimmed.match(/\/folders\/([-\w]{25,})/);
  if (folderPathMatch && folderPathMatch[1]) {
    return folderPathMatch[1];
  }

  const idParamMatch = trimmed.match(/[?&]id=([-\w]{25,})/);
  if (idParamMatch && idParamMatch[1]) {
    return idParamMatch[1];
  }

  const genericMatch = trimmed.match(/[-\w]{25,}/);
  return genericMatch ? genericMatch[0] : null;
}

/**
 * Optimizes Google Drive thumbnailLink resolution:
 * - gridThumbUrl: =s400 for 60fps virtualized grid
 * - previewUrl: =s1600 for crisp Lightbox & Crop modal
 */
export function buildOptimizedThumbnailUrls(
  fileId: string,
  thumbnailLink?: string
): { gridThumbUrl: string; previewUrl: string } {
  if (thumbnailLink) {
    const hasSizeSuffix = /=s\d+/.test(thumbnailLink);
    if (hasSizeSuffix) {
      return {
        gridThumbUrl: thumbnailLink.replace(/=s\d+.*$/, '=s400'),
        previewUrl: thumbnailLink.replace(/=s\d+.*$/, '=s1600'),
      };
    }
    return {
      gridThumbUrl: `${thumbnailLink}=s400`,
      previewUrl: `${thumbnailLink}=s1600`,
    };
  }

  return {
    gridThumbUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w400`,
    previewUrl: `https://drive.google.com/thumbnail?id=${fileId}&sz=w1600`,
  };
}

export function getGoogleDriveApiKey(): string {
  const envKey = import.meta.env.VITE_GOOGLE_API_KEY;
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

async function fetchFolderChildren(
  parentId: string,
  apiKey: string
): Promise<RawDriveFile[]> {
  const query = `'${parentId}' in parents and trashed = false`;
  const fields =
    'files(id,name,mimeType,thumbnailLink,imageMediaMetadata(width,height),videoMediaMetadata(width,height,durationMillis))';

  const params = new URLSearchParams({
    q: query,
    pageSize: '1000',
    orderBy: 'name',
    fields,
    includeItemsFromAllDrives: 'true',
    supportsAllDrives: 'true',
    key: apiKey,
  });

  const response = await fetch(`${DRIVE_API_BASE}?${params.toString()}`);

  if (!response.ok) {
    let errorDetail = '';
    try {
      const errJson = await response.json();
      errorDetail = errJson?.error?.message || '';
    } catch {
      // ignore json parse error
    }

    if (response.status === 401 || response.status === 403) {
      if (errorDetail.toLowerCase().includes('quota')) {
        throw new Error(
          'Đã vượt quá giới hạn truy cập (Quota) của Google Drive API. Vui lòng thử lại sau ít phút.'
        );
      }
      throw new Error(
        "Không thể truy cập thư mục. Vui lòng kiểm tra quyền chia sẻ: Thư mục chưa bật quyền chia sẻ công khai 'Bất kỳ ai có đường liên kết đều có thể xem' hoặc khóa VITE_GOOGLE_API_KEY chưa hợp lệ."
      );
    }

    if (response.status === 404) {
      throw new Error(
        "Không tìm thấy thư mục Google Drive. Đường dẫn không tồn tại hoặc thư mục chưa bật quyền chia sẻ công khai 'Bất kỳ ai có đường liên kết đều có thể xem'."
      );
    }

    throw new Error(
      `Lỗi kết nối Google Drive API (Mã ${response.status}): ${
        errorDetail || 'Vui lòng kiểm tra lại đường dẫn thư mục.'
      }`
    );
  }

  const data = (await response.json()) as { files?: RawDriveFile[] };
  return data.files || [];
}

function mapRawFileToMediaItem(
  raw: RawDriveFile,
  folderId: string,
  folderName: string,
  apiKey: string
): DriveMediaItem | null {
  const isImage = raw.mimeType.startsWith('image/');
  const isVideo = raw.mimeType.startsWith('video/');

  if (!isImage && !isVideo) {
    return null;
  }

  const { gridThumbUrl, previewUrl } = buildOptimizedThumbnailUrls(
    raw.id,
    raw.thumbnailLink
  );

  const width =
    raw.imageMediaMetadata?.width ||
    raw.videoMediaMetadata?.width ||
    1600;
  const height =
    raw.imageMediaMetadata?.height ||
    raw.videoMediaMetadata?.height ||
    1067;

  const durationRaw = raw.videoMediaMetadata?.durationMillis;
  const durationMillis =
    durationRaw !== undefined ? Number(durationRaw) : undefined;

  const downloadUrl = `${DRIVE_API_BASE}/${raw.id}?alt=media&key=${encodeURIComponent(
    apiKey
  )}`;

  return {
    id: raw.id,
    name: raw.name,
    folderId,
    folderName,
    mimeType: raw.mimeType,
    mediaType: isVideo ? 'video' : 'image',
    gridThumbUrl,
    previewUrl,
    downloadUrl,
    width,
    height,
    durationMillis,
    status: 'kept',
    edit: {
      ...DEFAULT_EDIT_CONFIG,
      logo: { ...DEFAULT_EDIT_CONFIG.logo },
    },
  };
}

export interface CrawlDriveResult {
  rootFolderId: string;
  folders: DriveFolder[];
  items: DriveMediaItem[];
}

/**
 * 2-Step Parallel Crawler for Google Drive Folders:
 * Step 1: Fetch immediate children of rootFolderId (subfolders + any root media files).
 * Step 2: Concurrently fetch all media inside all subfolders using Promise.all.
 */
export async function crawlGoogleDriveFolder(
  urlOrId: string,
  onStatusUpdate?: (message: string) => void
): Promise<CrawlDriveResult> {
  const rootFolderId = extractDriveFolderId(urlOrId);
  if (!rootFolderId) {
    throw new Error(
      'Đường dẫn Google Drive không hợp lệ. Vui lòng dán link thư mục Google Drive hợp lệ (ví dụ: https://drive.google.com/drive/folders/...).'
    );
  }

  const apiKey = getGoogleDriveApiKey();
  if (!apiKey) {
    throw new Error(
      'Chưa cấu hình biến môi trường VITE_GOOGLE_API_KEY. Vui lòng thêm VITE_GOOGLE_API_KEY vào phần Environment Variables trên Vercel hoặc file .env.'
    );
  }

  onStatusUpdate?.('Đang quét cấu trúc thư mục gốc từ Google Drive...');
  const rootChildren = await fetchFolderChildren(rootFolderId, apiKey);

  const subFoldersRaw = rootChildren.filter(
    (f) => f.mimeType === FOLDER_MIME
  );
  const rootMediaRaw = rootChildren.filter(
    (f) => f.mimeType.startsWith('image/') || f.mimeType.startsWith('video/')
  );

  const folders: DriveFolder[] = [];
  const allItems: DriveMediaItem[] = [];

  if (rootMediaRaw.length > 0) {
    const rootFolderEntry: DriveFolder = {
      id: rootFolderId,
      name: 'Thư mục gốc',
      isRoot: true,
    };
    folders.push(rootFolderEntry);

    for (const raw of rootMediaRaw) {
      const mapped = mapRawFileToMediaItem(
        raw,
        rootFolderEntry.id,
        rootFolderEntry.name,
        apiKey
      );
      if (mapped) allItems.push(mapped);
    }
  }

  if (subFoldersRaw.length > 0) {
    onStatusUpdate?.(
      `Đang tải song song ${subFoldersRaw.length} thư mục con với tốc độ cao...`
    );

    const subFolderResults = await Promise.all(
      subFoldersRaw.map(async (sub) => {
        const children = await fetchFolderChildren(sub.id, apiKey);
        return {
          folder: { id: sub.id, name: sub.name } as DriveFolder,
          children,
        };
      })
    );

    for (const result of subFolderResults) {
      folders.push(result.folder);
      for (const raw of result.children) {
        const mapped = mapRawFileToMediaItem(
          raw,
          result.folder.id,
          result.folder.name,
          apiKey
        );
        if (mapped) {
          allItems.push(mapped);
        }
      }
    }
  }

  if (folders.length === 0 || allItems.length === 0) {
    throw new Error(
      "Không tìm thấy file Ảnh hoặc Video nào trong thư mục này. Hãy đảm bảo thư mục có chứa ảnh/video và đã bật chế độ 'Bất kỳ ai có đường liên kết đều có thể xem'."
    );
  }

  return {
    rootFolderId,
    folders,
    items: allItems,
  };
}
