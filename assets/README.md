# FieldTrack — Waste Collection Data Portal

A mobile-first web app for field staff to log daily Wet / Dry / Sanitary / DHW
collection figures against their assigned Facility / Shift / Zone / Ward / VID
list. Frontend is static (GitHub Pages‑ready); backend is a Google Apps Script
Web App reading/writing a single Google Sheet.

---

## 1. Google Sheet setup

Create one Google Sheet with **exactly** these three tabs (names matter, case-sensitive):

### Tab: `Users`
| User Id | Password | Employee ID | Employee Name |
|---|---|---|---|
| 109 | Pass@109 | Sample | Name |

You maintain this manually — one row per person who can log in.

### Tab: `Assignment`
| User Id | Facility | Shift | Zone | Ward | VID |
|---|---|---|---|---|---|
| 109 | X1 | A | 9 | 109 | V100 |

You maintain this manually too — one row per Facility/VID a user is
responsible for that day. A user only ever sees rows where `User Id`
matches their own login.

### Tab: `Entries`
| ID | Timestamp | User Id | Facility | Shift | Zone | Ward | VID | Wet | Dry | Sanitary | DHW |
|---|---|---|---|---|---|---|---|---|---|---|---|

Leave this **empty except for the header row** — the app generates every
row here itself (ID + Timestamp auto-generated; User Id/Facility/Shift/
Zone/Ward/VID auto-filled from the matching `Assignment` row; Wet/Dry/
Sanitary/DHW typed by the user). Never edit this sheet by hand while the
app is in use.

> **Daily reset:** at the end of each collection day, copy out the
> `Entries` data for your records, then delete all data rows (keep the
> header) and refresh `Assignment` with the next day's list. That's it —
> no code changes needed.

---

## 2. Deploy the backend (Apps Script)

1. Open the Sheet → **Extensions → Apps Script**.
2. Delete the default `Code.gs` content and paste in this project's
   `Code.gs`.
3. Click **Deploy → New deployment**.
4. Type: **Web app**.
   - Execute as: **Me**
   - Who has access: **Anyone**
5. Click **Deploy**, authorize the requested permissions, and copy the
   generated **Web app URL** (ends in `/exec`).

If you ever edit `Code.gs` again, use **Deploy → Manage deployments →
Edit → New version** so the same URL keeps working.

---

## 3. Configure and publish the frontend

1. Open `assets/config.js` and paste your Web App URL:
   ```js
   const API_URL = "https://script.google.com/macros/s/XXXXXXXX/exec";
   ```
2. Push the whole `waste-tracker/` folder to a GitHub repo.
3. Repo → **Settings → Pages** → deploy from the branch/root containing
   `index.html`.
4. Open the published URL on any phone or desktop browser.

---

## 4. How the app behaves

- **Login** — checked against the `Users` tab. On success the browser
  stores a signed session token good for **12 hours**; a live countdown
  shows in the top bar and auto-logs-out on expiry.
- **Scoping** — every request is filtered server-side by the logged-in
  `User Id`; a user can never fetch or submit rows belonging to someone
  else's `Assignment` list, even if they tamper with the browser.
- **Entry validation** — Wet, Dry, Sanitary and DHW must **all** be
  filled and **≥ 0** before a row can be submitted, whether submitted
  one row at a time or as a bulk "Submit all filled" batch (handles
  100+ rows in one call).
- **No duplicates** — each row is uniquely identified by
  `User Id + Facility + Shift + Zone + Ward + VID`. Submitting again for
  the same combination **updates** the existing `Entries` row (new
  Timestamp, new values) instead of creating a second row — this is how
  "edit an already-submitted entry" works.
- **KPIs** — total assigned, completed, pending, % progress ring, and
  running totals of Wet/Dry/Sanitary/DHW logged so far, all recalculated
  live after every submission.
- **Completed Entries table** — shows everything already submitted by
  that user, with values editable straight from the assignments table
  above (button switches to "Update").

---

## 5. Files

```
waste-tracker/
├── index.html          # Login + dashboard markup
├── assets/
│   ├── style.css        # Violet/Blue/Teal theme + animations
│   ├── app.js            # All frontend logic (auth, KPIs, submit)
│   └── config.js          # Paste your Apps Script URL here
├── Code.gs               # Apps Script backend (paste into the Sheet's script editor)
└── README.md
```

## 6. Notes / things you may want to tune later

- Session length (`SESSION_MS` in `app.js`, `SESSION_DURATION_MS` in
  `Code.gs`) — both must be changed together if you adjust the 12-hour
  window.
- The login token is a lightweight signed value (not bank-grade auth) —
  appropriate for an internal field-ops tool, not for public-internet
  sensitive data.
- Apps Script Web Apps can be slow to cold-start (1–2s) — this is
  normal for the free tier.
