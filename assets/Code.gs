/**
 * ============================================================
 *  Field Data Collection — Apps Script Backend
 * ------------------------------------------------------------
 *  Sheets expected in THIS spreadsheet (exact tab names):
 *    1. "Users"       -> User Id | Password | Employee ID | Employee Name
 *    2. "Assignment"  -> User Id | Facility | Shift | Zone | Ward | VID
 *    3. "Entries"     -> ID | Timestamp | User Id | Facility | Shift | Zone | Ward | VID | Wet | Dry | Sanitary | DHW
 *
 *  Deploy: Extensions > Apps Script > paste this file > Deploy >
 *          New deployment > Type: Web app > Execute as: Me >
 *          Who has access: Anyone > Deploy. Copy the /exec URL
 *          into assets/config.js on the frontend.
 * ============================================================
 */

const SHEET_USERS = 'Users';
const SHEET_ASSIGNMENT = 'Assignment';
const SHEET_ENTRIES = 'Entries';

// 12-hour session validity (in milliseconds)
const SESSION_DURATION_MS = 12 * 60 * 60 * 1000;

/**
 * Web app entry points.
 * The frontend calls this as a JSON API via POST (avoids CORS preflight
 * issues by sending a simple text/plain body containing JSON).
 */
function doPost(e) {
  return handleRequest(e);
}
function doGet(e) {
  return handleRequest(e);
}

function handleRequest(e) {
  let out;
  try {
    const body = parseBody(e);
    const action = body.action;

    switch (action) {
      case 'login':
        out = login(body.userId, body.password);
        break;
      case 'getAssignments':
        out = getAssignments(requireSession(body));
        break;
      case 'submitEntries':
        out = submitEntries(requireSession(body), body.entries);
        break;
      case 'ping':
        out = { success: true, message: 'ok' };
        break;
      default:
        out = { success: false, error: 'Unknown action: ' + action };
    }
  } catch (err) {
    out = { success: false, error: err && err.message ? err.message : String(err) };
  }
  return ContentService.createTextOutput(JSON.stringify(out))
    .setMimeType(ContentService.MimeType.JSON);
}

function parseBody(e) {
  if (e && e.postData && e.postData.contents) {
    return JSON.parse(e.postData.contents);
  }
  if (e && e.parameter && e.parameter.payload) {
    return JSON.parse(e.parameter.payload);
  }
  return {};
}

/** Session token = base64("userId|issuedAtMillis|signature") — lightweight, not high-security. */
function makeToken(userId) {
  const issuedAt = Date.now();
  const raw = userId + '|' + issuedAt;
  const sig = Utilities.base64Encode(
    Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, raw + '::salt-wt-2026')
  ).substring(0, 12);
  return Utilities.base64Encode(raw + '|' + sig);
}

function verifyToken(token, userId) {
  try {
    const decoded = Utilities.newBlob(Utilities.base64Decode(token)).getDataAsString();
    const parts = decoded.split('|');
    const tUser = parts[0], issuedAt = Number(parts[1]), sig = parts[2];
    if (tUser !== userId) return false;
    const expectedRaw = tUser + '|' + issuedAt;
    const expectedSig = Utilities.base64Encode(
      Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, expectedRaw + '::salt-wt-2026')
    ).substring(0, 12);
    if (sig !== expectedSig) return false;
    if (Date.now() - issuedAt > SESSION_DURATION_MS) return false;
    return true;
  } catch (err) {
    return false;
  }
}

function requireSession(body) {
  const userId = String(body.userId || '').trim();
  const token = String(body.token || '').trim();
  if (!userId || !token || !verifyToken(token, userId)) {
    throw new Error('SESSION_EXPIRED');
  }
  return userId;
}

/** ---------- LOGIN ---------- */
function login(userId, password) {
  userId = String(userId || '').trim();
  password = String(password || '').trim();
  if (!userId || !password) return { success: false, error: 'User ID and password are required.' };

  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_USERS);
  const data = sheet.getDataRange().getValues();
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rUser = String(row[0]).trim();
    const rPass = String(row[1]).trim();
    if (rUser === userId && rPass === password) {
      return {
        success: true,
        userId: rUser,
        employeeId: row[2],
        employeeName: row[3],
        token: makeToken(rUser),
        expiresInMs: SESSION_DURATION_MS
      };
    }
  }
  return { success: false, error: 'Invalid User ID or password.' };
}

/** ---------- ASSIGNMENTS + EXISTING ENTRIES (merged, scoped to logged-in user) ---------- */
function getAssignments(userId) {
  const assignSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ASSIGNMENT);
  const assignData = assignSheet.getDataRange().getValues();
  const assignments = [];
  for (let i = 1; i < assignData.length; i++) {
    const row = assignData[i];
    if (String(row[0]).trim() === userId) {
      assignments.push({
        userId: String(row[0]).trim(),
        facility: String(row[1]).trim(),
        shift: String(row[2]).trim(),
        zone: String(row[3]).trim(),
        ward: String(row[4]).trim(),
        vid: String(row[5]).trim()
      });
    }
  }

  const existingByKey = getEntriesMapForUser(userId);

  const merged = assignments.map(function (a) {
    const key = entryKey(a.userId, a.facility, a.shift, a.zone, a.ward, a.vid);
    const existing = existingByKey[key];
    return {
      key: key,
      userId: a.userId,
      facility: a.facility,
      shift: a.shift,
      zone: a.zone,
      ward: a.ward,
      vid: a.vid,
      entryId: existing ? existing.id : null,
      timestamp: existing ? existing.timestamp : null,
      wet: existing ? existing.wet : '',
      dry: existing ? existing.dry : '',
      sanitary: existing ? existing.sanitary : '',
      dhw: existing ? existing.dhw : '',
      status: existing ? 'completed' : 'pending'
    };
  });

  return { success: true, assignments: merged };
}

function entryKey(userId, facility, shift, zone, ward, vid) {
  return [userId, facility, shift, zone, ward, vid].join('||');
}

function getEntriesMapForUser(userId) {
  const sheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ENTRIES);
  const data = sheet.getDataRange().getValues();
  const map = {};
  for (let i = 1; i < data.length; i++) {
    const row = data[i];
    const rUser = String(row[2]).trim();
    if (rUser !== userId) continue;
    const key = entryKey(rUser, String(row[3]).trim(), String(row[4]).trim(), String(row[5]).trim(), String(row[6]).trim(), String(row[7]).trim());
    map[key] = {
      rowIndex: i + 1, // 1-based sheet row
      id: row[0],
      timestamp: row[1],
      wet: row[8],
      dry: row[9],
      sanitary: row[10],
      dhw: row[11]
    };
  }
  return map;
}

/** ---------- SUBMIT (single or bulk) — upsert, no duplicates ---------- */
function submitEntries(userId, entries) {
  if (!entries || !entries.length) return { success: false, error: 'No entries provided.' };

  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const assignSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ASSIGNMENT);
    const assignData = assignSheet.getDataRange().getValues();
    const validKeys = {};
    for (let i = 1; i < assignData.length; i++) {
      const row = assignData[i];
      if (String(row[0]).trim() === userId) {
        validKeys[entryKey(userId, String(row[1]).trim(), String(row[2]).trim(), String(row[3]).trim(), String(row[4]).trim(), String(row[5]).trim())] = true;
      }
    }

    const entriesSheet = SpreadsheetApp.getActive().getSheetByName(SHEET_ENTRIES);
    const existingByKey = getEntriesMapForUser(userId);
    const results = [];
    const now = new Date();
    let nextIdSeed = getNextIdSeed(entriesSheet);

    entries.forEach(function (e) {
      const facility = String(e.facility || '').trim();
      const shift = String(e.shift || '').trim();
      const zone = String(e.zone || '').trim();
      const ward = String(e.ward || '').trim();
      const vid = String(e.vid || '').trim();
      const key = entryKey(userId, facility, shift, zone, ward, vid);

      // Reject anything not actually assigned to this user
      if (!validKeys[key]) {
        results.push({ key: key, success: false, error: 'Not assigned to this user.' });
        return;
      }

      const wet = Number(e.wet);
      const dry = Number(e.dry);
      const sanitary = Number(e.sanitary);
      const dhw = Number(e.dhw);
      const nums = [wet, dry, sanitary, dhw];
      const anyBlank = [e.wet, e.dry, e.sanitary, e.dhw].some(function (v) {
        return v === '' || v === null || v === undefined;
      });
      const anyInvalid = nums.some(function (n) { return isNaN(n) || n < 0; });

      if (anyBlank || anyInvalid) {
        results.push({ key: key, success: false, error: 'All values are required and must be >= 0.' });
        return;
      }

      const existing = existingByKey[key];
      if (existing) {
        // EDIT in place — no duplicate row created
        entriesSheet.getRange(existing.rowIndex, 2, 1, 1).setValue(now); // Timestamp
        entriesSheet.getRange(existing.rowIndex, 9, 1, 4).setValues([[wet, dry, sanitary, dhw]]); // Wet..DHW
        results.push({ key: key, success: true, id: existing.id, mode: 'updated' });
      } else {
        const id = 'E' + nextIdSeed;
        nextIdSeed++;
        entriesSheet.appendRow([id, now, userId, facility, shift, zone, ward, vid, wet, dry, sanitary, dhw]);
        existingByKey[key] = { rowIndex: entriesSheet.getLastRow(), id: id };
        results.push({ key: key, success: true, id: id, mode: 'created' });
      }
    });

    return { success: true, results: results };
  } finally {
    lock.releaseLock();
  }
}

function getNextIdSeed(entriesSheet) {
  const lastRow = entriesSheet.getLastRow();
  if (lastRow < 2) return 1;
  const ids = entriesSheet.getRange(2, 1, lastRow - 1, 1).getValues();
  let max = 0;
  ids.forEach(function (r) {
    const n = parseInt(String(r[0]).replace(/[^0-9]/g, ''), 10);
    if (!isNaN(n) && n > max) max = n;
  });
  return max + 1;
}
