/* ============================================
   PAGE STATE
   ============================================ */
let activeDay = null;
let selectedPlatform = null;
let selectedPayment = null;
let isCancelled = false;

/* ============================================
   INIT
   ============================================ */
document.addEventListener('DOMContentLoaded', async () => {
  if (CONFIG.SHEET_URL) $('sheetLink').href = CONFIG.SHEET_URL;

  populateZoneOptions();
  activeDay = loadActiveDayFromStorage();
  selectedPlatform = localStorage.getItem('lastPlatform') || null;
  selectedPayment = localStorage.getItem('lastPayment') || null;

  bindDayControl();
  bindCancelledToggle();
  bindExtrasToggle();
  bindRideForm();
  bindEndDayModal();

  renderDayControl();
  renderRideForm();

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

  // Delegated input listener to toggle the Start Day button live
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
  renderRideForm();
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
  renderRideForm();
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
   CANCELLED-RIDE TOGGLE
   ============================================ */
function bindCancelledToggle() {
  $('cancelledToggle').addEventListener('click', () => {
    isCancelled = !isCancelled;
    $('cancelledToggleState').textContent = isCancelled ? 'Yes' : 'No';
    $('cancelledToggle').classList.toggle('is-active', isCancelled);
    document.querySelectorAll('#rideForm .money-field').forEach(el => { el.hidden = isCancelled; });
    if (isCancelled) $('extrasFields').hidden = true;
  });
}

/* ============================================
   TIP / EXTRA CHARGE COLLAPSIBLE
   ============================================ */
function bindExtrasToggle() {
  $('extrasToggle').addEventListener('click', () => {
    const isOpen = $('extrasToggle').dataset.open === 'true';
    $('extrasToggle').dataset.open = String(!isOpen);
    $('extrasFields').hidden = isOpen;
    $('extrasToggle').textContent = isOpen ? '+ Add tip / extra charge' : '− Hide tip / extra charge';
  });
}

/* ============================================
   RIDE FORM
   ============================================ */
function bindRideForm() {
  $('platformPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    selectedPlatform = btn.dataset.value;
    localStorage.setItem('lastPlatform', selectedPlatform);
    updatePillSelection('platformPills', selectedPlatform);
  });

  $('paymentPills').addEventListener('click', (e) => {
    const btn = e.target.closest('.pill');
    if (!btn) return;
    selectedPayment = btn.dataset.value;
    localStorage.setItem('lastPayment', selectedPayment);
    updatePillSelection('paymentPills', selectedPayment);
  });

  $('pickupZone').addEventListener('change', () => {
    localStorage.setItem('lastPickupZone', $('pickupZone').value);
  });

  $('rideForm').addEventListener('submit', onRideSubmit);
}

function updatePillSelection(groupId, value) {
  document.querySelectorAll(`#${groupId} .pill`).forEach(pill => {
    pill.classList.toggle('is-active', pill.dataset.value === value);
  });
}

function renderRideForm() {
  const locked = !activeDay;
  $('lockedNotice').hidden = !locked;
  $('rideForm').hidden = locked;
  $('recentRidesSection').hidden = locked;
  if (locked) return;

  updatePillSelection('platformPills', selectedPlatform);
  updatePillSelection('paymentPills', selectedPayment);
}

async function onRideSubmit(e) {
  e.preventDefault();
  if (!activeDay) return;

  if (!selectedPlatform) { $('platformPills').scrollIntoView({ block: 'center' }); return; }
  if (!$('pickupZone').value) { $('pickupZone').focus(); return; }
  if (!isCancelled && !selectedPayment) { $('paymentPills').scrollIntoView({ block: 'center' }); return; }

  const saveBtn = $('saveBtn');
  const saveBtnText = $('saveBtnText');

  const entry = {
    date: activeDay.date,
    time: nowTimeStr(),
    platform: selectedPlatform,
    pickupZone: $('pickupZone').value,
    dropLocation: isCancelled ? '' : ($('dropLocation').value || ''),
    fare: isCancelled ? 0 : (Number($('fare').value) || 0),
    tip: isCancelled ? 0 : (Number($('tip').value) || 0),
    extra: isCancelled ? 0 : (Number($('extra').value) || 0),
    paymentMode: isCancelled ? '' : selectedPayment,
    cancelled: isCancelled,
    notes: $('rideNotes').value || ''
  };

  saveBtn.disabled = true;
  saveBtnText.textContent = 'Saving…';

  rides.push(entry);
  saveCachedData();
  renderTodayStrip();
  renderRecentRides();

  try {
    await postToSheet({ kind: 'ride', ...entry });
    saveBtnText.textContent = 'Logged ✓';
    setSyncState('live');
  } catch (err) {
    saveBtnText.textContent = 'Saved locally (sync failed)';
    setSyncState('error');
    console.error(err);
  }

  setTimeout(() => { saveBtnText.textContent = 'Log ride'; saveBtn.disabled = false; }, 900);

  // Reset only the per-ride fields — platform/zone/payment/cancelled-state carry over
  $('fare').value = '';
  $('tip').value = '';
  $('extra').value = '';
  $('dropLocation').value = '';
  $('rideNotes').value = '';
  if (!isCancelled) $('fare').focus();
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
    const route = r.dropLocation ? `${shortZone(r.pickupZone)} → ${r.dropLocation}` : shortZone(r.pickupZone);
    return `
      <div class="recent-row">
        <span class="recent-time">${r.time || '—'}</span>
        <span class="recent-mid">${r.platform} · ${route}</span>
        <span class="recent-amount">${formatMoney(rideTotal(r))}</span>
      </div>
    `;
  }).join('');
}
