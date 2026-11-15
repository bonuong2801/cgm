import {
  DEFAULT_EDIT_CONFIG,
  DriveFolder,
  DriveMediaItem,
} from '../types/media';

/**
 * Generates a realistic, high-contrast transparent studio watermark logo SVG data URL
 * so users can test Smart Logo Watermarking with 1 click or upload their own file.
 */
export function createSampleStudioLogoDataUrl(): {
  dataUrl: string;
  fileName: string;
  naturalWidth: number;
  naturalHeight: number;
} {
  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="440" height="140" viewBox="0 0 440 140">
    <defs>
      <linearGradient id="badgeGrad" x1="0%" y1="0%" x2="100%" y2="100%">
        <stop offset="0%" stop-color="#6366f1" />
        <stop offset="100%" stop-color="#10b981" />
      </linearGradient>
    </defs>
    <rect x="6" y="6" width="428" height="128" rx="20" fill="#09090b" fill-opacity="0.72" stroke="#ffffff" stroke-opacity="0.35" stroke-width="3"/>
    <rect x="24" y="26" width="88" height="88" rx="14" fill="url(#badgeGrad)" />
    <circle cx="68" cy="70" r="24" fill="none" stroke="#ffffff" stroke-width="5" />
    <circle cx="68" cy="70" r="9" fill="#ffffff" />
    <text x="132" y="68" fill="#ffffff" font-family="sans-serif" font-weight="800" font-size="38" letter-spacing="3">CGM STUDIO</text>
    <text x="134" y="102" fill="#e4e4e7" font-family="sans-serif" font-weight="600" font-size="18" letter-spacing="4">VIETNAM PRODUCTION</text>
  </svg>`;

  const encoded = `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
  return {
    dataUrl: encoded,
    fileName: 'Logo_CGM_Studio_ChinhThuc.svg',
    naturalWidth: 440,
    naturalHeight: 140,
  };
}

interface ScenePalette {
  skyTop: string;
  skyBottom: string;
  accent: string;
  secondary: string;
  subjectLabel: string;
  cameraMeta: string;
}

const SCENE_PALETTES: ScenePalette[] = [
  {
    skyTop: '#0f172a',
    skyBottom: '#312e81',
    accent: '#f59e0b',
    secondary: '#38bdf8',
    subjectLabel: 'Toàn cảnh Sân khấu Khai mạc',
    cameraMeta: '35mm f/1.4 · ISO 400 · 1/250s',
  },
  {
    skyTop: '#18181b',
    skyBottom: '#3f3f46',
    accent: '#ec4899',
    secondary: '#a855f7',
    subjectLabel: 'Chân dung Khách mời Thảm đỏ',
    cameraMeta: '85mm f/1.2 · ISO 200 · 1/500s',
  },
  {
    skyTop: '#064e3b',
    skyBottom: '#0f766e',
    accent: '#34d399',
    secondary: '#fde047',
    subjectLabel: 'Hoạt động Team Building Bãi biển',
    cameraMeta: '24mm f/2.8 · ISO 100 · 1/1000s',
  },
  {
    skyTop: '#1e1b4b',
    skyBottom: '#4c1d95',
    accent: '#fb7185',
    secondary: '#60a5fa',
    subjectLabel: 'Đêm Gala Dinner & Trao giải',
    cameraMeta: '50mm f/1.4 · ISO 800 · 1/160s',
  },
  {
    skyTop: '#27272a',
    skyBottom: '#18181b',
    accent: '#22d3ee',
    secondary: '#818cf8',
    subjectLabel: 'Hậu trường & Phỏng vấn Báo chí',
    cameraMeta: '24-70mm f/2.8 · ISO 640 · 1/200s',
  },
];

/**
 * Generates a rich, high-resolution SVG photographic scene data URL
 * that renders instantaneously at 60fps, never fails offline/CORS,
 * and responds vividly to Brightness, Contrast, Saturation, Warmth, Crop & Watermark.
 */
function createPhotographicSvgDataUrl(params: {
  width: number;
  height: number;
  folderIndex: number;
  itemIndex: number;
  title: string;
  folderName: string;
  isVideo: boolean;
}): string {
  const { width, height, folderIndex, itemIndex, title, folderName, isVideo } =
    params;
  const palette = SCENE_PALETTES[folderIndex % SCENE_PALETTES.length];
  const isPortrait = height > width;

  const sunX = Math.round(width * (0.28 + ((itemIndex * 13) % 45) / 100));
  const sunY = Math.round(height * (0.26 + ((itemIndex * 7) % 25) / 100));
  const sunR = Math.round(Math.min(width, height) * 0.16);

  const horizonY = Math.round(height * 0.64);

  const svg = `<svg xmlns="http://www.w3.org/2000/svg" width="${width}" height="${height}" viewBox="0 0 ${width} ${height}">
    <defs>
      <linearGradient id="bg_${folderIndex}_${itemIndex}" x1="0%" y1="0%" x2="15%" y2="100%">
        <stop offset="0%" stop-color="${palette.skyTop}" />
        <stop offset="65%" stop-color="${palette.skyBottom}" />
        <stop offset="100%" stop-color="#09090b" />
      </linearGradient>
      <radialGradient id="glow_${folderIndex}_${itemIndex}" cx="50%" cy="50%" r="50%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.85" />
        <stop offset="55%" stop-color="${palette.secondary}" stop-opacity="0.28" />
        <stop offset="100%" stop-color="${palette.skyBottom}" stop-opacity="0" />
      </radialGradient>
      <linearGradient id="stage_${folderIndex}_${itemIndex}" x1="0%" y1="0%" x2="100%" y2="0%">
        <stop offset="0%" stop-color="${palette.accent}" stop-opacity="0.32" />
        <stop offset="50%" stop-color="${palette.secondary}" stop-opacity="0.45" />
        <stop offset="100%" stop-color="${palette.accent}" stop-opacity="0.25" />
      </linearGradient>
    </defs>

    <!-- Sky & Ambient Backdrop -->
    <rect width="${width}" height="${height}" fill="url(#bg_${folderIndex}_${itemIndex})" />

    <!-- Bokeh / Stage Spotlight Orb -->
    <circle cx="${sunX}" cy="${sunY}" r="${sunR * 2.1}" fill="url(#glow_${folderIndex}_${itemIndex})" />
    <circle cx="${sunX}" cy="${sunY}" r="${sunR * 0.65}" fill="${palette.accent}" fill-opacity="0.55" />

    <!-- Secondary Bokeh Lights -->
    <circle cx="${Math.round(width * 0.78)}" cy="${Math.round(height * 0.28)}" r="${Math.round(sunR * 0.45)}" fill="${palette.secondary}" fill-opacity="0.4" />
    <circle cx="${Math.round(width * 0.18)}" cy="${Math.round(height * 0.48)}" r="${Math.round(sunR * 0.3)}" fill="#ffffff" fill-opacity="0.22" />

    <!-- Architectural / Mountain / Stage Geometry -->
    <polygon points="0,${horizonY} ${Math.round(width * 0.32)},${Math.round(height * 0.42)} ${Math.round(width * 0.68)},${horizonY}" fill="#18181b" fill-opacity="0.65" />
    <polygon points="${Math.round(width * 0.35)},${horizonY} ${Math.round(width * 0.72)},${Math.round(height * 0.38)} ${width},${horizonY}" fill="#09090b" fill-opacity="0.75" />

    <!-- Foreground Subject Silhouette / Portrait Frame -->
    ${
      isPortrait
        ? `<g>
            <circle cx="${Math.round(width * 0.5)}" cy="${Math.round(height * 0.45)}" r="${Math.round(width * 0.14)}" fill="#27272a" stroke="${palette.accent}" stroke-width="4" />
            <path d="M ${Math.round(width * 0.26)} ${horizonY + 120} C ${Math.round(width * 0.26)} ${Math.round(height * 0.58)}, ${Math.round(width * 0.74)} ${Math.round(height * 0.58)}, ${Math.round(width * 0.74)} ${horizonY + 120} Z" fill="#27272a" stroke="${palette.secondary}" stroke-width="3" />
          </g>`
        : `<g>
            <rect x="${Math.round(width * 0.14)}" y="${Math.round(height * 0.48)}" width="${Math.round(width * 0.72)}" height="${Math.round(height * 0.2)}" rx="16" fill="url(#stage_${folderIndex}_${itemIndex})" stroke="#ffffff" stroke-opacity="0.2" stroke-width="2" />
          </g>`
    }

    <!-- Ground Reflection Plane -->
    <rect x="0" y="${horizonY}" width="${width}" height="${height - horizonY}" fill="#09090b" fill-opacity="0.82" />
    <line x1="0" y1="${horizonY}" x2="${width}" y2="${horizonY}" stroke="${palette.accent}" stroke-opacity="0.6" stroke-width="3" />

    <!-- Rule of Thirds Subtle Studio Reference Grid -->
    <line x1="${Math.round(width / 3)}" y1="0" x2="${Math.round(width / 3)}" y2="${height}" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1" />
    <line x1="${Math.round((width * 2) / 3)}" y1="0" x2="${Math.round((width * 2) / 3)}" y2="${height}" stroke="#ffffff" stroke-opacity="0.06" stroke-width="1" />

    <!-- Top Left Metadata Kicker -->
    <text x="44" y="64" fill="#e4e4e7" fill-opacity="0.85" font-family="sans-serif" font-weight="700" font-size="24" letter-spacing="1">${folderName.toUpperCase()}</text>
    <text x="44" y="98" fill="#a1a1aa" font-family="monospace" font-size="20">${palette.cameraMeta} · ${width}×${height}px (${isPortrait ? 'Dọc 2:3' : 'Ngang 3:2'})</text>

    <!-- Bottom Left Subject Title -->
    <text x="44" y="${height - 86}" fill="#ffffff" font-family="sans-serif" font-weight="800" font-size="38">${title}</text>
    <text x="44" y="${height - 44}" fill="${palette.accent}" font-family="sans-serif" font-weight="600" font-size="24">${palette.subjectLabel} ${isVideo ? '· [VIDEO GỐC 4K]' : ''}</text>
  </svg>`;

  return `data:image/svg+xml;utf8,${encodeURIComponent(svg)}`;
}

export function generateVietnameseDemoDataset(): {
  rootFolderId: string;
  folders: DriveFolder[];
  items: DriveMediaItem[];
} {
  const demoFolders: DriveFolder[] = [
    { id: 'demo_folder_01', name: '01_Le_Khai_Mac_Su_Kien' },
    { id: 'demo_folder_02', name: '02_Chup_Tham_Do_Khach_VIP' },
    { id: 'demo_folder_03', name: '03_Hoat_Dong_Team_Building' },
    { id: 'demo_folder_04', name: '04_Dem_Gala_Dinner_Trao_Giai' },
    { id: 'demo_folder_05', name: '05_Hau_Truong_BTS_HighLight' },
  ];

  const items: DriveMediaItem[] = [];

  const folderCounts = [18, 16, 18, 16, 14]; // 82 rich items across 5 folders for instant testing

  demoFolders.forEach((folder, fIdx) => {
    const count = folderCounts[fIdx] || 15;

    for (let i = 1; i <= count; i++) {
      const isVideo = i % 6 === 0; // Every 6th item is a video
      const isPortrait = !isVideo && i % 3 === 0; // Mix of Landscape (1800x1200) and Portrait (1200x1800)

      const width = isVideo ? 1920 : isPortrait ? 1200 : 1800;
      const height = isVideo ? 1080 : isPortrait ? 1800 : 1200;

      const paddedNum = String(i).padStart(3, '0');
      const ext = isVideo ? 'MP4' : 'JPG';
      const prefix = isVideo ? 'VID' : isPortrait ? 'PORTRAIT' : 'DSC';
      const fileName = `${prefix}_${fIdx + 1}${paddedNum}.${ext}`;

      const svgDataUrl = createPhotographicSvgDataUrl({
        width,
        height,
        folderIndex: fIdx,
        itemIndex: i,
        title: `${fileName} — Khung hình #${paddedNum}`,
        folderName: folder.name,
        isVideo,
      });

      items.push({
        id: `demo_item_${folder.id}_${paddedNum}`,
        name: fileName,
        folderId: folder.id,
        folderName: folder.name,
        mimeType: isVideo ? 'video/mp4' : 'image/jpeg',
        mediaType: isVideo ? 'video' : 'image',
        gridThumbUrl: svgDataUrl,
        previewUrl: svgDataUrl,
        downloadUrl: svgDataUrl,
        width,
        height,
        durationMillis: isVideo ? (45 + ((i * 19) % 140)) * 1000 : undefined,
        status: 'kept',
        isDemo: true,
        edit: {
          ...DEFAULT_EDIT_CONFIG,
          logo: { ...DEFAULT_EDIT_CONFIG.logo },
        },
      });
    }
  });

  return {
    rootFolderId: '1CGM_Demo_Folder_Su_Kien_2026_VietNam',
    folders: demoFolders,
    items,
  };
}
