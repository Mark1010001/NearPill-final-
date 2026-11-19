import 'dart:math' as math;
import 'dart:ui' as ui;
import 'package:flutter/material.dart';
import 'package:nearpill/widgets/np_icon.dart';
import 'package:google_maps_flutter/google_maps_flutter.dart';
import 'package:provider/provider.dart';
import 'package:url_launcher/url_launcher.dart';

import '../features/map/presentation/map_view_model.dart';
import '../features/pharmacy/domain/pharmacy.dart';
import 'home_store_detail.dart';

class MapScreen extends StatefulWidget {
  const MapScreen({super.key});

  @override
  State<MapScreen> createState() => _MapScreenState();
}

class _MapScreenState extends State<MapScreen> with WidgetsBindingObserver {
  final _manualSearch = TextEditingController();
  late final MapViewModel _model;
  GoogleMapController? _mapController;
  BitmapDescriptor? _userMarker;

  @override
  void initState() {
    super.initState();
    WidgetsBinding.instance.addObserver(this);
    _model = context.read<MapViewModel>();
    _loadUserMarker();
    _model.addListener(_resultsChanged);
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _model.loadNearby();
    });
  }

  @override
  void dispose() {
    WidgetsBinding.instance.removeObserver(this);
    _model.removeListener(_resultsChanged);
    _model.closeRoute();
    _manualSearch.dispose();
    _mapController?.dispose();
    super.dispose();
  }

  Future<void> _loadUserMarker() async {
    final recorder = ui.PictureRecorder();
    final canvas = Canvas(recorder);
    canvas.drawCircle(const Offset(40, 40), 38, Paint()..color = Colors.white);
    canvas.drawCircle(
      const Offset(40, 40),
      33,
      Paint()..color = const Color(0xFF1565C0),
    );
    canvas.drawCircle(const Offset(40, 30), 9, Paint()..color = Colors.white);
    canvas.drawRRect(
      RRect.fromRectAndRadius(
        const Rect.fromLTWH(24, 43, 32, 19),
        const Radius.circular(10),
      ),
      Paint()..color = Colors.white,
    );
    final picture = recorder.endRecording();
    try {
      final image = await picture.toImage(80, 80);
      try {
        final bytes = await image.toByteData(format: ui.ImageByteFormat.png);
        if (mounted && bytes != null) {
          setState(
            () => _userMarker = BitmapDescriptor.bytes(
              bytes.buffer.asUint8List(),
              width: 40,
              height: 40,
            ),
          );
        }
      } finally {
        image.dispose();
      }
    } catch (_) {
      // Keep the blue location pin if the custom marker cannot be rendered.
    } finally {
      picture.dispose();
    }
  }

  @override
  void didChangeAppLifecycleState(AppLifecycleState state) {
    if (state == AppLifecycleState.resumed && _model.selectedStore != null) {
      _model.selectRoute(_model.selectedStore!);
    } else if (state != AppLifecycleState.resumed) {
      _model.pauseTracking();
    }
  }

  void _resultsChanged() {
    if (_model.state != MapLoadState.ready &&
        _model.state != MapLoadState.manualFallback) {
      return;
    }
    WidgetsBinding.instance.addPostFrameCallback((_) {
      if (mounted) _fitResults();
    });
  }

  Future<void> _fitResults() async {
    final controller = _mapController;
    if (controller == null ||
        (_model.state != MapLoadState.ready &&
            _model.state != MapLoadState.manualFallback)) {
      return;
    }
    final points =
        (_model.selectedStore == null ? _model.stores : [_model.selectedStore!])
            .where((store) => store.hasCoordinates)
            .map((store) => LatLng(store.latitude!, store.longitude!))
            .toSet();
    for (final point in _model.route?.coordinates ?? <List<double>>[]) {
      points.add(LatLng(point[1], point[0]));
    }
    if (_model.latitude != null && _model.longitude != null) {
      points.add(LatLng(_model.latitude!, _model.longitude!));
    }
    if (points.isEmpty) return;
    CameraUpdate camera;
    if (points.length == 1) {
      camera = CameraUpdate.newLatLngZoom(points.single, 15);
    } else {
      var south = points.first.latitude;
      var north = south;
      var west = points.first.longitude;
      var east = west;
      for (final point in points.skip(1)) {
        south = math.min(south, point.latitude);
        north = math.max(north, point.latitude);
        west = math.min(west, point.longitude);
        east = math.max(east, point.longitude);
      }
      camera = CameraUpdate.newLatLngBounds(
        LatLngBounds(
          southwest: LatLng(south, west),
          northeast: LatLng(north, east),
        ),
        48,
      );
    }
    try {
      await controller.moveCamera(camera);
    } catch (_) {
      debugPrint('Map camera update unavailable.');
    }
  }

  void _search(String query) {
    FocusScope.of(context).unfocus();
    _model.searchManually(query);
  }

  void _retry() {
    if (_manualSearch.text.trim().isEmpty) {
      _model.loadNearby();
    } else {
      _search(_manualSearch.text);
    }
  }

  Future<void> _openDirections(Pharmacy store) async {
    final uri = store.directionsUri;
    if (uri == null) return;
    try {
      if (await launchUrl(uri, mode: LaunchMode.externalApplication)) return;
    } catch (_) {
      // The pharmacy list remains usable when an external maps app is unavailable.
    }
    if (!mounted) return;
    ScaffoldMessenger.of(context).showSnackBar(
      const SnackBar(
        content: Text('Could not open directions. Please try again.'),
      ),
    );
  }

  @override
  Widget build(BuildContext context) {
    final model = context.watch<MapViewModel>();
    final stores = model.stores;
    final loading = model.state == MapLoadState.loading;
    final markers = stores
        .where((store) => store.hasCoordinates)
        .map(
          (store) => Marker(
            markerId: MarkerId('pharmacy-${store.id}'),
            position: LatLng(store.latitude!, store.longitude!),
            infoWindow: InfoWindow(title: store.name, snippet: store.address),
            icon: BitmapDescriptor.defaultMarkerWithHue(
              BitmapDescriptor.hueGreen,
            ),
            onTap: () => model.selectRoute(store),
          ),
        )
        .toSet();
    if (model.latitude != null && model.longitude != null) {
      markers.add(
        Marker(
          markerId: const MarkerId('current-user'),
          position: LatLng(model.latitude!, model.longitude!),
          icon:
              _userMarker ??
              BitmapDescriptor.defaultMarkerWithHue(BitmapDescriptor.hueAzure),
          anchor: Offset(0.5, _userMarker == null ? 1 : 0.5),
          zIndexInt: 10,
          infoWindow: const InfoWindow(
            title: 'You are here',
            snippet: 'Your current location',
          ),
        ),
      );
    }

    return Scaffold(
      appBar: AppBar(title: const Text('NearPill')),
      body: SafeArea(
        top: false,
        child: Column(
          children: [
            Padding(
              padding: const EdgeInsets.fromLTRB(16, 8, 12, 8),
              child: Row(
                children: [
                  Expanded(
                    child: TextField(
                      controller: _manualSearch,
                      maxLength: 160,
                      textInputAction: TextInputAction.search,
                      onSubmitted: _search,
                      decoration: InputDecoration(
                        labelText: 'Search pharmacies',
                        hintText: 'Name, street, or area',
                        counterText: '',
                        suffixIcon: IconButton(
                          tooltip: 'Search pharmacies',
                          onPressed: () => _search(_manualSearch.text),
                          icon: const NpIcon(NpIcons.search),
                        ),
                      ),
                    ),
                  ),
                  const SizedBox(width: 8),
                  IconButton.filledTonal(
                    tooltip: 'Use current location',
                    onPressed: loading
                        ? null
                        : () {
                            _manualSearch.clear();
                            FocusScope.of(context).unfocus();
                            model.loadNearby();
                          },
                    icon: const NpIcon(NpIcons.my_location),
                  ),
                ],
              ),
            ),
            if (MediaQuery.viewInsetsOf(context).bottom == 0)
              const Padding(
                padding: EdgeInsets.only(bottom: 8),
                child: Wrap(
                  alignment: WrapAlignment.center,
                  spacing: 16,
                  children: [
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        NpIcon(
                          NpIcons.account_circle,
                          color: Color(0xFF1565C0),
                          size: 20,
                        ),
                        SizedBox(width: 4),
                        Text('You'),
                      ],
                    ),
                    Row(
                      mainAxisSize: MainAxisSize.min,
                      children: [
                        NpIcon(
                          NpIcons.local_pharmacy,
                          color: Color(0xFF2E7D32),
                          size: 20,
                        ),
                        SizedBox(width: 4),
                        Text('Pharmacies'),
                      ],
                    ),
                  ],
                ),
              ),
            Expanded(
              flex: 3,
              child: GoogleMap(
                initialCameraPosition: const CameraPosition(
                  target: LatLng(10.3157, 123.8854),
                  zoom: 12,
                ),
                onMapCreated: (controller) {
                  _mapController = controller;
                  _resultsChanged();
                },
                markers: markers,
                polylines: {
                  if (model.route != null)
                    Polyline(
                      polylineId: const PolylineId('selected-road-route'),
                      points: model.route!.coordinates
                          .map((p) => LatLng(p[1], p[0]))
                          .toList(),
                      color: const Color(0xFF1976D2),
                      width: 6,
                      startCap: Cap.roundCap,
                      endCap: Cap.roundCap,
                    ),
                },
                myLocationButtonEnabled: false,
                myLocationEnabled: model.latitude != null,
                compassEnabled: true,
                mapToolbarEnabled: false,
              ),
            ),
            Expanded(
              flex: model.selectedStore == null ? 2 : 3,
              child: model.selectedStore != null
                  ? SingleChildScrollView(child: _routeCard(model))
                  : _pharmacyResults(model, loading),
            ),
          ],
        ),
      ),
    );
  }

  Widget _pharmacyResults(MapViewModel model, bool loading) {
    final stores = model.stores;
    return ListView.builder(
      keyboardDismissBehavior: ScrollViewKeyboardDismissBehavior.onDrag,
      padding: const EdgeInsets.symmetric(horizontal: 8),
      itemCount: stores.length + 1,
      itemBuilder: (context, index) {
        if (index == 0) {
          return Padding(
            padding: const EdgeInsets.fromLTRB(8, 10, 8, 4),
            child: Column(
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Semantics(
                  liveRegion: true,
                  child: Text(
                    loading
                        ? 'Finding verified pharmacies…'
                        : stores.length == 1
                        ? '1 verified pharmacy'
                        : '${stores.length} verified pharmacies',
                    style: Theme.of(context).textTheme.titleSmall,
                  ),
                ),
                if (loading) ...[
                  const SizedBox(height: 8),
                  const LinearProgressIndicator(),
                ] else if (model.message case final message?)
                  Semantics(liveRegion: true, child: Text(message))
                else if (stores.isEmpty)
                  const Text(
                    'Search by pharmacy or area to find verified pharmacies.',
                  ),
                if (model.state == MapLoadState.error)
                  TextButton(onPressed: _retry, child: const Text('Try again')),
              ],
            ),
          );
        }
        final store = stores[index - 1];
        final distance = store.distanceKm;
        return ListTile(
          leading: const NpIcon(NpIcons.local_pharmacy),
          title: Text(store.name),
          subtitle: Text(
            distance == null
                ? store.address
                : '${store.address}\n${distance.toStringAsFixed(1)} km away',
          ),
          isThreeLine: distance != null,
          onTap: () => _openStore(store),
          trailing: IconButton(
            tooltip: 'Directions to ${store.name}',
            onPressed: store.directionsUri == null
                ? null
                : () => model.selectRoute(store),
            icon: const NpIcon(NpIcons.directions),
          ),
        );
      },
    );
  }

  Widget _routeCard(MapViewModel model) {
    final store = model.selectedStore!;
    final route = model.route;
    return Card(
      margin: const EdgeInsets.all(12),
      child: Padding(
        padding: const EdgeInsets.all(16),
        child: Column(
          mainAxisSize: MainAxisSize.min,
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Row(
              children: [
                const NpIcon(NpIcons.local_pharmacy, color: Colors.green),
                const SizedBox(width: 8),
                Expanded(
                  child: Text(
                    store.name,
                    style: Theme.of(context).textTheme.titleMedium,
                  ),
                ),
                IconButton(
                  tooltip: 'Close route',
                  onPressed: model.closeRoute,
                  icon: const NpIcon(NpIcons.close),
                ),
              ],
            ),
            Text(store.address, maxLines: 2, overflow: TextOverflow.ellipsis),
            const SizedBox(height: 8),
            if (model.routeLoading)
              const LinearProgressIndicator(
                semanticsLabel: 'Finding driving route',
              ),
            if (route != null)
              Text(
                '${(route.distanceMeters / 1000).toStringAsFixed(2)} km by road · ${math.max(1, (route.durationSeconds / 60).ceil())} min estimated',
                style: const TextStyle(fontWeight: FontWeight.bold),
              ),
            if (model.routeError != null)
              Text(
                model.routeError!,
                style: TextStyle(color: Theme.of(context).colorScheme.error),
              ),
            const Text(
              'Driving route by Google Maps. Estimated time excludes live traffic.',
              style: TextStyle(fontSize: 12),
            ),
            const Text(
              'Your location is shared with Google for routing while this route is open.',
              style: TextStyle(fontSize: 12),
            ),
            Wrap(
              spacing: 8,
              children: [
                TextButton.icon(
                  onPressed: model.routeLoading
                      ? null
                      : () => model.selectRoute(store),
                  icon: const NpIcon(NpIcons.refresh),
                  label: const Text('Refresh route'),
                ),
                TextButton(
                  onPressed: () => _openStore(store),
                  child: const Text('View medicines'),
                ),
                FilledButton.icon(
                  onPressed: () => _openDirections(store),
                  icon: const NpIcon(NpIcons.navigation),
                  label: const Text('Navigate'),
                ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Future<void> _openStore(Pharmacy store) async {
    FocusScope.of(context).unfocus();
    _model.pauseTracking();
    await Navigator.of(
      context,
    ).pushNamed(StoreDetailScreen.routeName, arguments: store.id.toString());
    if (mounted && _model.selectedStore != null) {
      _model.selectRoute(_model.selectedStore!);
    }
  }
}
