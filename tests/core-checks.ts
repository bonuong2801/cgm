import assert from 'node:assert/strict';
import {
  DEFAULT_EDIT_CONFIG,
  createLogoLayer,
  getActiveLogos,
  isPhotoEdited,
  type DriveMediaItem,
  type ExportOptions,
} from '../src/types/media.ts';
import {
  computeFrameGeometry,
  computeSmartLogoPlacement,
  computeWarmthTint,
  sanitizeFileToken,
  sanitizeFolderNameForDisk,
} from '../src/utils/mediaMath.ts';
import { resolveRelativeFolderPath } from '../src/services/localFileLoader.ts';
import {
  buildExportPlan,
  canBypassPhotoReencode,
} from '../src/services/batchExporter.ts';
import { GET as handleDriveCrawl } from '../api/drive/crawl.ts';
import { GET as handleDriveStream } from '../api/drive/stream.ts';

async function runCoreChecks() {
  // 1. Vietnamese folder normalization & nested folder preservation
  assert.equal(sanitizeFileToken('Lễ Đính Hôn 2026!'), 'Le_Dinh_Hon_2026');
  const f1 = resolveRelativeFolderPath('Root/Lễ 1/DSC_001.JPG');
  const f2 = resolveRelativeFolderPath('Root/Lố 1/DSC_001.JPG');
  assert.notEqual(f1.folderId, f2.folderId, 'Vietnamese folder IDs must not collide');

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
    { dataUrl: 'data:image/png;base64,AA', fileName: 'org.png', naturalWidth: 400, naturalHeight: 200 },
    0
  );
  const logo2 = createLogoLayer(
    { dataUrl: 'data:image/png;base64,BB', fileName: 'sponsor.png', naturalWidth: 300, naturalHeight: 300 },
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
  assert.ok(pCustomClamped.x >= 0 && pCustomClamped.x + pCustomClamped.width <= 1000);
  assert.ok(pCustomClamped.y >= 0 && pCustomClamped.y + pCustomClamped.height <= 800);

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

  const plan = buildExportPlan([baseItem, { ...baseItem, id: '2' }], baseExportOpts);
  assert.equal(plan[0].subFolderName, 'Ngày 1/Khai Mạc');
  assert.equal(plan[0].targetFileName, 'CGM_Khai_Mac_001.jpg');
  assert.equal(plan[1].targetFileName, 'CGM_Khai_Mac_002.jpg');

  // 6. Backend API Trust-Boundary Validation
  const badCrawlRes = await handleDriveCrawl(
    new Request('http://localhost:3000/api/drive/crawl?folderId=short')
  );
  assert.equal(badCrawlRes.status, 400);

  const badStreamRes = await handleDriveStream(
    new Request('http://localhost:3000/api/drive/stream?id=../../etc/passwd')
  );
  assert.equal(badStreamRes.status, 400);

  console.log('ALL CORE CHECKS PASSED SUCCESSFULLY');
}

runCoreChecks().catch((err) => {
  console.error(err);
  process.exit(1);
});
