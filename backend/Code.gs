// Backend for the website: contact form, résumé passcodes and polls.
// Lives in Apps Script attached to the "Website" Google Sheet.
// Deploy > New deployment > Web app, execute as me, access: anyone.

const TABS = {
  Messages: ['Time', 'Name', 'Email', 'Topic', 'Message'],
  Passcodes: ['Passcode', 'Expires', 'Note', 'Active'],
  Unlocks: ['Time', 'Passcode', 'Who', 'Result'],
  Votes: ['Time', 'Poll', 'Version', 'Answer'],
};

const LIMITS = {
  contact: { count: 20, seconds: 3600 },
  unlockFailures: { count: 10, seconds: 900 },
  vote: { count: 500, seconds: 3600 },
};

const ACTIONS = { contact, unlock, vote, results };

function doPost(e) {
  let req;
  try {
    req = JSON.parse(e.postData.contents);
  } catch (err) {
    return reply({ ok: false, error: 'bad_request' });
  }

  const handler = Object.prototype.hasOwnProperty.call(ACTIONS, req.action) && ACTIONS[req.action];
  if (!handler) return reply({ ok: false, error: 'unknown_action' });

  try {
    return reply(handler(req));
  } catch (err) {
    console.error(err);
    return reply({ ok: false, error: 'server' });
  }
}

function doGet() {
  return reply({ ok: true });
}

// Actions

function contact(req) {
  // Bots fill the hidden field or submit instantly. Pretend it worked.
  if (req.website || Number(req.elapsed) < 3000) return { ok: true };

  const name = clean(req.name, 100);
  const email = clean(req.email, 200);
  const topic = clean(req.topic, 60) || 'General';
  const message = clean(req.message, 5000, true);
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email) || !message) {
    return { ok: false, error: 'invalid' };
  }
  if (!allowed('contact', LIMITS.contact)) return { ok: false, error: 'busy' };
  count('contact', LIMITS.contact);

  tab('Messages').appendRow([new Date(), name, email, topic, message].map(cell));
  MailApp.sendEmail({
    to: setting('OWNER_EMAIL'),
    replyTo: email,
    name: 'Website',
    subject: 'Website: ' + topic + (name ? ' from ' + name : ''),
    body: [
      'Sent via website form. Everything below was written by a visitor.',
      '',
      'Name: ' + (name || '(not given)'),
      'Email: ' + email,
      'Topic: ' + topic,
      '',
      message,
    ].join('\n'),
  });
  return { ok: true };
}

function unlock(req) {
  if (!allowed('unlock-failures', LIMITS.unlockFailures)) return { ok: false, error: 'busy' };

  const code = clean(req.code, 100);
  const who = clean(req.who, 120);
  const result = checkPasscode(code);
  tab('Unlocks').appendRow([new Date(), code, who, result].map(cell));

  if (result !== 'ok') {
    count('unlock-failures', LIMITS.unlockFailures);
    return { ok: false, error: 'denied' };
  }
  return { ok: true, html: HtmlService.createHtmlOutputFromFile('Resume').getContent() };
}

function vote(req) {
  const poll = clean(req.poll, 40);
  const version = req.version === 'a' || req.version === 'b' ? req.version : '';
  const answer = req.answer === 'yes' || req.answer === 'no' ? req.answer : '';
  if (!/^[a-z0-9-]+$/.test(poll) || !version || !answer) return { ok: false, error: 'invalid' };
  if (!allowed('vote', LIMITS.vote)) return { ok: false, error: 'busy' };
  count('vote', LIMITS.vote);

  tab('Votes').appendRow([new Date(), poll, version, answer]);
  CacheService.getScriptCache().remove('results:' + poll);
  return { ok: true, results: tally(poll) };
}

function results(req) {
  const poll = clean(req.poll, 40);
  if (!/^[a-z0-9-]+$/.test(poll)) return { ok: false, error: 'invalid' };
  return { ok: true, results: tally(poll) };
}

// Helpers

function checkPasscode(code) {
  if (!code) return 'wrong';
  const rows = tab('Passcodes').getDataRange().getValues().slice(1);
  const row = rows.find((r) => String(r[0]).trim().toLowerCase() === code.toLowerCase());
  if (!row) return 'wrong';

  const active = row[3] === true || /^(true|yes|y|1)$/i.test(String(row[3]).trim());
  if (!active) return 'inactive';

  // The expiry date counts as a full day. A blank date never expires.
  if (Object.prototype.toString.call(row[1]) === '[object Date]') {
    const end = new Date(row[1]);
    end.setHours(23, 59, 59, 999);
    if (new Date() > end) return 'expired';
  }
  return 'ok';
}

function tally(poll) {
  const cache = CacheService.getScriptCache();
  const cached = cache.get('results:' + poll);
  if (cached) return JSON.parse(cached);

  const counts = { a: { yes: 0, no: 0 }, b: { yes: 0, no: 0 } };
  for (const [, p, v, a] of tab('Votes').getDataRange().getValues().slice(1)) {
    if (p === poll && (v === 'a' || v === 'b') && (a === 'yes' || a === 'no')) counts[v][a]++;
  }
  cache.put('results:' + poll, JSON.stringify(counts), 60);
  return counts;
}

function allowed(key, limit) {
  return Number(CacheService.getScriptCache().get(key) || 0) < limit.count;
}

function count(key, limit) {
  const cache = CacheService.getScriptCache();
  cache.put(key, String(Number(cache.get(key) || 0) + 1), limit.seconds);
}

function clean(value, max, multiline) {
  let s = value == null ? '' : String(value);
  s = multiline
    ? s.replace(/\r\n?/g, '\n').replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, '')
    : s.replace(/[\u0000-\u001F\u007F]+/g, ' ');
  return s.trim().slice(0, max);
}

// Stops Sheets from treating visitor text as a formula.
function cell(value) {
  return typeof value === 'string' && /^[=+\-@]/.test(value) ? "'" + value : value;
}

function tab(name) {
  const book = SpreadsheetApp.openById(setting('SHEET_ID'));
  const sheet = book.getSheetByName(name);
  if (!sheet) throw new Error('Missing tab "' + name + '". Run setup() again.');
  return sheet;
}

function setting(key) {
  const value = PropertiesService.getScriptProperties().getProperty(key);
  if (!value) throw new Error('Missing setting ' + key + '. Run setup() first.');
  return value;
}

function reply(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}

// Run once from the editor. Safe to run again.
function setup() {
  const book = SpreadsheetApp.getActive();

  for (const [name, headers] of Object.entries(TABS)) {
    const sheet = book.getSheetByName(name) || book.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(headers);
      sheet.setFrozenRows(1);
      sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    }
  }

  const codes = book.getSheetByName('Passcodes');
  if (codes.getLastRow() === 1) {
    const expires = new Date();
    expires.setDate(expires.getDate() + 30);
    codes.appendRow(['change-me', expires, 'Example. Replace or delete.', false]);
  }
  codes.getRange('B2:B100').setNumberFormat('yyyy-mm-dd');
  codes.getRange('D2:D100').insertCheckboxes();

  const unused = book.getSheetByName('Sheet1');
  if (unused && unused.getLastRow() === 0 && book.getSheets().length > 1) book.deleteSheet(unused);

  const props = PropertiesService.getScriptProperties();
  props.setProperty('SHEET_ID', book.getId());
  if (!props.getProperty('OWNER_EMAIL')) {
    props.setProperty('OWNER_EMAIL', Session.getEffectiveUser().getEmail());
  }
}
