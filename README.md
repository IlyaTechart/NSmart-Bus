# NSmart Bus · Trecker NS

**Novi Sad buses on a map: GPS positions, stop arrivals, and timetables in one Android app.**

This repository is a fork of Paul’s [katurov/NSBusTablica](https://github.com/katurov/NSBusTablica), extended with the Trecker NS Android app. The original project’s history, server, and firmware are preserved. Its original documentation is available in [UPSTREAM.md](UPSTREAM.md); the app is located in [`app/`](app/).

Trecker NS helps you see where a bus is, choose a route, and find out when transport will arrive at your stop. The app uses NSmart data and the official GSP Novi Sad timetable. The interface is available in Russian and English, while route and stop names are preserved from their sources.

[**Download APK 1.9**](https://github.com/IlyaTechart/NSmart-Bus/releases/download/v1.9/Trecker.apk) · [All releases](https://github.com/IlyaTechart/NSmart-Bus/releases)

<p>
  <img src="docs/images/map.png" width="260" alt="Novi Sad bus map">
  <img src="docs/images/map-collapsed.png" width="260" alt="Map with the panel collapsed">
  <img src="docs/images/route.png" width="260" alt="Selected route">
</p>

## Features

- A vector map with a custom light style: a blue Danube, green parks, and subdued street colors.
- Urban and suburban routes, with search by number or neighborhood name.
- Russian and English interface languages, switched instantly from the side menu and saved across restarts.
- Three position types: fresh GPS, an estimate based on the last GPS fix, and a timetable-based prediction.
- Estimated markers move along the road network between stops while preserving their ETA. Road geometry is bundled into the APK and does not require a separate routing server.
- A “GPS only” filter and a button to go to your own location.
- Clustering of nearby buses with their count and route numbers. Tapping a cluster zooms in; at high zoom levels, overlapping markers spread out.
- A collapsible “On the map now” card: drag its top edge down or tap the arrow. Swipe up to expand it again.
- Stop arrivals when you tap a stop circle, plus departure timetables from terminals.
- The stop panel closes with a large close button or a downward swipe from its top edge. You can also drag the list itself down when it is scrolled to the top.
- Caching of the stop catalog, discovered routes, and timetables.

## Installation

1. Download [Trecker.apk from a release](https://github.com/IlyaTechart/NSmart-Bus/releases/latest).
2. Open the APK on Android and, if prompted, allow installation from the browser or file manager you used.
3. Launch the app with an internet connection. Location permission is needed only for the “Where am I” button.

**Android 7.0 or newer is required.** The map and current arrivals are downloaded from the network; this is not a fully offline app. The vector map requires a WebView with WebGL support; without it, a raster map is used as a fallback.

## What the colors mean

| Marker | Source | Interpretation |
| --- | --- | --- |
| Green · GPS | Fresh coordinates from NSmart | The latest known GPS position. It may also arrive with a delay. |
| Gold · Estimated | A previously received GPS fix and times to stops | An approximate position after the last fresh GPS fix. |
| Light · Timetable | The GSP timetable and known travel time | A prediction without real GPS. It does not confirm that the bus actually started its trip. |

NSmart provides arrival data for individual stops, so the app polls a set of stops and gradually builds a picture of traffic. Buses appear as responses arrive; the map does not guarantee complete transport coverage. A repeated response with the same coordinates is not treated as a new GPS fix.

The timetable shows **departure from the terminal**, not a promised arrival time at any stop. Times are calculated for the `Europe/Belgrade` time zone.

### Conservative NSmart polling

Since version 1.9, startup is faster: the first GPS request to a major stop in the visible area is sent before the basemap is initialized, and data is displayed as soon as the response arrives. Updating the bundled/saved catalog waits for the first four GPS requests. Initial stops are selected to cover different local lines. Saved rate limits and error backoff periods are also respected during startup.

Since version 1.8, a shared limit of **20 network requests in any 60 seconds** applies, with at least **3 seconds** between requests and only one request in flight. It is shared by the map, manual refresh, the stop panel, and catalog downloads; moving the map does not reset it. Budget history and backoff periods are saved locally across app restarts.

A response for a stop is reused for **30 seconds**. Concurrent requests for it are coalesced, and ETAs are recalculated from the original response’s receipt time. The cache does not make GPS data fresher. In a wide view, polling every stop can take more than a minute; positions are estimated locally between responses.

After HTTP 403/429, the app pauses for at least **5 minutes**, increasing the pause on repeated errors up to **30 minutes**; a longer server-provided `Retry-After` is also respected. Other errors cause a growing pause from 15 seconds to 5 minutes. No new requests are sent in the background, including requests already waiting in the queue.

This is our load-reduction policy, not a published NSmart quota. The budget applies per app instance, not per external IP address: users on the same Wi-Fi/mobile network may share an address. In the APK, requests are sent from the client device. The browser `devserver` is a local development tool: its proxy sends requests from the computer running it.

Tapping a bus highlights the route and stops for its exact direction and line variant with a bright green line and a soft halo. In its card, tap “Show full route.” The close button above the map clears the selection; if a line was selected beforehand, its routes are restored. Selecting a bus does not send additional NSmart requests. An unavailable route is never replaced with another line, and sections without road geometry are shown as approximate dashed segments.

Road snapping covers Novi Sad and nearby areas. It uses the stop sequence and the OpenStreetMap road network rather than official bus route geometry. Outside the coverage area, or when no suitable path is available, approximate interpolation remains; this is noted in the bus popup. Special bus exceptions and all turn restrictions are absent from the vector data used. For details about the data and how to update it, see [`app/www/data/ROADS.md`](app/www/data/ROADS.md).

## Development

The app consists of HTML/CSS/JavaScript running in an Android WebView and a small Java wrapper. The wrapper performs network requests to NSmart/GSP, handles location permission, and supports the system Back button. No server is required for the APK to work.

```text
app/
  www/                  interface, map, movement model, and bundled libraries
  android/              Java wrapper, AndroidManifest, and resources
  tools/                local server, tests, and test data
  build.ps1             APK build and signing
docs/images/            interface screenshots
```

### Running in a browser

Node.js 18 or newer is required:

```sh
cd app
npm start
```

Open `http://localhost:8787`. The local server proxies requests to the data sources, replacing the Android bridge. Run it only in a trusted local environment. To view an individual route, use `http://localhost:8787/#focus=9`.

### Checks

The core tests require neither npm packages nor network access:

```sh
cd app
npm test
```

For UI checks, install the dependencies and Chrome, then start the local server in a separate terminal:

```sh
npm ci
npm start
```

In another terminal, from the `app` directory:

```sh
npm run test:ui
npm run preview
```

If Chrome is installed in a nonstandard location, set the `CHROME_PATH` environment variable to its executable. The UI tests cover touch gestures, panels, bus retention while zooming, cluster expansion, the GPS filter, repeated stop refreshes, and Russian/English switching with persistence. Automated tests do not poll NSmart/GSP: they use mock responses and, for rate checks, a virtual clock. These data are not included in the app. The separate `preview` command uses network sources and saves screenshots.

### Building the APK on Windows

JDK 17 and an Android SDK with `platforms;android-34` and `build-tools;34.0.0` are required. Android Studio and Gradle are not necessary.

Expected tool directory structure:

```text
trecker-tools/
  jdk/bin/java.exe
  sdk/platforms/android-34/android.jar
  sdk/build-tools/34.0.0/
```

```powershell
$env:TRECKER_TOOLS = 'C:\path\to\trecker-tools'
powershell -ExecutionPolicy Bypass -File app/build.ps1
```

The result is `Trecker.apk` in the project root. Without `TRECKER_TOOLS`, the script uses the `trecker-tools` folder in the current user’s profile.

The `app/android/trecker.keystore` signing key is not stored in the repository. If it is absent, the script creates a local development key. An APK signed with a different key cannot be installed over the release version as an update. Keep your key for subsequent builds of your own.

## Sources and acknowledgments

- [NSmart](https://online.nsmart.rs/) — transport arrival and movement data.
- [GSP Novi Sad](https://www.gspns.rs/) — the official timetable.
- [OpenFreeMap](https://openfreemap.org/), [OpenMapTiles](https://openmaptiles.org/), [OpenStreetMap](https://www.openstreetmap.org/copyright) — map data and the vector basemap.
- [Leaflet](https://leafletjs.com/), [MapLibre GL JS](https://maplibre.org/), Leaflet.markercluster, and Manrope — libraries and the font. Licenses for bundled components are in `app/www/lib/`.
- [katurov/NSBusTablica](https://github.com/katurov/NSBusTablica) — approaches to working with NSmart, handling stale coordinates, and making predictions; the provenance of the test data is described in `app/tools/fixtures/README.md`.

This is an independent project, not an official NSmart or GSP Novi Sad app. Data availability and prediction accuracy depend on external services. /Android
