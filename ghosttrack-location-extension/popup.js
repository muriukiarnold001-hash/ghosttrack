(() => {
  "use strict";

  const LOCATION_KEY = "ghostTrackSpoof";
  const LAST_KEY = "ghostTrackLastLocation";

  const latInput = document.getElementById("lat");
  const lngInput = document.getElementById("lng");
  const status = document.getElementById("status");
  const activateButton = document.getElementById("activate");
  const stopButton = document.getElementById("stop");

  function show(message) {
    status.textContent = message;
  }

  function getStorage() {
    if (!globalThis.chrome?.storage?.local) {
      throw new Error(
        "Extension storage unavailable. Open this popup from the GhostTrack toolbar icon."
      );
    }

    return chrome.storage.local;
  }

  function validLocation(value) {
    if (!value) return false;

    const lat = Number(value.lat);
    const lng = Number(value.lng);

    return Number.isFinite(lat) &&
      Number.isFinite(lng) &&
      lat >= -90 && lat <= 90 &&
      lng >= -180 && lng <= 180;
  }

  async function load() {
    try {
      const saved = await getStorage().get([
        LOCATION_KEY,
        LAST_KEY
      ]);

      const active = saved[LOCATION_KEY];
      const last = saved[LAST_KEY];

      const location = validLocation(active)
        ? active
        : validLocation(last)
          ? last
          : null;

      if (location) {
        latInput.value = String(location.lat);
        lngInput.value = String(location.lng);
      }

      if (active?.active === true && validLocation(active)) {
        show(`Active: ${active.lat}, ${active.lng}`);
      } else if (location) {
        show("Saved coordinates loaded. Click Activate spoofing.");
      } else {
        show("Enter latitude and longitude to begin.");
      }
    } catch (error) {
      show(`Load failed: ${error.message}`);
    }
  }

  activateButton.addEventListener("click", async () => {
    try {
      const latText = latInput.value.trim();
      const lngText = lngInput.value.trim();

      if (!latText || !lngText) {
        show("Enter both latitude and longitude.");
        return;
      }

      const location = {
        lat: Number(latText),
        lng: Number(lngText)
      };

      if (!validLocation(location)) {
        show(
          "Invalid coordinates. Latitude must be -90 to 90; longitude -180 to 180."
        );
        return;
      }

      const activeLocation = {
        active: true,
        lat: location.lat,
        lng: location.lng,
        updatedAt: Date.now()
      };

      const storage = getStorage();

      await storage.set({
        [LAST_KEY]: location,
        [LOCATION_KEY]: activeLocation
      });

      const verify = await storage.get(LOCATION_KEY);
      const result = verify[LOCATION_KEY];

      if (
        result?.active !== true ||
        result.lat !== location.lat ||
        result.lng !== location.lng
      ) {
        throw new Error("Could not verify the saved coordinates.");
      }

      show(
        `Activated: ${location.lat}, ${location.lng}. Reload the target page to test.`
      );
    } catch (error) {
      show(`Activation failed: ${error.message}`);
    }
  });

  stopButton.addEventListener("click", async () => {
    try {
      await getStorage().set({
        [LOCATION_KEY]: {
          active: false,
          updatedAt: Date.now()
        }
      });

      show("Spoofing disabled. Saved coordinates retained.");
    } catch (error) {
      show(`Disable failed: ${error.message}`);
    }
  });

  load();
})();
