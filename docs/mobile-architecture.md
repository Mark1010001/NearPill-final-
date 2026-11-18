# NearPill mobile architecture

The existing Flutter application is the only NearPill mobile client. Its production data flow is now organized around one Dio transport and feature repositories/view models rather than direct screen networking.

## Runtime boundary

- `lib/core/api/api_client.dart` owns HTTP transport, authorization headers, retry, and single-flight refresh.
- `lib/core/auth/session_manager.dart` owns secure credential persistence.
- Feature repositories own `/api/v1` I/O for identity, catalog, pharmacy discovery, and orders.
- View models own cart, order, and map UI state.
- Screens render state and invoke repository/view-model commands; they do not create their own HTTP clients.
- The Android emulator default is `http://10.0.2.2:8080`, the NGINX boundary, and can be overridden with `--dart-define=API_BASE_URL=...`.

## Credential rotation

A 401 triggers one shared refresh operation. The backend's new access and refresh credentials are both required and are stored atomically. Failed rotation clears the local session. The old refresh credential is never persisted after successful rotation.

## Cart and checkout

The local cart is scoped by authenticated user ID. Prices are integer centavos and one pharmacy is enforced per cart/order. The mobile client persists an idempotency key for a stable checkout attempt and sends it to the authoritative `/api/v1/orders` endpoint. Client totals remain display-only.

## Pharmacy map

Opening the map requests the current location. Denied, disabled, or unavailable location supports manual pharmacy, street, or area search against the verified-pharmacy discovery API. New requests discard older replies and clear stale pins. The Google map fits valid pharmacy coordinates and the actual GPS position. Manual search never supplies a simulated user position or distance. Selecting a pharmacy opens its inventory and the directions button opens Google Maps with that pharmacy's coordinates. Inventory remains subject to the pharmacy's last update.

## Driving route preview

The user's valid location has a blue circular person marker with a white border, drawn above green pharmacy pins. A visible `You / Pharmacies` legend identifies the symbols; tapping the user marker shows `You are here`. Without a permitted location no user marker is added. A blue pin is the fallback if the person icon cannot be rendered.

Selecting a pharmacy marker or its directions icon previews a Google driving route inside the map. The route card shows road distance and estimated time without live traffic, plus refresh, pharmacy inventory and external navigation actions. The current-location dot updates in the foreground. While a route is selected, position updates use a 25-metre distance filter and road routes recalculate at most once every 15 seconds. Closing the route, leaving the map, opening inventory or backgrounding the app cancels tracking. Late replies cannot restore a closed route.

The authenticated `GET /api/v1/stores/:id/route` endpoint accepts current coordinates and resolves the destination from the verified public pharmacy record. Google requests run on the server with `GOOGLE_ROUTES_API_KEY`, use a minimal response field mask, an eight-second timeout, and a one-request-per-second limit per user per API process. Responses are private and not cached. Invalid geometry and provider failures clear the path and offer retry/external navigation, never a fabricated straight-line road route. No OSRM requests are used. Public deployment also needs an appropriately restricted server key, Google Cloud quotas and billing monitoring; Routes API usage may incur charges.

## Android release controls

Release builds require an owner-approved application ID, `android/key.properties`, and a Maps API key. The Gradle configuration refuses a release when those values are absent and never falls back to debug signing. `android/key.properties.example` documents the local key metadata shape without containing credentials.

Set `MAPS_API_KEY` in the ignored `android/local.properties`, the build environment, or a Gradle property. Keep the key out of tracked source and restrict it to Maps SDK for Android with the application's package name and signing certificate SHA-1. Coordinate search uses the NearPill API and directions use a Google Maps URL.

## Dependency compatibility

The project remains on Dart 3.12.2. `google_maps_flutter` is pinned to 2.18.1 because that release supports Dart 3.10+, whereas 2.19.0 requires Dart 3.13. The `http` and `shared_preferences` packages were removed because production networking and session/cart persistence no longer use them.

## Verification

Run:

```bash
npm run verify:mobile
```

The source-level mobile architecture contract runs everywhere. When Flutter is installed, the same command additionally performs `flutter pub get`, `flutter analyze`, and `flutter test`. In environments without Flutter it returns exit code 2 to distinguish an unavailable runtime from a code failure.

A production Android release additionally requires owner-supplied application identity, Maps credentials, and signing material. Those values are intentionally not invented or committed to source.
