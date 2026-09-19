/* AI News Hub — release.js  AH-03 manifest verification and versioned LKG cache */

const RELEASE_MANIFEST_URL = 'data/release-manifest.json';
const RELEASE_SCHEMA_VERSION = 1;
const RELEASE_COMPATIBILITY_VERSION = 'ai-news-hub-web-data-v1';
const RELEASE_CACHE_VERSION = 1;
const RELEASE_CACHE_KEY = 'ainews-release-cache-v1';
const RELEASE_MANAGED_PATHS = Object.freeze([
  'data/latest.json', 'data/health.json', 'data/index.json', 'data/skills.json',
]);
const RELEASE_SHA256_RE = /^[a-f0-9]{64}$/;
const RELEASE_ID_RE = /^ahr1_[a-f0-9]{64}$/;
let RELEASE_ACTIVE = null;
let RELEASE_STATE = {mode:'not_loaded', verified:false, degraded:false, release_id:null, error:null};

function releaseError(code, detail) {
  const error = new Error(detail ? `${code}: ${detail}` : code);
  error.code = code;
  return error;
}
function releasePlain(value) { return !!value && typeof value === 'object' && !Array.isArray(value); }
function releaseCanonical(value) {
  if (Array.isArray(value)) return value.map(releaseCanonical);
  if (releasePlain(value)) return Object.fromEntries(Object.keys(value).sort().map(key => [key, releaseCanonical(value[key])]));
  return value;
}
async function releaseSha256(raw) {
  if (!globalThis.crypto?.subtle) throw releaseError('hash_unavailable');
  const bytes = new TextEncoder().encode(raw);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), byte => byte.toString(16).padStart(2, '0')).join('');
}
function releaseValidDateTime(value) {
  return typeof value === 'string' && /^\d{4}-\d{2}-\d{2}T/.test(value) && Number.isFinite(Date.parse(value));
}
function releaseManifestShape(manifest) {
  const topKeys = ['schema_version','compatibility_version','cache_version','release_id','created_at','content_set_sha256','assets'];
  if (!releasePlain(manifest) || Object.keys(manifest).some(key => !topKeys.includes(key))) return false;
  if (manifest.schema_version !== RELEASE_SCHEMA_VERSION
      || manifest.compatibility_version !== RELEASE_COMPATIBILITY_VERSION
      || manifest.cache_version !== RELEASE_CACHE_VERSION
      || !RELEASE_ID_RE.test(manifest.release_id || '')
      || !releaseValidDateTime(manifest.created_at)
      || !RELEASE_SHA256_RE.test(manifest.content_set_sha256 || '')
      || !Array.isArray(manifest.assets)
      || manifest.assets.length !== RELEASE_MANAGED_PATHS.length) return false;
  const seen = new Set();
  const assetKeys = ['path','sha256','bytes','media_type','schema_version','required'];
  for (const asset of manifest.assets) {
    if (!releasePlain(asset) || Object.keys(asset).some(key => !assetKeys.includes(key))
        || !RELEASE_MANAGED_PATHS.includes(asset.path) || seen.has(asset.path)
        || !RELEASE_SHA256_RE.test(asset.sha256 || '')
        || !Number.isSafeInteger(asset.bytes) || asset.bytes < 0
        || asset.media_type !== 'application/json'
        || !Number.isSafeInteger(asset.schema_version) || asset.schema_version < 1
        || asset.required !== true) return false;
    seen.add(asset.path);
  }
  return RELEASE_MANAGED_PATHS.every(path => seen.has(path));
}
async function releaseVerifyManifest(manifest) {
  if (!releaseManifestShape(manifest)) throw releaseError('manifest_schema_invalid');
  const contentDescriptor = manifest.assets.map(asset => ({
    path:asset.path, sha256:asset.sha256, bytes:asset.bytes, schema_version:asset.schema_version,
  }));
  const contentHash = await releaseSha256(JSON.stringify(releaseCanonical(contentDescriptor)));
  if (contentHash !== manifest.content_set_sha256) throw releaseError('manifest_content_set_mismatch');
  const identity = {
    schema_version:manifest.schema_version,
    compatibility_version:manifest.compatibility_version,
    cache_version:manifest.cache_version,
    created_at:manifest.created_at,
    content_set_sha256:manifest.content_set_sha256,
    assets:manifest.assets,
  };
  const releaseId = `ahr1_${await releaseSha256(JSON.stringify(releaseCanonical(identity)))}`;
  if (releaseId !== manifest.release_id) throw releaseError('manifest_release_id_mismatch');
  return manifest;
}

async function releaseFetchText(url, ms=10000) {
  const ctrl = new AbortController();
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => { ctrl.abort(); reject(releaseError('release_fetch_timeout')); }, ms);
  });
  try {
    return await Promise.race([timeout, (async()=>{
      const response = await fetch(url, {signal:ctrl.signal, cache:'no-store'});
      if (response.status === 404) throw releaseError('release_not_found');
      if (!response.ok) throw releaseError('release_http_error', String(response.status));
      return response.text();
    })()]);
  } finally { clearTimeout(timer); }
}
async function releaseFetchManifest() {
  const separator = RELEASE_MANIFEST_URL.includes('?') ? '&' : '?';
  const raw = await releaseFetchText(`${RELEASE_MANIFEST_URL}${separator}v=${Date.now()}`, 8000);
  let manifest;
  try { manifest = JSON.parse(raw); } catch { throw releaseError('manifest_json_invalid'); }
  return releaseVerifyManifest(manifest);
}
function releaseReadStoredCache() {
  try {
    const cache = JSON.parse(localStorage.getItem(RELEASE_CACHE_KEY));
    return releasePlain(cache)
      && cache.cache_version === RELEASE_CACHE_VERSION
      && cache.compatibility_version === RELEASE_COMPATIBILITY_VERSION
      && releasePlain(cache.assets) ? cache : null;
  } catch { return null; }
}
function releaseWriteStoredCache(cache) {
  try { localStorage.setItem(RELEASE_CACHE_KEY, JSON.stringify(cache)); return true; }
  catch { return false; }
}
async function releaseVerifyCachedAsset(record, asset) {
  if (!releasePlain(record) || record.sha256 !== asset.sha256 || record.bytes !== asset.bytes || typeof record.raw !== 'string') {
    throw releaseError('cached_asset_metadata_mismatch', asset.path);
  }
  const bytes = new TextEncoder().encode(record.raw).byteLength;
  if (bytes !== asset.bytes || await releaseSha256(record.raw) !== asset.sha256) throw releaseError('cached_asset_hash_mismatch', asset.path);
  try { JSON.parse(record.raw); } catch { throw releaseError('cached_asset_json_invalid', asset.path); }
  return record;
}
async function releaseFetchAsset(asset, releaseId) {
  const separator = asset.path.includes('?') ? '&' : '?';
  const raw = await releaseFetchText(`${asset.path}${separator}release=${encodeURIComponent(releaseId)}`, 10000);
  const bytes = new TextEncoder().encode(raw).byteLength;
  if (bytes !== asset.bytes) throw releaseError('asset_size_mismatch', asset.path);
  if (await releaseSha256(raw) !== asset.sha256) throw releaseError('asset_hash_mismatch', asset.path);
  try { JSON.parse(raw); } catch { throw releaseError('asset_json_invalid', asset.path); }
  return {sha256:asset.sha256, bytes:asset.bytes, raw};
}
async function releaseVerifiedCache(cache) {
  if (!cache) throw releaseError('verified_cache_missing');
  const manifest = await releaseVerifyManifest(cache.manifest);
  const assets = {};
  for (const asset of manifest.assets) assets[asset.path] = await releaseVerifyCachedAsset(cache.assets[asset.path], asset);
  return {...cache, manifest, assets};
}
function releaseActivate(cache, state={}) {
  RELEASE_ACTIVE = cache;
  RELEASE_STATE = {
    mode:'manifest', verified:true, degraded:false,
    release_id:cache.manifest.release_id, error:null, ...state,
  };
  return {
    mode:'manifest', manifest:cache.manifest,
    assets:Object.fromEntries(Object.entries(cache.assets).map(([path, record]) => [path, JSON.parse(record.raw)])),
    state:{...RELEASE_STATE},
  };
}
async function releaseFallback(prior, error) {
  try {
    const verified = await releaseVerifiedCache(prior);
    return releaseActivate(verified, {degraded:true, error:error.code || 'release_load_failed'});
  } catch { throw error; }
}

async function loadReleaseBundle() {
  const stored = releaseReadStoredCache();
  let manifest;
  try { manifest = await releaseFetchManifest(); }
  catch (error) {
    if (error.code === 'release_not_found') {
      const prior = RELEASE_ACTIVE || stored;
      if (prior) return releaseFallback(prior, error);
      RELEASE_ACTIVE = null;
      RELEASE_STATE = {mode:'legacy_unverified', verified:false, degraded:false, release_id:null, error:null};
      return {mode:'legacy', manifest:null, assets:null, state:{...RELEASE_STATE}};
    }
    return releaseFallback(RELEASE_ACTIVE || stored, error);
  }
  const source = RELEASE_ACTIVE || stored;
  try {
    const assets = {};
    for (const asset of manifest.assets) {
      const reusable = source?.assets?.[asset.path];
      if (reusable && reusable.sha256 === asset.sha256 && reusable.bytes === asset.bytes) {
        try { assets[asset.path] = await releaseVerifyCachedAsset(reusable, asset); }
        catch { assets[asset.path] = await releaseFetchAsset(asset, manifest.release_id); }
      } else {
        assets[asset.path] = await releaseFetchAsset(asset, manifest.release_id);
      }
    }
    const next = {
      cache_version:RELEASE_CACHE_VERSION,
      compatibility_version:RELEASE_COMPATIBILITY_VERSION,
      manifest,
      assets,
    };
    releaseWriteStoredCache(next);
    return releaseActivate(next);
  } catch (error) { return releaseFallback(RELEASE_ACTIVE || stored, error); }
}

function releaseReadJSON(path) {
  const record = RELEASE_ACTIVE?.assets?.[path];
  if (!record) return null;
  try { return JSON.parse(record.raw); } catch { return null; }
}
