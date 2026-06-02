import axios from 'axios';

const PROXIES = [
  (url) => `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`,
  (url) => `https://corsproxy.io/?${encodeURIComponent(url)}`,
  (url) => `https://thingproxy.freeboard.io/fetch/${url}`,
  (url) => `https://api.codetabs.com/v1/proxy?quest=${encodeURIComponent(url)}`
];

export const fetchBybitData = async (symbol, interval = 'D', limit = 365) => {
  const url = `https://api.bybit.com/v5/market/kline?category=spot&symbol=${symbol}&interval=${interval}&limit=${limit}&t=${Date.now()}`;
  
  // Try direct connection first (extremely fast, supports CORS natively)
  try {
    const response = await axios.get(url, { timeout: 1500 });
    const data = response.data?.result?.list || response.data?.list;
    if (data && data.length > 0) return data;
  } catch (e) { }

  // Fallbacks to proxies only if direct fails
  const allOriginsUrl = `https://api.allorigins.win/raw?url=${encodeURIComponent(url)}`;
  try {
    const response = await axios.get(allOriginsUrl, { timeout: 3000 });
    const data = response.data?.result?.list || response.data?.list;
    if (data && data.length > 0) return data;
  } catch (e) { }

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const response = await axios.get(PROXIES[i](url), { timeout: 3000 });
      let data = response.data?.result?.list || response.data?.list;
      if (!data && typeof response.data === 'string') {
          try { data = JSON.parse(response.data)?.result?.list; } catch(err) {}
      }
      if (data && data.length > 0) return data;
    } catch (e) { }
  }
  
  return null;
};

export const fetchDailyMacro = async (symbol) => {
  const klines = await fetchBybitData(symbol, 'D', 365); // 365 days history
  if (!klines || klines.length === 0) return null;
  
  // --- Parabolic Recovery (Cup & Handle) Logic ---
  let cupPattern = null;
  const currentPrice = parseFloat(klines[0][4]);

  // On cherche l'ancien sommet (la lèvre gauche du bol) de 15 à la fin de l'historique
  for (let i = klines.length - 1; i >= 15; i--) {
    const potentialHigh = parseFloat(klines[i][2]);
    
    // On s'assure que ce point est le sommet le PLUS HAUT depuis le début de la cassure
    let isHighest = true;
    for (let j = 5; j <= i; j++) {
      if (parseFloat(klines[j][2]) > potentialHigh) {
        isHighest = false;
        break;
      }
    }
    
    if (!isHighest) continue;

    // Trouver le point le plus bas (le fond du bol) entre ce sommet et aujourd'hui
    let cupBottom = Infinity;
    let cupBottomIndex = -1;
    for (let j = 1; j < i; j++) {
      const low = parseFloat(klines[j][3]);
      if (low < cupBottom) {
        cupBottom = low;
        cupBottomIndex = j;
      }
    }

    const dropPercent = ((cupBottom / potentialHigh) - 1) * 100;
    const distanceToHigh = ((currentPrice / potentialHigh) - 1) * 100;
    
    // 1. Chute d'au moins 15%
    // 2. Le fond doit dater d'au moins 5 jours
    // 3. Proche du sommet: entre -15% et +10%
    if (dropPercent <= -15 && cupBottomIndex >= 5 && distanceToHigh >= -15 && distanceToHigh <= 10) {
      
      const formattedKlines = [...klines].reverse().map(k => {
         const open = parseFloat(k[1]);
         const close = parseFloat(k[4]);
         return {
           time: Math.floor(Number(k[0]) / 1000),
           open,
           high: parseFloat(k[2]),
           low: parseFloat(k[3]),
           close,
           volume: parseFloat(k[5]),
           volColor: close > open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 42, 42, 0.4)'
         };
      });

      // --- CALCUL MATHÉMATIQUE DE LA COURBE PARABOLIQUE ---
      const idx1 = klines.length - 1 - i; // Point 1: Ancien Sommet
      const idx2 = klines.length - 1 - cupBottomIndex; // Point 2: Le fond du bol
      const idx3 = klines.length - 1; // Point 3: Aujourd'hui

      const x2 = idx2 - idx1;
      const x3 = idx3 - idx1;
      const y1 = potentialHigh;
      const y2 = cupBottom;
      const y3 = currentPrice;

      // Résolution du système y = Ax² + Bx + C
      const A = ((y3 - y1) - (x3 / x2) * (y2 - y1)) / (x3 * (x3 - x2));
      const B = (y2 - y1 - (x2 * x2) * A) / x2;
      const C = y1;

      const parabolaCurve = [];
      for (let idx = idx1; idx <= idx3; idx++) {
        const x = idx - idx1;
        const y = A * x * x + B * x + C;
        parabolaCurve.push({
          time: formattedKlines[idx].time,
          value: y
        });
      }

      cupPattern = {
        type: distanceToHigh < 0 ? 'PRE-BREAKOUT' : 'EARLY BREAKOUT',
        oldHigh: potentialHigh,
        cupBottom,
        currentPrice,
        dropPercent,
        breakoutPercent: distanceToHigh,
        daysSinceHigh: i,
        daysSinceBottom: cupBottomIndex,
        klines: formattedKlines,
        parabolaCurve
      };

      // On a trouvé le bol le plus macro (le plus large valide), on arrête la recherche.
      break; 
    }
  }

  return { cupPattern };
};

export const fetchTop500Symbols = async () => {
  const url = 'https://api.bybit.com/v5/market/tickers?category=spot';
  
  try {
    const response = await axios.get(url, { timeout: 2000 });
    const list = response.data?.result?.list || response.data?.list;
    if (list) {
      return filterTickers(list);
    }
  } catch (e) { }

  for (let i = 0; i < PROXIES.length; i++) {
    try {
      const response = await axios.get(PROXIES[i](url), { timeout: 5000 });
      let list = response.data?.result?.list || response.data?.list;
      if (!list && typeof response.data === 'string') {
          try { list = JSON.parse(response.data)?.result?.list; } catch(e) {}
      }
      if (list) {
        return filterTickers(list);
      }
    } catch (e) { }
  }
  return [];
};

// Helper for filtering & formatting tickers
const filterTickers = (list) => {
  const blackList = ['USD', 'DAI', 'EUR', 'GBP', 'TRY', 'BUSD', 'USDC', 'USDE'];
  return list
    .filter(t => t.symbol.endsWith('USDT'))
    .filter(t => !blackList.some(ex => t.symbol.startsWith(ex)))
    .sort((a, b) => parseFloat(b.turnover24h) - parseFloat(a.turnover24h))
    .slice(0, 500).map(t => ({
      symbol: t.symbol,
      priceChangePercent: t.price24hPcnt * 100,
      lastPrice: t.lastPrice,
      turnover24h: t.turnover24h
    }));
};
