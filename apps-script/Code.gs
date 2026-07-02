/**
 * LGHS Forms → Google Sheets bridge.
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
 * Each form gets its own tab in the spreadsheet, named after the form title.
 * The header row (Timestamp + one column per question) is created automatically,
 * and new questions added to a form later get appended as new columns.
 */

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
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

    return ContentService
      .createTextOutput(JSON.stringify({ ok: true }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (err) {
    return ContentService
      .createTextOutput(JSON.stringify({ ok: false, error: String(err) }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// Health check: open the /exec URL in a browser to verify the deployment.
function doGet() {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: true, service: 'LGHS Forms webhook' }))
    .setMimeType(ContentService.MimeType.JSON);
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
