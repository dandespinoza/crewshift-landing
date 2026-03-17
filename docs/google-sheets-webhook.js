/**
 * Google Apps Script — Paste this into your Google Sheet
 *
 * SETUP:
 * 1. Open your Google Sheet
 * 2. Go to Extensions > Apps Script
 * 3. Delete any existing code and paste this entire file
 * 4. Click Deploy > New Deployment
 * 5. Choose "Web app"
 * 6. Set "Execute as" → Me
 * 7. Set "Who has access" → Anyone
 * 8. Click Deploy
 * 9. Copy the Web App URL — it looks like:
 *    https://script.google.com/macros/s/AKfycb.../exec
 * 10. Paste that URL into your .env.local as NEXT_PUBLIC_GOOGLE_SHEET_URL
 *
 * Your sheet should have these column headers in Row 1:
 * Timestamp | Name | Business Name | Email | Phone
 */

function doPost(e) {
  try {
    var sheet = SpreadsheetApp.getActiveSpreadsheet().getActiveSheet();
    var data = JSON.parse(e.postData.contents);

    sheet.appendRow([
      new Date().toLocaleString(),
      data.name,
      data.businessName,
      data.email,
      data.phone,
    ]);

    return ContentService
      .createTextOutput(JSON.stringify({ status: 'success' }))
      .setMimeType(ContentService.MimeType.JSON);
  } catch (error) {
    return ContentService
      .createTextOutput(JSON.stringify({ status: 'error', message: error.toString() }))
      .setMimeType(ContentService.MimeType.JSON);
  }
}

// This handles CORS preflight — required for browser fetch
function doGet(e) {
  return ContentService
    .createTextOutput(JSON.stringify({ status: 'ok' }))
    .setMimeType(ContentService.MimeType.JSON);
}
