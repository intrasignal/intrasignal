const low = require('lowdb');
const FileSync = require('lowdb/adapters/FileSync');
const path = require('path');

const adapter = new FileSync(path.join(__dirname, 'db.json'));
const db = low(adapter);

// Default structure
db.defaults({
  users: [],
  signals: [],
  subscriptions: [],
  settings: {
    monthly_price: '299',
    trial_days: '7',
    upi_id: 'your-upi@upi',
    whatsapp: '+91 9XXXXXXXXX'
  },
  _counters: { users: 0, signals: 0, subscriptions: 0 }
}).write();

// Helper: auto-increment ID
function nextId(table) {
  const key = `_counters.${table}`;
  const current = db.get(key).value() || 0;
  const next = current + 1;
  db.set(key, next).write();
  return next;
}

module.exports = { db, nextId };
