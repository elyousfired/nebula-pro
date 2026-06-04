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

  // ÉTAPE 1: Trouver le "Closest HH" (la résistance macro la plus proche)
  // On scanne du PLUS RÉCENT au PLUS ANCIEN (de 15 à la fin)
  let bestPeakIndex = -1;
  let bestPotentialHigh = 0;
  let bestCupBottom = Infinity;
  let bestCupBottomIndex = -1;

  for (let i = 15; i < klines.length; i++) {
    const potentialHigh = parseFloat(klines[i][2]);
    
    // Vérifier que c'est le sommet le plus haut depuis ce jour-là jusqu'à aujourd'hui
    // Tolérance de 5% pour ne pas être invalidé par un petit fakeout récent
    // En commençant à j=0, on s'assure que si le prix ACTUEL a cassé ce sommet, 
    // on l'invalide pour chercher un HH plus grand !
    let isHighestSince = true;
    for (let j = 0; j < i; j++) {
      if (parseFloat(klines[j][2]) > potentialHigh * 1.05) {
        isHighestSince = false;
        break;
      }
    }
    
    if (!isHighestSince) continue;

    // Trouver le fond du bol
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
    
    // Condition pour être une résistance macro : chute d'au moins 30% (ignore les micro-bosses comme celle à 765)
    if (dropPercent <= -30 && cupBottomIndex >= 5) {
      bestPeakIndex = i;
      bestPotentialHigh = potentialHigh;
      bestCupBottom = cupBottom;
      bestCupBottomIndex = cupBottomIndex;
      break; // On a trouvé le Closest HH, on arrête l'étape 1 !
    }
  }

  // ÉTAPE 2: Extension "Equal High" vers le passé
  if (bestPeakIndex !== -1) {
    let macroPeakIndex = bestPeakIndex;
    let macroPotentialHigh = bestPotentialHigh;

    // On regarde encore plus loin dans le passé pour voir s'il y a des sommets au même niveau
    for (let i = bestPeakIndex + 1; i < klines.length; i++) {
      const olderHigh = parseFloat(klines[i][2]);
      
      // CORRECTION: On compare TOUJOURS avec le bestPotentialHigh original (le niveau de résistance de base)
      // Cela évite que l'algorithme "grimpe l'escalier" jusqu'à l'ATH si les sommets montent progressivement
      if (olderHigh >= bestPotentialHigh * 0.90 && olderHigh <= bestPotentialHigh * 1.10) {
        
        // On s'assure qu'aucun sommet intermédiaire ne casse franchement cet olderHigh
        let isValidEqualHigh = true;
        for (let j = bestPeakIndex; j < i; j++) {
           if (parseFloat(klines[j][2]) > olderHigh * 1.05) {
             isValidEqualHigh = false;
             break;
           }
        }

        if (isValidEqualHigh) {
          // On étend la courbe à cet ancien sommet !
          macroPeakIndex = i;
          macroPotentialHigh = olderHigh;
        }
      }
    }

    // --- PRÉPARATION DES DONNÉES ET CALCUL DE LA PARABOLE ---
    const i = macroPeakIndex;
    const potentialHigh = macroPotentialHigh;
    
    // Recalcul du fond du bol avec la nouvelle extension
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

    const formattedKlines = [...klines].reverse().map(k => {
       const open = parseFloat(k[1]);
       const close = parseFloat(k[4]);
       return {
         time: Math.floor(Number(k[0]) / 1000),
         open,
         high: parseFloat(k[2]),
         low: parseFloat(k[3]),
         close,
         volume: parseFloat(k[6] || k[5]),
         volColor: close > open ? 'rgba(0, 255, 136, 0.4)' : 'rgba(255, 42, 42, 0.4)'
       };
    });

    const idx1 = klines.length - 1 - i; 
    const idx2 = klines.length - 1 - cupBottomIndex; 
    const idx3 = klines.length - 1; 

    const x2 = idx2 - idx1;
    const x3 = idx3 - idx1;
    const y1 = potentialHigh;
    const y2 = cupBottom;
    const y3 = currentPrice;

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

    let patternType = 'RECOVERY';
    if (distanceToHigh >= -15 && distanceToHigh < 0) patternType = 'PRE-BREAKOUT';
    else if (distanceToHigh >= 0) patternType = 'EARLY BREAKOUT';

    cupPattern = {
      type: patternType,
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
