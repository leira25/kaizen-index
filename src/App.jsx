import { useState, useEffect, useRef } from 'react';
import { RefreshCw, ChevronDown, Search, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, Copy } from 'lucide-react';
import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import './App.css';

// Priority tokens
const PRIORITY_TOKENS = [
  { symbol: 'SOL', id: 'solana', binanceSymbol: 'SOL' },
  { symbol: 'BTC', id: 'bitcoin', binanceSymbol: 'BTC' },
  { symbol: 'ETH', id: 'ethereum', binanceSymbol: 'ETH' },
  { symbol: 'BONK', id: 'bonk', binanceSymbol: '1000BONK' },
  { symbol: 'WIF', id: 'dogwifcoin', binanceSymbol: 'WIF' },
  { symbol: 'POPCAT', id: 'popcat', binanceSymbol: 'POPCAT' },
  { symbol: 'JUP', id: 'jupiter-exchange-solana', binanceSymbol: 'JUP' },
  { symbol: 'FARTCOIN', id: 'fartcoin', binanceSymbol: null }
];

const CONTRACT_ADDRESS = '4EKDKWJDrqrCQtAD6j9sM5diTeZiKBepkEB8GLP9Dark';

const CARD_DEFS = [
  { key: 'openInterest', label: 'OPEN INTEREST', unit: 'All Exchanges', fmt: (v) => fmtUSD(v) },
  { key: 'fundingRate', label: 'FUNDING RATE', unit: 'All Exchanges', fmt: (v) => v != null ? `${(v * 100).toFixed(4)}%` : '--' },
  { key: 'longShort', label: 'LONG/SHORT', unit: 'All Traders', fmt: (v) => v != null ? v.toFixed(2) : '--' },
  { key: 'topTraders', label: 'TOP TRADERS', unit: 'L/S Ratio', fmt: (v) => v != null ? v.toFixed(2) : '--' },
  { key: 'fearGreed', label: 'FEAR & GREED', unit: 'Fear', fmt: (v) => v != null ? Math.round(v) : '--' },
  { key: 'volume24h', label: 'VOLUME 24H', unit: 'USD', fmt: (v) => fmtUSD(v) },
  { key: 'marketCap', label: 'MARKET CAP', unit: 'USD', fmt: (v) => fmtUSD(v) },
  { key: 'priceChange7d', label: '7D CHANGE', unit: '%', fmt: (v) => v != null ? `${v > 0 ? '+' : ''}${v.toFixed(2)}%` : '--' }
];

function fmtUSD(v) {
  if (v == null || isNaN(v)) return '--';
  const n = Number(v);
  if (n >= 1e12) return `$${(n/1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n/1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n/1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n/1e3).toFixed(2)}K`;
  return `$${n.toFixed(2)}`;
}

function toBinanceFuturesSymbol(token) {
  if (!token.binanceSymbol) return null;
  return `${token.binanceSymbol}USDT`;
}

// Search CoinGecko for tokens
async function searchCoinGeckoTokens(query) {
  try {
    const url = `https://api.coingecko.com/api/v3/search?query=${encodeURIComponent(query)}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Search failed');
    const data = await res.json();
    return data.coins.slice(0, 20).map(coin => ({
      symbol: coin.symbol.toUpperCase(),
      id: coin.id,
      name: coin.name,
      binanceSymbol: null
    }));
  } catch (err) {
    console.warn('Token search failed', err);
    return [];
  }
}

async function fetchCoinGeckoOHLC(coingeckoId, days = 30) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/ohlc?vs_currency=usd&days=${days}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('CoinGecko OHLC failed');
    return await res.json();
  } catch (err) {
    console.warn('OHLC fetch failed', err);
    return null;
  }
}

async function fetchCoinGeckoMarketChart(coingeckoId, days = 30) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}/market_chart?vs_currency=usd&days=${days}&interval=daily`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Market chart failed');
    return await res.json();
  } catch (err) {
    console.warn('Market chart fetch failed', err);
    return null;
  }
}

async function fetchCoinGeckoMarketData(coingeckoId) {
  try {
    const url = `https://api.coingecko.com/api/v3/coins/${coingeckoId}?localization=false&tickers=false&market_data=true&community_data=false&developer_data=false&sparkline=false`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('CoinGecko market failed');
    return await res.json();
  } catch (err) {
    console.warn('CoinGecko market fetch failed', err);
    return null;
  }
}

async function fetchAlternativeFearGreed(limit = 60) {
  try {
    const url = `https://api.alternative.me/fng/?limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('F&G fetch failed');
    const json = await res.json();
    return json.data.map(d => ({ ts: Number(d.timestamp) * 1000, value: Number(d.value) }));
  } catch (err) {
    console.warn('F&G fetch failed', err);
    return null;
  }
}

async function fetchBinanceOpenInterest(token) {
  const bin = toBinanceFuturesSymbol(token);
  if (!bin) return null;
  try {
    const url = `https://fapi.binance.com/futures/data/openInterestHist?symbol=${bin}&period=5m&limit=1`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('OI fetch failed');
    const [j] = await res.json();
    return Number(j.sumOpenInterestValue);
  } catch (err) {
    console.warn('Binance OI fetch error for', token.symbol, err);
    return null;
  }
}

async function fetchBinanceFundingHistory(token, limit = 60) {
  const bin = toBinanceFuturesSymbol(token);
  if (!bin) return null;
  try {
    const url = `https://fapi.binance.com/fapi/v1/fundingRate?symbol=${bin}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Funding fetch failed');
    const arr = await res.json();
    return arr.map(o => ({ ts: Number(o.fundingTime), rate: Number(o.fundingRate) }));
  } catch (err) {
    console.warn('Binance funding fetch error for', token.symbol, err);
    return null;
  }
}

async function fetchBinanceTakerRatio(token, period = '1h', limit = 100) {
  const bin = toBinanceFuturesSymbol(token);
  if (!bin) return null;
  try {
    const url = `https://fapi.binance.com/futures/data/takerlongshortRatio?symbol=${bin}&period=${period}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Taker ratio fetch failed');
    const arr = await res.json();
    return arr.map(o => ({
      ts: Number(o.timestamp),
      value: Number(o.buySellRatio)
    }));
  } catch (err) {
    console.warn('Binance taker ratio fetch failed for', token.symbol, err);
    return null;
  }
}

async function fetchBinanceGlobalLSRatio(token, period = '1h', limit = 100) {
  const bin = toBinanceFuturesSymbol(token);
  if (!bin) return null;
  try {
    const url = `https://fapi.binance.com/futures/data/globalLongShortAccounts?symbol=${bin}&period=${period}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Global LS fetch failed');
    const arr = await res.json();
    return arr.map(o => ({
      ts: Number(o.timestamp),
      value: Number(o.longShortRatio)
    }));
  } catch (err) {
    console.warn('Binance global LS fetch failed for', token.symbol, err);
    return null;
  }
}

async function fetchBinanceTopLSRatio(token, period = '1h', limit = 100) {
  const bin = toBinanceFuturesSymbol(token);
  if (!bin) return null;
  try {
    const url = `https://fapi.binance.com/futures/data/topLongShortAccounts?symbol=${bin}&period=${period}&limit=${limit}`;
    const res = await fetch(url);
    if (!res.ok) throw new Error('Top LS fetch failed');
    const arr = await res.json();
    return arr.map(o => ({
      ts: Number(o.timestamp),
      value: Number(o.longShortRatio)
    }));
  } catch (err) {
    console.warn('Binance top LS fetch failed for', token.symbol, err);
    return null;
  }
}

// Calculate buy/sell signal based on multiple indicators
function calculateSignal(priceChange24h, fundingRate, takerRatio, fearGreed) {
  let score = 0;
  let signals = [];

  // Price momentum (30%)
  if (priceChange24h > 5) {
    score += 30;
    signals.push('Strong upward momentum');
  } else if (priceChange24h > 0) {
    score += 15;
    signals.push('Positive momentum');
  } else if (priceChange24h < -5) {
    score -= 30;
    signals.push('Strong downward momentum');
  } else {
    score -= 15;
    signals.push('Negative momentum');
  }

  // Funding rate (25%)
  if (fundingRate != null) {
    if (fundingRate < -0.01) {
      score += 25;
      signals.push('Negative funding (shorts paying longs)');
    } else if (fundingRate > 0.01) {
      score -= 25;
      signals.push('High funding (longs paying shorts)');
    }
  }

  // Taker buy/sell ratio (25%)
  if (takerRatio != null) {
    if (takerRatio > 1.2) {
      score += 25;
      signals.push('Strong buying pressure');
    } else if (takerRatio > 1) {
      score += 12;
      signals.push('Moderate buying pressure');
    } else if (takerRatio < 0.8) {
      score -= 25;
      signals.push('Strong selling pressure');
    } else {
      score -= 12;
      signals.push('Moderate selling pressure');
    }
  }

  // Fear & Greed (20%)
  if (fearGreed != null) {
    if (fearGreed < 25) {
      score += 20;
      signals.push('Extreme fear (contrarian buy)');
    } else if (fearGreed > 75) {
      score -= 20;
      signals.push('Extreme greed (contrarian sell)');
    }
  }

  // Determine signal
  let signal = 'NEUTRAL';
  if (score > 40) signal = 'STRONG BUY';
  else if (score > 15) signal = 'BUY';
  else if (score < -40) signal = 'STRONG SELL';
  else if (score < -15) signal = 'SELL';

  return { signal, score, signals };
}

async function fetchMarketMetrics(token) {
  const [oiCurrent, fundingHist, takerRaw, globalLSRaw, topLSRaw] = await Promise.all([
    fetchBinanceOpenInterest(token),
    fetchBinanceFundingHistory(token, 60),
    fetchBinanceTakerRatio(token, '1h', 100),
    fetchBinanceGlobalLSRatio(token, '1h', 100),
    fetchBinanceTopLSRatio(token, '1h', 100)
  ]);

  const funding = fundingHist ? {
    timeseries: fundingHist,
    current: fundingHist[fundingHist.length - 1]?.rate
  } : { timeseries: [], current: null };

  const taker = takerRaw && Array.isArray(takerRaw) && takerRaw.length
    ? { timeseries: takerRaw }
    : { timeseries: [] };

  return {
    oi: oiCurrent,
    funding,
    taker,
    longShortRatio: globalLSRaw?.[globalLSRaw.length - 1]?.value ?? null,
    topTradersRatio: topLSRaw?.[topLSRaw.length - 1]?.value ?? null
  };
}

function App() {
  const [currentToken, setCurrentToken] = useState(PRIORITY_TOKENS[0]);
  const [dropdownOpen, setDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState([]);
  const [loading, setLoading] = useState(false);
  const [searching, setSearching] = useState(false);
  const [cardData, setCardData] = useState({});
  const [priceData, setPriceData] = useState({ price: null, change: null });
  const [signal, setSignal] = useState(null);
  const [copied, setCopied] = useState(false);
  
  const chartsRef = useRef({});
  const canvasRefs = {
    ohlc: useRef(null),
    volume: useRef(null),
    buySell: useRef(null),
    fg: useRef(null),
    funding: useRef(null)
  };

  const displayTokens = searchQuery.length > 0 ? searchResults : PRIORITY_TOKENS;

  const handleCopyCA = async () => {
    try {
      await navigator.clipboard.writeText(CONTRACT_ADDRESS);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch (err) {
      console.warn('Copy failed', err);
    }
  };

  useEffect(() => {
    const searchTimer = setTimeout(async () => {
      if (searchQuery.length > 1) {
        setSearching(true);
        const results = await searchCoinGeckoTokens(searchQuery);
        setSearchResults(results);
        setSearching(false);
      } else {
        setSearchResults([]);
      }
    }, 500);

    return () => clearTimeout(searchTimer);
  }, [searchQuery]);

  useEffect(() => {
    initCharts();
    fetchAndRenderAll(currentToken);
    
    return () => {
      Object.values(chartsRef.current).forEach(chart => {
        if (chart) chart.destroy();
      });
    };
  }, []);

  useEffect(() => {
    fetchAndRenderAll(currentToken);
  }, [currentToken]);

  const defaultOptions = (yLabel = '') => ({
    responsive: true,
    maintainAspectRatio: true,
    aspectRatio: 1.5,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM dd' },
        grid: { display: false, color: 'rgba(0,0,0,0.05)' },
        ticks: { color: '#333' }
      },
      y: {
        grid: { color: 'rgba(0,0,0,0.05)' },
        ticks: { color: '#333' },
        title: { display: !!yLabel, text: yLabel, color: '#000' }
      }
    },
    plugins: {
      legend: { 
        display: true, 
        position: 'bottom', 
        labels: { color: '#000', usePointStyle: true, font: { family: 'Orbitron' } } 
      },
      tooltip: { mode: 'index' }
    }
  });

  const initCharts = () => {
    if (canvasRefs.ohlc.current) {
      const ctx = canvasRefs.ohlc.current.getContext('2d');
      chartsRef.current.ohlc = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'High',
            data: [],
            borderColor: '#000',
            backgroundColor: 'rgba(0, 0, 0, 0.05)',
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 0,
            fill: false
          }, {
            label: 'Low',
            data: [],
            borderColor: '#666',
            backgroundColor: 'rgba(102, 102, 102, 0.05)',
            borderWidth: 2,
            tension: 0.2,
            pointRadius: 0,
            fill: false
          }, {
            label: 'Close',
            data: [],
            borderColor: '#333',
            borderWidth: 3,
            tension: 0.2,
            pointRadius: 0,
            fill: false
          }]
        },
        options: defaultOptions('Price (USD)')
      });
    }

    if (canvasRefs.volume.current) {
      const ctx = canvasRefs.volume.current.getContext('2d');
      const options = defaultOptions('Volume (USD)');
      options.scales.y.ticks.callback = (value) => fmtUSD(value);
      chartsRef.current.volume = new Chart(ctx, {
        type: 'bar',
        data: {
          labels: [],
          datasets: [{
            label: 'Volume',
            data: [],
            backgroundColor: 'rgba(0, 0, 0, 0.2)',
            borderColor: '#000',
            borderWidth: 1
          }]
        },
        options
      });
    }

    if (canvasRefs.buySell.current) {
      const ctx = canvasRefs.buySell.current.getContext('2d');
      chartsRef.current.buySell = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Buy/Sell Ratio',
            data: [],
            borderColor: '#000',
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            borderWidth: 3,
            tension: 0.2,
            pointRadius: 0,
            fill: true
          }]
        },
        options: defaultOptions('Taker Buy Ratio')
      });
    }

    if (canvasRefs.fg.current) {
      const ctx = canvasRefs.fg.current.getContext('2d');
      chartsRef.current.fg = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Fear & Greed',
            data: [],
            borderColor: '#000',
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            borderWidth: 3,
            tension: 0.2,
            pointRadius: 0,
            fill: true
          }]
        },
        options: defaultOptions('Index Value')
      });
    }

    if (canvasRefs.funding.current) {
      const ctx = canvasRefs.funding.current.getContext('2d');
      chartsRef.current.funding = new Chart(ctx, {
        type: 'line',
        data: {
          labels: [],
          datasets: [{
            label: 'Funding Rate',
            data: [],
            borderColor: '#000',
            backgroundColor: 'rgba(0, 0, 0, 0.1)',
            borderWidth: 3,
            tension: 0.2,
            pointRadius: 0,
            fill: true
          }]
        },
        options: defaultOptions('Funding Rate (%)')
      });
    }
  };

  const fetchAndRenderAll = async (token) => {
    setLoading(true);
    try {
      const [ohlc, market, marketChart, fg, metrics] = await Promise.all([
        fetchCoinGeckoOHLC(token.id, 30),
        fetchCoinGeckoMarketData(token.id),
        fetchCoinGeckoMarketChart(token.id, 30),
        fetchAlternativeFearGreed(60),
        fetchMarketMetrics(token)
      ]);

      // Always prioritize getting price from available data
      let currentPrice = null;
      if (market?.market_data?.current_price?.usd) {
        currentPrice = market.market_data.current_price.usd;
      } else if (ohlc && ohlc.length > 0) {
        currentPrice = ohlc[ohlc.length - 1][4]; // Use close price from OHLC
      }

      // Calculate 24h change from OHLC if market data unavailable
      let priceChange24h = market?.market_data?.price_change_percentage_24h ?? null;
      if (priceChange24h === null && ohlc && ohlc.length >= 2) {
        const latestPrice = ohlc[ohlc.length - 1][4];
        const price24hAgo = ohlc[ohlc.length - 2][4];
        priceChange24h = ((latestPrice - price24hAgo) / price24hAgo) * 100;
      }

      const priceChange7d = market?.market_data?.price_change_percentage_7d ?? null;
      const volume24h = market?.market_data?.total_volume?.usd ?? null;
      const marketCap = market?.market_data?.market_cap?.usd ?? null;

      setPriceData({ price: currentPrice, change: priceChange24h });

      const fundingCurrent = metrics.funding?.current ?? null;
      const fgLast = fg && fg.length ? fg[fg.length - 1].value : null;
      const takerLast = metrics.taker?.timeseries?.length > 0 ? metrics.taker.timeseries[metrics.taker.timeseries.length - 1].value : null;

      // Calculate trading signal
      const tradingSignal = calculateSignal(priceChange24h, fundingCurrent, takerLast, fgLast);
      setSignal(tradingSignal);

      setCardData({
        openInterest: { value: metrics.oi, delta: null },
        fundingRate: { value: fundingCurrent, delta: null },
        longShort: { value: metrics.longShortRatio, delta: null },
        topTraders: { value: metrics.topTradersRatio, delta: null },
        fearGreed: { value: fgLast, delta: null },
        volume24h: { value: volume24h, delta: null },
        marketCap: { value: marketCap, delta: null },
        priceChange7d: { value: priceChange7d, delta: null }
      });

      renderOHLC(ohlc);
      renderVolumeHistory(marketChart);
      renderTakerRatio(metrics.taker);
      renderFearGreed(fg);
      renderFunding(metrics.funding);

    } catch (err) {
      console.error('fetchAndRenderAll failed', err);
    } finally {
      setLoading(false);
    }
  };

  const renderOHLC = (raw) => {
    if (!raw || !raw.length || !chartsRef.current.ohlc) return;
    const labels = raw.map(r => new Date(r[0]));
    chartsRef.current.ohlc.data.labels = labels;
    chartsRef.current.ohlc.data.datasets[0].data = raw.map(r => ({ x: new Date(r[0]), y: r[2] }));
    chartsRef.current.ohlc.data.datasets[1].data = raw.map(r => ({ x: new Date(r[0]), y: r[3] }));
    chartsRef.current.ohlc.data.datasets[2].data = raw.map(r => ({ x: new Date(r[0]), y: r[4] }));
    chartsRef.current.ohlc.update();
  };

  const renderVolumeHistory = (raw) => {
    if (!chartsRef.current.volume) return;
    if (raw && raw.total_volumes && raw.total_volumes.length) {
      const volumes = raw.total_volumes;
      chartsRef.current.volume.data.labels = volumes.map(v => new Date(v[0]));
      chartsRef.current.volume.data.datasets[0].data = volumes.map(v => v[1]);
    } else {
      chartsRef.current.volume.data.labels = [];
      chartsRef.current.volume.data.datasets[0].data = [];
    }
    chartsRef.current.volume.update();
  };

  const renderTakerRatio = (takerData) => {
    if (!chartsRef.current.buySell) return;
    const series = takerData?.timeseries || [];
    const data = series.map(s => ({ x: new Date(s.ts), y: s.value }));
    chartsRef.current.buySell.data.labels = data.map(d => d.x);
    chartsRef.current.buySell.data.datasets[0].data = data;
    chartsRef.current.buySell.update();
  };

  const renderFearGreed = (series) => {
    if (!chartsRef.current.fg) return;
    const data = series && series.length ? series.map(s => ({ x: new Date(s.ts), y: s.value })) : [];
    chartsRef.current.fg.data.labels = data.map(d => d.x);
    chartsRef.current.fg.data.datasets[0].data = data;
    chartsRef.current.fg.update();
  };

  const renderFunding = (funding) => {
    if (!chartsRef.current.funding) return;
    const series = funding?.timeseries || [];
    const data = series.map(s => ({ x: new Date(s.ts), y: (s.rate ?? s.value ?? 0) * 100 }));
    chartsRef.current.funding.data.labels = data.map(d => d.x);
    chartsRef.current.funding.data.datasets[0].data = data;
    chartsRef.current.funding.update();
  };

  const getSignalColor = (sig) => {
    if (!sig) return '';
    if (sig === 'STRONG BUY') return 'strong-buy';
    if (sig === 'BUY') return 'buy';
    if (sig === 'STRONG SELL') return 'strong-sell';
    if (sig === 'SELL') return 'sell';
    return 'neutral';
  };

  const getSignalIcon = (sig) => {
    if (!sig) return <Minus size={24} />;
    if (sig === 'STRONG BUY' || sig === 'BUY') return <ArrowUp size={24} />;
    if (sig === 'STRONG SELL' || sig === 'SELL') return <ArrowDown size={24} />;
    return <Minus size={24} />;
  };

  return (
    <div className="app">
      <header className="header">
        <div className="header-content">
          <div className="logo-section">
            <div className="logo">
              <div className="logo-icon"><img src="./logo.png" alt="Logo" /></div>
              <div className="logo-text">
                <h1 className="logo-title">USDARK-INDICATOR</h1>
                <p className="logo-subtitle">Token Analysis & Trading Signals</p>
                <div className="contract-address">
                  <span className="ca-label">CA: </span>
                  <button 
                    className="ca-copy-btn" 
                    onClick={handleCopyCA}
                    title="Copy contract address"
                  >
                    <span className="ca-value">{CONTRACT_ADDRESS}</span>
                    <Copy size={12} className="copy-icon" />
                    {copied && <span className="copied-feedback">Copied!</span>}
                  </button>
                </div>
              </div>
            </div>
          </div>

          <div className="header-actions">
            <div className="token-selector">
              <button 
                className="token-btn"
                onClick={() => setDropdownOpen(!dropdownOpen)}
              >
                <span>{currentToken.symbol}</span>
                <ChevronDown size={16} />
              </button>

              {dropdownOpen && (
                <>
                  <div className="dropdown-backdrop" onClick={() => setDropdownOpen(false)} />
                  <div className="dropdown">
                    <div className="dropdown-search">
                      <Search size={16} />
                      <input
                        type="text"
                        placeholder="Search any token..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        autoFocus
                      />
                    </div>
                    <div className="dropdown-list">
                      {searching && <div className="dropdown-loading">Searching...</div>}
                      {!searching && displayTokens.map(token => (
                        <button
                          key={token.id}
                          className="dropdown-item"
                          onClick={() => {
                            setCurrentToken(token);
                            setDropdownOpen(false);
                            setSearchQuery('');
                          }}
                        >
                          <span className="token-symbol">{token.symbol}</span>
                          <span className="token-id">{token.name || token.id}</span>
                        </button>
                      ))}
                      {!searching && displayTokens.length === 0 && searchQuery.length > 1 && (
                        <div className="dropdown-empty">No tokens found</div>
                      )}
                    </div>
                  </div>
                </>
              )}
            </div>

            <div className="price-display">
              <div className="price">
                {priceData.price ? `$${Number(priceData.price).toLocaleString(undefined, {maximumFractionDigits: 6})}` : '--'}
              </div>
              {priceData.change != null && (
                <div className={`price-change ${priceData.change >= 0 ? 'positive' : 'negative'}`}>
                  {priceData.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                  {priceData.change >= 0 ? '+' : ''}{priceData.change.toFixed(2)}%
                </div>
              )}
            </div>

            <button
              className="refresh-btn"
              onClick={() => fetchAndRenderAll(currentToken)}
              disabled={loading}
            >
              <RefreshCw size={18} className={loading ? 'spinning' : ''} />
            </button>
          </div>
        </div>
      </header>

      <main className="main">
        {/* Trading Signal */}
        {signal && (
          <div className={`signal-card ${getSignalColor(signal.signal)}`}>
            <div className="signal-icon">
              {getSignalIcon(signal.signal)}
            </div>
            <div className="signal-content">
              <div className="signal-label">TRADING SIGNAL</div>
              <div className="signal-value">{signal.signal}</div>
              <div className="signal-score">Confidence Score: {signal.score}</div>
              <div className="signal-reasons">
                {signal.signals.map((s, i) => (
                  <div key={i} className="signal-reason">• {s}</div>
                ))}
              </div>
            </div>
          </div>
        )}

        <div className="cards-grid">
          {CARD_DEFS.map(card => {
            const data = cardData[card.key] || {};
            return (
              <div key={card.key} className={`metric-card ${loading ? 'loading' : ''}`}>
                <div className="card-header">
                  <TrendingUp size={16} className="card-icon" />
                  <span className="card-label">{card.label}</span>
                </div>
                <div className="card-value">
                  {card.fmt(data.value)}
                </div>
                <div className="card-unit">{card.unit}</div>
                {data.delta != null && (
                  <div className={`card-delta ${data.delta >= 0 ? 'positive' : 'negative'}`}>
                    {data.delta >= 0 ? '+' : ''}{(data.delta * 100).toFixed(2)}%
                  </div>
                )}
              </div>
            );
          })}
        </div>

        <div className="charts-grid">
          <div className="chart-container">
            <h3 className="chart-title">{currentToken.symbol}/USDT PRICE HISTORY (OHLC)</h3>
            <div className="chart-wrapper">
              <canvas ref={canvasRefs.ohlc}></canvas>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="chart-title">{currentToken.symbol} VOLUME HISTORY</h3>
            <div className="chart-wrapper">
              <canvas ref={canvasRefs.volume}></canvas>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="chart-title">TAKER BUY RATIO (1H)</h3>
            <div className="chart-wrapper">
              <canvas ref={canvasRefs.buySell}></canvas>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="chart-title">FEAR & GREED INDEX</h3>
            <div className="chart-wrapper">
              <canvas ref={canvasRefs.fg}></canvas>
            </div>
          </div>

          <div className="chart-container">
            <h3 className="chart-title">FUNDING RATE HISTORY</h3>
            <div className="chart-wrapper">
              <canvas ref={canvasRefs.funding}></canvas>
            </div>
          </div>
        </div>
      </main>
    </div>
  );
}

export default App;