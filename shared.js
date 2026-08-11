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
  const ts = String(row['Timestamp'] || '');
  return {
    date: row['Date'] || '',
    time: ts.length >= 16 ? ts.slice(11, 16) : '',
    platform: row['Platform'] || '',
    pickupZone: row['Pickup Zone'] || '',
    dropLocation: row['Drop Location'] || '',
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
