# OTC catalog and pharmacy discovery contract

NearPill's **approved transaction scope** is OTC-only. Publication requires approved evidence and a recorded OTC eligibility review under migration 0009. Catalogue browsing may display unreviewed source listings with an explicit status, but does not make them eligible for ordering. Do not treat a source document, demo fixture, or a `published` status as regulatory approval. Real pharmacy and medicine reviews remain required before live use.

## Publication authority

A medicine starts as `draft`. It can be changed to `published` only by an authenticated administrator, with approved `medicine_evidence` and a recorded OTC eligibility decision. Legacy restricted-medicine rows are migrated to `retired`; legacy non-restricted rows are migrated to `draft`, not auto-published.

A pharmacy starts with `verification_status = pending`. A public profile is visible only when the store is active, an administrator has recorded verification evidence, its status is `verified`, and `public_profile_published_at` is set. Development fixtures are synthetic and are not verification evidence.

Partners may update stock only for an active pharmacy membership that grants `inventory:adjust`. Catalog publication and inventory price authority remain administrator-only.

## Search

`GET /api/v1/medicines` returns only published medicines with currently sellable inventory at a verified public pharmacy. Text search uses PostgreSQL full-text search with trigram fallback and bounded pagination.

`view=catalog` includes draft and published source listings at those pharmacies, including entries with unconfirmed stock. It returns `publicationStatus`, `canOrder`, stock count, and original names. Retired entries remain excluded. `latitude` and `longitude` must be supplied together and add `distanceKm`, measured in a straight line, sorted nearest first. Stable inventory-ID ordering prevents ties from duplicating paginated rows. The mobile Search page loads pages of 50, up to the existing 1,000 offset limit. It displays review/stock status and disables ordering when `canOrder` is false.

`GET /api/v1/stores/:id/inventory?view=catalog` uses the same browsing rule. Omitting `view=catalog` retains the available-only API contract. Migration 0019 grants only SELECT under a transaction-local `catalog_browse` capability used by these two repository reads. It does not grant writes, alter existing ordering/publication policies, or expose tables through Supabase Data API roles.

`GET /api/v1/stores` returns only verified, published pharmacy profiles. `GET /api/v1/stores/nearby` accepts either:

- `latitude` + `longitude`, with optional `radiusKm` capped at 25 km; or
- `q` for manual pharmacy/address lookup when location is unavailable or declined.

Coordinate queries use an indexed bounding box and then an exact `earth_distance` check. The mobile Map separately loads the full verified/public store list, so pharmacies outside the 5 km nearby boundary remain visible. It merges duplicate IDs with nearby results, calculates straight-line distances from the permitted device position, sorts nearest first, and fits the camera to the displayed pins and user. If the nearby response is empty, the map shows “No verified pharmacies within 5 km. Try searching by name or area.” together with the full listing. A nearby-query failure shows a retry message rather than claiming no pharmacies are nearby. Without location permission, the listed pharmacy pins remain visible, without invented user coordinates or distances. This does not guarantee medicine stock, and pending/inactive pharmacies remain excluded by the existing API.

## Mobile/map permission and error behavior

1. Do not request device location merely because the app starts.
2. Ask only after the user invokes nearby discovery.
3. If permission is granted and coordinates are valid, call the bounded nearby endpoint.
4. If permission is declined, GPS is unavailable, coordinates are invalid/stale, or acquisition fails, keep discovery usable through the manual `q` search path.
5. Display network/provider errors as retryable errors rather than replacing them with fabricated pharmacies.
6. Outside-service-area/empty results are valid empty states, not verification failures.
7. The Flutter map plots actual pharmacy coordinates and supports opening each pharmacy's inventory and directions.
8. Opening Search or refreshing medicines requests one permitted position for the whole catalogue request. If location is unavailable, listings remain browsable and show `Distance unavailable`. The Map page shows the user's location only with permission; manual search never invents a user position.

## Cache policy

Successful public catalog/pharmacy GET responses without coordinates use a short shared-cache policy (`max-age=60`, `stale-while-revalidate=300`). Requests with location coordinates use `private, no-store`. PostgreSQL remains authoritative. Authenticated/private endpoints are not made public-cacheable by this policy.
