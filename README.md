# Ride Log — Coimbatore Gig Tracker

Two pages:

- **`index.html` (Today)** — start/end your day, start/end each ride as it happens. Nothing historical shows here; once you End Day, this page goes back to a clean "Start your day" state.
- **`history.html` (History)** — week/month/all-time totals, best pickup zone, best platform, tips collected, cancelled rides, distance per ride, and the full ride/day tables.

## How it's meant to be used

1. **Leave home** → open the Today page → enter your odometer reading → **Start Day**. Mandatory — the button stays greyed out until you enter a valid reading.
2. **Arrive at pickup** → Platform (Rapido/Blinkit) → Pickup zone → tap **📍 GPS** to capture your pickup location automatically (auto-fills the address and even auto-suggests the closest zone — both stay editable if it guesses wrong) → **Start Ride**.
3. **Reach the drop point** → tap **End Ride** → tap **📍 GPS** again to capture the drop location → the app calculates the actual route distance between pickup and drop automatically → fill in Fare, Payment mode, and any tip/extra charge → **Finish ride**. If the ride got cancelled at any point, tap **Ride cancelled?** first — it skips straight to just a notes field, no GPS or money needed.
4. **Get home, park the bike** → **End Day** → closing odometer reading and today's fuel cost (both required) + any bonus/incentive.
5. Check **History** whenever you want the bigger picture.

## GPS, addresses, and distance — how it works, and what to expect

- **Location**: your browser's built-in Geolocation API. No signup, works over HTTPS (GitHub Pages qualifies). It'll ask permission once.
- **Address text**: a free reverse-geocoding service called Nominatim (OpenStreetMap). No API key. Occasionally the address it returns is a bit generic — the field is always editable, so just correct it if needed.
- **Distance**: a free routing service (OSRM) estimates the actual road distance between your pickup and drop points. If it's ever unreachable, the app falls back to a straight-line estimate and clearly labels it "(estimated)" so you always know which kind of number you're looking at.
- **This distance is separate from your day-level odometer KM.** The odometer figure (Start KM → End KM) stays the authoritative number for fuel/₹-per-km, since it captures everything — riding to pickup, detours, positioning between drops. Per-ride distance is a supplementary stat for comparing individual rides, not a replacement.
- If GPS fails or you'd rather not grant permission, every location field can still be typed in by hand — nothing is ever GPS-only.

## 1. Set up the Google Sheet

Two tabs, named exactly:

**`Days`** — row 1 headers, A → I (unchanged):
```
Date | Start Time | Start KM | End Time | End KM | Total KM | Fuel Cost | Bonus | Notes
```

**`Rides`** — row 1 headers, A → S:
```
Timestamp | Date | Platform | Pickup Zone | Pickup Address | Pickup Lat | Pickup Lng | Start Time | Drop Location | Drop Lat | Drop Lng | Distance KM | End Time | Fare | Tip | Extra Charges | Payment Mode | Cancelled | Notes
```

**If you already have an older `Rides` tab** (7 or 11 columns) — clear the header row and retype the 19-column version above. No data migration needed if you haven't logged real rides on the old schema yet.

## 2. Deploy the Apps Script backend

1. In the Sheet: **Extensions → Apps Script**.
2. Delete existing code in `Code.gs`, paste in [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
3. **Deploy → Manage deployments → pencil/edit icon → Version: New version → Deploy.**
   (First time only: **Deploy → New deployment → Web app** — Execute as **Me**, Who has access: **Anyone**.)

## 3. Connect the frontend

Set the URL once, in `shared.js`:

```js
const CONFIG = {
  SCRIPT_URL: 'https://script.google.com/macros/s/XXXXXXXX/exec',
  SHEET_URL: 'https://docs.google.com/spreadsheets/d/XXXXXXXX/edit' // optional
};
```

## 4. Host it on GitHub Pages

```bash
git init
git add .
git commit -m "Ride log tracker v4 — GPS pickup/drop, route distance, two-platform"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then: **Settings → Pages → Source: Deploy from branch → main → / (root)**.

## How the numbers work

- A ride's **total** = Fare + Tip + Extra charges. A **cancelled** ride always contributes ₹0 and is excluded from every earnings figure, but is counted separately.
- **Today's gross** (Today page) is a running total while your day is open. Once you End Day, fuel and bonus factor in and it becomes the day's **net**.
- **₹/km** (day-level) only exists once a day is closed, since it needs the odometer's total KM.
- **Best pickup zone / best platform**: whichever earned the most total ride income in the selected window.
- A small amber dot next to a ride's time in the History log means it fell in a peak window (8–10 AM or 5–8 PM).

## Notes

- "Day in progress" and "Ride in progress" are both remembered on your phone (`localStorage`) so losing signal or closing the tab doesn't lose your captured pickup point — they only clear once you End Day / Finish that ride.
- Stick to one device per day/ride — a second device won't know your start KM or pickup point.
- The Apps Script URL in `shared.js` is visible in the page source. Fine for personal use; add a shared-secret check inside `doPost` in `Code.gs` if that ever matters.
- The zone-auto-suggest coordinates in `shared.js` (`ZONE_COORDS`) are rough estimates for each named area, used only to pre-select the closest match — always double-check and adjust if it picks the wrong one.

## Ideas for later (not built yet)

- **Fuel-efficiency / service reminder** — track cumulative KM since last service, nudge you when due.
- **Weekly platform comparison chart** — a visual bar comparing Rapido vs Blinkit earnings per hour.
- **Idle/waiting time between rides** — which zones have the least dead time, not just the most fares.
- **Little map view** on the History page showing the day's pickup/drop pins — genuinely free to add (OpenStreetMap tiles, no key needed) now that real coordinates are being captured.

