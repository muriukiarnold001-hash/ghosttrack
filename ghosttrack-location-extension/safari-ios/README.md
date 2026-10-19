# GhostTrack Safari extension component

This folder is part of the existing GhostTrack project. It is not a second dashboard: the current GhostTrack dashboard remains the place to choose a map location and press its existing Spoof/Activate button. The Safari bridge accepts the dashboard's existing `GHOSTTRACK_APP` messages from the approved GhostTrack origins, stores the coordinates in Safari extension storage, and shares them with the page-world geolocation override.

## Package and install on iPhone

Apple requires a Safari Web Extension to be embedded in an iOS app. On a Mac with Xcode, create an **iOS > Safari Extension App** project and place `manifest.json`, `main.js`, and `bridge.js` into the generated extension target's resources. Build and install that app on the iPhone, then enable GhostTrack under **Settings > Safari > Extensions** and grant website access.

After enabling it, open the existing GhostTrack dashboard in Safari, select a location on its map, and use the existing Spoof/Activate button. Then open or reload the target Safari site. If using the dashboard hosted at `https://ghosttrack.onrender.com`, the origin is already allowed by the bridge. Local `127.0.0.1` on the iPhone refers to the iPhone itself, so use the hosted dashboard unless the GhostTrack server has separately been made reachable on the local network.

This source uses a `MAIN`-world content script and targets current Safari releases with that WebExtension feature. Safari asks for permission to inject on websites; allow the sites where the override should run. This changes browser geolocation API results in Safari pages only, not iPhone system GPS, other apps, or IP-based location.

## Source files

- `manifest.json` declares Safari website access and the two document-start scripts.
- `main.js` is shared with the existing Chrome extension and overrides page geolocation, including `watchPosition`.
- `bridge.js` uses Safari's `browser.storage` API (with a Chrome namespace fallback) and communicates with GhostTrack's existing dashboard.
