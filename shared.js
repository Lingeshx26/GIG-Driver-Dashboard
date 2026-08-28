/* ============================================
   CONFIG
   Paste your deployed Apps Script Web App URL here.
   See apps-script/Code.gs + README for setup steps.
   ============================================ */
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/AKfycbzrQywNU2cmWMInaSSdLhLKjWpWGaj-0NiYyvrHaH8RzsUJoYCr3rmMcyWOZiShkCDa/exec',
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/1rLay1GStS63CT8V0fFRhqDDmtQXOgpeKYm5aJC_Rg0A/edit?usp=sharing' // optional: paste your Google Sheet's normal URL for the "Open sheet" footer link
};

const PEAK_WINDOWS = [
  { start: '08:00', end: '10:00' },
  { start: '17:00', end: '20:00' }
];

const ZONES = [
  'Gandhipuram / Ukkadam',
  'Coimbatore Junction / Podanur',
  'Peelamedu / Airport / PSG Tech',
  'Saravanampatti / Kalapatti (IT corridor)',
  'RS Puram / Race Course / Avinashi Rd',
  'Singanallur / Hope College',
  'Other'
];

const PLATFORMS = ['Rapido', 'Blinkit'];

// Rough centroid coordinates for each zone, used only to auto-suggest the
// nearest match after a GPS fix. Approximate on purpose — always editable,
// never treated as authoritative.
const ZONE_COORDS = {
  'Gandhipuram / Ukkadam': { lat: 11.0090, lng: 76.9558 },
  'Coimbatore Junction / Podanur': { lat: 11.0018, lng: 76.9628 },
  'Peelamedu / Airport / PSG Tech': { lat: 11.0280, lng: 77.0200 },
  'Saravanampatti / Kalapatti (IT corridor)': { lat: 11.0730, lng: 77.0107 },
  'RS Puram / Race Course / Avinashi Rd': { lat: 11.0070, lng: 76.9600 },
  'Singanallur / Hope College': { lat: 11.0016, lng: 77.0200 }
};

/* ============================================
   GPS, REVERSE GEOCODING, DISTANCE
   No API keys needed:
   - Geolocation: built into the browser
   - Reverse geocoding: Nominatim (OpenStreetMap), free
   - Route distance: OSRM public server, free — falls back to a
     straight-line estimate if it's unreachable
   ============================================ */
function getCurrentPosition(options = {}) {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported on this device/browser'));
      return;
    }
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({ lat: pos.coords.latitude, lng: pos.coords.longitude }),
      (err) => reject(err),
      { enableHighAccuracy: true, timeout: 12000, maximumAge: 0, ...options }
    );
  });
}

async function reverseGeocode(lat, lng) {
  try {
    const res = await fetch(`https://nominatim.openstreetmap.org/reverse?format=json&lat=${lat}&lon=${lng}&zoom=17&addressdetails=1`);
    const data = await res.json();
    return shortAddress(data);
  } catch (e) {
    return `${lat.toFixed(5)}, ${lng.toFixed(5)}`; // fallback: raw coordinates, still usable
  }
}

function shortAddress(nominatimData) {
  const a = nominatimData.address || {};
  const parts = [
    a.road || a.pedestrian || a.neighbourhood,
    a.suburb || a.residential || a.city_district
  ].filter(Boolean);
  if (parts.length) return parts.join(', ');
  return (nominatimData.display_name || '').split(',').slice(0, 2).join(',').trim();
}

function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

async function routeDistanceKm(pickupLat, pickupLng, dropLat, dropLng) {
  try {
    const url = `https://router.project-osrm.org/route/v1/driving/${pickupLng},${pickupLat};${dropLng},${dropLat}?overview=false`;
    const res = await fetch(url);
    const data = await res.json();
    if (data.routes && data.routes[0]) {
      return { km: Math.round((data.routes[0].distance / 1000) * 10) / 10, estimated: false };
    }
    throw new Error('No route found');
  } catch (e) {
    // OSRM unreachable or no route — fall back to a straight-line estimate,
    // clearly flagged as such rather than presented as exact
    return { km: Math.round(haversineKm(pickupLat, pickupLng, dropLat, dropLng) * 10) / 10, estimated: true };
  }
}

function nearestZone(lat, lng) {
  let best = null;
  let bestDist = Infinity;
  Object.entries(ZONE_COORDS).forEach(([zone, c]) => {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < bestDist) { bestDist = d; best = zone; }
  });
  return best;
}

/* ============================================
   SHARED STATE (populated by loadFromSheet)
   ============================================ */
let rides = [];   // all ride rows (any date)
let days = [];    // all day rows (any date)

const $ = (id) => document.getElementById(id);

/* ============================================
   ACTIVE DAY — persisted locally so a refresh
   mid-shift doesn't lose the start KM
   ============================================ */
function loadActiveDayFromStorage() {
  const raw = localStorage.getItem('activeDay');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.date === todayStr()) return parsed;
    localStorage.removeItem('activeDay'); // stale day from a previous date, never ended
  } catch (e) {
    localStorage.removeItem('activeDay');
  }
  return null;
}

function saveActiveDayToStorage(activeDay) {
  if (activeDay) {
    localStorage.setItem('activeDay', JSON.stringify(activeDay));
  } else {
    localStorage.removeItem('activeDay');
  }
}

/* ============================================
   PENDING RIDE — the ride between "Start Ride" and
   "End Ride". Persisted locally so a refresh mid-ride
   doesn't lose the captured pickup point.
   ============================================ */
function loadPendingRideFromStorage() {
  const raw = localStorage.getItem('pendingRide');
  if (!raw) return null;
  try {
    const parsed = JSON.parse(raw);
    if (parsed.date === todayStr()) return parsed;
    localStorage.removeItem('pendingRide'); // stale ride from a previous date, never finished
  } catch (e) {
    localStorage.removeItem('pendingRide');
  }
  return null;
}

function savePendingRideToStorage(pendingRide) {
  if (pendingRide) {
    localStorage.setItem('pendingRide', JSON.stringify(pendingRide));
  } else {
    localStorage.removeItem('pendingRide');
  }
}

/* ============================================
   GOOGLE SHEETS SYNC
   ============================================ */
const CACHE_KEY = 'lastSyncedData';
const FETCH_TIMEOUT_MS = 15000;
const SLOW_CONNECTION_HINT_MS = 4000;

/**
 * Paints the last-known data immediately from localStorage, if any exists.
 * Call this before loadFromSheet() so the page never shows a blank state
 * while Apps Script cold-starts — it shows what you saw last, then updates
 * silently once the fresh fetch resolves.
 * Returns true if cached data was found and applied.
 */
function loadCachedData() {
  const raw = localStorage.getItem(CACHE_KEY);
  if (!raw) return false;
  try {
    const cached = JSON.parse(raw);
    rides = cached.rides || [];
    days = cached.days || [];
    return true;
  } catch (e) {
    return false;
  }
}

function saveCachedData() {
  try {
    localStorage.setItem(CACHE_KEY, JSON.stringify({ rides, days }));
  } catch (e) {
    // storage full or unavailable — non-critical, just skip caching
  }
}

async function loadFromSheet() {
  if (!isConfigured()) {
    setSyncState('error', 'Not connected — see README');
    return false;
  }

  // After a few seconds, reassure instead of leaving "Connecting…" hanging —
  // Apps Script cold-starts can genuinely take a while, this isn't broken.
  const slowHintTimer = setTimeout(() => {
    setSyncState('connecting', 'Still connecting… you can keep working');
  }, SLOW_CONNECTION_HINT_MS);

  const controller = new AbortController();
  const timeoutTimer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);

  try {
    const res = await fetch(CONFIG.SCRIPT_URL, { signal: controller.signal });
    const data = await res.json();
    rides = (data.rides || []).map(normalizeRideRow).filter(r => r.date);
    days = (data.days || []).map(normalizeDayRow).filter(d => d.date);
    saveCachedData();
    setSyncState('live');
    return true;
  } catch (err) {
    console.error(err);
    setSyncState('error', 'Could not reach sheet — showing last-known data');
    return false;
  } finally {
    clearTimeout(slowHintTimer);
    clearTimeout(timeoutTimer);
  }
}

function normalizeRideRow(row) {
  return {
    date: row['Date'] || '',
    time: row['Start Time'] || '',
    platform: row['Platform'] || '',
    pickupZone: row['Pickup Zone'] || '',
    pickupAddress: row['Pickup Address'] || '',
    pickupLat: row['Pickup Lat'] !== '' && row['Pickup Lat'] != null ? Number(row['Pickup Lat']) : null,
    pickupLng: row['Pickup Lng'] !== '' && row['Pickup Lng'] != null ? Number(row['Pickup Lng']) : null,
    dropLocation: row['Drop Location'] || '',
    dropLat: row['Drop Lat'] !== '' && row['Drop Lat'] != null ? Number(row['Drop Lat']) : null,
    dropLng: row['Drop Lng'] !== '' && row['Drop Lng'] != null ? Number(row['Drop Lng']) : null,
    distanceKm: row['Distance KM'] !== '' && row['Distance KM'] != null ? Number(row['Distance KM']) : null,
    rideEndTime: row['End Time'] || '',
    fare: Number(row['Fare']) || 0,
    tip: Number(row['Tip']) || 0,
    extra: Number(row['Extra Charges']) || 0,
    paymentMode: row['Payment Mode'] || '',
    cancelled: row['Cancelled'] === true || row['Cancelled'] === 'TRUE',
    notes: row['Notes'] || ''
  };
}

function normalizeDayRow(row) {
  return {
    date: String(row['Date'] || '').slice(0, 10),
    startTime: row['Start Time'] || '',
    startKm: Number(row['Start KM']) || 0,
    endTime: row['End Time'] || '',
    endKm: Number(row['End KM']) || 0,
    totalKm: Number(row['Total KM']) || 0,
    fuelCost: Number(row['Fuel Cost']) || 0,
    bonus: Number(row['Bonus']) || 0,
    notes: row['Notes'] || ''
  };
}

async function postToSheet(payload) {
  if (!isConfigured()) throw new Error('Apps Script URL not configured');
  // text/plain avoids a CORS preflight against Apps Script's web app endpoint
  await fetch(CONFIG.SCRIPT_URL, {
    method: 'POST',
    headers: { 'Content-Type': 'text/plain;charset=utf-8' },
    body: JSON.stringify(payload)
  });
}

function isConfigured() {
  return CONFIG.SCRIPT_URL && !CONFIG.SCRIPT_URL.startsWith('PASTE_');
}

function setSyncState(state, label) {
  const dot = $('syncDot');
  const text = $('syncLabel');
  if (!dot || !text) return;
  dot.classList.remove('is-live', 'is-error');
  if (state === 'live') {
    dot.classList.add('is-live');
    text.textContent = label || 'Synced to Sheets';
  } else if (state === 'error') {
    dot.classList.add('is-error');
    text.textContent = label || 'Sync error';
  } else {
    // 'connecting' or default — neutral dot, just update the label
    text.textContent = label || 'Connecting…';
  }
}

/* ============================================
   RIDE MATH
   A cancelled ride always contributes ₹0, regardless
   of what (if anything) is in its fare/tip/extra fields.
   ============================================ */
function rideTotal(r) {
  return r.cancelled ? 0 : (Number(r.fare) || 0) + (Number(r.tip) || 0) + (Number(r.extra) || 0);
}

function dayRecordFor(date) {
  return days.find(d => d.date === date) || null;
}

/* ============================================
   GENERAL HELPERS
   ============================================ */
function todayStr() {
  return new Date().toISOString().slice(0, 10);
}

function nowTimeStr() {
  const d = new Date();
  return String(d.getHours()).padStart(2, '0') + ':' + String(d.getMinutes()).padStart(2, '0');
}

function sum(list, fn) {
  return list.reduce((acc, r) => acc + (Number(fn(r)) || 0), 0);
}

function formatMoney(n, withSymbol = true) {
  const rounded = Math.round(n);
  const formatted = Math.abs(rounded).toLocaleString('en-IN');
  const sign = rounded < 0 ? '-' : '';
  return withSymbol ? `${sign}₹${formatted}` : `${sign}${formatted}`;
}

function formatDate(dateStr) {
  const d = new Date(dateStr);
  if (isNaN(d)) return dateStr;
  return d.toLocaleDateString('en-IN', { day: '2-digit', month: 'short' });
}

function shortZone(zone) {
  return (zone || '').split(' / ')[0];
}

function isPeak(time) {
  if (!time) return false;
  return PEAK_WINDOWS.some(w => time >= w.start && time <= w.end);
}
