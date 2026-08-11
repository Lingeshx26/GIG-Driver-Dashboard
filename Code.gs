/**
 * Gig Tracker — Google Sheets backend (v3: pickup/drop, tips, extras, cancelled rides).
 *
 * Setup:
 * 1. In your Sheet, keep two tabs named exactly:  Days   and   Rides
 *
 *    Days tab — row 1 headers (A → I), unchanged from before:
 *    Date | Start Time | Start KM | End Time | End KM | Total KM | Fuel Cost | Bonus | Notes
 *
 *    Rides tab — row 1 headers (A → K):
 *    Timestamp | Date | Platform | Pickup Zone | Drop Location | Fare | Tip | Extra Charges | Payment Mode | Cancelled | Notes
 *
 * 2. Extensions > Apps Script. Delete any existing code and paste this file in.
 * 3. Deploy > Manage deployments > pencil icon > Version: New version > Deploy.
 *    (If this is your first-ever deploy: Deploy > New deployment > Web app,
 *     Execute as Me, Who has access: Anyone.)
 */

const DAYS_SHEET = 'Days';
const RIDES_SHEET = 'Rides';

function doGet(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const days = readSheet(ss.getSheetByName(DAYS_SHEET));
  const rides = readSheet(ss.getSheetByName(RIDES_SHEET));
  return jsonResponse({ ok: true, days, rides });
}

function doPost(e) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const body = JSON.parse(e.postData.contents);

  if (body.kind === 'ride') {
    handleRide(ss, body);
  } else if (body.kind === 'day_start') {
    handleDayStart(ss, body);
  } else if (body.kind === 'day_end') {
    handleDayEnd(ss, body);
  } else {
    return jsonResponse({ ok: false, error: 'Unknown kind: ' + body.kind });
  }

  return jsonResponse({ ok: true });
}

function handleRide(ss, body) {
  const sheet = ss.getSheetByName(RIDES_SHEET);
  const cancelled = !!body.cancelled;
  sheet.appendRow([
    new Date(),                                  // Timestamp
    body.date || '',                              // Date
    body.platform || '',                          // Platform
    body.pickupZone || '',                        // Pickup Zone
    cancelled ? '' : (body.dropLocation || ''),    // Drop Location
    cancelled ? 0 : (body.fare || 0),              // Fare
    cancelled ? 0 : (body.tip || 0),               // Tip
    cancelled ? 0 : (body.extra || 0),             // Extra Charges
    cancelled ? '' : (body.paymentMode || ''),     // Payment Mode
    cancelled,                                     // Cancelled
    body.notes || ''                               // Notes
  ]);
}

function handleDayStart(ss, body) {
  const sheet = ss.getSheetByName(DAYS_SHEET);
  const existingRow = findDayRowIndex(sheet, body.date);
  if (existingRow !== -1) {
    // Day already has a row (e.g. re-opened after refresh) — just overwrite the start fields
    sheet.getRange(existingRow, 2, 1, 2).setValues([[body.startTime || '', body.startKm || 0]]);
    return;
  }
  sheet.appendRow([
    body.date || '',
    body.startTime || '',
    body.startKm || 0,
    '', '', '', '', '', '' // end fields blank until day_end
  ]);
}

function handleDayEnd(ss, body) {
  const sheet = ss.getSheetByName(DAYS_SHEET);
  const rowIndex = findDayRowIndex(sheet, body.date);
  if (rowIndex === -1) {
    // No start row found (shouldn't normally happen) — create a full row instead
    sheet.appendRow([
      body.date || '',
      body.startTime || '',
      body.startKm || 0,
      body.endTime || '',
      body.endKm || 0,
      body.totalKm || 0,
      body.fuelCost || 0,
      body.bonus || 0,
      body.notes || ''
    ]);
    return;
  }
  // Columns D–I: End Time, End KM, Total KM, Fuel Cost, Bonus, Notes
  sheet.getRange(rowIndex, 4, 1, 6).setValues([[
    body.endTime || '',
    body.endKm || 0,
    body.totalKm || 0,
    body.fuelCost || 0,
    body.bonus || 0,
    body.notes || ''
  ]]);
}

function findDayRowIndex(sheet, date) {
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    let cell = data[i][0];
    if (cell instanceof Date) {
      cell = Utilities.formatDate(cell, Session.getScriptTimeZone(), 'yyyy-MM-dd');
    }
    if (String(cell) === String(date)) return i + 1; // 1-indexed row number
  }
  return -1;
}

function readSheet(sheet) {
  const data = sheet.getDataRange().getValues();
  const headers = data.shift();
  return data
    .filter(row => row.some(cell => cell !== '' && cell !== null))
    .map(row => {
      const obj = {};
      headers.forEach((h, i) => {
        let val = row[i];
        if (val instanceof Date) {
          val = Utilities.formatDate(val, Session.getScriptTimeZone(), 'yyyy-MM-dd HH:mm:ss');
        }
        obj[h] = val;
      });
      return obj;
    });
}

function jsonResponse(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * ONE-TIME CLEANUP UTILITY — not called by the web app, run manually.
 *
 * Deletes every data row (everything below row 1) in both Days and Rides,
 * leaving just the header row. Use this to wipe out old test/junk entries
 * typed directly into the sheet.
 *
 * How to run it:
 * 1. In the Apps Script editor, use the function dropdown (next to the Run
 *    button, top toolbar) and select "clearAllTestData".
 * 2. Click Run. First time, it'll ask you to authorize — that's normal.
 * 3. Check both sheet tabs — only the header row should remain.
 */
function clearAllTestData() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  [DAYS_SHEET, RIDES_SHEET].forEach(name => {
    const sheet = ss.getSheetByName(name);
    const lastRow = sheet.getLastRow();
    if (lastRow > 1) {
      sheet.deleteRows(2, lastRow - 1);
    }
  });
}
