let activeRange = 'week';

document.addEventListener('DOMContentLoaded', async () => {
  if (CONFIG.SHEET_URL) $('sheetLink').href = CONFIG.SHEET_URL;

  bindRangeTabs();

  // Show last-known data instantly (if any) while the fresh fetch loads in the background
  if (loadCachedData()) {
    renderAll();
  }

  await loadFromSheet();
  renderAll();
});

function bindRangeTabs() {
  document.querySelectorAll('.range-tab').forEach(tab => {
    tab.addEventListener('click', () => {
      document.querySelectorAll('.range-tab').forEach(t => t.classList.remove('is-active'));
      tab.classList.add('is-active');
      activeRange = tab.dataset.range;
      renderRangeSummary();
    });
  });
}

function renderAll() {
  renderRangeSummary();
  renderRideTable();
  renderDayTable();
}

/* ============================================
   RANGE SUMMARY
   ============================================ */
function renderRangeSummary() {
  const dateSetAll = new Set([...rides.map(r => r.date), ...days.map(d => d.date)]);
  const inRange = (date) => activeRange === 'all' || rangeDates(activeRange).has(date);

  const relevantDates = [...dateSetAll].filter(inRange);
  const relevantRides = rides.filter(r => relevantDates.includes(r.date));
  const relevantDays = days.filter(d => relevantDates.includes(d.date));

  let totalNet = 0;
  relevantDates.forEach(date => {
    const dayRec = relevantDays.find(d => d.date === date);
    const gross = sum(relevantRides.filter(r => r.date === date), rideTotal);
    totalNet += dayRec ? (gross + dayRec.bonus - dayRec.fuelCost) : gross;
  });

  const daysWorked = relevantDates.length;
  const avg = daysWorked > 0 ? Math.round(totalNet / daysWorked) : 0;
  const activeRides = relevantRides.filter(r => !r.cancelled);
  const cancelledCount = relevantRides.length - activeRides.length;
  const tips = sum(activeRides, r => r.tip);

  $('rangeNet').textContent = formatMoney(totalNet);
  $('rangeAvg').textContent = formatMoney(avg);
  $('rangeBestZone').textContent = topGroup(activeRides, 'pickupZone') || '—';
  $('rangeBestPlatform').textContent = topGroup(activeRides, 'platform') || '—';
  $('rangeTips').textContent = formatMoney(tips);
  $('rangeCancelled').textContent = cancelledCount;
}

function rangeDates(range) {
  const set = new Set();
  if (range === 'all') return set;
  const now = new Date();
  const cutoff = new Date();
  if (range === 'week') cutoff.setDate(now.getDate() - 7);
  if (range === 'month') cutoff.setMonth(now.getMonth() - 1);
  const allDates = new Set([...rides.map(r => r.date), ...days.map(d => d.date)]);
  allDates.forEach(date => {
    if (new Date(date) >= cutoff) set.add(date);
  });
  return set;
}

function topGroup(list, key) {
  const totals = {};
  list.forEach(r => { totals[r[key]] = (totals[r[key]] || 0) + rideTotal(r); });
  const sorted = Object.entries(totals).filter(([k]) => k).sort((a, b) => b[1] - a[1]);
  return sorted.length ? shortZone(sorted[0][0]) : null;
}

/* ============================================
   RIDE LOG TABLE
   ============================================ */
function renderRideTable() {
  const body = $('rideTableBody');
  const sorted = [...rides].sort((a, b) => {
    if (a.date !== b.date) return b.date.localeCompare(a.date);
    return (b.time || '').localeCompare(a.time || '');
  }).slice(0, 150); // keep the DOM light; full history always lives in the Sheet

  if (sorted.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="5">No rides logged yet.</td></tr>';
    return;
  }

  body.innerHTML = sorted.map(r => {
    if (r.cancelled) {
      return `
        <tr class="row-cancelled">
          <td>${r.time || '—'}</td>
          <td>${r.platform}</td>
          <td>${shortZone(r.pickupZone)} · cancelled</td>
          <td>—</td>
          <td>—</td>
          <td>—</td>
        </tr>
      `;
    }
    const route = r.dropLocation ? `${shortZone(r.pickupZone)} → ${r.dropLocation}` : shortZone(r.pickupZone);
    return `
      <tr>
        <td>${isPeak(r.time) ? '<span class="peak-dot" title="Peak hours"></span>' : ''}${r.time || '—'}</td>
        <td>${r.platform}</td>
        <td>${route}</td>
        <td>${r.distanceKm != null ? r.distanceKm + ' km' + (r.roundTripKm ? ` (RT ${r.roundTripKm})` : '') : '—'}</td>
        <td>${formatMoney(rideTotal(r))}</td>
        <td><span class="pay-tag ${r.paymentMode === 'Cash' ? 'pay-tag-cash' : 'pay-tag-upi'}">${r.paymentMode}</span></td>
      </tr>
    `;
  }).join('');
}

/* ============================================
   DAY SUMMARY TABLE
   ============================================ */
function renderDayTable() {
  const body = $('dayTableBody');
  const closedDays = [...days].filter(d => d.endTime).sort((a, b) => b.date.localeCompare(a.date));

  if (closedDays.length === 0) {
    body.innerHTML = '<tr class="empty-row"><td colspan="6">No days closed out yet.</td></tr>';
    return;
  }

  body.innerHTML = closedDays.map(d => {
    const gross = sum(rides.filter(r => r.date === d.date), rideTotal);
    const net = gross + d.bonus - d.fuelCost;
    const perKm = d.totalKm > 0 ? Math.round(net / d.totalKm) : 0;
    return `
      <tr>
        <td>${formatDate(d.date)}</td>
        <td>${d.totalKm.toFixed(1)}</td>
        <td>${formatMoney(d.fuelCost)}</td>
        <td>${formatMoney(d.bonus)}</td>
        <td class="${net >= 0 ? 'net-positive' : 'net-negative'}">${formatMoney(net)}</td>
        <td>${formatMoney(perKm)}</td>
      </tr>
    `;
  }).join('');
}
