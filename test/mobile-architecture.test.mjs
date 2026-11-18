import assert from 'node:assert/strict';
import { access, readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import test from 'node:test';

const root = process.cwd();
const read = (relative) => readFile(path.join(root, relative), 'utf8');

async function walk(dir) {
  const result = [];
  for (const entry of await readdir(path.join(root, dir), { withFileTypes: true })) {
    const relative = path.join(dir, entry.name);
    if (entry.isDirectory()) result.push(...await walk(relative));
    else result.push(relative);
  }
  return result;
}

const pubspec = await read('pubspec.yaml');
const apiConfig = await read('lib/config/api_config.dart');
const apiClient = await read('lib/core/api/api_client.dart');
const cart = await read('lib/features/cart/presentation/cart_view_model.dart');
const orderRepository = await read('lib/features/orders/data/order_repository.dart');
const mapScreen = await read('lib/screens/map.dart');
const locationService = await read('lib/features/map/data/location_service.dart');
const manifest = await read('android/app/src/main/AndroidManifest.xml');
const gradle = await read('android/app/build.gradle.kts');
const routeSource = await read('backend/src/http/routes/v1/register.ts');
const appSource = await read('backend/src/http/app.ts');

const dartFiles = (await walk('lib')).filter((file) => file.endsWith('.dart'));
const dartSource = (await Promise.all(dartFiles.map(read))).join('\n');
const screenFiles = dartFiles.filter((file) => file.includes(`${path.sep}screens${path.sep}`) || file.startsWith('lib/screens/'));
const screenSource = (await Promise.all(screenFiles.map(read))).join('\n');

test('mobile production networking uses one Dio boundary and canonical /api/v1 routes', async () => {
  assert.match(pubspec, /^\s+dio:/m);
  assert.doesNotMatch(pubspec, /^\s+http:/m);
  assert.doesNotMatch(pubspec, /^\s+shared_preferences:/m);
  assert.doesNotMatch(dartSource, /package:http\//);
  assert.match(apiConfig, /10\.0\.2\.2:8080/);
  const debugManifest = await read('android/app/src/debug/AndroidManifest.xml');
  const debugNetwork = await read('android/app/src/debug/res/xml/debug_network_security_config.xml');
  assert.match(debugManifest, /networkSecurityConfig="@xml\/debug_network_security_config"/);
  assert.match(debugNetwork, /base-config cleartextTrafficPermitted="false"/);
  assert.deepEqual([...debugNetwork.matchAll(/<domain\b[^>]*>([^<]+)<\/domain>/g)].map((match) => match[1]), ['10.0.2.2', '127.0.0.1']);
  assert.doesNotMatch(manifest, /usesCleartextTraffic="true"|debug_network_security_config/);
  assert.match(apiConfig, /apiPrefix\s*=\s*'\/api\/v1'/);
  assert.doesNotMatch(screenSource, /\bDio\s*\(|\.dio\.(get|post|put|delete)\s*\(/);
  assert.doesNotMatch(screenSource, /context\.(read|watch)<[^>]*Repository|features\/[^'\"]*\/data\/[^'\"]*_repository\.dart/);
  await assert.rejects(access(path.join(root, 'lib/services')));
});

test('refresh is single-flight and atomically persists both rotated credentials', () => {
  assert.match(apiClient, /Future<String\?>\? _refreshInFlight/);
  assert.match(apiClient, /ApiConfig\.apiPath\('\/auth\/refresh'\)/);
  assert.match(apiClient, /newAccessToken/);
  assert.match(apiClient, /newRefreshToken/);
  assert.match(apiClient, /saveTokens\(\s*newAccessToken,\s*newRefreshToken/s);
  assert.doesNotMatch(apiClient, /saveTokens\(\s*newAccessToken,\s*refreshToken/s);
});

test('cart and checkout are user-scoped, centavo based, one-pharmacy and idempotent', () => {
  assert.match(cart, /nearpill_cart_user_\$_userId/);
  assert.match(cart, /nearpill_checkout_idempotency_user_\$_userId/);
  assert.match(cart, /priceCentavos/);
  assert.match(cart, /item\.drugstoreId\)\.toSet\(\)\.length\s*>\s*1/);
  assert.match(cart, /mobile-\$\{bytes\.map/);
  assert.match(orderRepository, /Idempotency-Key/);
  assert.match(orderRepository, /ApiConfig\.apiPath\('\/orders'\)/);
});

test('map flow uses runtime location permission with verified-pharmacy API and manual fallback', () => {
  assert.equal(/google_maps_flutter:\s*2\.18\.1/.test(pubspec), true);
  assert.match(pubspec, /geolocator:\s*14\.0\.2/);
  assert.match(mapScreen, /GoogleMap\(/);
  assert.match(mapScreen, /labelText: 'Search pharmacies'/);
  assert.match(mapScreen, /\.searchManually\(query\)/);
  assert.match(locationService, /Geolocator\.checkPermission/);
  assert.match(locationService, /Geolocator\.requestPermission/);
  assert.match(locationService, /LocationPermission\.deniedForever/);
  assert.match(dartSource, /\/stores\/nearby/);
});

test('Android release config cannot silently use example identity, debug signing, or a blank Maps key', () => {
  assert.doesNotMatch(gradle, /com\.example\.nearpill/);
  assert.doesNotMatch(gradle, /signingConfigs\.getByName\("debug"\)|signingConfig\s*=\s*signingConfigs\.debug/);
  assert.match(gradle, /NEARPILL_APPLICATION_ID/);
  assert.match(gradle, /key\.properties is required for release signing/);
  assert.match(gradle, /MAPS_API_KEY/);
  assert.match(manifest, /ACCESS_COARSE_LOCATION/);
  assert.match(manifest, /ACCESS_FINE_LOCATION/);
  assert.match(manifest, /com\.google\.android\.geo\.API_KEY/);
});

test('first-party web and mobile cutover removes unversioned API compatibility routes', () => {
  assert.doesNotMatch(routeSource, /compatibilityHandler|app\.on\(spec\.method/);
  assert.doesNotMatch(appSource, /X-NearPill-Compatibility|successor-version|app\.get\('\/api\/health'/);
  assert.match(appSource, /app\.get\('\/api\/v1\/health'/);
});
