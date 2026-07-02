/**
 * LJHS Dorm Messenger — Google Apps Script backend.
 *
 * The whole "server" is this file bound to a Google Sheet. The sheet stores
 * users, invite codes, channels, messages, reactions and poll votes; the PWA
 * talks to it through the web-app URL.
 *
 * Setup (once, ~3 minutes):
 *  1. Create a new Google Sheet (sheets.new).
 *  2. Extensions → Apps Script. Delete the sample code and paste this file in.
 *  3. In the editor toolbar pick the function `setup` and press Run
 *     (authorize when asked). Check the Codes tab: your one-time ADMIN
 *     invite code is there.
 *  4. Deploy → New deployment → type "Web app".
 *       - Execute as: Me
 *       - Who has access: Anyone
 *  5. Copy the Web app URL (ends in /exec) into the messenger's join screen,
 *     enter the admin code, and you're in. Generate student/faculty codes
 *     from the in-app Admin panel.
 */

var TABS = {
  Users: ['id', 'token', 'name', 'role', 'status', 'codeUsed', 'createdAt', 'lastSeen'],
  Codes: ['code', 'role', 'note', 'usedBy', 'createdAt'],
  Channels: ['id', 'type', 'name', 'members', 'createdBy', 'createdAt', 'lastMsgAt', 'lastMsgPreview'],
  Messages: ['id', 'channelId', 'userId', 'kind', 'text', 'data', 'createdAt'],
  Reactions: ['messageId', 'channelId', 'userId', 'emoji', 'createdAt'],
  Votes: ['messageId', 'channelId', 'userId', 'choice', 'createdAt'],
  Settings: ['key', 'value'],
};

/** Run once from the editor: creates the tabs and an admin invite code. */
function setup() {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  Object.keys(TABS).forEach(function (name) {
    var sheet = ss.getSheetByName(name) || ss.insertSheet(name);
    if (sheet.getLastRow() === 0) {
      sheet.appendRow(TABS[name]);
      sheet.getRange(1, 1, 1, TABS[name].length).setFontWeight('bold');
      sheet.setFrozenRows(1);
    }
  });
  var codes = ss.getSheetByName('Codes');
  var adminCode = 'ADMIN-' + randomCode_(6);
  codes.appendRow([adminCode, 'admin', 'First admin — join with this code', '', new Date()]);
  Logger.log('Admin invite code: ' + adminCode);
}

function doGet() {
  return json_({ ok: true, service: 'LJHS Dorm Messenger' });
}

function doPost(e) {
  try {
    var req = JSON.parse(e.postData.contents);
    var action = String(req.action || '');

    if (action === 'join') return json_(join_(req));

    var user = authed_(req.token);
    if (!user) return json_({ ok: false, error: 'auth', message: 'Not signed in or account disabled.' });

    switch (action) {
      case 'me':            return json_({ ok: true, user: publicUser_(user), settings: allSettings_() });
      case 'directory':     return json_(directory_(user));
      case 'listChannels':  return json_(listChannels_(user));
      case 'createChannel': return json_(createChannel_(user, req));
      case 'getMessages':   return json_(getMessages_(user, req));
      case 'send':          return json_(send_(user, req));
      case 'react':         return json_(react_(user, req));
      case 'vote':          return json_(vote_(user, req));
      case 'deleteMessage': return json_(deleteMessage_(user, req));
      case 'admin':         return json_(admin_(user, req));
      default:              return json_({ ok: false, error: 'unknown-action' });
    }
  } catch (err) {
    return json_({ ok: false, error: 'server', message: String(err) });
  }
}

// ---------------------------------------------------------------- auth

function join_(req) {
  var code = String(req.code || '').trim().toUpperCase();
  var name = String(req.name || '').trim().substring(0, 40);
  if (!code || !name) return { ok: false, error: 'bad-request', message: 'Code and name are required.' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var codes = rows_('Codes');
    var match = null;
    for (var i = 0; i < codes.length; i++) {
      if (String(codes[i].code).toUpperCase() === code) { match = codes[i]; break; }
    }
    if (!match) return { ok: false, error: 'bad-code', message: 'That invite code is not valid.' };
    if (match.usedBy) return { ok: false, error: 'used-code', message: 'That invite code was already used.' };

    var user = {
      id: 'u_' + uid_(),
      token: token_(),
      name: name,
      role: match.role || 'student',
      status: 'active',
      codeUsed: match.code,
      createdAt: now_(),
      lastSeen: now_(),
    };
    appendRow_('Users', user);
    updateRow_('Codes', match._row, { usedBy: user.id });

    // Everyone is in the school-wide announcements channel from day one.
    ensureAnnouncements_(user);

    return { ok: true, token: user.token, user: publicUser_(user), settings: allSettings_() };
  } finally {
    lock.releaseLock();
  }
}

function authed_(token) {
  if (!token) return null;
  var users = rows_('Users');
  for (var i = 0; i < users.length; i++) {
    if (users[i].token === token && users[i].status === 'active') {
      // Touch lastSeen at most once a minute to keep writes cheap.
      var seen = Number(users[i].lastSeen || 0);
      if (now_() - seen > 60000) updateRow_('Users', users[i]._row, { lastSeen: now_() });
      return users[i];
    }
  }
  return null;
}

function publicUser_(u) {
  return { id: u.id, name: u.name, role: u.role };
}

function directory_(user) {
  var users = rows_('Users')
    .filter(function (u) { return u.status === 'active'; })
    .map(publicUser_);
  return { ok: true, users: users };
}

// ---------------------------------------------------------------- channels

function ensureAnnouncements_(creator) {
  var channels = rows_('Channels');
  for (var i = 0; i < channels.length; i++) {
    if (channels[i].type === 'announcement') return channels[i];
  }
  var ch = {
    id: 'c_' + uid_(),
    type: 'announcement',
    name: '📣 Announcements',
    members: '*',
    createdBy: creator.id,
    createdAt: now_(),
    lastMsgAt: now_(),
    lastMsgPreview: '',
  };
  appendRow_('Channels', ch);
  return ch;
}

function memberIds_(channel) {
  if (channel.members === '*') return null; // everyone
  try { return JSON.parse(channel.members); } catch (e) { return []; }
}

function isMember_(user, channel) {
  var ids = memberIds_(channel);
  return ids === null || ids.indexOf(user.id) !== -1;
}

function canPost_(user, channel) {
  if (!isMember_(user, channel)) return false;
  if (channel.type === 'announcement') return user.role === 'admin' || user.role === 'faculty';
  return true;
}

function listChannels_(user) {
  var usersById = indexBy_(rows_('Users'), 'id');
  var channels = rows_('Channels')
    .filter(function (ch) { return isMember_(user, ch); })
    .map(function (ch) {
      var name = ch.name;
      if (ch.type === 'dm') {
        // A DM is named after the other participant.
        var other = (memberIds_(ch) || []).filter(function (id) { return id !== user.id; })[0];
        name = (usersById[other] || {}).name || 'Direct message';
      }
      return {
        id: ch.id,
        type: ch.type,
        name: name,
        lastMsgAt: Number(ch.lastMsgAt || 0),
        lastMsgPreview: ch.lastMsgPreview || '',
        memberCount: ch.members === '*' ? null : memberIds_(ch).length,
      };
    })
    .sort(function (a, b) { return b.lastMsgAt - a.lastMsgAt; });
  return { ok: true, channels: channels };
}

function createChannel_(user, req) {
  var type = req.type === 'group' ? 'group' : req.type === 'announcement' ? 'announcement' : 'dm';
  if (type === 'announcement' && user.role !== 'admin') {
    return { ok: false, error: 'forbidden', message: 'Only admins can create announcement channels.' };
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    if (type === 'dm') {
      var otherId = String(req.memberIds && req.memberIds[0] || '');
      if (!otherId || otherId === user.id) return { ok: false, error: 'bad-request' };
      var pair = [user.id, otherId].sort().join('|');
      var channels = rows_('Channels');
      for (var i = 0; i < channels.length; i++) {
        var ch = channels[i];
        if (ch.type === 'dm' && (memberIds_(ch) || []).sort().join('|') === pair) {
          return { ok: true, channelId: ch.id, existed: true };
        }
      }
      var dm = {
        id: 'c_' + uid_(), type: 'dm', name: '',
        members: JSON.stringify([user.id, otherId]),
        createdBy: user.id, createdAt: now_(), lastMsgAt: now_(), lastMsgPreview: '',
      };
      appendRow_('Channels', dm);
      return { ok: true, channelId: dm.id };
    }

    var members = (req.memberIds || []).filter(function (id, i, a) { return a.indexOf(id) === i; });
    if (members.indexOf(user.id) === -1) members.push(user.id);
    var group = {
      id: 'c_' + uid_(),
      type: type,
      name: String(req.name || 'New group').trim().substring(0, 60),
      members: type === 'announcement' ? '*' : JSON.stringify(members),
      createdBy: user.id, createdAt: now_(), lastMsgAt: now_(), lastMsgPreview: '',
    };
    appendRow_('Channels', group);
    return { ok: true, channelId: group.id };
  } finally {
    lock.releaseLock();
  }
}

// ---------------------------------------------------------------- messages

function getMessages_(user, req) {
  var channel = findRow_('Channels', 'id', req.channelId);
  if (!channel || !isMember_(user, channel)) return { ok: false, error: 'forbidden' };

  var since = Number(req.since || 0);
  var usersById = indexBy_(rows_('Users'), 'id');

  var messages = rows_('Messages').filter(function (m) {
    return m.channelId === channel.id && Number(m.createdAt) > since;
  });

  // Reactions/votes are re-sent for the whole channel: they mutate old
  // messages, so incremental "since" filtering can't cover them.
  var reactions = {};
  rows_('Reactions').forEach(function (r) {
    if (r.channelId !== channel.id) return;
    var perMsg = reactions[r.messageId] || (reactions[r.messageId] = {});
    var perEmoji = perMsg[r.emoji] || (perMsg[r.emoji] = { count: 0, mine: false, names: [] });
    perEmoji.count++;
    perEmoji.names.push((usersById[r.userId] || {}).name || '?');
    if (r.userId === user.id) perEmoji.mine = true;
  });

  var votes = {};
  rows_('Votes').forEach(function (v) {
    if (v.channelId !== channel.id) return;
    var perMsg = votes[v.messageId] || (votes[v.messageId] = { counts: {}, mine: null, voters: {} });
    perMsg.counts[v.choice] = (perMsg.counts[v.choice] || 0) + 1;
    var list = perMsg.voters[v.choice] || (perMsg.voters[v.choice] = []);
    list.push((usersById[v.userId] || {}).name || '?');
    if (v.userId === user.id) perMsg.mine = Number(v.choice);
  });

  return {
    ok: true,
    canPost: canPost_(user, channel),
    channel: { id: channel.id, type: channel.type, name: channel.name },
    now: now_(),
    messages: messages.map(function (m) {
      return {
        id: m.id,
        userId: m.userId,
        userName: (usersById[m.userId] || {}).name || '?',
        userRole: (usersById[m.userId] || {}).role || 'student',
        kind: m.kind,
        text: m.text,
        data: m.data ? JSON.parse(m.data) : null,
        createdAt: Number(m.createdAt),
      };
    }),
    reactions: reactions,
    votes: votes,
  };
}

function send_(user, req) {
  var channel = findRow_('Channels', 'id', req.channelId);
  if (!channel || !canPost_(user, channel)) return { ok: false, error: 'forbidden' };

  var kind = 'text';
  var text = String(req.text || '').trim().substring(0, 2000);
  var data = null;

  if (req.kind === 'poll' || req.kind === 'checkin') {
    if (req.kind === 'checkin' && user.role === 'student') {
      return { ok: false, error: 'forbidden', message: 'Only faculty can start a check-in.' };
    }
    kind = req.kind;
    var options = (req.options || []).map(function (o) { return String(o).trim().substring(0, 80); }).filter(Boolean);
    if (kind === 'checkin') options = ["I'm here ✔"];
    if (!text || options.length < 1) return { ok: false, error: 'bad-request' };
    data = { options: options };
  } else if (!text) {
    return { ok: false, error: 'bad-request' };
  }

  var msg = {
    id: 'm_' + uid_(),
    channelId: channel.id,
    userId: user.id,
    kind: kind,
    text: text,
    data: data ? JSON.stringify(data) : '',
    createdAt: now_(),
  };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    appendRow_('Messages', msg);
    var preview = kind === 'poll' ? '📊 ' + text : kind === 'checkin' ? '🙋 ' + text : user.name + ': ' + text;
    updateRow_('Channels', channel._row, { lastMsgAt: msg.createdAt, lastMsgPreview: preview.substring(0, 80) });
  } finally {
    lock.releaseLock();
  }
  return { ok: true, messageId: msg.id, createdAt: msg.createdAt };
}

function react_(user, req) {
  var msg = findRow_('Messages', 'id', req.messageId);
  if (!msg) return { ok: false, error: 'not-found' };
  var channel = findRow_('Channels', 'id', msg.channelId);
  if (!channel || !isMember_(user, channel)) return { ok: false, error: 'forbidden' };

  var emoji = String(req.emoji || '').substring(0, 8);
  if (!emoji) return { ok: false, error: 'bad-request' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // Toggle: a second tap on the same emoji removes it.
    var existing = rows_('Reactions').filter(function (r) {
      return r.messageId === msg.id && r.userId === user.id && r.emoji === emoji;
    });
    if (existing.length > 0) {
      deleteRows_('Reactions', existing.map(function (r) { return r._row; }));
      return { ok: true, removed: true };
    }
    appendRow_('Reactions', {
      messageId: msg.id, channelId: msg.channelId, userId: user.id, emoji: emoji, createdAt: now_(),
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function vote_(user, req) {
  var msg = findRow_('Messages', 'id', req.messageId);
  if (!msg || (msg.kind !== 'poll' && msg.kind !== 'checkin')) return { ok: false, error: 'not-found' };
  var channel = findRow_('Channels', 'id', msg.channelId);
  if (!channel || !isMember_(user, channel)) return { ok: false, error: 'forbidden' };

  var choice = Number(req.choice);
  var options = (msg.data ? JSON.parse(msg.data) : {}).options || [];
  if (!(choice >= 0 && choice < options.length)) return { ok: false, error: 'bad-request' };

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    // One vote per person; voting again moves the vote.
    var existing = rows_('Votes').filter(function (v) {
      return v.messageId === msg.id && v.userId === user.id;
    });
    deleteRows_('Votes', existing.map(function (v) { return v._row; }));
    appendRow_('Votes', {
      messageId: msg.id, channelId: msg.channelId, userId: user.id, choice: choice, createdAt: now_(),
    });
    return { ok: true };
  } finally {
    lock.releaseLock();
  }
}

function deleteMessage_(user, req) {
  var msg = findRow_('Messages', 'id', req.messageId);
  if (!msg) return { ok: false, error: 'not-found' };
  var mine = msg.userId === user.id;
  var mod = user.role === 'admin' || user.role === 'faculty';
  if (!mine && !mod) return { ok: false, error: 'forbidden' };
  updateRow_('Messages', msg._row, { kind: 'deleted', text: '', data: '' });
  return { ok: true };
}

// ---------------------------------------------------------------- admin

function admin_(user, req) {
  if (user.role !== 'admin') return { ok: false, error: 'forbidden', message: 'Admins only.' };
  switch (req.op) {
    case 'createCodes': {
      var role = ['student', 'faculty', 'admin'].indexOf(req.role) !== -1 ? req.role : 'student';
      var count = Math.min(Math.max(Number(req.count) || 1, 1), 50);
      var made = [];
      for (var i = 0; i < count; i++) {
        var code = role.toUpperCase().substring(0, 3) + '-' + randomCode_(6);
        appendRow_('Codes', { code: code, role: role, note: String(req.note || ''), usedBy: '', createdAt: now_() });
        made.push(code);
      }
      return { ok: true, codes: made };
    }
    case 'listCodes':
      return { ok: true, codes: rows_('Codes').map(function (c) {
        return { code: c.code, role: c.role, note: c.note, used: !!c.usedBy };
      }) };
    case 'listUsers':
      return { ok: true, users: rows_('Users').map(function (u) {
        return { id: u.id, name: u.name, role: u.role, status: u.status, lastSeen: Number(u.lastSeen || 0) };
      }) };
    case 'setUserStatus': {
      var target = findRow_('Users', 'id', req.userId);
      if (!target) return { ok: false, error: 'not-found' };
      var status = req.status === 'disabled' ? 'disabled' : 'active';
      updateRow_('Users', target._row, { status: status });
      return { ok: true };
    }
    case 'setSetting': {
      var key = String(req.key || '').substring(0, 40);
      if (!key) return { ok: false, error: 'bad-request' };
      var row = findRow_('Settings', 'key', key);
      if (row) updateRow_('Settings', row._row, { value: String(req.value || '') });
      else appendRow_('Settings', { key: key, value: String(req.value || '') });
      return { ok: true, settings: allSettings_() };
    }
    default:
      return { ok: false, error: 'unknown-op' };
  }
}

function allSettings_() {
  var out = {};
  rows_('Settings').forEach(function (s) { out[s.key] = s.value; });
  return out;
}

// ---------------------------------------------------------------- sheet helpers

function sheet_(name) {
  var ss = SpreadsheetApp.getActiveSpreadsheet();
  var sheet = ss.getSheetByName(name);
  if (!sheet) {
    sheet = ss.insertSheet(name);
    sheet.appendRow(TABS[name]);
  }
  return sheet;
}

/** All data rows of a tab as objects; `_row` is the 1-based sheet row. */
function rows_(name) {
  var sheet = sheet_(name);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) return [];
  var header = TABS[name];
  var values = sheet.getRange(2, 1, lastRow - 1, header.length).getValues();
  return values.map(function (row, i) {
    var obj = { _row: i + 2 };
    header.forEach(function (col, j) {
      var v = row[j];
      obj[col] = v instanceof Date ? v.getTime() : v;
    });
    return obj;
  });
}

function findRow_(name, key, value) {
  var all = rows_(name);
  for (var i = 0; i < all.length; i++) if (all[i][key] === value) return all[i];
  return null;
}

function indexBy_(list, key) {
  var out = {};
  list.forEach(function (item) { out[item[key]] = item; });
  return out;
}

function appendRow_(name, obj) {
  var header = TABS[name];
  sheet_(name).appendRow(header.map(function (col) {
    return obj[col] !== undefined ? obj[col] : '';
  }));
}

function updateRow_(name, rowIndex, patch) {
  var sheet = sheet_(name);
  var header = TABS[name];
  Object.keys(patch).forEach(function (col) {
    var colIndex = header.indexOf(col);
    if (colIndex !== -1) sheet.getRange(rowIndex, colIndex + 1).setValue(patch[col]);
  });
}

function deleteRows_(name, rowIndexes) {
  var sheet = sheet_(name);
  rowIndexes.sort(function (a, b) { return b - a; }) // bottom-up so indexes stay valid
    .forEach(function (r) { sheet.deleteRow(r); });
}

// ---------------------------------------------------------------- misc

function now_() { return Date.now(); }

function uid_() {
  return Utilities.getUuid().replace(/-/g, '').substring(0, 16);
}

function token_() {
  return Utilities.getUuid().replace(/-/g, '') + Utilities.getUuid().replace(/-/g, '');
}

function randomCode_(len) {
  var alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  var out = '';
  for (var i = 0; i < len; i++) out += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  return out;
}

function json_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
