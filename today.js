/* ============================================
   PAGE STATE
   ============================================ */
let activeDay = null;
let pendingRide = null;
let selectedPlatform = null;
let selectedPayment = null;
let isRideCancelled = false;
let lastComputedDistance = null; // { km, estimated } or null

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', async () => {
  if (CONFIG.SHEET_URL) $('sheetLink').href = CONFIG.SHEET_URL;

  populateZoneOptions();
  activeDay = loadActiveDayFromStorage();
  pendingRide = loadPendingRideFromStorage();
  selectedPlatform = localStorage.getItem('lastPlatform') || null;
  selectedPayment = localStorage.getItem('lastPayment') || null;

  bindDayControl();
  bindStartRideForm();
  bindEndRideModal();
  bindEndDayModal();

  renderDayControl();
  renderRideSection();

  // Show last-known data instantly (if any) while the fresh fetch loads in the background
  if (loadCachedData()) {
    renderTodayStrip();
    renderRecentRides();
  }

  await loadFromSheet();
  renderTodayStrip();
  renderRecentRides();
});

function populateZoneOptions() {
  const select = $('pickupZone');
  ZONES.forEach(z => {
    const opt = document.createElement('option');
    opt.value = z;
    opt.textContent = z;
    select.appendChild(opt);
  });
  const lastZone = localStorage.getItem('lastPickupZone');
  if (lastZone) select.value = lastZone;
}

/* ============================================
   DAY CONTROL — start / end day
   Odometer entry is mandatory: the action buttons
   stay disabled until a valid reading is present.
   ============================================ */
function bindDayControl() {
  $('dayControl').addEventListener('click', (e) => {
    if (e.target.id === 'startDayBtn') onStartDay();
    if (e.target.id === 'endDayBtn') openEndDayModal();
  });

  $('dayControl').addEventListener('input', (e) => {
    if (e.target.id === 'startKmInput') {
      const btn = $('startDayBtn');
      if (btn) btn.disabled = !isValidKm(e.target.value);
    }
  });

  $('dismissDayComplete').addEventListener('click', () => {
    $('dayCompleteCard').hidden = true;
  });
}

function isValidKm(value) {
  const n = Number(value);
  return value !== '' && !isNaN(n) && n >= 0;
}

function renderDayControl() {
  const container = $('dayControl');
  if (!activeDay) {
    container.innerHTML = `
      <div class="day-start-card">
        <span class="day-card-title">Start your day</span>
        <p class="day-card-hint">Odometer reading is required before you can start.</p>
        <div class="day-start-row">
          <input type="number" id="startKmInput" min="0" step="1" placeholder="Odometer reading (km)" inputmode="numeric" autocomplete="off">
          <button type="button" class="btn-start-day" id="startDayBtn" disabled>Start Day</button>
        </div>
      </div>
    `;
    $('odometerBlock').hidden = true;
  } else {
    container.innerHTML = `
      <div class="day-active-card">
        <div class="day-active-info">
          <span class="day-active-status"><span class="live-dot"></span>Day in progress</span>
          <span class="day-active-detail">Started ${activeDay.startTime} · ${formatMoney(activeDay.startKm, false)} km</span>
        </div>
        <button type="button" class="btn-end-day" id="endDayBtn">End Day</button>
      </div>
    `;
    $('odometerBlock').hidden = false;
  }
}

function onStartDay() {
  const input = $('startKmInput');
  if (!isValidKm(input.value)) { input.focus(); return; }

  activeDay = {
    date: todayStr(),
    startTime: nowTimeStr(),
    startKm: Number(input.value)
  };
  saveActiveDayToStorage(activeDay);
  $('dayCompleteCard').hidden = true;
  renderDayControl();
  renderRideSection();
  renderTodayStrip();
  renderRecentRides();

  postToSheet({ kind: 'day_start', date: activeDay.date, startTime: activeDay.startTime, startKm: activeDay.startKm });
}

/* ============================================
   END DAY MODAL — odometer + fuel are mandatory
   ============================================ */
function bindEndDayModal() {
  $('cancelEndDay').addEventListener('click', closeEndDayModal);
  $('endDayOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'endDayOverlay') closeEndDayModal();
  });
  $('endDayForm').addEventListener('submit', onEndDaySubmit);
  $('endDayForm').addEventListener('input', updateFinishDayButtonState);
}

function updateFinishDayButtonState() {
  const endKm = $('endKm').value;
  const fuelCost = $('fuelCost').value;
  const validKm = isValidKm(endKm) && Number(endKm) >= activeDay.startKm;
  const validFuel = fuelCost !== '' && !isNaN(Number(fuelCost)) && Number(fuelCost) >= 0;
  $('finishDayBtn').disabled = !(validKm && validFuel);
}

function openEndDayModal() {
  $('endKm').value = '';
  $('fuelCost').value = '';
  $('bonus').value = '';
  $('dayNotes').value = '';
  $('finishDayBtn').disabled = true;
  $('endDayOverlay').hidden = false;
  $('endKm').focus();
}

function closeEndDayModal() {
  $('endDayOverlay').hidden = true;
}

function onEndDaySubmit(e) {
  e.preventDefault();
  const endKm = Number($('endKm').value);
  const fuelCost = Number($('fuelCost').value);

  if (!isValidKm($('endKm').value) || endKm < activeDay.startKm) {
    alert("End KM must be a valid reading, and can't be less than your start KM (" + activeDay.startKm + ").");
    return;
  }
  if ($('fuelCost').value === '' || isNaN(fuelCost) || fuelCost < 0) {
    alert('Fuel & expenses is required — enter 0 if you spent nothing today.');
    return;
  }

  const bonus = Number($('bonus').value) || 0;
  const notes = $('dayNotes').value || '';
  const endTime = nowTimeStr();
  const totalKm = Math.round((endKm - activeDay.startKm) * 10) / 10;

  const finishedDay = {
    date: activeDay.date,
    startTime: activeDay.startTime,
    startKm: activeDay.startKm,
    endTime,
    endKm,
    totalKm,
    fuelCost,
    bonus,
    notes
  };

  days = days.filter(d => d.date !== finishedDay.date);
  days.push(finishedDay);

  postToSheet({ kind: 'day_end', ...finishedDay });

  const todayRides = rides.filter(r => r.date === finishedDay.date);
  const gross = sum(todayRides, rideTotal);
  const net = gross + bonus - fuelCost;
  const cancelledCount = todayRides.filter(r => r.cancelled).length;

  activeDay = null;
  saveActiveDayToStorage(null);
  closeEndDayModal();
  renderDayControl();
  renderRideSection();
  showDayCompleteCard({ net, km: totalKm, rides: todayRides.length - cancelledCount, cancelled: cancelledCount });
}

function showDayCompleteCard(summary) {
  $('dayCompleteFigures').innerHTML = `
    <div class="range-figure"><span class="range-figure-value">${formatMoney(summary.net)}</span><span class="range-figure-label">net</span></div>
    <div class="range-figure"><span class="range-figure-value">${summary.km.toFixed(1)}</span><span class="range-figure-label">km</span></div>
    <div class="range-figure"><span class="range-figure-value">${summary.rides}</span><span class="range-figure-label">rides</span></div>
    <div class="range-figure"><span class="range-figure-value">${summary.cancelled}</span><span class="range-figure-label">cancelled</span></div>
  `;
  $('dayCompleteCard').hidden = false;
  $('odometerBlock').hidden = true;
  $('recentRidesSection').hidden = true;
}

/* ============================================
   GPS CAPTURE (shared by Start Ride's pickup field
   and End Ride's drop field)
   ============================================ */
async function fetchGpsInto(inputId, statusId, isPickup) {
  const statusEl = $(statusId);
  statusEl.textContent = 'Getting location…';
  statusEl.className = 'gps-status gps-status-loading';
  try {
    const pos = await getCurrentPosition();
    const address = await reverseGeocode(pos.lat, pos.lng);
    $(inputId).value = address;
    $(inputId).dataset.lat = pos.lat;
    $(inputId).dataset.lng = pos.lng;

    if (isPickup) {
      const nearest = nearestZone(pos.lat, pos.lng);
      if (nearest) {
        $('pickupZone').value = nearest;
        localStorage.setItem('lastPickupZone', nearest);
      }
    }

    statusEl.textContent = 'Location captured — edit if it looks off';
    statusEl.className = 'gps-status gps-status-ok';
    $(inputId).dispatchEvent(new Event('input'));
  } catch (err) {
    console.error(err);
    statusEl.textContent = "Couldn't get a location — type it in instead";
    statusEl.className = 'gps-status gps-status-error';
  }
}

/* ============================================
   START RIDE
   ============================================ */
function bindStartRideForm() {
  $('platformPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    selectedPlatform = btn.dataset.value;
    localStorage.setItem('lastPlatform', selectedPlatform);
    updatePillSelection('platformPills', selectedPlatform);
    updateStartRideButtonState();
  });

  $('pickupZone').addEventListener('change', () => {
    localStorage.setItem('lastPickupZone', $('pickupZone').value);
    updateStartRideButtonState();
  });

  $('pickupAddress').addEventListener('input', updateStartRideButtonState);

  $('getPickupBtn').addEventListener('click', () => fetchGpsInto('pickupAddress', 'pickupGpsStatus', true));

  $('startRideForm').addEventListener('submit', onStartRide);

  $('endRideBtn').addEventListener('click', openEndRideModal);
}

function updatePillSelection(groupId, value) {
  document.querySelectorAll(`#${groupId} .pill`).forEach(pill => {
    pill.classList.toggle('is-active', pill.dataset.value === value);
  });
}

function updateStartRideButtonState() {
  const ok = !!selectedPlatform && !!$('pickupZone').value && $('pickupAddress').value.trim() !== '';
  $('startRideBtn').disabled = !ok;
}

function onStartRide(e) {
  e.preventDefault();
  if (!selectedPlatform || !$('pickupZone').value || !$('pickupAddress').value.trim()) return;

  pendingRide = {
    date: todayStr(),
    startTime: nowTimeStr(),
    platform: selectedPlatform,
    pickupZone: $('pickupZone').value,
    pickupAddress: $('pickupAddress').value.trim(),
    pickupLat: $('pickupAddress').dataset.lat ? Number($('pickupAddress').dataset.lat) : null,
    pickupLng: $('pickupAddress').dataset.lng ? Number($('pickupAddress').dataset.lng) : null
  };
  savePendingRideToStorage(pendingRide);

  // Reset pickup-specific fields for next time; platform/zone selection carries over
  $('pickupAddress').value = '';
  delete $('pickupAddress').dataset.lat;
  delete $('pickupAddress').dataset.lng;
  $('pickupGpsStatus').textContent = '';

  renderRideSection();
}

/* ============================================
   RIDE SECTION RENDERING (Start Ride vs In Progress)
   ============================================ */
function renderRideSection() {
  const dayLocked = !activeDay;
  const rideInProgress = !!pendingRide;

  $('lockedNotice').hidden = !dayLocked;
  $('startRideForm').hidden = dayLocked || rideInProgress;
  $('rideActiveCard').hidden = dayLocked || !rideInProgress;
  $('recentRidesSection').hidden = dayLocked;

  if (dayLocked) return;

  if (rideInProgress) {
    $('rideActiveDetail').textContent = `${pendingRide.platform} · ${shortZone(pendingRide.pickupZone)} · started ${pendingRide.startTime}`;
  } else {
    updatePillSelection('platformPills', selectedPlatform);
    updateStartRideButtonState();
  }
}

/* ============================================
   END RIDE MODAL
   ============================================ */
function bindEndRideModal() {
  $('cancelEndRide').addEventListener('click', closeEndRideModal);
  $('endRideOverlay').addEventListener('click', (e) => {
    if (e.target.id === 'endRideOverlay') closeEndRideModal();
  });

  $('rideCancelledToggle').addEventListener('click', () => {
    isRideCancelled = !isRideCancelled;
    $('rideCancelledToggleState').textContent = isRideCancelled ? 'Yes' : 'No';
    $('rideCancelledToggle').classList.toggle('is-active', isRideCancelled);
    document.querySelectorAll('#endRideForm .money-field').forEach(el => { el.hidden = isRideCancelled; });
    if (isRideCancelled) $('extrasFields').hidden = true;
    updateFinishRideButtonState();
  });

  $('extrasToggle').addEventListener('click', () => {
    const isOpen = $('extrasToggle').dataset.open === 'true';
    $('extrasToggle').dataset.open = String(!isOpen);
    $('extrasFields').hidden = isOpen;
    $('extrasToggle').textContent = isOpen ? '+ Add tip / extra charge' : '− Hide tip / extra charge';
  });

  $('getDropBtn').addEventListener('click', async () => {
    await fetchGpsInto('dropAddress', 'dropGpsStatus', false);
    await maybeComputeDistance();
    updateFinishRideButtonState();
  });

  $('dropAddress').addEventListener('input', updateFinishRideButtonState);
  $('fare').addEventListener('input', updateFinishRideButtonState);

  $('paymentPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    selectedPayment = btn.dataset.value;
    localStorage.setItem('lastPayment', selectedPayment);
    updatePillSelection('paymentPills', selectedPayment);
    updateFinishRideButtonState();
  });

  $('endRideForm').addEventListener('submit', onFinishRide);
}

async function maybeComputeDistance() {
  const dropLat = $('dropAddress').dataset.lat ? Number($('dropAddress').dataset.lat) : null;
  const dropLng = $('dropAddress').dataset.lng ? Number($('dropAddress').dataset.lng) : null;

  if (pendingRide.pickupLat == null || dropLat == null) {
    lastComputedDistance = null;
    $('distanceField').hidden = true;
    return;
  }

  $('distanceField').hidden = false;
  $('distanceDisplay').textContent = 'Calculating…';
  const result = await routeDistanceKm(pendingRide.pickupLat, pendingRide.pickupLng, dropLat, dropLng);
  lastComputedDistance = result;
  $('distanceDisplay').textContent = `${result.km} km${result.estimated ? ' (estimated)' : ''}`;
}

function openEndRideModal() {
  isRideCancelled = false;
  lastComputedDistance = null;
  $('rideCancelledToggleState').textContent = 'No';
  $('rideCancelledToggle').classList.remove('is-active');
  document.querySelectorAll('#endRideForm .money-field').forEach(el => { el.hidden = false; });
  $('dropAddress').value = '';
  delete $('dropAddress').dataset.lat;
  delete $('dropAddress').dataset.lng;
  $('dropGpsStatus').textContent = '';
  $('distanceField').hidden = true;
  $('fare').value = '';
  $('tip').value = '';
  $('extra').value = '';
  $('rideNotes').value = '';
  $('extrasFields').hidden = true;
  $('extrasToggle').dataset.open = 'false';
  $('extrasToggle').textContent = '+ Add tip / extra charge';
  updatePillSelection('paymentPills', selectedPayment);
  $('finishRideBtn').disabled = true;
  $('endRideOverlay').hidden = false;
}

function closeEndRideModal() {
  $('endRideOverlay').hidden = true;
}

function updateFinishRideButtonState() {
  if (isRideCancelled) {
    $('finishRideBtn').disabled = false;
    return;
  }
  const hasDrop = $('dropAddress').value.trim() !== '';
  const hasFare = $('fare').value !== '' && !isNaN(Number($('fare').value)) && Number($('fare').value) >= 0;
  const hasPayment = !!selectedPayment;
  $('finishRideBtn').disabled = !(hasDrop && hasFare && hasPayment);
}

function onFinishRide(e) {
  e.preventDefault();
  if (!pendingRide) return;

  const dropLat = $('dropAddress').dataset.lat ? Number($('dropAddress').dataset.lat) : null;
  const dropLng = $('dropAddress').dataset.lng ? Number($('dropAddress').dataset.lng) : null;

  const entry = {
    date: pendingRide.date,
    time: pendingRide.startTime,
    platform: pendingRide.platform,
    pickupZone: pendingRide.pickupZone,
    pickupAddress: pendingRide.pickupAddress,
    pickupLat: pendingRide.pickupLat,
    pickupLng: pendingRide.pickupLng,
    rideStartTime: pendingRide.startTime,
    rideEndTime: nowTimeStr(),
    dropLocation: isRideCancelled ? '' : $('dropAddress').value.trim(),
    dropLat: isRideCancelled ? null : dropLat,
    dropLng: isRideCancelled ? null : dropLng,
    distanceKm: isRideCancelled ? null : (lastComputedDistance ? lastComputedDistance.km : null),
    fare: isRideCancelled ? 0 : (Number($('fare').value) || 0),
    tip: isRideCancelled ? 0 : (Number($('tip').value) || 0),
    extra: isRideCancelled ? 0 : (Number($('extra').value) || 0),
    paymentMode: isRideCancelled ? '' : selectedPayment,
    cancelled: isRideCancelled,
    notes: $('rideNotes').value || ''
  };

  const finishBtn = $('finishRideBtn');
  finishBtn.disabled = true;
  finishBtn.textContent = 'Saving…';

  rides.push(entry);
  saveCachedData();
  pendingRide = null;
  savePendingRideToStorage(null);
  closeEndRideModal();
  renderRideSection();
  renderTodayStrip();
  renderRecentRides();

  postToSheet({ kind: 'ride', ...entry })
    .then(() => setSyncState('live'))
    .catch(err => { console.error(err); setSyncState('error'); })
    .finally(() => { finishBtn.textContent = 'Finish ride'; finishBtn.disabled = false; });
}

/* ============================================
   RENDER: TODAY STRIP
   ============================================ */
function renderTodayStrip() {
  if (!activeDay) return;
  const today = todayStr();
  const todayRides = rides.filter(r => r.date === today);
  const activeRides = todayRides.filter(r => !r.cancelled);
  const cancelledCount = todayRides.length - activeRides.length;
  const gross = sum(activeRides, rideTotal);

  $('todayNet').querySelector('.digits').textContent = formatMoney(gross, false);
  $('todayRides').textContent = activeRides.length;
  $('todayCancelled').textContent = cancelledCount;

  const [sh, sm] = activeDay.startTime.split(':').map(Number);
  const now = new Date();
  let mins = (now.getHours() * 60 + now.getMinutes()) - (sh * 60 + sm);
  if (mins < 0) mins += 24 * 60;
  $('todayHours').textContent = (mins / 60).toFixed(1);

  const cash = sum(activeRides.filter(r => r.paymentMode === 'Cash'), rideTotal);
  const upi = sum(activeRides.filter(r => r.paymentMode === 'UPI'), rideTotal);
  $('todayCash').textContent = formatMoney(cash);
  $('todayUpi').textContent = formatMoney(upi);
}

/* ============================================
   RENDER: RECENT RIDES (today only, quick glance)
   ============================================ */
function renderRecentRides() {
  if (!activeDay) return;
  const today = todayStr();
  const todayRides = rides
    .filter(r => r.date === today)
    .sort((a, b) => (b.time || '').localeCompare(a.time || ''))
    .slice(0, 5);

  const list = $('recentList');
  if (todayRides.length === 0) {
    list.innerHTML = '<p class="recent-empty">Nothing logged yet — your next ride will show up here.</p>';
    return;
  }

  list.innerHTML = todayRides.map(r => {
    if (r.cancelled) {
      return `
        <div class="recent-row recent-row-cancelled">
          <span class="recent-time">${r.time || '—'}</span>
          <span class="recent-mid">${r.platform} · ${shortZone(r.pickupZone)}</span>
          <span class="recent-amount">Cancelled</span>
        </div>
      `;
    }
    const distanceLabel = r.distanceKm ? ` · ${r.distanceKm} km` : '';
    const route = r.dropLocation ? `${shortZone(r.pickupZone)} → ${r.dropLocation}` : shortZone(r.pickupZone);
    return `
      <div class="recent-row">
        <span class="recent-time">${r.time || '—'}</span>
        <span class="recent-mid">${r.platform} · ${route}${distanceLabel}</span>
        <span class="recent-amount">${formatMoney(rideTotal(r))}</span>
      </div>
    `;
  }).join('');
}
