(() => {
  "use strict";

  if (window.__ghostTrackGeoInstalled) return;

  const geo = navigator.geolocation;
  if (!geo) {
    console.error("GhostTrack: Geolocation API unavailable.");
    return;
  }

  window.__ghostTrackGeoInstalled = true;

  let spoof = { active: false };
  let lastRevision = 0;
  let nextId = 1;
  const watches = new Map();

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

  function makePosition() {
    return {
      coords: {
        latitude: spoof.lat,
        longitude: spoof.lng,
        accuracy: 10,
        altitude: null,
        altitudeAccuracy: null,
        heading: null,
        speed: null
      },
      timestamp: Date.now()
    };
  }

  const originalGet = geo.getCurrentPosition.bind(geo);
  const originalWatch = geo.watchPosition.bind(geo);
  const originalClear = geo.clearWatch.bind(geo);

  function stopNativeWatch(watch) {
    if (watch.nativeId === null) return;
    originalClear(watch.nativeId);
    watch.nativeId = null;
  }

  function stopSpoofTimer(watch) {
    if (watch.timer === null) return;
    clearInterval(watch.timer);
    watch.timer = null;
  }

  function sendSpoofedPosition(watch) {
    if (!spoof.active || !watches.has(watch.id)) return;
    try {
      watch.success(makePosition());
    } catch (error) {
      console.error("GhostTrack: watch callback failed.", error);
    }
  }

  function startSpoofWatch(watch) {
    stopNativeWatch(watch);
    if (watch.timer === null) {
      watch.timer = setInterval(() => sendSpoofedPosition(watch), 1000);
    }
    sendSpoofedPosition(watch);
  }

  function startNativeWatch(watch) {
    stopSpoofTimer(watch);
    if (watch.nativeId !== null) return;

    watch.nativeId = originalWatch(
      position => {
        if (spoof.active) sendSpoofedPosition(watch);
        else if (watches.has(watch.id)) watch.success(position);
      },
      error => {
        if (!spoof.active && watches.has(watch.id) && typeof watch.error === "function") {
          watch.error(error);
        }
      },
      watch.options
    );
  }

  function handleMessage(event) {
    if (
      event.source !== window ||
      event.data?.source !== "GHOSTTRACK_EXTENSION"
    ) return;

    const message = event.data;
    if (!Number.isSafeInteger(message.revision) || message.revision <= lastRevision) return;
    lastRevision = message.revision;

    if (validLocation(message.location)) {
      spoof = {
        active: true,
        lat: message.location.lat,
        lng: message.location.lng
      };
      for (const watch of watches.values()) startSpoofWatch(watch);
      console.info("GhostTrack: spoofing active", {
        latitude: spoof.lat,
        longitude: spoof.lng
      });
    } else if (message.location?.active === false) {
      spoof = { active: false };
      for (const watch of watches.values()) startNativeWatch(watch);
      console.info("GhostTrack: spoofing disabled");
    } else {
      console.warn("GhostTrack: invalid location message.");
    }
  }

  window.addEventListener("message", handleMessage);

  try {
    Object.defineProperty(geo, "getCurrentPosition", {
      configurable: true,
      writable: true,
      value(success, error, options) {
        if (typeof success !== "function") {
          throw new TypeError("A success callback is required.");
        }
        if (!spoof.active) return originalGet(success, error, options);
        setTimeout(() => success(makePosition()), 0);
      }
    });

    Object.defineProperty(geo, "watchPosition", {
      configurable: true,
      writable: true,
      value(success, error, options) {
        if (typeof success !== "function") {
          throw new TypeError("A success callback is required.");
        }

        const id = nextId++;
        const watch = { id, success, error, options, nativeId: null, timer: null };
        watches.set(id, watch);

        if (spoof.active) startSpoofWatch(watch);
        else startNativeWatch(watch);
        return id;
      }
    });

    Object.defineProperty(geo, "clearWatch", {
      configurable: true,
      writable: true,
      value(id) {
        const watch = watches.get(id);
        if (!watch) return originalClear(id);
        watches.delete(id);
        stopSpoofTimer(watch);
        stopNativeWatch(watch);
      }
    });

    console.info("GhostTrack: geolocation override installed");
  } catch (error) {
    console.error("GhostTrack: override installation failed.", error);
  }

  window.postMessage({ source: "GHOSTTRACK_READY" }, "*");
})();
