(() => {
  "use strict";

  const extensionApi = globalThis.browser ?? globalThis.chrome;
  if (!extensionApi?.storage?.local) {
    console.error("GhostTrack: Safari extension storage is unavailable.");
    return;
  }

  const KEY = "ghostTrackSpoof";
  const LAST_KEY = "ghostTrackLastLocation";
  const GHOSTTRACK_ORIGINS = new Set([
    "http://127.0.0.1:8000",
    "http://localhost:8000",
    "https://ghosttrack.onrender.com"
  ]);
  let revision = 0;
  let requestId = 0;

  function validLocation(value) {
    return value &&
      value.active === true &&
      typeof value.lat === "number" &&
      Number.isFinite(value.lat) &&
      value.lat >= -90 && value.lat <= 90 &&
      typeof value.lng === "number" &&
      Number.isFinite(value.lng) &&
      value.lng >= -180 && value.lng <= 180;
  }

  async function publishLocation() {
    const id = ++requestId;
    try {
      const result = await extensionApi.storage.local.get(KEY);
      if (id !== requestId) return;

      const saved = result[KEY];
      const location = validLocation(saved)
        ? { active: true, lat: saved.lat, lng: saved.lng }
        : { active: false };

      window.postMessage({
        source: "GHOSTTRACK_EXTENSION",
        revision: ++revision,
        location
      }, "*");
    } catch (error) {
      console.error("GhostTrack bridge storage error:", error);
    }
  }

  window.addEventListener("message", event => {
    if (event.source !== window) return;
    const message = event.data;

    if (message?.source === "GHOSTTRACK_READY") {
      publishLocation();
      return;
    }

    if (!GHOSTTRACK_ORIGINS.has(event.origin) ||
        message?.source !== "GHOSTTRACK_APP" ||
        !Number.isSafeInteger(message.requestId)) return;

    (async () => {
      try {
        if (message.action === "activate" && validLocation({ ...message.location, active: true })) {
          const location = {
            lat: message.location.lat,
            lng: message.location.lng
          };
          await extensionApi.storage.local.set({
            [LAST_KEY]: location,
            [KEY]: { ...location, active: true, updatedAt: Date.now() }
          });
        } else if (message.action === "disable") {
          const current = await extensionApi.storage.local.get(LAST_KEY);
          const values = { [KEY]: { active: false, updatedAt: Date.now() } };
          if (current[LAST_KEY]) values[LAST_KEY] = current[LAST_KEY];
          await extensionApi.storage.local.set(values);
        } else {
          throw new Error("Invalid location request.");
        }

        window.postMessage({
          source: "GHOSTTRACK_EXTENSION_RESULT",
          requestId: message.requestId,
          ok: true
        }, "*");
      } catch (error) {
        console.error("GhostTrack extension sync failed:", error);
        window.postMessage({
          source: "GHOSTTRACK_EXTENSION_RESULT",
          requestId: message.requestId,
          ok: false,
          reason: error.message
        }, "*");
      }
    })();
  });

  extensionApi.storage.onChanged.addListener((changes, area) => {
    if (area === "local" && changes[KEY]) publishLocation();
  });

  publishLocation();
})();
