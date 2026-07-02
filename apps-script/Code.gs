/**
 * LGHS Forms → Google Sheets bridge + student hub storage.
 *
 * Setup (once, ~2 minutes):
 *  1. Create or open the Google Sheet that should collect responses.
 *  2. Extensions → Apps Script. Delete the sample code and paste this file in.
 *  3. Deploy → New deployment → type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  4. Copy the Web app URL (ends in /exec) and paste it into the app's
 *     "Sheets setup" page.
 *
 * UPDATING this code later: paste the new version, then use
 * Deploy → Manage deployments → ✏️ Edit → Version: "New version" → Deploy.
 * That keeps the SAME /exec URL so existing links keep working.
 * (A brand-new deployment gets a new URL and breaks old links.)
 *
 * What it does:
 *  - Each form gets its own tab; headers are created automatically and
 *    new questions become new columns.
 *  - Published forms are stored in a hidden "_Published Forms" tab so the
 *    app's student hub page can list them from one permanent link.
 *
 * Optional: set PUBLISH_KEY to a password to stop anyone who has a form
 * link from publishing their own forms to your hub. If you set it here,
 * enter the same key in the app's Sheets setup page.
 */

var PUBLISH_KEY = '';
var PUBLISHED_SHEET = '_Published Forms';

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    var action = data.action || 'submit';
    if (action === 'publish') return publish_(data);
    if (action === 'unpublish') return unpublish_(data);
    return submit_(data);
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function doGet(e) {
  try {
    if (e && e.parameter && e.parameter.list) {
      return json_({ ok: true, forms: listPublished_() });
    }
    return json_({ ok: true, service: 'LGHS Forms webhook' });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

// ---- Response recording ----

function submit_(data) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var tabName = String(data.formTitle || 'Responses').substring(0, 90) || 'Responses';
  var sheet = ss.getSheetByName(tabName) || ss.insertSheet(tabName);

  var questions = (data.answers || []).map(function (a) { return a.question; });
  var header = ensureHeader_(sheet, questions);

  var byQuestion = {};
  (data.answers || []).forEach(function (a) { byQuestion[a.question] = a.answer; });

  var row = header.map(function (col) {
    if (col === 'Timestamp') {
      return data.submittedAt ? new Date(data.submittedAt) : new Date();
    }
    return byQuestion.hasOwnProperty(col) ? byQuestion[col] : '';
  });

  sheet.appendRow(row);
  return json_({ ok: true });
}

/**
 * Makes sure row 1 contains Timestamp + every question, appending any new
 * questions as extra columns. Returns the final header as an array.
 */
function ensureHeader_(sheet, questions) {
  var lastCol = sheet.getLastColumn();
  var header = lastCol > 0 ? sheet.getRange(1, 1, 1, lastCol).getValues()[0] : [];

  if (header.length === 0 || header[0] !== 'Timestamp') {
    header = ['Timestamp'].concat(questions);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
    return header;
  }

  var missing = questions.filter(function (q) { return header.indexOf(q) === -1; });
  if (missing.length > 0) {
    header = header.concat(missing);
    sheet.getRange(1, 1, 1, header.length).setValues([header]);
    sheet.getRange(1, 1, 1, header.length).setFontWeight('bold');
  }
  return header;
}

// ---- Student hub: published forms ----

function publish_(data) {
  if (PUBLISH_KEY && data.key !== PUBLISH_KEY) {
    return json_({ ok: false, error: 'Wrong publish key' });
  }
  var form = data.form;
  if (!form || !form.id) return json_({ ok: false, error: 'No form' });

  var sheet = publishedSheet_();
  var rowIndex = findFormRow_(sheet, form.id);
  var row = [form.id, new Date(), JSON.stringify(form)];
  if (rowIndex > 0) {
    sheet.getRange(rowIndex, 1, 1, 3).setValues([row]);
  } else {
    sheet.appendRow(row);
  }
  return json_({ ok: true });
}

function unpublish_(data) {
  if (PUBLISH_KEY && data.key !== PUBLISH_KEY) {
    return json_({ ok: false, error: 'Wrong publish key' });
  }
  var sheet = publishedSheet_();
  var rowIndex = findFormRow_(sheet, data.formId);
  if (rowIndex > 0) sheet.deleteRow(rowIndex);
  return json_({ ok: true });
}

function listPublished_() {
  var sheet = publishedSheet_();
  var lastRow = sheet.getLastRow();
  if (lastRow < 1) return [];
  var values = sheet.getRange(1, 1, lastRow, 3).getValues();
  var forms = [];
  values.forEach(function (r) {
    if (!r[0]) return;
    try {
      var form = JSON.parse(r[2]);
      form.publishedAt = r[1] ? new Date(r[1]).getTime() : 0;
      forms.push(form);
    } catch (ignored) {}
  });
  forms.sort(function (a, b) { return b.publishedAt - a.publishedAt; });
  return forms;
}

function publishedSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(PUBLISHED_SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PUBLISHED_SHEET);
    try { sheet.hideSheet(); } catch (ignored) {}
  }
  return sheet;
}

function findFormRow_(sheet, formId) {
  var lastRow = sheet.getLastRow();
  if (lastRow < 1 || !formId) return 0;
  var ids = sheet.getRange(1, 1, lastRow, 1).getValues();
  for (var i = 0; i < ids.length; i++) {
    if (ids[i][0] === formId) return i + 1;
  }
  return 0;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
