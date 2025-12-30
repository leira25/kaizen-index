import { useState, useEffect, useRef } from 'react';
import { RefreshCw, ChevronDown, Search, TrendingUp, TrendingDown, ArrowUp, ArrowDown, Minus, Copy } from 'lucide-react';
import Chart from 'chart.js/auto';
import 'chartjs-adapter-date-fns';
import * as THREE from 'three';
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

const CONTRACT_ADDRESS = '3ejk8LXAS9kUC7XhpDGHRjARyUy5qU7PaAq7PMykpump';

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
  if (n >= 1e12) return `$${(n / 1e12).toFixed(2)}T`;
  if (n >= 1e9) return `$${(n / 1e9).toFixed(2)}B`;
  if (n >= 1e6) return `$${(n / 1e6).toFixed(2)}M`;
  if (n >= 1e3) return `$${(n / 1e3).toFixed(2)}K`;
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

function calculateSignal(priceChange24h, fundingRate, takerRatio, fearGreed) {
  let score = 0;
  let signals = [];
  if (priceChange24h > 5) { score += 30; signals.push('Strong upward momentum'); }
  else if (priceChange24h > 0) { score += 15; signals.push('Positive momentum'); }
  else if (priceChange24h < -5) { score -= 30; signals.push('Strong downward momentum'); }
  else if (priceChange24h < 0) { score -= 15; signals.push('Negative momentum'); }
  if (fundingRate != null) {
    if (fundingRate < -0.01) { score += 25; signals.push('Negative funding (shorts paying longs)'); }
    else if (fundingRate > 0.01) { score -= 25; signals.push('High funding (longs paying shorts)'); }
  }
  if (takerRatio != null) {
    if (takerRatio > 1.2) { score += 25; signals.push('Strong buying pressure'); }
    else if (takerRatio > 1) { score += 12; signals.push('Moderate buying pressure'); }
    else if (takerRatio < 0.8) { score -= 25; signals.push('Strong selling pressure'); }
    else if (takerRatio < 1) { score -= 12; signals.push('Moderate selling pressure'); }
  }
  if (fearGreed != null) {
    if (fearGreed < 25) { score += 20; signals.push('Extreme fear (contrarian buy)'); }
    else if (fearGreed > 75) { score -= 20; signals.push('Extreme greed (contrarian sell)'); }
  }
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
  const [preloaderActive, setPreloaderActive] = useState(true);
  const [progress, setProgress] = useState(0);

  const chartsRef = useRef({});
  const canvasRefs = {
    ohlc: useRef(null),
    volume: useRef(null),
    buySell: useRef(null),
    fg: useRef(null),
    funding: useRef(null)
  };

  const matrixRef = useRef(null);
  const bgCanvasRef = useRef(null);

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

  // Preloader progress simulation
  useEffect(() => {
    if (!preloaderActive) return;
    let currentProgress = 0;
    const interval = setInterval(() => {
      currentProgress += Math.random() * 8 + 2;
      if (currentProgress > 100) currentProgress = 100;
      setProgress(Math.floor(currentProgress));
      if (currentProgress >= 100) {
        clearInterval(interval);
        setTimeout(() => setPreloaderActive(false), 500);
      }
    }, 80);
    return () => clearInterval(interval);
  }, [preloaderActive]);

  // Token search
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

  // Init charts and fetch data after preloader
  useEffect(() => {
    if (preloaderActive) return;
    initCharts();
    fetchAndRenderAll(currentToken);
    return () => {
      Object.values(chartsRef.current).forEach(chart => chart?.destroy());
    };
  }, [preloaderActive]);

  useEffect(() => {
    if (preloaderActive) return;
    fetchAndRenderAll(currentToken);
  }, [currentToken]);

  // Matrix Rain + 3D Grid Background
  useEffect(() => {
    if (preloaderActive || typeof window === 'undefined') return;

    let matrixInterval;
    let animationId;
    let renderer, scene, camera, grid, nodes;

    // Matrix Rain
    const matrixCanvas = matrixRef.current;
    if (matrixCanvas) {
      const ctx = matrixCanvas.getContext('2d');
      const resize = () => {
        matrixCanvas.width = window.innerWidth;
        matrixCanvas.height = window.innerHeight;
      };
      resize();

      const fontSize = 16;
      let columns = Math.floor(matrixCanvas.width / fontSize);
      const drops = Array(columns).fill(1);
      const chars = 'アイウエオカキクケコサシスセソタチツテトナニヌネノハヒフヘホマミムメモヤユヨラリルレロワヲン0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZ'.split('');

      const draw = () => {
        ctx.fillStyle = 'rgba(0, 0, 0, 0.08)';
        ctx.fillRect(0, 0, matrixCanvas.width, matrixCanvas.height);
        ctx.fillStyle = '#0f0';
        ctx.font = `${fontSize}px monospace`;
        ctx.shadowBlur = 10;
        ctx.shadowColor = '#0f0';

        for (let i = 0; i < drops.length; i++) {
          const char = chars[Math.floor(Math.random() * chars.length)];
          const x = i * fontSize;
          const y = drops[i] * fontSize;
          ctx.fillText(char, x, y);
          if (y > matrixCanvas.height && Math.random() > 0.975) drops[i] = 0;
          drops[i]++;
        }
      };

      matrixInterval = setInterval(draw, 35);
      window.addEventListener('resize', () => {
        resize();
        columns = Math.floor(matrixCanvas.width / fontSize);
      });
    }

    // THREE.js Grid + Nodes
    const bgCanvas = bgCanvasRef.current;
    if (bgCanvas) {
      scene = new THREE.Scene();
      camera = new THREE.PerspectiveCamera(60, window.innerWidth / window.innerHeight, 0.1, 100);
      camera.position.set(0, -2, 10);
      camera.lookAt(0, 0, 0);

      renderer = new THREE.WebGLRenderer({ canvas: bgCanvas, alpha: true, antialias: true });
      renderer.setSize(window.innerWidth, window.innerHeight);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));

      const gridHelper = new THREE.GridHelper(30, 50, 0x00ff00, 0x003300);
      gridHelper.rotation.x = Math.PI / 2;
      gridHelper.position.z = -5;
      scene.add(gridHelper);

      grid = new THREE.LineSegments(
        new THREE.WireframeGeometry(new THREE.PlaneGeometry(40, 40, 64, 64)),
        new THREE.LineBasicMaterial({ color: 0x00ff41, transparent: true, opacity: 0.3 })
      );
      grid.rotation.x = -Math.PI / 2;
      grid.position.z = -8;
      scene.add(grid);

      const nodeGeometry = new THREE.SphereGeometry(0.15, 16, 16);
      const nodeMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
      nodes = new THREE.Group();
      for (let i = 0; i < 80; i++) {
        const node = new THREE.Mesh(nodeGeometry, nodeMaterial);
        node.position.set(
          (Math.random() - 0.5) * 30,
          (Math.random() - 0.5) * 20,
          (Math.random() - 0.5) * 15 - 5
        );
        nodes.add(node);
      }
      scene.add(nodes);

      const ambient = new THREE.AmbientLight(0x00ff41, 0.4);
      scene.add(ambient);

      const animate = () => {
        animationId = requestAnimationFrame(animate);
        grid.rotation.z += 0.001;
        nodes.rotation.y += 0.002;
        nodes.rotation.x += 0.001;
        renderer.render(scene, camera);
      };
      animate();

      const onResize = () => {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
      };
      window.addEventListener('resize', onResize);
    }

    return () => {
      if (matrixInterval) clearInterval(matrixInterval);
      if (animationId) cancelAnimationFrame(animationId);
      if (renderer) renderer.dispose();
    };
  }, [preloaderActive]);

  const defaultOptions = (yLabel = '') => ({
    responsive: true,
    maintainAspectRatio: false,
    interaction: { mode: 'index', intersect: false },
    scales: {
      x: {
        type: 'time',
        time: { unit: 'day', tooltipFormat: 'MMM dd' },
        grid: { color: 'rgba(0, 255, 0, 0.1)' },
        ticks: { color: '#0f0' }
      },
      y: {
        grid: { color: 'rgba(0, 255, 0, 0.1)' },
        ticks: { color: '#0f0' },
        title: { display: !!yLabel, text: yLabel, color: '#0f0' }
      }
    },
    plugins: {
      legend: { labels: { color: '#0f0' } },
      tooltip: {
        backgroundColor: 'rgba(0, 0, 0, 0.9)',
        titleColor: '#0f0',
        bodyColor: '#0f0',
        borderColor: '#0f0',
        borderWidth: 1
      }
    }
  });

    const initCharts = () => {
    const neon = '#0f0';
    const darkGreen = '#008800';
    const glowFill = 'rgba(0, 255, 0, 0.2)';

    // PRICE HISTORY (OHLC - High/Low/Close)
    if (canvasRefs.ohlc.current) {
      chartsRef.current.ohlc = new Chart(canvasRefs.ohlc.current.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'High',
              data: [],
              borderColor: neon,
              backgroundColor: glowFill,
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'Low',
              data: [],
              borderColor: darkGreen,
              backgroundColor: 'rgba(0, 136, 0, 0.1)',
              borderWidth: 2,
              tension: 0.3,
              pointRadius: 0,
              fill: false
            },
            {
              label: 'Close',
              data: [],
              borderColor: neon,
              backgroundColor: glowFill,
              borderWidth: 4,
              tension: 0.3,
              pointRadius: 0,
              fill: false
            }
          ]
        },
        options: defaultOptions('Price (USD)')
      });
    }

    // VOLUME HISTORY
    if (canvasRefs.volume.current) {
      chartsRef.current.volume = new Chart(canvasRefs.volume.current.getContext('2d'), {
        type: 'bar',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Volume',
              data: [],
              backgroundColor: 'rgba(0, 255, 0, 0.4)',
              borderColor: neon,
              borderWidth: 1
            }
          ]
        },
        options: {
          ...defaultOptions('Volume (USD)'),
          scales: {
            ...defaultOptions().scales,
            y: {
              ...defaultOptions().scales.y,
              ticks: {
                color: '#0f0',
                callback: function(value) {
                  return fmtUSD(value);
                }
              }
            }
          }
        }
      });
    }

    // TAKER BUY/SELL RATIO
    if (canvasRefs.buySell.current) {
      chartsRef.current.buySell = new Chart(canvasRefs.buySell.current.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Taker Buy/Sell Ratio',
              data: [],
              borderColor: neon,
              backgroundColor: glowFill,
              borderWidth: 4,
              tension: 0.3,
              pointRadius: 0,
              fill: true
            }
          ]
        },
        options: defaultOptions('Ratio')
      });
    }

    // FEAR & GREED INDEX
    if (canvasRefs.fg.current) {
      chartsRef.current.fg = new Chart(canvasRefs.fg.current.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Fear & Greed Index',
              data: [],
              borderColor: neon,
              backgroundColor: glowFill,
              borderWidth: 4,
              tension: 0.3,
              pointRadius: 0,
              fill: true
            }
          ]
        },
        options: defaultOptions('Index (0-100)')
      });
    }

    // FUNDING RATE HISTORY
    if (canvasRefs.funding.current) {
      chartsRef.current.funding = new Chart(canvasRefs.funding.current.getContext('2d'), {
        type: 'line',
        data: {
          labels: [],
          datasets: [
            {
              label: 'Funding Rate (%)',
              data: [],
              borderColor: neon,
              backgroundColor: glowFill,
              borderWidth: 4,
              tension: 0.3,
              pointRadius: 0,
              fill: true
            }
          ]
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

      let currentPrice = market?.market_data?.current_price?.usd ?? (ohlc?.[ohlc.length - 1]?.[4] ?? null);
      let priceChange24h = market?.market_data?.price_change_percentage_24h ?? null;
      if (priceChange24h === null && ohlc && ohlc.length >= 2) {
        const latest = ohlc[ohlc.length - 1][4];
        const prev = ohlc[ohlc.length - 2][4];
        priceChange24h = ((latest - prev) / prev) * 100;
      }
      const priceChange7d = market?.market_data?.price_change_percentage_7d ?? null;
      const volume24h = market?.market_data?.total_volume?.usd ?? null;
      const marketCap = market?.market_data?.market_cap?.usd ?? null;

      setPriceData({ price: currentPrice, change: priceChange24h });

      const fundingCurrent = metrics.funding?.current ?? null;
      const fgLast = fg?.[fg.length - 1]?.value ?? null;
      const takerLast = metrics.taker?.timeseries?.[metrics.taker.timeseries.length - 1]?.value ?? null;

      const tradingSignal = calculateSignal(priceChange24h, fundingCurrent, takerLast, fgLast);
      setSignal(tradingSignal);

      setCardData({
        openInterest: { value: metrics.oi },
        fundingRate: { value: fundingCurrent },
        longShort: { value: metrics.longShortRatio },
        topTraders: { value: metrics.topTradersRatio },
        fearGreed: { value: fgLast },
        volume24h: { value: volume24h },
        marketCap: { value: marketCap },
        priceChange7d: { value: priceChange7d }
      });

      // Render charts
      if (ohlc && chartsRef.current.ohlc) {
        const labels = ohlc.map(r => new Date(r[0]));
        chartsRef.current.ohlc.data.labels = labels;
        chartsRef.current.ohlc.data.datasets[0].data = ohlc.map(r => ({ x: new Date(r[0]), y: r[2] }));
        chartsRef.current.ohlc.data.datasets[1].data = ohlc.map(r => ({ x: new Date(r[0]), y: r[3] }));
        chartsRef.current.ohlc.data.datasets[2].data = ohlc.map(r => ({ x: new Date(r[0]), y: r[4] }));
        chartsRef.current.ohlc.update();
      }

      if (marketChart?.total_volumes && chartsRef.current.volume) {
        const vols = marketChart.total_volumes;
        chartsRef.current.volume.data.labels = vols.map(v => new Date(v[0]));
        chartsRef.current.volume.data.datasets[0].data = vols.map(v => v[1]);
        chartsRef.current.volume.update();
      }

      if (metrics.taker?.timeseries && chartsRef.current.buySell) {
        const data = metrics.taker.timeseries.map(s => ({ x: new Date(s.ts), y: s.value }));
        chartsRef.current.buySell.data.labels = data.map(d => d.x);
        chartsRef.current.buySell.data.datasets[0].data = data;
        chartsRef.current.buySell.update();
      }

      if (fg && chartsRef.current.fg) {
        const data = fg.map(s => ({ x: new Date(s.ts), y: s.value }));
        chartsRef.current.fg.data.labels = data.map(d => d.x);
        chartsRef.current.fg.data.datasets[0].data = data;
        chartsRef.current.fg.update();
      }

      if (metrics.funding?.timeseries && chartsRef.current.funding) {
        const data = metrics.funding.timeseries.map(s => ({ x: new Date(s.ts), y: (s.rate ?? 0) * 100 }));
        chartsRef.current.funding.data.labels = data.map(d => d.x);
        chartsRef.current.funding.data.datasets[0].data = data;
        chartsRef.current.funding.update();
      }
    } catch (err) {
      console.error('fetchAndRenderAll failed', err);
    } finally {
      setLoading(false);
    }
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
    if (!sig) return <Minus size={80} />;
    if (sig.includes('BUY')) return <ArrowUp size={80} />;
    if (sig.includes('SELL')) return <ArrowDown size={80} />;
    return <Minus size={80} />;
  };

  return (
    <div className="app-matrix">
      {preloaderActive && (
        <div className="preloader">
          <div className="loader-text glitch">KAIZEN-INDEX</div>
          <div className="progress-bar">
            <div className="progress-fill" style={{ width: `${progress}%` }} />
          </div>
          <div className="percent">{progress}%</div>
        </div>
      )}

      <canvas ref={matrixRef} className="matrix-rain" />
      <canvas ref={bgCanvasRef} className="bg-grid" />
      <div className="crt-overlay" />

      <div className={preloaderActive ? 'main-content hidden' : 'main-content'}>
        <div className="dashboard-container">
          <header className="header-matrix">
            <div className="logo-section">
              <div className="logo">
                <div className="logo-icon glitch-hover">
                  <img src="./logo.jpg" alt="KAIZEN-INDEX Logo" />
                </div>
                <div className="logo-text">
                  <h1 className="logo-title glitch">KAIZEN-INDEX</h1>
                  <p className="logo-subtitle">TOKEN ANALYSIS TERMINAL</p>
                </div>
              </div>
            </div>

            <div className="contract-display">
              <span className="ca-label">CA:</span>
              <button className="ca-copy-btn" onClick={handleCopyCA}>
                <span className="ca-value">{CONTRACT_ADDRESS}</span>
                <Copy size={16} />
                {copied && <span className="copied-feedback">COPIED</span>}
              </button>
            </div>

            <div className="controls-section">
                            <div className="token-selector">
                <button className="token-btn" onClick={() => setDropdownOpen(!dropdownOpen)}>
                  <span>{currentToken.symbol}</span>
                  <ChevronDown size={16} />
                </button>

                {dropdownOpen && (
                  <>
                    <div
                      className="dropdown-backdrop"
                      onClick={() => setDropdownOpen(false)}
                    />
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
                        
                        {!searching && displayTokens.length === 0 && searchQuery.length > 1 && (
                          <div className="dropdown-empty">No tokens found</div>
                        )}
                        
                        {!searching && displayTokens.map(token => (
                          <button
                            key={token.id}
                            className="dropdown-item"
                            onClick={() => {
                              setCurrentToken(token);
                              setDropdownOpen(false);
                              setSearchQuery('');
                              setSearchResults([]);
                            }}
                          >
                            <span className="token-symbol">{token.symbol}</span>
                            <span className="token-id">{token.name || token.id}</span>
                          </button>
                        ))}
                      </div>
                    </div>
                  </>
                )}
              </div>

              <div className="price-display">
                <div className="price">
                  {priceData.price ? `$${Number(priceData.price).toLocaleString(undefined, { maximumFractionDigits: 6 })}` : '--'}
                </div>
                {priceData.change != null && (
                  <div className={`price-change ${priceData.change >= 0 ? 'positive' : 'negative'}`}>
                    {priceData.change >= 0 ? <TrendingUp size={14} /> : <TrendingDown size={14} />}
                    {priceData.change >= 0 ? '+' : ''}{priceData.change.toFixed(2)}%
                  </div>
                )}
              </div>

              <button className="refresh-btn" onClick={() => fetchAndRenderAll(currentToken)} disabled={loading}>
                <RefreshCw size={18} className={loading ? 'spinning' : ''} />
              </button>
            </div>
          </header>

          <main className="dashboard">
            {signal && (
              <div className={`signal-holo ${getSignalColor(signal.signal)}`}>
                <div className="signal-glow" />
                <div className="signal-icon">{getSignalIcon(signal.signal)}</div>
                <div className="signal-content">
                  <div className="signal-label">TRADING SIGNAL</div>
                  <div className="signal-value glitch">{signal.signal}</div>
                  <div className="signal-score">SCORE: {signal.score}</div>
                  <div className="signal-reasons">
                    {signal.signals.map((s, i) => (
                      <div key={i} className="signal-reason"> {s}</div>
                    ))}
                  </div>
                </div>
              </div>
            )}

            <div className="metrics-grid">
              {CARD_DEFS.map(card => {
                const data = cardData[card.key] || {};
                return (
                  <div key={card.key} className="metric-holo">
                    <div className="holo-border" />
                    <div className="card-header">
                      <span className="card-label">{card.label}</span>
                    </div>
                    <div className="card-value">{card.fmt(data.value)}</div>
                    <div className="card-unit">{card.unit}</div>
                  </div>
                );
              })}
            </div>

            <div className="charts-grid">
              <div className="chart-holo">
                <div className="holo-border" />
                <h3 className="chart-title">{currentToken.symbol}/USDT PRICE HISTORY</h3>
                <div className="chart-wrapper"><canvas ref={canvasRefs.ohlc}></canvas></div>
              </div>
              <div className="chart-holo">
                <div className="holo-border" />
                <h3 className="chart-title">VOLUME HISTORY</h3>
                <div className="chart-wrapper"><canvas ref={canvasRefs.volume}></canvas></div>
              </div>
              <div className="chart-holo">
                <div className="holo-border" />
                <h3 className="chart-title">TAKER BUY/SELL RATIO</h3>
                <div className="chart-wrapper"><canvas ref={canvasRefs.buySell}></canvas></div>
              </div>
              <div className="chart-holo">
                <div className="holo-border" />
                <h3 className="chart-title">FEAR & GREED INDEX</h3>
                <div className="chart-wrapper"><canvas ref={canvasRefs.fg}></canvas></div>
              </div>
              <div className="chart-holo">
                <div className="holo-border" />
                <h3 className="chart-title">FUNDING RATE HISTORY</h3>
                <div className="chart-wrapper"><canvas ref={canvasRefs.funding}></canvas></div>
              </div>
            </div>
          </main>
        </div>
      </div>
    </div>
  );
}

export default App;