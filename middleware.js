const jwt = require('jsonwebtoken');
const { db } = require('./db');
const SECRET = process.env.JWT_SECRET || 'intrasignal_secret_2024';

function authMiddleware(req, res, next) {
  const token = req.headers.authorization?.split(' ')[1];
  if (!token) return res.status(401).json({ error: 'No token' });
  try {
    const decoded = jwt.verify(token, SECRET);
    const user = db.get('users').find({ id: decoded.id }).value();
    if (!user || !user.is_active) return res.status(401).json({ error: 'Invalid user' });
    req.user = user;
    next();
  } catch (e) {
    return res.status(401).json({ error: 'Invalid token' });
  }
}

function adminMiddleware(req, res, next) {
  authMiddleware(req, res, () => {
    if (!req.user.is_admin) return res.status(403).json({ error: 'Admin only' });
    next();
  });
}

function checkSubscription(req, res, next) {
  const user = req.user;
  const now = new Date();
  if (user.plan === 'trial') {
    if (now > new Date(user.trial_end))
      return res.status(403).json({ error: 'trial_expired', message: 'Trial expired. Please subscribe.' });
  } else if (user.plan === 'paid') {
    if (now > new Date(user.subscription_end))
      return res.status(403).json({ error: 'subscription_expired', message: 'Subscription expired.' });
  }
  next();
}

module.exports = { authMiddleware, adminMiddleware, checkSubscription, SECRET };
