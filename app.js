// ===============================
// ðŸ—ºï¸ MAP SETUP + TILE LAYERS
// ===============================
const TILES = {
  dark:  "https://tiles.stadiamaps.com/tiles/alidade_smooth_dark/{z}/{x}/{y}{r}.png",
  light: "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png",
};
let isDarkMap = true;
const map = L.map("map").setView([12.9716, 77.5946], 13);
let tileLayer = L.tileLayer(TILES.dark, { attribution: "OpenStreetMap" }).addTo(map);

// ===============================
// GHOSTTRACK_BROWSER_LOCATION
// User location requires browser permission.
// ===============================
(() => {
  const button = document.getElementById("locate-me");
  const status = document.getElementById("location-status");

  if (!button || !status) return;

  let userMarker = null;
  let accuracyCircle = null;
  let watchId = null;

  function showStatus(message) {
    status.textContent = message;
  }

  button.addEventListener("click", () => {
    if (!("geolocation" in navigator)) {
      showStatus("Geolocation is not supported by this browser.");
      return;
    }

    button.disabled = true;
    button.textContent = "Locating...";
    showStatus("Requesting location permission...");

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const lat = position.coords.latitude;
        const lng = position.coords.longitude;
        const accuracy = position.coords.accuracy;
        const point = [lat, lng];

        if (!userMarker) {
          userMarker = L.circleMarker(point, {
            radius: 9,
            color: "#ffffff",
            weight: 3,
            fillColor: "#00aaff",
            fillOpacity: 1
          }).addTo(map);

          userMarker.bindTooltip("Your location");
          accuracyCircle = L.circle(point, {
            radius: accuracy,
            color: "#00aaff",
            weight: 1,
            fillColor: "#00aaff",
            fillOpacity: 0.12
          }).addTo(map);
        } else {
          userMarker.setLatLng(point);
          accuracyCircle.setLatLng(point);
          accuracyCircle.setRadius(accuracy);
        }

        // Prevent simulated bus updates from pulling the map away.
        if (typeof follow !== "undefined") {
          follow = false;
          const followButton = document.getElementById("toggle-follow");
          if (followButton) followButton.textContent = "Follow: OFF";
        }

        map.setView(point, 16);
        showStatus(
          `Your location found. Accuracy: approximately ${Math.round(accuracy)} m.`
        );

        button.textContent = "◎ Update My Location";
        button.disabled = false;

        // Keep the marker updated while this page remains open.
        if (watchId === null) {
          watchId = navigator.geolocation.watchPosition(
            (nextPosition) => {
              const nextPoint = [
                nextPosition.coords.latitude,
                nextPosition.coords.longitude
              ];
              userMarker.setLatLng(nextPoint);
              accuracyCircle.setLatLng(nextPoint);
              accuracyCircle.setRadius(nextPosition.coords.accuracy);
            },
            (error) => {
              showStatus("Live location update stopped: " + error.message);
            },
            { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
          );
        }
      },
      (error) => {
        const messages = {
          1: "Location permission denied. Allow location access in your browser settings.",
          2: "Your location is currently unavailable. Check device location settings.",
          3: "Location request timed out. Try again."
        };
        showStatus(messages[error.code] || "Unable to get your location.");
        button.textContent = "◎ Locate Me";
        button.disabled = false;
      },
      { enableHighAccuracy: true, maximumAge: 5000, timeout: 15000 }
    );
  });
})();

// ðŸŒ™ MAP TOGGLE
document.getElementById("map-toggle").onclick = () => {
  isDarkMap = !isDarkMap;
  map.removeLayer(tileLayer);
  tileLayer = L.tileLayer(isDarkMap ? TILES.dark : TILES.light, { attribution: "OpenStreetMap" }).addTo(map);
  document.getElementById("map-toggle").innerText = isDarkMap ? "ðŸŒ™" : "â˜€ï¸";
  document.body.classList.toggle("light-map", !isDarkMap);
};

// ===============================
// ðŸŽ¨ BUS CONFIG
// ===============================
const BUS_CONFIG = {
  "BUS-01": { color: "#ff6600" },
  "BUS-02": { color: "#00aaff" },
  "BUS-03": { color: "#cc44ff" },
};

// ===============================
// ðŸŒ GLOBAL STATE
// ===============================
let follow = true, mode = "normal", selectedBus = "BUS-01";

const busState = {};
Object.keys(BUS_CONFIG).forEach(id => {
  busState[id] = {
    marker: null, realLine: null, predictedLine: null, futurePolyline: null,
    stopMarkers: [], routePolyline: null, routeWaypoints: [],
    realPath: [], predictedPath: [], buffer: [],
    isPredicting: false, isDelayed: false, slowTicks: 0,
    packetLoss: 0, recoveryCount: 0,
  };
});

const DELAY_SPEED = 15, DELAY_TICKS = 4;
let delayToastTimeout = null;

// Charts
const MAX_CHART = 40;
const speedHistory = [], confidenceHistory = [], lossHistory = [], chartLabels = [];
let tickCount = 0, speedChart, confidenceChart, lossChart;

// ===============================
// ðŸš CREATE BUS MARKERS
// ===============================
function createBusIcon(color) {
  return L.divIcon({
    className: "",
    html: `<div style="width:20px;height:20px;background:${color};border:3px solid #fff;border-radius:50%;box-shadow:0 0 0 3px ${color},0 0 14px ${color};"></div>`,
    iconSize: [20, 20], iconAnchor: [10, 10],
  });
}

Object.keys(BUS_CONFIG).forEach(id => {
  const color = BUS_CONFIG[id].color;
  busState[id].marker        = L.marker([12.97, 77.59], { icon: createBusIcon(color) }).addTo(map);
  busState[id].marker.bindTooltip(id, { permanent: true, direction: "top", className: "bus-label" });
  busState[id].realLine      = L.polyline([], { color, weight: 3, opacity: 0.85 }).addTo(map);
  busState[id].predictedLine = L.polyline([], { color: "#ff4444", weight: 2, dashArray: "5,5" }).addTo(map);
});

// ===============================
// â° LIVE CLOCK + PEAK BADGE
// ===============================
function isPeakHour() {
  const h = new Date().getHours();
  return (h >= 8 && h < 10) || (h >= 17 && h < 19);
}
function updateClock() {
  const now = new Date();
  document.getElementById("live-clock").innerText =
    [now.getHours(), now.getMinutes(), now.getSeconds()]
      .map(n => String(n).padStart(2, "0")).join(":");
  const badge = document.getElementById("peak-badge");
  if (isPeakHour()) { badge.innerText = "ðŸ”´ Peak Hours"; badge.className = "badge-peak"; }
  else              { badge.innerText = "ðŸŸ¢ Off Peak";   badge.className = "badge-offpeak"; }
}
setInterval(updateClock, 1000);
updateClock();

// ===============================
// ðŸš STOP ARRIVAL PREDICTIONS
// ===============================
function renderStopPredictions(busId, stopEtas) {
  if (!stopEtas || stopEtas.length === 0) return;
  document.getElementById("stop-panel-bus").innerText = busId;
  const list = document.getElementById("stop-list");
  list.innerHTML = "";
  stopEtas.forEach(stop => {
    const row = document.createElement("div");
    row.className = "stop-row" + (stop.passed ? " stop-passed" : "");
    const icon = stop.passed ? "âœ…" : "ðŸš";
    const etaText = stop.passed ? "Passed" : `~${stop.eta_min} min`;
    const etaClass = stop.passed ? "stop-eta-passed" : stop.eta_min <= 2 ? "stop-eta-soon" : "stop-eta-normal";
    row.innerHTML = `
      <span class="stop-icon">${icon}</span>
      <span class="stop-name">${stop.name}</span>
      <span class="${etaClass}">${etaText}</span>
    `;
    list.appendChild(row);
  });
}

// ===============================
// ðŸš¦ DELAY ALERT
// ===============================
function checkDelay(busId, speed, eta) {
  const bs = busState[busId];
  if (speed < DELAY_SPEED) {
    bs.slowTicks++;
  } else {
    if (bs.isDelayed) { bs.isDelayed = false; if (busId === selectedBus) showDelayResolved(busId); }
    bs.slowTicks = 0;
    if (busId === selectedBus) hideDelayBanner();
  }
  if (bs.slowTicks >= DELAY_TICKS && !bs.isDelayed) {
    bs.isDelayed = true;
    if (busId === selectedBus) showDelayAlert(busId, speed, eta);
  }
  if (bs.isDelayed && busId === selectedBus) {
    document.getElementById("delay-banner-text").innerText =
      `ðŸš¦ ${busId} â€” Heavy Traffic | Speed: ${speed} km/h | ETA: ${eta} min`;
    document.getElementById("delay-banner").style.display = "flex";
  }
}

function showDelayAlert(busId, speed, eta) {
  const toast = document.getElementById("delay-toast");
  document.getElementById("delay-toast-title").innerText = `ðŸš¦ ${busId} â€” Heavy Traffic`;
  document.getElementById("delay-toast-title").style.color = "#ff6600";
  toast.style.borderColor = "#ff6600"; toast.style.background = "rgba(30,10,0,0.96)";
  document.getElementById("delay-toast-speed").innerText = speed + " km/h";
  document.getElementById("delay-toast-eta").innerText   = eta + " min";
  toast.style.display = "flex";
  if (delayToastTimeout) clearTimeout(delayToastTimeout);
  delayToastTimeout = setTimeout(() => { toast.style.display = "none"; }, 6000);
}

function showDelayResolved(busId) {
  const toast = document.getElementById("delay-toast");
  document.getElementById("delay-toast-title").innerText = `âœ… ${busId} â€” Traffic Cleared`;
  document.getElementById("delay-toast-title").style.color = "#00ffcc";
  toast.style.borderColor = "#00ffcc"; toast.style.background = "rgba(0,30,15,0.96)";
  document.getElementById("delay-toast-speed").innerText = "Resumed";
  document.getElementById("delay-toast-eta").innerText   = "Recalculating";
  toast.style.display = "flex";
  if (delayToastTimeout) clearTimeout(delayToastTimeout);
  delayToastTimeout = setTimeout(() => { toast.style.display = "none"; }, 4000);
  hideDelayBanner();
}

function hideDelayBanner() { document.getElementById("delay-banner").style.display = "none"; }
document.getElementById("delay-toast-close").onclick = () => {
  document.getElementById("delay-toast").style.display = "none";
};

// ===============================
// ðŸ”® FUTURE PATH
// ===============================
function renderFuturePath(busId, futurePositions) {
  const bs = busState[busId];
  const color = BUS_CONFIG[busId].color;
  if (bs.futurePolyline) { map.removeLayer(bs.futurePolyline); bs.futurePolyline = null; }
  if (futurePositions && futurePositions.length > 0) {
    bs.futurePolyline = L.polyline(futurePositions.map(p => [p.lat, p.lng]), {
      color, weight: 2, dashArray: "4,8", opacity: 0.55
    }).addTo(map);
  }
}

// ===============================
// ðŸ“ ROUTE PROGRESS BAR
// ===============================
function updateProgressBar(busId, currentWpIdx, totalWaypoints) {
  const pct = totalWaypoints > 1 ? Math.round((currentWpIdx / (totalWaypoints - 1)) * 100) : 0;
  document.getElementById("progress-bar-fill").style.width = pct + "%";
  document.getElementById("progress-marker").style.left    = Math.min(pct, 97) + "%";
  document.getElementById("progress-pct").innerText = `${busId}: ${pct}% complete`;
  document.getElementById("stops-passed").innerText = pct >= 100 ? "âœ… Arrived" : "ðŸšŒ En Route";
}

// ===============================
// ðŸ” GEOCODE + OSRM ROUTING
// ===============================
async function geocode(name) {
  const res  = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(name)}&format=json&limit=1`, { headers: { "Accept-Language": "en" } });
  const data = await res.json();
  if (!data.length) return null;
  return { lat: parseFloat(data[0].lat), lng: parseFloat(data[0].lon), name: data[0].display_name.split(",")[0] };
}

async function getRoadRoute(start, end) {
  const res  = await fetch(`https://router.project-osrm.org/route/v1/driving/${start.lng},${start.lat};${end.lng},${end.lat}?overview=full&geometries=geojson`);
  const data = await res.json();
  if (!data.routes || !data.routes.length) return null;
  return data.routes[0].geometry.coordinates.map(c => [c[1], c[0]]);
}

function drawRoute(busId, waypoints, sName, eName) {
  const bs    = busState[busId];
  const color = BUS_CONFIG[busId].color;
  if (bs.routePolyline) map.removeLayer(bs.routePolyline);
  bs.stopMarkers.forEach(m => map.removeLayer(m));
  bs.stopMarkers = [];

  bs.routePolyline = L.polyline(waypoints, { color, weight: 3, opacity: 0.25, dashArray: "6,10" }).addTo(map);
  bs.stopMarkers.push(
    L.circleMarker(waypoints[0], { radius:7, color, fillColor:color, fillOpacity:1, weight:2 })
      .bindTooltip("ðŸŸ¢ " + sName).addTo(map)
  );
  bs.stopMarkers.push(
    L.circleMarker(waypoints[waypoints.length-1], { radius:7, color:"#ff4444", fillColor:"#ff4444", fillOpacity:1, weight:2 })
      .bindTooltip("ðŸ " + eName).addTo(map)
  );
  map.fitBounds(bs.routePolyline.getBounds(), { padding: [50, 50] });
}

document.getElementById("btn-set-route").onclick = async () => {
  const busId = document.getElementById("route-bus-select").value;
  const sIn   = document.getElementById("input-start").value.trim();
  const eIn   = document.getElementById("input-end").value.trim();
  const stEl  = document.getElementById("route-status");

  if (!sIn || !eIn) { stEl.innerText = "âš ï¸ Enter both locations."; stEl.style.color = "orange"; return; }
  stEl.innerText = "ðŸ” Searching..."; stEl.style.color = "#aaa";

  const start = await geocode(sIn + ", Bengaluru");
  const end   = await geocode(eIn + ", Bengaluru");
  if (!start) { stEl.innerText = "âŒ Not found: " + sIn; stEl.style.color = "red"; return; }
  if (!end)   { stEl.innerText = "âŒ Not found: " + eIn; stEl.style.color = "red"; return; }

  stEl.innerText = "ðŸ—ºï¸ Fetching road route...";
  const waypoints = await getRoadRoute(start, end);
  if (!waypoints) { stEl.innerText = "âŒ Road route not found."; stEl.style.color = "red"; return; }

  busState[busId].routeWaypoints = waypoints;
  busState[busId].realPath       = [];
  busState[busId].predictedPath  = [];
  busState[busId].realLine.setLatLngs([]);
  busState[busId].predictedLine.setLatLngs([]);
  drawRoute(busId, waypoints, start.name, end.name);

  if (busId === selectedBus) {
    document.getElementById("label-start").innerText = "ðŸ“ " + start.name;
    document.getElementById("label-end").innerText   = "ðŸ " + end.name;
  }

  if (socket && socket.readyState === WebSocket.OPEN)
    socket.send(JSON.stringify({ bus_id: busId, route: waypoints }));

  stEl.innerText = `âœ… ${busId} route set (${waypoints.length} pts)`; stEl.style.color = "#00ffcc";
};

// ===============================
// âœ• RESET ROUTE
// ===============================
document.getElementById("btn-reset-route").onclick = () => {
  const busId = document.getElementById("route-bus-select").value;
  const bs = busState[busId];

  if (bs.routePolyline) { map.removeLayer(bs.routePolyline); bs.routePolyline = null; }
  bs.stopMarkers.forEach(m => map.removeLayer(m));
  bs.stopMarkers = [];
  bs.realPath = [];
  bs.predictedPath = [];
  bs.realLine.setLatLngs([]);
  bs.predictedLine.setLatLngs([]);

  document.getElementById("input-start").value = "";
  document.getElementById("input-end").value = "";
  document.getElementById("route-status").innerText = "Route cleared";
  document.getElementById("route-status").style.color = "#aaa";
  document.getElementById("label-start").innerText = "ðŸ“ Start";
  document.getElementById("label-end").innerText = "ðŸ End";
};

// ===============================
// ðŸ—‚ï¸ BUS TABS
// ===============================
document.querySelectorAll(".bus-tab").forEach(tab => {
  tab.onclick = () => {
    document.querySelectorAll(".bus-tab").forEach(t => t.classList.remove("active"));
    tab.classList.add("active");
    selectedBus = tab.dataset.bus;
    document.getElementById("progress-pct").innerText = `Select a bus to track`;
    document.getElementById("stops-passed").innerText = "";
  };
});

// ===============================
// ðŸŽ® CONTROLS
// ===============================
document.querySelectorAll(".mode").forEach(btn => {
  btn.onclick = () => {
    document.querySelectorAll(".mode").forEach(b => b.classList.remove("active"));
    btn.classList.add("active");
    const t = btn.innerText.toLowerCase();
    mode = t.includes("very") ? "bad" : t;
    if (socket && socket.readyState === WebSocket.OPEN)
      socket.send(JSON.stringify({ mode }));
  };
});

document.getElementById("toggle-follow").onclick = () => {
  follow = !follow;
  document.getElementById("toggle-follow").innerText = "Follow: " + (follow ? "ON" : "OFF");
};

let dashboardVisible = false;
document.getElementById("toggle-dashboard").onclick = () => {
  dashboardVisible = !dashboardVisible;
  document.getElementById("dashboard-panel").style.display = dashboardVisible ? "block" : "none";
  document.getElementById("toggle-dashboard").innerText = dashboardVisible ? "ðŸ“Š Hide Charts" : "ðŸ“Š Show Charts";
};

function updateConnection(status) {
  const el = document.getElementById("connection-status");
  el.innerText  = status ? "ðŸŸ¢ Server: Connected" : "ðŸ”´ Server: Disconnected";
  el.style.color = status ? "#00ffcc" : "red";
}

function updateSignal() {
  document.querySelectorAll(".signal span").forEach((b, i) => {
    if (mode === "normal")     b.style.opacity = "1";
    else if (mode === "slow")  b.style.opacity = i < 3 ? "1" : "0.2";
    else                       b.style.opacity = i < 1 ? "1" : "0.2";
  });
}

// ===============================
// ðŸ“ˆ CHARTS
// ===============================
function initCharts() {
  const def = {
    type: "line",
    options: {
      animation: false, responsive: true, maintainAspectRatio: true, aspectRatio: 3,
      plugins: { legend: { display: false } },
      scales: { x: { display: false }, y: { ticks: { color: "#666", font: { size: 10 } }, grid: { color: "rgba(0,0,0,0.08)" } } }
    }
  };
  speedChart = new Chart(document.getElementById("speedChart"), {
    ...def, data: { labels: chartLabels, datasets: [{ data: speedHistory, borderColor: "#ff6600", backgroundColor: "rgba(255,102,0,0.08)", borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.4 }] }
  });
  confidenceChart = new Chart(document.getElementById("confidenceChart"), {
    ...def, data: { labels: chartLabels, datasets: [{ data: confidenceHistory, borderColor: "#4fc3f7", backgroundColor: "rgba(79,195,247,0.08)", borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.4 }] }
  });
  lossChart = new Chart(document.getElementById("lossChart"), {
    ...def, data: { labels: chartLabels, datasets: [{ data: lossHistory, borderColor: "#ff4444", backgroundColor: "rgba(255,68,68,0.08)", borderWidth: 1.5, pointRadius: 0, fill: true, tension: 0.4, stepped: true }] }
  });
}

function updateCharts(speed, conf, dropped) {
  tickCount++;
  if (chartLabels.length >= MAX_CHART) { chartLabels.shift(); speedHistory.shift(); confidenceHistory.shift(); lossHistory.shift(); }
  chartLabels.push(tickCount.toString());
  speedHistory.push(speed); confidenceHistory.push(conf); lossHistory.push(dropped ? 1 : 0);
  speedChart.update(); confidenceChart.update(); lossChart.update();
}

// ===============================
// ðŸ”Œ WEBSOCKET
// ===============================
const host = window.location.host;
const protocol = window.location.protocol === "https:" ? "wss" : "ws";
const socket = new WebSocket(`${protocol}://${host}/ws`);
socket.onopen  = () => { updateConnection(true);  initCharts(); };
socket.onclose = () => { updateConnection(false); };

socket.onmessage = (event) => {
  const payload = JSON.parse(event.data);
  if (!payload.buses) return;

  payload.buses.forEach(data => {
    const busId = data.bus_id;
    const bs    = busState[busId];
    const color = BUS_CONFIG[busId].color;

    // Move marker
    bs.marker.setLatLng([data.lat, data.lng]);
    if (follow && busId === selectedBus) map.setView([data.lat, data.lng], 14);

    // Paths
    if (!data.dropped) {
      bs.realPath.push([data.lat, data.lng]);
      if (bs.buffer.length > 0) { bs.buffer.forEach(p => bs.realPath.push(p)); bs.buffer = []; bs.recoveryCount++; }
      bs.predictedPath = []; bs.isPredicting = false;
      bs.marker.setIcon(createBusIcon(color));
    } else {
      bs.buffer.push([data.lat, data.lng]);
      bs.predictedPath.push([data.lat, data.lng]);
      bs.isPredicting = true; bs.packetLoss++;
      bs.marker.setIcon(createBusIcon("#ff0000"));
    }

    bs.realLine.setLatLngs(bs.realPath);
    bs.predictedLine.setLatLngs(bs.predictedPath);
    renderFuturePath(busId, data.future_positions);
    checkDelay(busId, data.speed, data.eta);

    // Only update status panel and progress for selected bus
    if (busId === selectedBus) {
      updateProgressBar(busId, data.current_wp_idx, data.total_waypoints);
      renderStopPredictions(busId, data.stop_etas);

      const conf = data.confidence;

      const ab = document.getElementById("anomaly-status");
      if (data.is_anomaly) { ab.innerText = "âš ï¸ Anomaly Detected!"; ab.style.color = "#ff4444"; ab.style.animation = "blink 0.8s infinite"; }
      else                 { ab.innerText = "âœ… Signal Normal";      ab.style.color = "#00ffcc"; ab.style.animation = "none"; }

      const re = document.getElementById("route-score");
      re.innerText   = data.route_score + "%";
      re.style.color = data.route_score > 70 ? "#00ffcc" : data.route_score > 40 ? "orange" : "red";

      document.getElementById("speed").innerText      = "Speed: "    + data.speed       + " km/h";
      document.getElementById("eta").innerText        = "ETA: "      + data.eta         + " min";
      document.getElementById("status").innerText     = "Status: "   + (bs.isDelayed ? "âš ï¸ Delayed" : bs.isPredicting ? "Predicting" : "On Route");
      document.getElementById("distance").innerText   = "Distance: " + data.distance_km + " km";
      document.getElementById("tracking-status").innerText = bs.isPredicting ? "ðŸ‘» Ghost Mode" : "ðŸ‘ Live Tracking";
      document.getElementById("system-mode").innerText     = bs.isPredicting ? "Mode: Predictive" : "Mode: Real-Time";
      document.getElementById("confidence").innerText  = "Confidence: " + conf + "%";
      document.getElementById("buffer-status").innerText  = "Buffer: " + bs.buffer.length + " points";
      document.getElementById("replay-status").innerText  = bs.buffer.length > 0 && !bs.isPredicting ? "ðŸ”„ Replaying" : "Replay: None";
      document.getElementById("loss").innerText      = bs.packetLoss;
      document.getElementById("recovery").innerText  = bs.recoveryCount;

      updateSignal();
      updateCharts(data.speed, conf, data.dropped);

      document.querySelector(".status-panel").style.boxShadow =
        bs.isDelayed    ? "0 0 25px orange" :
        conf > 70       ? "0 0 25px #00ffcc" :
        conf > 40       ? "0 0 25px orange"  : "0 0 25px red";
    }
  });
};


// GHOSTTRACK_SPOOF_PANEL
(() => {
  let point = null, marker = null, picking = false, active = false;
  const SPOOF_KEY = "ghostTrackSpoofLocation";
  const extensionRequests = new Map();
  let extensionRequestId = 0;
  const $ = id => document.getElementById(id);
  const status = text => { $("spoof-status").textContent = text; };
  window.addEventListener("message", event => {
    const data = event.data;
    if (event.source !== window || data?.source !== "GHOSTTRACK_EXTENSION_RESULT") return;
    const resolve = extensionRequests.get(data.requestId);
    if (!resolve) return;
    extensionRequests.delete(data.requestId);
    resolve(data);
  });
  const syncExtension = (location, enabled) => new Promise(resolve => {
    const requestId = ++extensionRequestId;
    const timer = setTimeout(() => {
      extensionRequests.delete(requestId);
      resolve({ ok: false, reason: "timeout" });
    }, 1800);
    extensionRequests.set(requestId, result => { clearTimeout(timer); resolve(result); });
    window.postMessage({
      source: "GHOSTTRACK_APP",
      action: enabled ? "activate" : "disable",
      requestId,
      location: enabled ? { lat: location.lat, lng: location.lng } : null
    }, "*");
  });
  const setPoint = (lat, lng) => {
    point = L.latLng(lat, lng);
    if (!marker) marker = L.marker(point, { draggable: true }).addTo(map);
    else marker.setLatLng(point);
    marker.bindTooltip("Selected location").openTooltip();
    marker.on("dragend", () => {
      point = marker.getLatLng();
      status(`Selected: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
    });
    map.setView(point, 15);
    status(`Selected: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`);
  };

  $("spoof-search").onclick = async () => {
    const q = $("spoof-place").value.trim();
    if (!q) return status("Enter a place or coordinates.");
    const match = q.match(/^\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*$/);
    if (match) {
      const lat = Number(match[1]), lng = Number(match[2]);
      if (Math.abs(lat) > 90 || Math.abs(lng) > 180) return status("Invalid coordinates.");
      setPoint(lat, lng);
      return;
    }
    status("Searching...");
    try {
      const url = "https://nominatim.openstreetmap.org/search?format=json&limit=1&q=" + encodeURIComponent(q);
      const res = await fetch(url, { headers: { "Accept-Language": "en" } });
      const data = await res.json();
      if (!data.length) return status("Place not found. Try coordinates.");
      setPoint(Number(data[0].lat), Number(data[0].lon));
    } catch {
      status("Search failed. Enter latitude, longitude instead.");
    }
  };

  $("spoof-pick").onclick = () => {
    picking = !picking;
    $("spoof-pick").textContent = picking ? "Click a map point…" : "Pick on map";
    status(picking ? "Click anywhere on the map." : "Map selection cancelled.");
  };

  map.on("click", e => {
    if (!picking) return;
    setPoint(e.latlng.lat, e.latlng.lng);
    picking = false;
    $("spoof-pick").textContent = "Pick on map";
  });

  // Restore the last activated location when GhostTrack is reopened.
  try {
    const saved = JSON.parse(localStorage.getItem(SPOOF_KEY) || "null");
    if (saved?.active === true && Number.isFinite(saved.lat) && Number.isFinite(saved.lng) &&
        Math.abs(saved.lat) <= 90 && Math.abs(saved.lng) <= 180) {
      setPoint(saved.lat, saved.lng);
      active = true;
      window.ghostTrackLocation = { lat: saved.lat, lng: saved.lng, source: "spoofed", active: true };
      document.body.dataset.locationMode = "spoofed";
      status(`Restored: ${saved.lat.toFixed(5)}, ${saved.lng.toFixed(5)}. Syncing extension…`);
      syncExtension(saved, true).then(result => {
        if (result.ok) status(`SPOOF ACTIVE: ${saved.lat.toFixed(5)}, ${saved.lng.toFixed(5)}`);
        else status(`Active in GhostTrack: ${saved.lat.toFixed(5)}, ${saved.lng.toFixed(5)}. Extension not connected.`);
      });
    }
  } catch (error) {
    console.warn("GhostTrack: could not restore saved spoof location.", error);
  }

  $("spoof-activate").onclick = async () => {
    if (!point) return status("Choose a location first.");
    active = true;
    window.ghostTrackLocation = {
      lat: point.lat, lng: point.lng, source: "spoofed", active: true
    };
    const selected = { lat: point.lat, lng: point.lng, active: true, updatedAt: Date.now() };
    localStorage.setItem(SPOOF_KEY, JSON.stringify(selected));
    document.body.dataset.locationMode = "spoofed";
    status(`Activating: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}…`);
    window.dispatchEvent(new CustomEvent("ghosttrack:locationchange", {
      detail: window.ghostTrackLocation
    }));
    const result = await syncExtension(selected, true);
    status(result.ok
      ? `SPOOF ACTIVE: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}`
      : `Active in GhostTrack: ${point.lat.toFixed(5)}, ${point.lng.toFixed(5)}. Extension not connected.`);
  };

  $("spoof-stop").onclick = async () => {
    active = false;
    window.ghostTrackLocation = { source: "gps", active: false };
    localStorage.setItem(SPOOF_KEY, JSON.stringify({ active: false, updatedAt: Date.now() }));
    delete document.body.dataset.locationMode;
    if (marker) { map.removeLayer(marker); marker = null; }
    point = null;
    status("Spoofing stopped. Click Locate Me to get real GPS.");
    window.dispatchEvent(new CustomEvent("ghosttrack:locationchange", {
      detail: window.ghostTrackLocation
    }));
    const result = await syncExtension(null, false);
    status(result.ok ? "Spoofing stopped. Coordinates retained." : "Stopped in GhostTrack; extension not connected.");
  };
})();

// GHOSTTRACK_APP_LEVEL_GEOLOCATION_SPOOF
(() => {
  const geo = navigator.geolocation;
  if (!geo || geo.__ghostTrackPatched) return;

  const nativeGet = geo.getCurrentPosition.bind(geo);
  const nativeWatch = geo.watchPosition.bind(geo);
  const nativeClear = geo.clearWatch.bind(geo);
  const watches = new Map();
  let nextId = 1;

  const spoofed = () => {
    const p = window.ghostTrackLocation;
    return p && p.active && p.source === "spoofed" &&
      Number.isFinite(p.lat) && Number.isFinite(p.lng);
  };

  const makePosition = () => {
    const p = window.ghostTrackLocation;
    return {
      coords: {
        latitude: p.lat, longitude: p.lng, accuracy: 1,
        altitude: null, altitudeAccuracy: null,
        heading: null, speed: null
      },
      timestamp: Date.now()
    };
  };

  geo.getCurrentPosition = (success, error, options) => {
    if (spoofed()) {
      success(makePosition());
      return;
    }
    nativeGet(success, error, options);
  };

  geo.watchPosition = (success, error, options) => {
    const id = nextId++;
    const record = { nativeId: null, timer: null };
    record.nativeId = nativeWatch(pos => {
      if (!spoofed()) success(pos);
    }, error, options);

    record.timer = setInterval(() => {
      if (spoofed()) success(makePosition());
    }, 1000);

    watches.set(id, record);
    return id;
  };

  geo.clearWatch = id => {
    const record = watches.get(id);
    if (!record) return nativeClear(id);
    nativeClear(record.nativeId);
    clearInterval(record.timer);
    watches.delete(id);
  };

  Object.defineProperty(geo, "__ghostTrackPatched", { value: true });
  console.log("GhostTrack app-level geolocation spoofing enabled.");
})();
