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
import {
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
  sanitizeFileToken,
  sanitizeFolderNameForDisk,
} from '../src/utils/mediaMath.ts';
import { toUserFriendlyError } from '../src/utils/userMessages.ts';
import { resolveRelativeFolderPath } from '../src/services/localFileLoader.ts';
import {
  buildExportPlan,
  canBypassPhotoReencode,
} from '../src/services/batchExporter.ts';
import { POST as handleAiCull } from '../api/ai/cull.ts';
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
    rating: 5,
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
  assert.equal(freeEnt.canUseAiCull, false);
  assert.equal(freeEnt.canExportOriginalOr4K, false);
  assert.equal(freeEnt.canCustomBatchRename, false);

  const lifetimePro: UserProfile = { ...freeUser, tier: 'pro', proExpiresAt: null };
  const proEnt = getPlanEntitlements(lifetimePro, nowMs);
  assert.equal(proEnt.isPro, true);
  assert.equal(proEnt.maxExportFilesPerRun, Number.POSITIVE_INFINITY);
  assert.equal(proEnt.maxLogoLayers, Number.POSITIVE_INFINITY);
  assert.equal(proEnt.canFreeDragLogo, true);
  assert.equal(proEnt.canUseAiCull, true);

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

  const unauthAiRes = await handleAiCull(
    new Request('http://localhost:3000/api/ai/cull', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ photos: [] }),
    })
  );
  assert.equal(unauthAiRes.status, 401);

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

  console.log('ALL CORE & SECURITY CHECKS PASSED SUCCESSFULLY');
}

runCoreChecks().catch((err) => {
  console.error(err);
  process.exit(1);
});
