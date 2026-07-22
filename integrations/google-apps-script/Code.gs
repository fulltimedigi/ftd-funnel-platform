/**
 * integrations/google-apps-script/Code.gs — Lead backend (SPEC §10, §12).
 *
 * Receives a lead (JSON in a text/plain POST body) and upserts it by lowercased
 * email into a "Leads" sheet. The sheet + header row are auto-created and styled
 * on first write. Same email → update that row; new email → append.
 *
 * Deploy: Apps Script → Deploy → New deployment → Web App, execute as **me**,
 * who-has-access **Anyone**. Copy the /exec URL into the funnel config at
 * analytics.sheetsEndpoint. Re-deploy a NEW version after any edit. See SETUP.md.
 */

var SHEET_NAME = "Leads";
var HEADERS = [
  "التاريخ والوقت",
  "الاسم",
  "الإيميل",
  "الجوال",
  "المسار الأول",
  "المسار الثاني",
  "الـ Flags",
  "النتائج (Scores)",
  "الإجابات",
  "المصدر",
];

function doPost(e) {
  try {
    var data = JSON.parse(e.postData.contents);
    upsertLead_(getSheet_(), data);
    return jsonOut_({ ok: true });
  } catch (err) {
    return jsonOut_({ ok: false, error: String(err) });
  }
}

function getSheet_() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sh = ss.getSheetByName(SHEET_NAME);
  if (!sh) {
    sh = ss.insertSheet(SHEET_NAME);
    sh.appendRow(HEADERS);
    sh.getRange(1, 1, 1, HEADERS.length)
      .setFontWeight("bold")
      .setBackground("#0a0d1a")
      .setFontColor("#00c8f8");
    sh.setFrozenRows(1);
  }
  return sh;
}

function buildRow_(d) {
  var email = String(d.email || "").trim().toLowerCase();
  return [
    d.timestamp || new Date().toISOString(),
    d.name || "",
    email,
    d.phone || "",
    d.primaryArchetypeName || d.primaryArchetype || "",
    d.secondaryArchetype || "",
    (d.flags || []).join(", "),
    JSON.stringify(d.scores || {}),
    JSON.stringify(d.answers || {}),
    d.source || "",
  ];
}

function upsertLead_(sheet, d) {
  var email = String(d.email || "").trim().toLowerCase();
  var row = buildRow_(d);
  var EMAIL_COL = 3; // 1-based; matches HEADERS order

  if (email && sheet.getLastRow() > 1) {
    var existing = sheet.getRange(2, EMAIL_COL, sheet.getLastRow() - 1, 1).getValues();
    for (var i = 0; i < existing.length; i++) {
      if (String(existing[i][0]).trim().toLowerCase() === email) {
        sheet.getRange(i + 2, 1, 1, row.length).setValues([row]); // update in place
        return;
      }
    }
  }
  sheet.appendRow(row); // new lead
}

function jsonOut_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(
    ContentService.MimeType.JSON
  );
}
