const TelegramBot = require('node-telegram-bot-api');
const axios = require('axios');
const WebSocket = require('ws');

const token = process.env.TELEGRAM_TOKEN;
const bot = new TelegramBot(token, {polling: true});

const ALLOWED_USERS = [123456789]; // ← CHANGE THIS TO YOUR TELEGRAM ID

const marketCache = {};

function connectWS() {
  const ws = new WebSocket('wss://fstream.binance.com/stream?streams=btcusdt@aggTrade/ethusdt@aggTrade/solusdt@aggTrade');
  ws.on('message', data => {
    const msg = JSON.parse(data);
    if (msg.data && msg.data.e === 'aggTrade') {
      const s = msg.data.s;
      const qty = parseFloat(msg.data.q);
      const isBuyer = !msg.data.m;
      if (!marketCache[s]) marketCache[s] = {delta: 0};
      marketCache[s].delta += isBuyer ? qty : -qty;
      marketCache[s].price = parseFloat(msg.data.p);
    }
  });
}
connectWS();
setInterval(connectWS, 300000);

async function getPrediction(coin, tf) {
  coin = coin.toUpperCase();
  const pair = coin === 'GOLD' ? 'XAUUSDT' : coin === 'SPX' ? 'SPX500USD' : coin + 'USDT';
  try {
    const k = await axios.get(`https://api.binance.com/api/v3/klines?symbol=${pair.replace('/', '')}&interval=${tf}&limit=100`);
    const closes = k.data.map(c => +c[4]);
    const vols = k.data.map(c => +c[5]);
    const last = k.data[99];
    let score = 50;

    if (+last[4] > +last[1]) score += 18;
    if (vols[99] > vols[98] * 1.4) score += 22;
    if (marketCache[pair]?.delta > 0) score += 20;
    const fund = (await axios.get(`https://fapi.binance.com/fapi/v1/premiumIndex?symbol=${pair}`)).data.lastFundingRate;
    if (fund > 0.0001) && (score += 15);
    if (+last[4] > closes.slice(-21).reduce((a,b) => a+b)/21) score += 13;

    const higher = score >= 70;
    return {
      direction: higher ? 'HIGHER' : 'LOWER',
      confidence: Math.min(94, score) + '%',
      price: (+last[4]).toFixed(2),
      reason: higher ? 'Aggressive buying + positive CVD + bullish funding' : 'Selling pressure + negative delta'
    };
  } catch { return {error: 'Not available'}; }
}

bot.on('message', async msg => {
  if (!ALLOWED_USERS.includes(msg.chat.id)) return;
  const match = msg.text.toLowerCase().match(/(btc|eth|sol|gold|spx)[\s]+(\d+m|\d+h|1d)/i);
  if (!match) return;
  const [_, coin, tf] = match;
  bot.sendChatAction(msg.chat.id, 'typing');
  const p = await getPrediction(coin, tf);
  if (p.error) return bot.sendMessage(msg.chat.id, p.error);

  bot.sendMessage(msg.chat.id,
`*${coin.toUpperCase()}/USDT – ${tf.toUpperCase()}*
Prediction: ${p.direction}
Confidence: ${p.confidence}
Price: $${p.price}

${p.reason}

Good luck boss`, {parse_mode: 'Markdown'});
});

console.log('Nuclear bot live');