import assert from 'node:assert/strict';
import crypto from 'node:crypto';
import {
  DEFAULT_EDIT_CONFIG,
  createLogoLayer,
  getActiveLogos,
  isPhotoEdited,
  type DriveMediaItem,
  type ExportOptions,
} from '../src/types/media.ts';
import type { UserProfile } from '../src/types/auth.ts';
import {
  FREE_MAX_EXPORT_FILES,
  FREE_MAX_LOGO_LAYERS,
  extractOrderCodeFromTransferContent,
  getPlanEntitlements,
} from '../src/utils/entitlements.ts';
import { generateGoogleNoncePair } from '../src/lib/supabaseClient.ts';
import {
  buildImageFallbackSources,
  buildStableDriveThumbnailUrls,
  collectAdjacentPreloadUrls,
  computeCursorZoomState,
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
  fitAspectRatioInBox,
  getInstantPaintState,
  normalizeDriveMediaUrls,
  resolveDetectedDimensions,
  resolveOrientedMediaDimensions,
  sanitizeFileToken,
  sanitizeFolderNameForDisk,
} from '../src/utils/mediaMath.ts';
import {
  getUserGuideStorageKey,
  readUserGuideHidden,
  toUserFriendlyError,
  writeUserGuideHidden,
} from '../src/utils/userMessages.ts';
import { resolveRelativeFolderPath } from '../src/services/localFileLoader.ts';
import {
  buildExportPlan,
  canBypassPhotoReencode,
} from '../src/services/batchExporter.ts';
import {
  verifyAndParseBankWebhook,
  verifyPayOsSignature,
} from '../api/billing/vietqr-webhook.ts';
import { GET as handleDriveCrawl } from '../api/drive/crawl.ts';
import { GET as handleDriveStream } from '../api/drive/stream.ts';

async function runCoreChecks() {
  // 1. Vietnamese folder normalization & nested folder preservation
  assert.equal(sanitizeFileToken('Lễ Đính Hôn 2026!'), 'Le_Dinh_Hon_2026');
  const f1 = resolveRelativeFolderPath('Root/Lễ 1/DSC_001.JPG');
  const f2 = resolveRelativeFolderPath('Root/Lố 1/DSC_001.JPG');
  assert.notEqual(
    f1.folderId,
    f2.folderId,
    'Vietnamese folder IDs must not collide'
  );

  const nestedA = resolveRelativeFolderPath('SuKien/Ngày 1/Khai Mạc/A.JPG');
  const nestedB = resolveRelativeFolderPath('SuKien/Ngày 2/Khai Mạc/A.JPG');
  assert.equal(nestedA.folderName, 'Ngày 1/Khai Mạc');
  assert.equal(nestedB.folderName, 'Ngày 2/Khai Mạc');
  assert.notEqual(nestedA.folderId, nestedB.folderId);
  assert.equal(
    sanitizeFolderNameForDisk('Ngày 1\\Lễ:Khai*Mạc'),
    'Ngày 1/Lễ_Khai_Mạc'
  );

  // 2. Rotation + Crop + MaxDimension Resize Geometry
  const geomRot90 = computeFrameGeometry(
    6000,
    4000,
    {
      ...DEFAULT_EDIT_CONFIG,
      rotation: 90,
      cropPercent: { x: 10, y: 20, width: 50, height: 50 },
    },
    2048
  );
  assert.equal(geomRot90.rotW, 4000);
  assert.equal(geomRot90.rotH, 6000);
  assert.equal(geomRot90.cropW, 2000);
  assert.equal(geomRot90.cropH, 3000);
  assert.equal(geomRot90.outH, 2048);
  assert.equal(geomRot90.outW, Math.round(2000 * (2048 / 3000)));

  // 3. Multi-Logo Layer Stack auto-corner distribution & custom drag placement
  const logo1 = createLogoLayer(
    {
      dataUrl: 'data:image/png;base64,AA',
      fileName: 'org.png',
      naturalWidth: 400,
      naturalHeight: 200,
    },
    0
  );
  const logo2 = createLogoLayer(
    {
      dataUrl: 'data:image/png;base64,BB',
      fileName: 'sponsor.png',
      naturalWidth: 300,
      naturalHeight: 300,
    },
    1
  );
  const logo3 = createLogoLayer(
    {
      dataUrl: 'data:image/png;base64,CC',
      fileName: 'studio.png',
      naturalWidth: 500,
      naturalHeight: 100,
      position: 'custom',
      customXPercent: 99,
      customYPercent: 2,
    },
    2
  );
  assert.equal(logo1.position, 'bottom-right');
  assert.equal(logo2.position, 'top-left');

  const editMulti = {
    ...DEFAULT_EDIT_CONFIG,
    logos: [logo1, logo2, { ...logo3, enabled: false }, logo3],
  };
  assert.equal(getActiveLogos(editMulti).length, 3);
  assert.equal(isPhotoEdited(editMulti).activeLogoCount, 3);

  const pLandscape = computeSmartLogoPlacement(3000, 2000, logo1);
  const pPortrait = computeSmartLogoPlacement(2000, 3000, logo1);
  assert.equal(
    pLandscape.width,
    pPortrait.width,
    'Shorter-edge proportional logo width must match on landscape & portrait'
  );

  const pCustomClamped = computeSmartLogoPlacement(1000, 800, logo3);
  assert.ok(
    pCustomClamped.x >= 0 &&
      pCustomClamped.x + pCustomClamped.width <= 1000
  );
  assert.ok(
    pCustomClamped.y >= 0 &&
      pCustomClamped.y + pCustomClamped.height <= 800
  );

  // 4. Warm/Cool Color Temperature
  assert.equal(computeWarmthTint(0), null);
  assert.equal(computeWarmthTint(30)?.rgb, '255, 146, 43');
  assert.equal(computeWarmthTint(-30)?.rgb, '56, 152, 255');

  // 5. Export Plan & Zero-Reencode Fast-Path
  const baseItem: DriveMediaItem = {
    id: '1',
    name: 'IMG_01.JPG',
    folderId: 'f1',
    folderName: 'Ngày 1/Khai Mạc',
    mimeType: 'image/jpeg',
    mediaType: 'image',
    gridThumbUrl: '',
    previewUrl: '',
    downloadUrl: '',
    width: 4000,
    height: 3000,
    status: 'kept',
    edit: { ...DEFAULT_EDIT_CONFIG, logos: [] },
  };
  const baseExportOpts: ExportOptions = {
    scope: 'all-folders',
    includeVideos: true,
    format: 'image/jpeg',
    quality: 0.92,
    maxDimension: 0,
    skipReencodeIfUnedited: true,
    renameMode: 'custom',
    customPattern: '{prefix}_{folder}_{index3}',
    customPrefix: 'CGM',
    startIndex: 1,
    numberingRule: 'per-folder',
  };
  assert.equal(canBypassPhotoReencode(baseItem, baseExportOpts), true);
  assert.equal(
    canBypassPhotoReencode({ ...baseItem, edit: editMulti }, baseExportOpts),
    false
  );

  const plan = buildExportPlan(
    [baseItem, { ...baseItem, id: '2' }],
    baseExportOpts
  );
  assert.equal(plan[0].subFolderName, 'Ngày 1/Khai Mạc');
  assert.equal(plan[0].targetFileName, 'CGM_Khai_Mac_001.jpg');
  assert.equal(plan[1].targetFileName, 'CGM_Khai_Mac_002.jpg');

  // 6. Account Tiering & Entitlements (Free vs Lifetime Pro vs Active Pro vs Expired Pro)
  const nowMs = Date.parse('2026-11-18T00:00:00Z');
  const freeUser: UserProfile = {
    id: 'u1',
    email: 'free@studio.vn',
    fullName: 'Free User',
    avatarUrl: '',
    tier: 'free',
    proExpiresAt: null,
    role: 'user',
  };
  const freeEnt = getPlanEntitlements(freeUser, nowMs);
  assert.equal(freeEnt.isPro, false);
  assert.equal(freeEnt.maxExportFilesPerRun, FREE_MAX_EXPORT_FILES);
  assert.equal(freeEnt.maxLogoLayers, FREE_MAX_LOGO_LAYERS);
  assert.equal(freeEnt.canFreeDragLogo, false);
  assert.equal(freeEnt.canExportOriginalOr4K, false);
  assert.equal(freeEnt.canCustomBatchRename, false);

  const lifetimePro: UserProfile = { ...freeUser, tier: 'pro', proExpiresAt: null };
  const proEnt = getPlanEntitlements(lifetimePro, nowMs);
  assert.equal(proEnt.isPro, true);
  assert.equal(proEnt.maxExportFilesPerRun, Number.POSITIVE_INFINITY);
  assert.equal(proEnt.maxLogoLayers, Number.POSITIVE_INFINITY);
  assert.equal(proEnt.canFreeDragLogo, true);

  const expiredPro: UserProfile = {
    ...freeUser,
    tier: 'pro',
    proExpiresAt: '2026-11-01T00:00:00Z',
  };
  assert.equal(
    getPlanEntitlements(expiredPro, nowMs).isPro,
    false,
    'Expired Pro subscription must automatically revert to Free entitlements'
  );

  // 7. VietQR Bank Memo Extraction & Webhook Verification (SePay + PayOS HMAC)
  assert.equal(
    extractOrderCodeFromTransferContent('MBVCB.948271.CGM8392140.CT TU NGUYEN VAN A'),
    'CGM8392140'
  );
  assert.equal(
    extractOrderCodeFromTransferContent('chuyen khoan cgm123456 nang cap'),
    'CGM123456'
  );
  assert.equal(extractOrderCodeFromTransferContent('Chuyen tien an trua'), null);

  // SePay Webhook Security Check
  const badSepay = verifyAndParseBankWebhook(
    new Headers({ Authorization: 'Apikey wrong_secret' }),
    { transferType: 'in', transferAmount: 99000, content: 'CGM1234567' },
    { sepaySecret: 'real_secret_123' }
  );
  assert.equal(badSepay.ok, false);

  const okSepay = verifyAndParseBankWebhook(
    new Headers({ Authorization: 'Apikey real_secret_123' }),
    {
      id: 9912,
      transferType: 'in',
      transferAmount: 599000,
      content: 'IBFT CGM7654321 thanh toan',
    },
    { sepaySecret: 'real_secret_123' }
  );
  assert.equal(okSepay.ok, true);
  if (okSepay.ok) {
    assert.equal(okSepay.transfer?.orderCode, 'CGM7654321');
    assert.equal(okSepay.transfer?.paidAmount, 599000);
  }

  // PayOS HMAC-SHA256 Signature Check
  const payosKey = 'payos_test_checksum_secret';
  const payosData = {
    amount: 1290000,
    description: 'Thanh toan CGM9876543',
    orderCode: 9876543,
    reference: 'FT26322',
  };
  const validSig = crypto
    .createHmac('sha256', payosKey)
    .update(
      `amount=${payosData.amount}&description=${payosData.description}&orderCode=${payosData.orderCode}&reference=${payosData.reference}`
    )
    .digest('hex');
  assert.equal(verifyPayOsSignature(payosData, validSig, payosKey), true);
  assert.equal(verifyPayOsSignature(payosData, 'deadbeef', payosKey), false);

  // 8. Backend API Trust-Boundary Validation
  const badCrawlRes = await handleDriveCrawl(
    new Request('http://localhost:3000/api/drive/crawl?folderId=short')
  );
  assert.equal(badCrawlRes.status, 400);

  const badStreamRes = await handleDriveStream(
    new Request('http://localhost:3000/api/drive/stream?id=../../etc/passwd')
  );
  assert.equal(badStreamRes.status, 400);

  // 9. Customer-Friendly Error Message Sanitizer (no developer jargon leaked to end-users)
  assert.equal(
    toUserFriendlyError('Invalid login credentials'),
    'Email hoặc mật khẩu không chính xác.'
  );
  assert.equal(
    toUserFriendlyError('User already registered'),
    'Email này đã có tài khoản. Vui lòng chuyển sang mục Đăng nhập.'
  );
  assert.equal(
    toUserFriendlyError(new TypeError('Failed to fetch')),
    'Kết nối mạng bị gián đoạn. Vui lòng kiểm tra Internet và thử lại.'
  );
  assert.equal(
    toUserFriendlyError(
      'Chưa cấu hình GEMINI_API_KEY trên Server (.env)',
      'Tính năng AI lọc ảnh hiện đang gặp sự cố hoặc tạm bảo trì. Vui lòng thử lại sau ít phút.'
    ),
    'Tính năng AI lọc ảnh hiện đang gặp sự cố hoặc tạm bảo trì. Vui lòng thử lại sau ít phút.'
  );
  assert.equal(
    toUserFriendlyError(
      'Supabase RPC error HTTP 503 Worker OffscreenCanvas',
      'Hệ thống đang tạm gián đoạn.'
    ),
    'Hệ thống đang tạm gián đoạn.'
  );
  assert.equal(
    toUserFriendlyError('Mã kích hoạt đã hết lượt sử dụng.'),
    'Mã kích hoạt đã hết lượt sử dụng.'
  );

  // 10. Google Identity Services Nonce Pair (SHA-256 hex match required by Supabase signInWithIdToken)
  const { nonce, hashedNonce } = await generateGoogleNoncePair();
  assert.equal(nonce.length, 48);
  assert.equal(
    hashedNonce,
    crypto.createHash('sha256').update(nonce).digest('hex')
  );

  // 11. Google Drive Stable Thumbnail URLs, Fallback Chains & Dimension Preservation
  const stableThumbs = buildStableDriveThumbnailUrls('abc123_DriveFileId');
  assert.equal(
    stableThumbs.gridThumbUrl,
    'https://drive.google.com/thumbnail?id=abc123_DriveFileId&sz=w800'
  );
  assert.equal(
    stableThumbs.previewUrl,
    'https://drive.google.com/thumbnail?id=abc123_DriveFileId&sz=w2400'
  );

  assert.deepEqual(resolveOrientedMediaDimensions(6000, 4000, 0), {
    width: 6000,
    height: 4000,
  });
  assert.deepEqual(resolveOrientedMediaDimensions(6000, 4000, 1), {
    width: 4000,
    height: 6000,
  });
  assert.deepEqual(resolveOrientedMediaDimensions(6000, 4000, 3), {
    width: 4000,
    height: 6000,
  });
  assert.deepEqual(resolveOrientedMediaDimensions(undefined, undefined), {
    width: 1600,
    height: 1067,
  });

  const legacyDriveItem = normalizeDriveMediaUrls({
    id: 'drive_legacy_1',
    isLocal: false,
    gridThumbUrl:
      'https://lh3.googleusercontent.com/drive-storage/expired-token=s480',
    previewUrl:
      'https://lh3.googleusercontent.com/drive-storage/expired-token=s2400',
  });
  assert.equal(
    legacyDriveItem.gridThumbUrl,
    'https://drive.google.com/thumbnail?id=drive_legacy_1&sz=w800'
  );
  assert.equal(
    legacyDriveItem.previewUrl,
    'https://drive.google.com/thumbnail?id=drive_legacy_1&sz=w2400'
  );

  const undersizedDriveItem = normalizeDriveMediaUrls({
    id: 'drive_w480_1',
    isLocal: false,
    gridThumbUrl: 'https://drive.google.com/thumbnail?id=drive_w480_1&sz=w480',
    previewUrl: 'https://drive.google.com/thumbnail?id=drive_w480_1&sz=w2400',
  });
  assert.equal(
    undersizedDriveItem.gridThumbUrl,
    'https://drive.google.com/thumbnail?id=drive_w480_1&sz=w800'
  );

  const localBlobItem = normalizeDriveMediaUrls({
    id: 'local_1',
    isLocal: true,
    gridThumbUrl: 'blob:https://cgmtop1cg.vercel.app/1234',
    previewUrl: 'blob:https://cgmtop1cg.vercel.app/1234',
  });
  assert.equal(
    localBlobItem.gridThumbUrl,
    'blob:https://cgmtop1cg.vercel.app/1234'
  );

  const gridFallback = buildImageFallbackSources({
    id: 'file_xyz',
    mediaType: 'image',
    isLocal: false,
    gridThumbUrl: 'https://drive.google.com/thumbnail?id=file_xyz&sz=w800',
    previewUrl: 'https://drive.google.com/thumbnail?id=file_xyz&sz=w2400',
    streamUrl: '/api/drive/stream?id=file_xyz&token=jwt',
    useHighRes: false,
  });
  assert.deepEqual(gridFallback, [
    'https://drive.google.com/thumbnail?id=file_xyz&sz=w800',
    'https://lh3.googleusercontent.com/d/file_xyz=w800',
    'https://drive.google.com/thumbnail?id=file_xyz&sz=w480',
    '/api/drive/stream?id=file_xyz&token=jwt',
  ]);

  const highResFallback = buildImageFallbackSources({
    id: 'file_xyz',
    mediaType: 'image',
    isLocal: false,
    gridThumbUrl: 'https://drive.google.com/thumbnail?id=file_xyz&sz=w800',
    previewUrl: 'https://drive.google.com/thumbnail?id=file_xyz&sz=w2400',
    streamUrl: '/api/drive/stream?id=file_xyz&token=jwt',
    useHighRes: true,
  });
  assert.deepEqual(highResFallback, [
    'https://drive.google.com/thumbnail?id=file_xyz&sz=w2400',
    'https://lh3.googleusercontent.com/d/file_xyz=w2400',
    'https://drive.google.com/thumbnail?id=file_xyz&sz=w1600',
    '/api/drive/stream?id=file_xyz&token=jwt',
    'https://drive.google.com/thumbnail?id=file_xyz&sz=w800',
  ]);

  const videoGridFallback = buildImageFallbackSources({
    id: 'vid_xyz',
    mediaType: 'video',
    isLocal: false,
    gridThumbUrl: 'https://drive.google.com/thumbnail?id=vid_xyz&sz=w800',
    previewUrl: 'https://drive.google.com/thumbnail?id=vid_xyz&sz=w2400',
    streamUrl: '/api/drive/stream?id=vid_xyz&token=jwt',
    useHighRes: false,
  });
  assert.equal(
    videoGridFallback.some((u) => u.includes('/api/drive/stream')),
    false,
    'Video <img> fallback chain must never include video binary stream URL'
  );

  const localFallback = buildImageFallbackSources({
    id: 'local_1',
    mediaType: 'image',
    isLocal: true,
    gridThumbUrl: 'blob:thumb',
    previewUrl: 'blob:full',
    streamUrl: 'blob:full',
    useHighRes: false,
  });
  assert.deepEqual(localFallback, ['blob:thumb', 'blob:full']);

  // Preserve full camera metadata when thumbnail loads with smaller same-ratio pixels
  assert.equal(resolveDetectedDimensions(6000, 4000, 800, 533), null);
  // Correct 90-degree EXIF orientation without losing camera resolution
  assert.deepEqual(resolveDetectedDimensions(6000, 4000, 533, 800), {
    width: 4000,
    height: 6000,
  });
  // Replace default Drive & local placeholders
  assert.deepEqual(resolveDetectedDimensions(1600, 1067, 800, 1200), {
    width: 800,
    height: 1200,
  });
  assert.deepEqual(resolveDetectedDimensions(1800, 1200, 800, 533), {
    width: 800,
    height: 533,
  });
  // Upgrade when full original loads with higher pixel count
  assert.deepEqual(resolveDetectedDimensions(2400, 1600, 6000, 4000), {
    width: 6000,
    height: 4000,
  });

  // Adjacent preloading priority, wrap-around & video skipping
  const preloadSeq = [
    {
      id: 'p0',
      mediaType: 'image' as const,
      gridThumbUrl: 'g0',
      previewUrl: 'v0',
    },
    {
      id: 'p1',
      mediaType: 'video' as const,
      gridThumbUrl: 'vg1',
      previewUrl: 'vv1',
    },
    {
      id: 'p2',
      mediaType: 'image' as const,
      gridThumbUrl: 'g2',
      previewUrl: 'v2',
    },
    {
      id: 'p3',
      mediaType: 'image' as const,
      gridThumbUrl: 'g3',
      previewUrl: 'v3',
    },
    {
      id: 'p4',
      mediaType: 'image' as const,
      gridThumbUrl: 'g4',
      previewUrl: 'v4',
    },
  ];
  assert.deepEqual(collectAdjacentPreloadUrls(preloadSeq, 0), [
    'v4',
    'v2',
    'v3',
    'g4',
    'g2',
    'g3',
  ]);
  assert.deepEqual(collectAdjacentPreloadUrls([preloadSeq[0]], 0), []);
  assert.deepEqual(collectAdjacentPreloadUrls(preloadSeq, -1), []);
  assert.deepEqual(collectAdjacentPreloadUrls([preloadSeq[0], preloadSeq[2]], 0), [
    'v2',
    'g2',
  ]);

  // Double-buffered Lightbox swap readiness checks
  const cachedSet = new Set<string>(['g_cached', 'v_cached']);
  const isUrlReady = (url: string) => cachedSet.has(url);
  assert.deepEqual(
    getInstantPaintState(
      {
        isLocal: true,
        mediaType: 'image',
        gridThumbUrl: 'blob:1',
        previewUrl: 'blob:1',
      },
      isUrlReady
    ),
    { canSwapImmediately: true, highResReady: true }
  );
  assert.deepEqual(
    getInstantPaintState(
      {
        isLocal: false,
        mediaType: 'video',
        gridThumbUrl: 'g_uncached',
        previewUrl: 'v_uncached',
      },
      isUrlReady
    ),
    { canSwapImmediately: true, highResReady: true }
  );
  assert.deepEqual(
    getInstantPaintState(
      {
        isLocal: false,
        mediaType: 'image',
        gridThumbUrl: 'g_uncached',
        previewUrl: 'v_cached',
      },
      isUrlReady
    ),
    { canSwapImmediately: true, highResReady: true }
  );
  assert.deepEqual(
    getInstantPaintState(
      {
        isLocal: false,
        mediaType: 'image',
        gridThumbUrl: 'g_cached',
        previewUrl: 'v_uncached',
      },
      isUrlReady
    ),
    { canSwapImmediately: true, highResReady: false }
  );
  assert.deepEqual(
    getInstantPaintState(
      {
        isLocal: false,
        mediaType: 'image',
        gridThumbUrl: 'g_uncached',
        previewUrl: 'v_uncached',
      },
      isUrlReady
    ),
    { canSwapImmediately: false, highResReady: false }
  );

  // Fit aspect ratio cleanly inside Loupe stage bounds
  assert.deepEqual(fitAspectRatioInBox(900, 600, 6000, 4000), {
    width: 900,
    height: 600,
  });
  assert.deepEqual(fitAspectRatioInBox(900, 600, 4000, 6000), {
    width: 400,
    height: 600,
  });
  assert.deepEqual(fitAspectRatioInBox(400, 600, 6000, 4000), {
    width: 400,
    height: 267,
  });
  assert.deepEqual(fitAspectRatioInBox(0, -10, 0, 0), {
    width: 1,
    height: 1,
  });

  // Anchored cursor zoom state math on Loupe canvas
  assert.deepEqual(
    computeCursorZoomState(1, { x: 0, y: 0 }, -200, { x: 100, y: -50 }, 1, 5),
    { zoom: 1.36, pan: { x: -36, y: 18 } }
  );
  assert.deepEqual(
    computeCursorZoomState(1.05, { x: 24, y: -12 }, 200, { x: 0, y: 0 }, 1, 5),
    { zoom: 1, pan: { x: 0, y: 0 } }
  );
  assert.equal(
    computeCursorZoomState(4.9, { x: 0, y: 0 }, -500, { x: 0, y: 0 }, 1, 5)
      .zoom,
    5
  );

  // 12. User Guide Per-User Permanent Hide Preference Storage
  const memStore = new Map<string, string>();
  const mockStorage = {
    getItem: (k: string) => memStore.get(k) ?? null,
    setItem: (k: string, v: string) => {
      memStore.set(k, v);
    },
    removeItem: (k: string) => {
      memStore.delete(k);
    },
  };
  assert.equal(
    getUserGuideStorageKey('user_abc'),
    'cgm_hide_user_guide_v1:user_abc'
  );
  assert.equal(
    getUserGuideStorageKey('  '),
    'cgm_hide_user_guide_v1:default'
  );
  assert.equal(readUserGuideHidden('user_abc', mockStorage), false);
  writeUserGuideHidden('user_abc', true, mockStorage);
  assert.equal(readUserGuideHidden('user_abc', mockStorage), true);
  assert.equal(readUserGuideHidden('user_other', mockStorage), false);
  writeUserGuideHidden('user_abc', false, mockStorage);
  assert.equal(readUserGuideHidden('user_abc', mockStorage), false);

  console.log('ALL CORE & SECURITY CHECKS PASSED SUCCESSFULLY');
}

runCoreChecks().catch((err) => {
  console.error(err);
  process.exit(1);
});
