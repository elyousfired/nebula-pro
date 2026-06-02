import React, { useState, useEffect, useRef } from 'react';
import { Target, LayoutDashboard, Radar, Activity, Settings } from 'lucide-react';
import { createChart, CandlestickSeries, LineSeries, HistogramSeries } from 'lightweight-charts';
import { fetchTop500Symbols, fetchDailyMacro } from './logic/scanner';

const TradingViewChart = ({ symbol, initialTrajectory, hh, parabolaCurve }) => {
  const chartContainerRef = useRef(null);
  const chartRef = useRef(null);
  const candlestickSeriesRef = useRef(null);
  const curveSeriesRef = useRef(null);
  const volumeSeriesRef = useRef(null);
  const hhLineRef = useRef(null);

  useEffect(() => {
    if (!chartContainerRef.current) return;

    const chart = createChart(chartContainerRef.current, {
      layout: {
        background: { type: 'solid', color: 'transparent' },
        textColor: '#d1d4dc',
      },
      grid: {
        vertLines: { color: 'rgba(42, 46, 57, 0.5)' },
        horzLines: { color: 'rgba(42, 46, 57, 0.5)' },
      },
      crosshair: { mode: 1 },
      rightPriceScale: { 
        borderColor: 'rgba(197, 203, 206, 0.8)',
      },
      timeScale: { borderColor: 'rgba(197, 203, 206, 0.8)', timeVisible: true },
    });

    // Les bougies prendront environ 65% du haut
    chart.priceScale('right').applyOptions({
      scaleMargins: {
        top: 0.1,
        bottom: 0.35, 
      },
    });

    const candlestickSeries = chart.addSeries(CandlestickSeries, {
      upColor: '#00ff88',
      downColor: '#ff2a2a',
      borderVisible: false,
      wickUpColor: '#00ff88',
      wickDownColor: '#ff2a2a'
    });

    const curveSeries = chart.addSeries(LineSeries, {
      color: 'rgba(255, 184, 0, 0.8)',
      lineWidth: 3,
      lineStyle: 0,
      crosshairMarkerVisible: false,
      priceLineVisible: false,
    });

    const volumeSeries = chart.addSeries(HistogramSeries, {
      color: '#26a69a',
      priceFormat: { type: 'volume' },
      priceScaleId: '', // Retour en mode overlay natif (comme TradingView)
      priceLineVisible: false,
      lastValueVisible: false, // Pas d'étiquette de prix écrasée
    });

    // Configurer l'échelle de l'overlay pour le volume
    chart.priceScale('').applyOptions({
      scaleMargins: {
        top: 0.70, // Le volume prendra strictement les 30% du bas
        bottom: 0,
      },
    });

    chartRef.current = chart;
    candlestickSeriesRef.current = candlestickSeries;
    curveSeriesRef.current = curveSeries;
    volumeSeriesRef.current = volumeSeries;

    return () => chart.remove();
  }, []);

  useEffect(() => {
    if (!candlestickSeriesRef.current || !initialTrajectory) return;
    
    // InitialTrajectory expects klines format from scanner
    const formatted = initialTrajectory;
    candlestickSeriesRef.current.setData(formatted);

    if (hh > 0) {
      if (hhLineRef.current) candlestickSeriesRef.current.removePriceLine(hhLineRef.current);
      hhLineRef.current = candlestickSeriesRef.current.createPriceLine({
        price: hh, color: '#ffb800', lineWidth: 2, lineStyle: 1, axisLabelVisible: true, title: 'HH',
      });
    }

    if (parabolaCurve && parabolaCurve.length > 0) {
      curveSeriesRef.current.setData(parabolaCurve);
    }

    if (volumeSeriesRef.current) {
      const volumeData = initialTrajectory.map(d => ({
        time: d.time,
        value: d.volume,
        color: d.volColor
      }));
      volumeSeriesRef.current.setData(volumeData);
    }

    setTimeout(() => chartRef.current?.timeScale().fitContent(), 100);
  }, [initialTrajectory, hh, parabolaCurve]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={chartContainerRef} style={{ width: '100%', height: '100%' }} />
      {/* Ligne de séparation esthétique entre le prix et le volume */}
      <div style={{ position: 'absolute', left: 0, right: 0, bottom: '30%', height: '1px', background: 'rgba(255, 255, 255, 0.15)', pointerEvents: 'none' }} />
    </div>
  );
};

const ParabolicRecoveryDashboard = ({ top500 }) => {
  const [analyzing, setAnalyzing] = useState(false);
  const [progress, setProgress] = useState(0);
  const [patterns, setPatterns] = useState([]);
  const [displayRange, setDisplayRange] = useState([0, 100]);

  useEffect(() => {
    if (top500 && top500.length > 0) {
      runDailyMacroScanner();
    }
  }, [top500]);

  const runDailyMacroScanner = async () => {
    setAnalyzing(true);
    setPatterns([]);
    let found = [];
    const BATCH_SIZE = 50;
    
    for (let i = 0; i < top500.length; i += BATCH_SIZE) {
      const batch = top500.slice(i, i + BATCH_SIZE);
      const promises = batch.map(async (t) => {
        try {
          const res = await fetchDailyMacro(t.symbol);
          if (res && res.cupPattern) {
            return { symbol: t.symbol, pattern: res.cupPattern };
          }
        } catch (e) { }
        return null;
      });

      const results = await Promise.all(promises);
      const valid = results.filter(r => r !== null);
      if (valid.length > 0) {
        found = [...found, ...valid];
        setPatterns([...found].sort((a, b) => b.pattern.breakoutPercent - a.pattern.breakoutPercent));
      }
      setProgress(Math.floor(((i + BATCH_SIZE) / top500.length) * 100));
      await new Promise(r => setTimeout(r, 500));
    }
    setAnalyzing(false);
    setProgress(100);
  };

  const ranges = [
    { label: "RANG 1-100", range: [0, 100] },
    { label: "RANG 101-200", range: [100, 200] },
    { label: "RANG 201-300", range: [200, 300] },
    { label: "RANG 301-400", range: [300, 400] },
    { label: "RANG 401-500", range: [400, 500] }
  ];

  // Map patterns to their original top 500 index
  const patternWithIndex = patterns.map(p => {
    const idx = top500.findIndex(t => t.symbol === p.symbol);
    return { ...p, originalIndex: idx };
  });

  const displayedPatterns = patternWithIndex.filter(p => p.originalIndex >= displayRange[0] && p.originalIndex < displayRange[1]);

  return (
    <div style={{ padding: '2rem' }}>
      <div style={{ marginBottom: '2rem', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h2 style={{ color: '#ffb800', fontSize: '2.5rem', fontWeight: '900', margin: 0, display: 'flex', alignItems: 'center', gap: '15px' }}>
            <Target size={40} /> PARABOLIC MACRO
          </h2>
          <p style={{ color: '#8b9bbb', margin: '10px 0 0 0', fontSize: '1.1rem' }}>
            Détection automatique de structures "Cup & Handle" avec projection parabolique (Top 500 Liquidity)
          </p>
        </div>
        
        {analyzing && (
          <div style={{ background: 'rgba(255, 184, 0, 0.1)', border: '1px solid #ffb800', padding: '15px 25px', borderRadius: '12px' }}>
            <div style={{ color: '#ffb800', fontWeight: 'bold', marginBottom: '8px' }}>ANALYSE DU TOP 500 EN COURS...</div>
            <div style={{ width: '200px', height: '6px', background: '#0a1922', borderRadius: '3px', overflow: 'hidden' }}>
              <div style={{ width: `${progress}%`, height: '100%', background: '#ffb800', transition: 'width 0.3s' }}></div>
            </div>
          </div>
        )}
      </div>

      <div style={{ display: 'flex', gap: '10px', marginBottom: '2rem', overflowX: 'auto', paddingBottom: '10px' }}>
        {ranges.map((r, i) => (
          <button 
            key={i} 
            onClick={() => setDisplayRange(r.range)}
            style={{
              padding: '10px 20px',
              background: displayRange[0] === r.range[0] ? '#ffb800' : '#11222c',
              color: displayRange[0] === r.range[0] ? '#000' : '#8b9bbb',
              border: `1px solid ${displayRange[0] === r.range[0] ? '#ffb800' : '#1e3848'}`,
              borderRadius: '8px',
              fontWeight: 'bold',
              cursor: 'pointer',
              whiteSpace: 'nowrap',
              transition: 'all 0.2s'
            }}
          >
            {r.label}
          </button>
        ))}
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(450px, 1fr))', gap: '2rem' }}>
        {displayedPatterns.map(({ symbol, pattern: p }, idx) => (
          <div key={idx} style={{ background: '#0a1922', border: '1px solid #1e3848', borderRadius: '12px', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
            {/* EN-TÊTE COMPACT */}
            <div style={{ padding: '1rem', background: 'linear-gradient(to right, #11222c, #0d212b)', borderBottom: '1px solid rgba(255,255,255,0.05)' }}>
              
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '0.5rem' }}>
                <div style={{ display: 'flex', alignItems: 'baseline', gap: '10px' }}>
                  <h3 style={{ margin: 0, color: '#fff', fontSize: '1.5rem', fontWeight: '900' }}>{symbol.replace('USDT', '')}</h3>
                  <span style={{ color: '#8b9bbb', fontSize: '0.8rem' }}>{p.daysSinceHigh}j</span>
                </div>
                
                <span style={{ 
                  background: p.type === 'PRE-BREAKOUT' ? '#ffb800' : '#00ff88', 
                  color: '#000', padding: '4px 10px', borderRadius: '6px', fontWeight: '900', fontSize: '0.8rem' 
                }}>
                  {p.breakoutPercent > 0 ? '+' : ''}{p.breakoutPercent.toFixed(2)}% {p.type}
                </span>
              </div>
              
              <div style={{ display: 'flex', gap: '1.5rem', alignItems: 'center' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#8b9bbb', fontSize: '0.75rem', textTransform: 'uppercase' }}>Résistance:</span>
                  <span style={{ color: '#ff2a2a', fontSize: '0.9rem', fontWeight: 'bold' }}>${p.oldHigh.toFixed(4)}</span>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                  <span style={{ color: '#8b9bbb', fontSize: '0.75rem', textTransform: 'uppercase' }}>Chute:</span>
                  <span style={{ color: '#ffb800', fontSize: '0.9rem', fontWeight: 'bold' }}>{p.dropPercent.toFixed(1)}%</span>
                </div>
              </div>
            </div>

            {/* GRAPHIQUE MAXIMISÉ */}
            <div style={{ padding: '0.5rem', flex: 1 }}>
              <div style={{ height: '350px', width: '100%' }}>
                <TradingViewChart 
                   symbol={symbol} 
                   initialTrajectory={p.klines} 
                   hh={p.oldHigh}
                   parabolaCurve={p.parabolaCurve}
                />
              </div>
            </div>
          </div>
        ))}
        {displayedPatterns.length === 0 && !analyzing && (
          <div style={{ gridColumn: '1 / -1', padding: '3rem', textAlign: 'center', color: '#8b9bbb', border: '1px dashed #1e3848', borderRadius: '16px' }}>
            Aucun pattern parabolique détecté dans ce rang pour le moment.
          </div>
        )}
      </div>
    </div>
  );
};

export default function App() {
  const [top500, setTop500] = useState([]);
  const [loading, setLoading] = useState(true);
  const [activeSection, setActiveSection] = useState('scanner');

  useEffect(() => {
    const init = async () => {
      try {
        const symbols = await fetchTop500Symbols();
        setTop500(symbols);
      } catch (e) {
        console.error("Failed to load top 500");
      }
      setLoading(false);
    };
    init();
  }, []);

  if (loading) {
    return (
      <div style={{ minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: '#071016' }}>
        <div style={{ color: '#ffb800', fontSize: '1.5rem', fontWeight: 'bold' }}>Initialisation du moteur...</div>
      </div>
    );
  }

  const menuItems = [
    { id: 'dashboard', label: 'Vue Globale', icon: <LayoutDashboard size={20} /> },
    { id: 'scanner', label: 'Scanner Macro', icon: <Radar size={20} /> },
    { id: 'live', label: 'Breakouts Live', icon: <Activity size={20} /> },
    { id: 'settings', label: 'Paramètres', icon: <Settings size={20} /> },
  ];

  return (
    <div style={{ minHeight: '100vh', display: 'flex', background: '#071016', color: '#fff', fontFamily: 'system-ui, sans-serif' }}>
      
      {/* SIDEBAR */}
      <div style={{ width: '280px', background: '#0a1922', borderRight: '1px solid #1e3848', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '2rem 1.5rem', borderBottom: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <h1 style={{ color: '#fff', margin: 0, fontSize: '1.5rem', fontWeight: '900', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <Target size={28} color="#ffb800" />
            NEBULA <span style={{ color: '#ffb800' }}>PRO</span>
          </h1>
          <div style={{ color: '#8b9bbb', fontSize: '0.8rem', marginTop: '5px', letterSpacing: '1px' }}>INSTITUTIONAL RADAR</div>
        </div>
        
        <div style={{ padding: '1.5rem', display: 'flex', flexDirection: 'column', gap: '8px', flex: 1 }}>
          <div style={{ color: '#8b9bbb', fontSize: '0.75rem', fontWeight: 'bold', marginBottom: '10px', letterSpacing: '1px' }}>MENU PRINCIPAL</div>
          
          {menuItems.map(item => (
            <button
              key={item.id}
              onClick={() => setActiveSection(item.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: '12px', padding: '12px 16px',
                background: activeSection === item.id ? 'rgba(255, 184, 0, 0.1)' : 'transparent',
                color: activeSection === item.id ? '#ffb800' : '#8b9bbb',
                border: 'none', borderRadius: '8px', cursor: 'pointer',
                fontWeight: activeSection === item.id ? 'bold' : 'normal',
                textAlign: 'left', transition: 'all 0.2s', width: '100%'
              }}
            >
              {item.icon}
              {item.label}
            </button>
          ))}
        </div>
        
        <div style={{ padding: '1.5rem', borderTop: '1px solid rgba(255, 255, 255, 0.05)' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
            <div style={{ width: '10px', height: '10px', borderRadius: '50%', background: '#00ff88', boxShadow: '0 0 10px #00ff88' }}></div>
            <span style={{ color: '#8b9bbb', fontSize: '0.9rem' }}>Système en ligne</span>
          </div>
        </div>
      </div>

      {/* MAIN CONTENT AREA */}
      <div style={{ flex: 1, overflowY: 'auto', height: '100vh' }}>
        {activeSection === 'scanner' && <ParabolicRecoveryDashboard top500={top500} />}
        {activeSection !== 'scanner' && (
          <div style={{ padding: '3rem', display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: '#8b9bbb' }}>
            <h2>Section {menuItems.find(m => m.id === activeSection)?.label} (En cours de développement)</h2>
          </div>
        )}
      </div>
      
    </div>
  );
}
