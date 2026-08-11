# Ride Log — Coimbatore Gig Tracker

Two pages:

- **`index.html` (Today)** — start/end your day, log each ride as it happens. Nothing historical shows here; once you End Day, this page goes back to a clean "Start your day" state.
- **`history.html` (History)** — week/month/all-time totals, best pickup zone, best platform, tips collected, cancelled rides, and the full ride/day tables.

## How it's meant to be used

1. **Leave home** → open the Today page → enter your odometer reading → **Start Day**. This is mandatory — you physically cannot start a day, or later end one, without a valid odometer reading. The button stays greyed out until you enter one.
2. **After every single ride/delivery** → Platform → Pickup zone → (optional) Drop location → Fare → Cash/UPI → **Log ride**. Tip and extra charges (rain, surge, waiting) are tucked behind a "+ Add tip / extra charge" link so they don't slow down the common case. If a ride gets cancelled, tap **Ride cancelled?** first — it swaps the form to just Platform + Pickup zone + a note, no money fields.
3. **Get home, park the bike** → **End Day** → closing odometer reading and today's fuel cost (both required) + any bonus/incentive. This is where total KM and ₹/km get calculated.
4. Check the **History** page whenever you want the bigger picture — which zone and platform are actually paying off, your net over the week/month, how much you've made in tips, how many rides you've had to cancel.

## 1. Set up the Google Sheet

Two tabs, named exactly:

**`Days`** — row 1 headers, A → I (unchanged if you already had this):
```
Date | Start Time | Start KM | End Time | End KM | Total KM | Fuel Cost | Bonus | Notes
```

**`Rides`** — row 1 headers, A → K:
```
Timestamp | Date | Platform | Pickup Zone | Drop Location | Fare | Tip | Extra Charges | Payment Mode | Cancelled | Notes
```

**If you already built the `Rides` tab from an earlier version** (headers: Timestamp, Date, Platform, Zone, Fare, Payment Mode, Notes) — clear the header row and any test rows, then retype the new K-column header row above. No real ride data has gone through it yet, so nothing's lost.

## 2. Deploy the Apps Script backend

1. In the Sheet: **Extensions → Apps Script**.
2. Delete existing code in `Code.gs`, paste in [`apps-script/Code.gs`](apps-script/Code.gs) from this repo.
3. **Deploy → Manage deployments → pencil/edit icon → Version: New version → Deploy.**
   (First time only: **Deploy → New deployment → Web app** — Execute as **Me**, Who has access: **Anyone**.)
4. If this is your very first deployment, copy the **Web app URL** (ends in `/exec`) — you'll need it in step 3. If you're re-deploying an existing one, the URL doesn't change.

## 3. Connect the frontend

Both `today.js` and `history.js` read from `shared.js` — you only set the URL once, in `shared.js`:

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
git commit -m "Ride log tracker v3 — two pages, pickup/drop, tips, cancelled rides"
git branch -M main
git remote add origin https://github.com/<your-username>/<repo-name>.git
git push -u origin main
```

Then: **Settings → Pages → Source: Deploy from branch → main → / (root)**. Live at `https://<your-username>.github.io/<repo-name>/` shortly after — `index.html` is the Today page by default.

## How the numbers work

- A ride's **total** = Fare + Tip + Extra charges. A **cancelled** ride always contributes ₹0 and is excluded from every earnings figure, but is counted separately so you can see how much time you're losing to cancellations.
- **Today's gross** (Today page) is a running total while your day is open. Once you End Day, fuel and bonus factor in and it becomes the day's **net** — visible on the History page's Day Summary table.
- **₹/km** only exists once a day is closed, since it needs the day's total KM.
- **Best pickup zone / best platform** (History page): whichever earned the most total ride income in the selected window.
- **Tips collected**: sum of the Tip field across the window — separate from fares, so you can see how much tipping is actually contributing.
- A small amber dot next to a ride's time in the log means it fell in a peak window (8–10 AM or 5–8 PM).

## Notes

- "Day in progress" is remembered on your phone (`localStorage`) so losing signal or closing the tab mid-shift doesn't lose your start KM — it only clears once you End Day.
- Stick to one device per day — if you start on one phone and try to end on another, the second device won't know your start KM.
- The Apps Script URL in `shared.js` is visible in the page source. Fine for personal use; add a shared-secret check inside `doPost` in `Code.gs` if that ever matters.

## Ideas for later (not built yet)

- **Fuel-efficiency / service reminder** — track cumulative KM since last service, nudge you when due.
- **Weekly platform comparison chart** — a visual bar comparing Rapido vs Blinkit vs Zomato earnings per hour, not just totals.
- **Idle/waiting time between rides** — to see which zones have the least dead time, not just the most fares.
- **Drop-location autocomplete** — right now it's free text, which is flexible but means typos won't group together for stats. A short autocomplete list of your common drop spots could help if that ever becomes useful.
