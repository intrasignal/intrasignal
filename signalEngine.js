const axios = require('axios');

const UPSTOX_BASE = 'https://api.upstox.com/v2';

// Nifty 500 instrument keys (sample - top 50 for demo)
const STOCK_UNIVERSE = [
  { symbol: 'RELIANCE',   key: 'NSE_EQ|INE002A01018' },
  { symbol: 'TCS',        key: 'NSE_EQ|INE467B01029' },
  { symbol: 'HDFCBANK',   key: 'NSE_EQ|INE040A01034' },
  { symbol: 'INFY',       key: 'NSE_EQ|INE009A01021' },
  { symbol: 'ICICIBANK',  key: 'NSE_EQ|INE090A01021' },
  { symbol: 'WIPRO',      key: 'NSE_EQ|INE075A01022' },
  { symbol: 'HCLTECH',    key: 'NSE_EQ|INE860A01027' },
  { symbol: 'BAJFINANCE', key: 'NSE_EQ|INE296A01024' },
  { symbol: 'KOTAKBANK',  key: 'NSE_EQ|INE237A01028' },
  { symbol: 'LT',         key: 'NSE_EQ|INE018A01030' },
  { symbol: 'TITAN',      key: 'NSE_EQ|INE280A01028' },
  { symbol: 'ASIANPAINT', key: 'NSE_EQ|INE021A01026' },
  { symbol: 'MARUTI',     key: 'NSE_EQ|INE585B01010' },
  { symbol: 'SUNPHARMA',  key: 'NSE_EQ|INE044A01036' },
  { symbol: 'BHARTIARTL', key: 'NSE_EQ|INE397D01024' },
  { symbol: 'ITC',        key: 'NSE_EQ|INE154A01025' },
  { symbol: 'SBIN',       key: 'NSE_EQ|INE062A01020' },
  { symbol: 'AXISBANK',   key: 'NSE_EQ|INE238A01034' },
  { symbol: 'TATAMOTORS', key: 'NSE_EQ|INE155A01022' },
  { symbol: 'TATASTEEL',  key: 'NSE_EQ|INE081A01020' },
  { symbol: 'NTPC',       key: 'NSE_EQ|INE733E01010' },
  { symbol: 'ONGC',       key: 'NSE_EQ|INE213A01029' },
  { symbol: 'POWERGRID',  key: 'NSE_EQ|INE752E01010' },
  { symbol: 'COALINDIA',  key: 'NSE_EQ|INE522F01014' },
  { symbol: 'JSWSTEEL',   key: 'NSE_EQ|INE019A01038' },
  { symbol: 'HINDUNILVR', key: 'NSE_EQ|INE030A01027' },
  { symbol: 'NESTLEIND',  key: 'NSE_EQ|INE239A01024' },
  { symbol: 'BRITANNIA',  key: 'NSE_EQ|INE216A01030' },
  { symbol: 'DRREDDY',    key: 'NSE_EQ|INE089A01023' },
  { symbol: 'CIPLA',      key: 'NSE_EQ|INE059A01026' },
  { symbol: 'DIVISLAB',   key: 'NSE_EQ|INE361B01024' },
  { symbol: 'APOLLOHOSP', key: 'NSE_EQ|INE437A01024' },
  { symbol: 'EICHERMOT',  key: 'NSE_EQ|INE066A01021' },
  { symbol: 'HEROMOTOCO', key: 'NSE_EQ|INE158A01026' },
  { symbol: 'MM',         key: 'NSE_EQ|INE101A01026' },
  { symbol: 'BAJAJFINSV', key: 'NSE_EQ|INE918I01026' },
  { symbol: 'TECHM',      key: 'NSE_EQ|INE669C01036' },
  { symbol: 'INDUSINDBK', key: 'NSE_EQ|INE095A01012' },
  { symbol: 'ADANIPORTS', key: 'NSE_EQ|INE742F01042' },
  { symbol: 'GRASIM',     key: 'NSE_EQ|INE047A01021' },
  { symbol: 'ULTRACEMCO', key: 'NSE_EQ|INE481G01011' },
  { symbol: 'HINDALCO',   key: 'NSE_EQ|INE038A01020' },
  { symbol: 'BPCL',       key: 'NSE_EQ|INE029A01011' },
  { symbol: 'TATACONSUM', key: 'NSE_EQ|INE192A01025' },
  { symbol: 'PIDILITIND', key: 'NSE_EQ|INE318A01026' },
  { symbol: 'DABUR',      key: 'NSE_EQ|INE016A01026' },
  { symbol: 'SBILIFE',    key: 'NSE_EQ|INE123W01016' },
  { symbol: 'HDFCLIFE',   key: 'NSE_EQ|INE795G01014' },
  { symbol: 'IRCTC',      key: 'NSE_EQ|INE335Y01020' },
  { symbol: 'ZOMATO',     key: 'NSE_EQ|INE758T01015' },
];

function sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

function calcEMA(prices, period) {
  const mult = 2 / (period + 1);
  let ema = prices.slice(0, period).reduce((a, b) => a + b, 0) / period;
  const result = new Array(period - 1).fill(null);
  result.push(ema);
  for (let i = period; i < prices.length; i++) {
    ema = (prices[i] - ema) * mult + ema;
    result.push(ema);
  }
  return result;
}

function calcATR(candles, period = 14) {
  const trs = [];
  for (let i = 1; i < Math.min(candles.length, period + 2); i++) {
    const h = candles[i][2], l = candles[i][3], pc = candles[i - 1][4];
    trs.push(Math.max(h - l, Math.abs(h - pc), Math.abs(l - pc)));
  }
  return trs.length ? trs.reduce((a, b) => a + b, 0) / trs.length : 0;
}

async function getCandles(instrumentKey, accessToken) {
  try {
    const url = `${UPSTOX_BASE}/historical-candle/intraday/${encodeURIComponent(instrumentKey)}/5minute`;
    const res = await axios.get(url, {
      headers: { Authorization: `Bearer ${accessToken}`, Accept: 'application/json' },
      timeout: 8000
    });
    return res.data?.data?.candles || [];
  } catch (e) { return []; }
}

// ORB Strategy
async function orbStrategy(stock, accessToken) {
  const candles = await getCandles(stock.key, accessToken);
  if (candles.length < 5) return null;
  const reversed = [...candles].reverse(); // oldest first
  const orbHigh = Math.max(...reversed.slice(0, 3).map(c => c[2]));
  const orbLow  = Math.min(...reversed.slice(0, 3).map(c => c[3]));
  const curr = reversed[reversed.length - 1];
  const prev = reversed[reversed.length - 2];
  const close = curr[4], vol = curr[5], pvol = prev[5];
  const highVol = vol > pvol * 1.2;
  if (close > orbHigh && highVol) {
    const sl = orbHigh - (orbHigh - orbLow) * 0.5;
    const tg = close + (orbHigh - orbLow) * 2;
    return { type: 'buy', entry: close, sl, tg, rr: +((tg - close) / (close - sl)).toFixed(1) };
  }
  if (close < orbLow && highVol) {
    const sl = orbLow + (orbHigh - orbLow) * 0.5;
    const tg = close - (orbHigh - orbLow) * 2;
    return { type: 'sell', entry: close, sl, tg, rr: +((close - tg) / (sl - close)).toFixed(1) };
  }
  return null;
}

// EMA Crossover Strategy
async function emaStrategy(stock, accessToken) {
  const candles = await getCandles(stock.key, accessToken);
  if (candles.length < 25) return null;
  const reversed = [...candles].reverse();
  const closes = reversed.map(c => c[4]);
  const fast = calcEMA(closes, 9);
  const slow = calcEMA(closes, 21);
  const n = closes.length - 1;
  const atr = calcATR(reversed);
  const bullish = fast[n - 1] <= slow[n - 1] && fast[n] > slow[n];
  const bearish = fast[n - 1] >= slow[n - 1] && fast[n] < slow[n];
  const price = closes[n];
  if (bullish) {
    return { type: 'buy', entry: price, sl: +(price - atr * 1.5).toFixed(2), tg: +(price + atr * 3).toFixed(2), rr: 2.0 };
  }
  if (bearish) {
    return { type: 'sell', entry: price, sl: +(price + atr * 1.5).toFixed(2), tg: +(price - atr * 3).toFixed(2), rr: 2.0 };
  }
  return null;
}

// VWAP Strategy
async function vwapStrategy(stock, accessToken) {
  const candles = await getCandles(stock.key, accessToken);
  if (candles.length < 5) return null;
  const reversed = [...candles].reverse();
  let cumTPV = 0, cumVol = 0;
  for (const c of reversed) {
    const tp = (c[2] + c[3] + c[4]) / 3;
    cumTPV += tp * c[5]; cumVol += c[5];
  }
  const vwap = cumVol ? cumTPV / cumVol : 0;
  const curr = reversed[reversed.length - 1];
  const prev = reversed[reversed.length - 2];
  const atr = calcATR(reversed);
  const bounce = prev[4] < vwap && curr[4] > vwap && curr[5] > prev[5];
  const reject = prev[4] > vwap && curr[4] < vwap && curr[5] > prev[5];
  if (bounce) {
    return { type: 'buy', entry: curr[4], sl: +(vwap - atr).toFixed(2), tg: +(curr[4] + atr * 2).toFixed(2), rr: 2.0 };
  }
  if (reject) {
    return { type: 'sell', entry: curr[4], sl: +(vwap + atr).toFixed(2), tg: +(curr[4] - atr * 2).toFixed(2), rr: 2.0 };
  }
  return null;
}

// Main scanner
async function runScan(accessToken, strategies = { orb: true, ema: true, vwap: true }) {
  const results = [];
  for (const stock of STOCK_UNIVERSE) {
    try {
      if (strategies.orb) {
        await sleep(250);
        const s = await orbStrategy(stock, accessToken);
        if (s) results.push({ symbol: stock.symbol, strategy: 'ORB', ...s });
      }
      if (strategies.ema) {
        await sleep(200);
        const s = await emaStrategy(stock, accessToken);
        if (s) results.push({ symbol: stock.symbol, strategy: 'EMA 9×21', ...s });
      }
      if (strategies.vwap) {
        await sleep(200);
        const s = await vwapStrategy(stock, accessToken);
        if (s) results.push({ symbol: stock.symbol, strategy: 'VWAP', ...s });
      }
    } catch (e) { /* skip */ }
  }
  return results;
}

module.exports = { runScan, STOCK_UNIVERSE };
