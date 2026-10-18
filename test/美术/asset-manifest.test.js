import test from 'node:test';
import assert from 'node:assert/strict';
import { closeSync, openSync, readFileSync, readSync, readdirSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..');
const resourceDir = path.join(projectRoot, 'resource');
const manifestPath = path.join(resourceDir, 'asset-manifest.json');
const attributionsPath = path.join(resourceDir, 'ATTRIBUTIONS.md');

const manifestText = readFileSync(manifestPath, 'utf8');

let manifest = null;
let manifestParseError = null;
try {
  manifest = JSON.parse(manifestText);
} catch (error) {
  manifestParseError = error;
  console.error('asset-manifest.json could not be parsed:', error.message);
}

function requireManifest() {
  assert.equal(manifestParseError, null, 'asset-manifest.json must be valid JSON');
  assert.ok(manifest, 'asset-manifest.json must parse into an object');
  return manifest;
}

function splitPosix(relativePath) {
  return relativePath.split('/');
}

function resolveResourceFile(relativePosix) {
  return path.resolve(resourceDir, ...splitPosix(relativePosix));
}

function isInsideResource(absolutePath) {
  const relative = path.relative(resourceDir, absolutePath);
  if (relative.length === 0) {
    return false;
  }
  if (relative.startsWith('..')) {
    return false;
  }
  return !path.isAbsolute(relative);
}

function walkFiles(directory) {
  const files = [];
  const entries = readdirSync(directory, { withFileTypes: true });
  for (const entry of entries) {
    const absolute = path.join(directory, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(absolute));
    } else if (entry.isFile()) {
      files.push(absolute);
    }
  }
  return files;
}

function readHead(absolutePath, byteCount) {
  const buffer = Buffer.alloc(byteCount);
  const descriptor = openSync(absolutePath, 'r');
  try {
    const bytesRead = readSync(descriptor, buffer, 0, byteCount, 0);
    return buffer.subarray(0, bytesRead);
  } finally {
    closeSync(descriptor);
  }
}

function assertNonEmptyFile(absolutePath, label) {
  assert.ok(isInsideResource(absolutePath), label + ' must resolve inside resource/');
  const stats = statSync(absolutePath);
  assert.ok(stats.isFile(), label + ' must be a regular file');
  assert.ok(stats.size > 0, label + ' must be non-empty');
}

function assertFileMagic(absolutePath, label) {
  const extension = path.extname(absolutePath).toLowerCase();
  const head = readHead(absolutePath, 12);
  if (extension === '.jpg' || extension === '.jpeg') {
    const isJpeg = head.length >= 3 && head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff;
    assert.ok(isJpeg, label + ' must start with JPEG magic bytes FF D8 FF');
    return;
  }
  if (extension === '.hdr') {
    const header = head.toString('ascii');
    assert.ok(header.startsWith('#?RADIANCE') || header.startsWith('#?RGBE'), label + ' must start with a Radiance HDR header');
    return;
  }
  if (extension === '.glb') {
    assert.equal(head.toString('ascii', 0, 4), 'glTF', label + ' must start with GLB magic glTF');
    return;
  }
  assert.fail(label + ' has an unexpected extension: ' + extension);
}

function collectHumanEntries(currentManifest) {
  const humans = currentManifest.models?.humans;
  if (!humans || typeof humans !== 'object') {
    return [];
  }
  const entries = [];
  for (const roleEntries of Object.values(humans)) {
    if (Array.isArray(roleEntries)) {
      entries.push(...roleEntries);
    }
  }
  return entries;
}

function collectReferencedPaths(currentManifest) {
  const referenced = [];
  for (const channelPath of Object.values(currentManifest.textures || {})) {
    for (const filePath of Object.values(channelPath)) {
      referenced.push(filePath);
    }
  }
  referenced.push(currentManifest.hdri.sky);
  referenced.push(currentManifest.models.rifle);
  const humanUrls = new Set();
  for (const entry of collectHumanEntries(currentManifest)) {
    if (typeof entry.url === 'string') {
      humanUrls.add(entry.url);
    }
  }
  for (const url of humanUrls) {
    referenced.push(url);
  }
  return referenced;
}

function readGlb(absolutePath, label) {
  assertNonEmptyFile(absolutePath, label);
  const buffer = readFileSync(absolutePath);
  assert.equal(buffer.toString('ascii', 0, 4), 'glTF', label + ' must start with GLB magic glTF');
  const version = buffer.readUInt32LE(4);
  const declaredLength = buffer.readUInt32LE(8);
  assert.equal(declaredLength, buffer.length, label + ' declared GLB length must equal the file size');
  let offset = 12;
  let json = null;
  const chunks = [];
  while (offset + 8 <= buffer.length) {
    const chunkLength = buffer.readUInt32LE(offset);
    const chunkType = buffer.readUInt32LE(offset + 4);
    const dataStart = offset + 8;
    const dataEnd = dataStart + chunkLength;
    assert.ok(dataEnd <= buffer.length, label + ' chunk length overruns the file');
    chunks.push({ type: chunkType, length: chunkLength });
    if (chunkType === 0x4e4f534a) {
      const text = buffer.toString('utf8', dataStart, dataEnd).replace(/\u0000+$/u, '').trim();
      json = JSON.parse(text);
    }
    offset = dataEnd;
  }
  assert.ok(chunks.length > 0, label + ' must contain at least one GLB chunk');
  assert.equal(chunks[0].type, 0x4e4f534a, label + ' first chunk must be JSON');
  assert.ok(json, label + ' must contain a parseable JSON chunk');
  return { version, declaredLength, chunks, json };
}

test('manifest parses and declares the frozen schema', () => {
  const current = requireManifest();
  assert.equal(current.schemaVersion, 1, 'schemaVersion must be 1');
  assert.equal(current.baseUrl, 'resource/', 'baseUrl must be resource/');
  assert.match(current.generatedAt, /^\d{4}-\d{2}-\d{2}$/);
  assert.equal(typeof current.textures, 'object');
  assert.equal(typeof current.hdri, 'object');
  assert.equal(typeof current.models, 'object');
  assert.ok(Array.isArray(current.assets), 'assets must be an array');
  assert.ok(current.assets.length > 0, 'assets must not be empty');
});

test('every texture group exposes color, normal and roughness', () => {
  const current = requireManifest();
  const materialNames = ['ground', 'concrete', 'metal', 'wood', 'steel', 'fabric'];
  for (const materialName of materialNames) {
    const group = current.textures[materialName];
    assert.ok(group, 'texture group missing: ' + materialName);
    assert.equal(typeof group.color, 'string', materialName + '.color must be a string');
    assert.equal(typeof group.normal, 'string', materialName + '.normal must be a string');
    assert.equal(typeof group.roughness, 'string', materialName + '.roughness must be a string');
    for (const channelName of ['metalness', 'ao']) {
      if (Object.hasOwn(group, channelName)) {
        assert.equal(typeof group[channelName], 'string', materialName + '.' + channelName + ' must be a string');
      }
    }
  }
});

test('texture, HDRI and model references exist inside resource and are non-empty', () => {
  const current = requireManifest();
  const referenced = collectReferencedPaths(current);
  assert.ok(referenced.length >= 21, 'expected at least 21 referenced files');
  for (const relativeUrl of referenced) {
    assert.equal(typeof relativeUrl, 'string', 'referenced path must be a string');
    assert.ok(relativeUrl.length > 0, 'referenced path must not be empty');
    const absolutePath = resolveResourceFile(relativeUrl);
    assertNonEmptyFile(absolutePath, relativeUrl);
  }
});

test('every listed asset is CC0, exists, is non-empty and stays inside resource', () => {
  const current = requireManifest();
  const requiredFields = ['id', 'file', 'url', 'kind', 'source', 'author', 'license', 'downloadedAt'];
  for (const asset of current.assets) {
    for (const fieldName of requiredFields) {
      assert.equal(typeof asset[fieldName], 'string', 'asset ' + asset.id + ' is missing string field ' + fieldName);
      assert.ok(asset[fieldName].length > 0, 'asset ' + asset.id + ' field ' + fieldName + ' must not be empty');
    }
    assert.equal(asset.license, 'CC0', 'asset ' + asset.id + ' must be CC0');
    assert.ok(asset.file.startsWith('resource/'), 'asset ' + asset.id + ' file must start with resource/');
    assert.equal(asset.file, 'resource/' + asset.url, 'asset ' + asset.id + ' file must equal resource/ + url');
    assert.match(asset.source, /^https:\/\//, 'asset ' + asset.id + ' source must be an https URL');
    assert.match(asset.downloadedAt, /^\d{4}-\d{2}-\d{2}$/);
    const absolutePath = resolveResourceFile(asset.url);
    assertNonEmptyFile(absolutePath, asset.url);
    assertFileMagic(absolutePath, asset.url);
  }
});

test('assets array covers every referenced file exactly once', () => {
  const current = requireManifest();
  const referenced = collectReferencedPaths(current).slice().sort();
  const listed = current.assets.map((asset) => asset.url).slice().sort();
  assert.deepEqual(listed, referenced, 'assets[].url must match the texture/hdri/model references exactly');

  const identifiers = current.assets.map((asset) => asset.id);
  const uniqueIdentifiers = new Set(identifiers);
  assert.equal(uniqueIdentifiers.size, identifiers.length, 'asset ids must be unique');

  const files = current.assets.map((asset) => asset.file);
  const uniqueFiles = new Set(files);
  assert.equal(uniqueFiles.size, files.length, 'asset files must be unique');
});

test('HDRI sky and rifle model exist with valid magic bytes', () => {
  const current = requireManifest();
  const hdriPath = resolveResourceFile(current.hdri.sky);
  const riflePath = resolveResourceFile(current.models.rifle);
  assertNonEmptyFile(hdriPath, current.hdri.sky);
  assertNonEmptyFile(riflePath, current.models.rifle);
  assertFileMagic(hdriPath, current.hdri.sky);
  assertFileMagic(riflePath, current.models.rifle);
});

test('models.humans declares rifleman, heavy and breacher with valid model entries', () => {
  const current = requireManifest();
  assert.ok(current.models.humans, 'models.humans must exist');
  const humans = current.models.humans;
  const roles = ['rifleman', 'heavy', 'breacher'];
  for (const role of roles) {
    assert.ok(Array.isArray(humans[role]) && humans[role].length > 0, 'models.humans.' + role + ' must be a non-empty array');
  }
  assert.ok(humans.rifleman.length >= 2, 'rifleman must declare at least two model variants');
  const allowedAxes = new Set(['+Z', '-Z', '+X', '-X']);
  for (const role of roles) {
    for (const entry of humans[role]) {
      assert.equal(typeof entry.id, 'string', role + ' entry id must be a string');
      assert.ok(entry.id.length > 0, role + ' entry id must not be empty');
      assert.equal(typeof entry.file, 'string', role + ' entry ' + entry.id + ' file must be a string');
      assert.equal(typeof entry.url, 'string', role + ' entry ' + entry.id + ' url must be a string');
      assert.equal(entry.file, 'resource/' + entry.url, role + ' entry ' + entry.id + ' file must equal resource/ + url');
      assert.ok(Array.isArray(entry.animations), role + ' entry ' + entry.id + ' animations must be an array');
      assert.ok(entry.animations.length > 0, role + ' entry ' + entry.id + ' animations must not be empty');
      for (const animationName of entry.animations) {
        assert.equal(typeof animationName, 'string', role + ' entry ' + entry.id + ' animation names must be strings');
        assert.ok(animationName.length > 0, role + ' entry ' + entry.id + ' animation names must not be empty');
      }
      assert.equal(typeof entry.scale, 'number', role + ' entry ' + entry.id + ' scale must be a number');
      assert.ok(entry.scale > 0, role + ' entry ' + entry.id + ' scale must be positive');
      assert.ok(allowedAxes.has(entry.forwardAxis), role + ' entry ' + entry.id + ' forwardAxis must be one of +Z/-Z/+X/-X');
      assert.equal(typeof entry.rootMotion, 'boolean', role + ' entry ' + entry.id + ' rootMotion must be a boolean');
      assertNonEmptyFile(resolveResourceFile(entry.url), entry.url);
    }
  }
});

test('human GLBs have valid headers and JSON chunks and expose the declared animation clips', () => {
  const current = requireManifest();
  const humans = current.models.humans;
  const rifleKeyClips = ['Idle_Gun', 'Walk', 'Run', 'Run_Shoot', 'Gun_Shoot', 'HitRecieve', 'Death'];
  const breacherKeyClips = ['Man_Punch', 'Man_Run', 'Man_Walk', 'Man_Death'];
  const checkedUrls = new Set();
  for (const role of ['rifleman', 'heavy', 'breacher']) {
    for (const entry of humans[role]) {
      const parsed = readGlb(resolveResourceFile(entry.url), entry.url);
      assert.equal(parsed.version, 2, entry.url + ' must be glTF 2.0');
      assert.ok(Array.isArray(parsed.json.meshes) && parsed.json.meshes.length > 0, entry.url + ' must contain meshes');
      assert.ok(Array.isArray(parsed.json.skins) && parsed.json.skins.length > 0, entry.url + ' must contain a skin');
      for (const skin of parsed.json.skins) {
        assert.ok(Array.isArray(skin.joints) && skin.joints.length > 0, entry.url + ' skins must contain joints');
      }
      const clipNames = (parsed.json.animations || []).map((animation) => animation.name);
      assert.ok(clipNames.length > 0, entry.url + ' must contain animations');
      for (const listed of entry.animations) {
        assert.ok(clipNames.includes(listed), entry.url + ' does not contain declared animation ' + listed);
      }
      if (role === 'rifleman' || role === 'heavy') {
        for (const expectedSuffix of rifleKeyClips) {
          const declared = entry.animations.find((name) => name.split('|').pop() === expectedSuffix);
          assert.ok(declared, role + ' entry ' + entry.id + ' must declare the ' + expectedSuffix + ' clip');
          assert.ok(clipNames.includes(declared), entry.url + ' is missing the ' + expectedSuffix + ' clip');
        }
      } else {
        for (const expectedSuffix of breacherKeyClips) {
          const expectedName = 'HumanArmature|' + expectedSuffix;
          assert.ok(entry.animations.includes(expectedName), 'breacher entry ' + entry.id + ' must declare ' + expectedName);
          assert.ok(clipNames.includes(expectedName), entry.url + ' is missing ' + expectedName);
        }
      }
      checkedUrls.add(entry.url);
    }
  }
  assert.equal(checkedUrls.size, 4, 'expected the four distinct human GLB files to be checked');
});

test('each human GLB appears exactly once in assets as a CC0 Quaternius Poly Pizza model', () => {
  const current = requireManifest();
  const humanUrls = [...new Set(collectHumanEntries(current).map((entry) => entry.url))];
  assert.equal(humanUrls.length, 4, 'models.humans must reference four distinct GLB files');
  for (const url of humanUrls) {
    const matches = current.assets.filter((asset) => asset.url === url);
    assert.equal(matches.length, 1, url + ' must appear exactly once in assets');
    const asset = matches[0];
    assert.equal(asset.kind, 'model', url + ' asset kind must be model');
    assert.equal(asset.license, 'CC0', url + ' must be CC0');
    assert.match(asset.author, /Quaternius/, url + ' author must mention Quaternius');
    assert.match(asset.source, /^https:\/\/static\.poly\.pizza\//, url + ' source must be a Poly Pizza download URL');
    assert.equal(asset.file, 'resource/' + url, url + ' asset file must equal resource/ + url');
  }
});

test('ATTRIBUTIONS covers every asset and each source family', () => {
  const current = requireManifest();
  const attributions = readFileSync(attributionsPath, 'utf8');
  assert.match(attributions, /CC0/);
  assert.match(attributions, /Poly Haven/);
  assert.match(attributions, /ambientCG/);
  assert.match(attributions, /Poly Pizza/);
  assert.match(attributions, /Quaternius/);
  for (const familyName of ['Ground054', 'Concrete034', 'Metal032', 'Wood066', 'CorrugatedSteel009', 'Fabric084']) {
    assert.ok(attributions.includes(familyName), 'ATTRIBUTIONS must mention ' + familyName);
  }
  for (const humanFile of ['quaternius-adventurer.glb', 'quaternius-woman-casual.glb', 'quaternius-woman-formal.glb', 'quaternius-man-base.glb']) {
    assert.ok(attributions.includes(humanFile), 'ATTRIBUTIONS must mention ' + humanFile);
  }
  for (const asset of current.assets) {
    assert.ok(attributions.includes(asset.file), 'ATTRIBUTIONS must list ' + asset.file);
  }
});

test('resource has no archives or source-editor leftovers', () => {
  const forbiddenExtensions = new Set(['.zip', '.blend', '.usdc', '.mtlx', '.tres', '.png']);
  const offenders = [];
  for (const absolutePath of walkFiles(resourceDir)) {
    const extension = path.extname(absolutePath).toLowerCase();
    if (forbiddenExtensions.has(extension)) {
      offenders.push(path.relative(projectRoot, absolutePath));
    }
  }
  assert.deepEqual(offenders, [], 'unexpected leftover files: ' + offenders.join(', '));
});
