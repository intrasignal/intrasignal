require('dotenv').config();
const express = require('express');
const cors = require('cors');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const path = require('path');
const { db, nextId } = require('./db');
const { authMiddleware, adminMiddleware, checkSubscription, SECRET } = require('./middleware');
const { runScan } = require('./signalEngine');

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend
app.use(express.static(path.join(__dirname, 'public')));

// ===== AUTH =====
app.post('/api/register', async (req, res) => {
  const { name, email, password } = req.body;
  if (!name || !email || !password) return res.status(400).json({ error: 'All fields required' });
  if (password.length < 6) return res.status(400).json({ error: 'Password min 6 characters' });
  const exists = db.get('users').find({ email: email.toLowerCase() }).value();
  if (exists) return res.status(400).json({ error: 'Email already registered' });
  try {
    const hash = await bcrypt.hash(password, 10);
    const now = new Date();
    const trialEnd = new Date(now); trialEnd.setDate(trialEnd.getDate() + 7);
    const user = {
      id: nextId('users'), name, email: email.toLowerCase(), password: hash,
      upstox_api_key: '', upstox_api_secret: '', upstox_access_token: '',
      plan: 'trial',
      trial_start: now.toISOString(),
      trial_end: trialEnd.toISOString(),
      subscription_end: null,
      is_active: true, is_admin: false,
      created_at: now.toISOString()
    };
    db.get('users').push(user).write();
    const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });
    res.json({ token, user: safeUser(user) });
  } catch (e) {
    res.status(500).json({ error: 'Server error: ' + e.message });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  const user = db.get('users').find({ email: email?.toLowerCase() }).value();
  if (!user) return res.status(400).json({ error: 'Invalid email or password' });
  const ok = await bcrypt.compare(password, user.password);
  if (!ok) return res.status(400).json({ error: 'Invalid email or password' });
  if (!user.is_active) return res.status(403).json({ error: 'Account suspended' });
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });
  res.json({ token, user: safeUser(user) });
});

app.get('/api/me', authMiddleware, (req, res) => {
  res.json({ user: safeUser(req.user) });
});

app.put('/api/me/upstox', authMiddleware, (req, res) => {
  const { api_key, api_secret, access_token } = req.body;
  db.get('users').find({ id: req.user.id })
    .assign({ upstox_api_key: api_key||'', upstox_api_secret: api_secret||'', upstox_access_token: access_token||'' })
    .write();
  res.json({ success: true });
});

// ===== SUBSCRIPTION =====
app.get('/api/subscription/status', authMiddleware, (req, res) => {
  const u = req.user;
  const now = new Date();
  let status = 'active', daysLeft = 0;
  if (u.plan === 'trial') {
    const end = new Date(u.trial_end);
    daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
    status = now > end ? 'expired' : 'trial';
  } else if (u.plan === 'paid') {
    const end = new Date(u.subscription_end);
    daysLeft = Math.max(0, Math.ceil((end - now) / 86400000));
    status = now > end ? 'expired' : 'paid';
  }
  const price = db.get('settings.monthly_price').value() || '299';
  res.json({ plan: u.plan, status, daysLeft, price });
});

app.post('/api/subscription/activate', adminMiddleware, (req, res) => {
  const { user_id, months } = req.body;
  const user = db.get('users').find({ id: +user_id }).value();
  if (!user) return res.status(404).json({ error: 'User not found' });
  const now = new Date();
  const end = new Date(now); end.setMonth(end.getMonth() + (months || 1));
  db.get('users').find({ id: +user_id }).assign({ plan: 'paid', subscription_end: end.toISOString() }).write();
  const sub = { id: nextId('subscriptions'), user_id: +user_id, plan: 'paid', amount: 299*(months||1), status: 'active', starts_at: now.toISOString(), ends_at: end.toISOString(), created_at: now.toISOString() };
  db.get('subscriptions').push(sub).write();
  res.json({ success: true, subscription_end: end.toISOString() });
});

// ===== SIGNALS =====
app.post('/api/scan', authMiddleware, checkSubscription, async (req, res) => {
  const user = db.get('users').find({ id: req.user.id }).value();
  if (!user.upstox_access_token)
    return res.status(400).json({ error: 'Please set your Upstox access token in Settings' });
  const { strategies } = req.body;
  try {
    const signals = await runScan(user.upstox_access_token, strategies);
    const now = new Date().toISOString();
    for (const s of signals) {
      const sig = { id: nextId('signals'), user_id: user.id, symbol: s.symbol, strategy: s.strategy, type: s.type, entry_price: s.entry, stop_loss: s.sl, target: s.tg, rr: s.rr, is_active: true, created_at: now };
      db.get('signals').push(sig).write();
    }
    // Return last 100 signals for this user
    const userSigs = db.get('signals').filter({ user_id: user.id }).value().slice(-100).reverse();
    res.json({ signals: userSigs, count: signals.length });
  } catch (e) {
    res.status(500).json({ error: 'Scan failed: ' + e.message });
  }
});

app.get('/api/signals', authMiddleware, checkSubscription, (req, res) => {
  const signals = db.get('signals').filter({ user_id: req.user.id }).value().slice(-100).reverse();
  res.json({ signals });
});

// ===== ADMIN =====
app.get('/api/admin/users', adminMiddleware, (req, res) => {
  const users = db.get('users').value().map(u => ({
    id: u.id, name: u.name, email: u.email, plan: u.plan,
    trial_end: u.trial_end, subscription_end: u.subscription_end,
    is_active: u.is_active, created_at: u.created_at
  }));
  res.json({ users });
});

app.put('/api/admin/users/:id/toggle', adminMiddleware, (req, res) => {
  const user = db.get('users').find({ id: +req.params.id }).value();
  if (!user) return res.status(404).json({ error: 'Not found' });
  db.get('users').find({ id: +req.params.id }).assign({ is_active: !user.is_active }).write();
  res.json({ success: true });
});

app.put('/api/admin/settings', adminMiddleware, (req, res) => {
  const { monthly_price, trial_days, upi_id, whatsapp } = req.body;
  if (monthly_price) db.set('settings.monthly_price', monthly_price).write();
  if (trial_days)    db.set('settings.trial_days', trial_days).write();
  if (upi_id)        db.set('settings.upi_id', upi_id).write();
  if (whatsapp)      db.set('settings.whatsapp', whatsapp).write();
  res.json({ success: true });
});

app.get('/api/admin/settings', adminMiddleware, (req, res) => {
  res.json(db.get('settings').value());
});

app.get('/api/admin/stats', adminMiddleware, (req, res) => {
  const users = db.get('users').value();
  res.json({
    total: users.length,
    trial: users.filter(u => u.plan === 'trial').length,
    paid:  users.filter(u => u.plan === 'paid').length,
    signals: db.get('signals').value().length
  });
});

// First admin setup (one-time)
app.post('/api/setup/admin', async (req, res) => {
  const existing = db.get('users').find({ is_admin: true }).value();
  if (existing) return res.status(400).json({ error: 'Admin already exists' });
  const { name, email, password } = req.body;
  const hash = await bcrypt.hash(password, 10);
  const now = new Date();
  const user = {
    id: nextId('users'), name, email: email.toLowerCase(), password: hash,
    upstox_api_key: '', upstox_api_secret: '', upstox_access_token: '',
    plan: 'paid', trial_start: now.toISOString(), trial_end: now.toISOString(),
    subscription_end: new Date(2099, 0, 1).toISOString(),
    is_active: true, is_admin: true, created_at: now.toISOString()
  };
  db.get('users').push(user).write();
  const token = jwt.sign({ id: user.id }, SECRET, { expiresIn: '30d' });
  res.json({ success: true, token, user: safeUser(user) });
});

// Catch-all: serve frontend
app.get('*', (req, res) => {
 res.sendFile(path.join(__dirname, 'public', 'index.html'));
});

function safeUser(u) {
  return {
    id: u.id, name: u.name, email: u.email, plan: u.plan,
    trial_end: u.trial_end, subscription_end: u.subscription_end,
    is_admin: u.is_admin, has_upstox: !!(u.upstox_access_token)
  };
}

const PORT = process.env.PORT || 3001;
app.listen(PORT, () => console.log(`✅ IntraSignal running on http://localhost:${PORT}`));
