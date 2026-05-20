import { useState, useEffect, useRef } from 'react';
import { io, Socket } from 'socket.io-client';
import {
  QrCode,
  Wifi,
  WifiOff,
  Keyboard,
  Volume2,
  VolumeX,
  Trash2,
  Phone,
  Monitor,
  CheckCircle,
  Copy,
  Layers,
  FileSpreadsheet,
  FileJson,
  Play,
  RotateCcw,
  Sparkles,
  Search
} from 'lucide-react';

interface ServerInfo {
  ips: string[];
  primaryIp: string;
  port: number;
  connectionUrl: string;
  qrCodeDataUrl: string;
  wedgeMode: boolean;
}

interface Device {
  id: string;
  type: 'scanner' | 'dashboard';
  name: string;
  connectedAt: string;
}

interface ScanRecord {
  code: string;
  format: string;
  timestamp: string;
  scannerId: string;
  scannerName: string;
}

// Sound generator using Web Audio API (100% offline, zero assets)
const playScannerBeep = () => {
  try {
    const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
    const oscillator = audioCtx.createOscillator();
    const gainNode = audioCtx.createGain();

    oscillator.connect(gainNode);
    gainNode.connect(audioCtx.destination);

    oscillator.type = 'sine';
    oscillator.frequency.setValueAtTime(1200, audioCtx.currentTime); // High pitch beep
    gainNode.gain.setValueAtTime(0.08, audioCtx.currentTime);
    gainNode.gain.exponentialRampToValueAtTime(0.01, audioCtx.currentTime + 0.15);

    oscillator.start(audioCtx.currentTime);
    oscillator.stop(audioCtx.currentTime + 0.15);
  } catch (e) {
    console.warn('Audio Context beep failed', e);
  }
};

export default function App() {
  const [serverInfo, setServerInfo] = useState<ServerInfo | null>(null);
  const [devices, setDevices] = useState<Device[]>([]);
  const [history, setHistory] = useState<ScanRecord[]>([]);
  const [searchQuery, setSearchQuery] = useState('');
  
  // Dashboard Toggles
  const [wedgeMode, setWedgeMode] = useState(true);
  const [soundEnabled, setSoundEnabled] = useState(true);
  
  // Status states
  const [socketConnected, setSocketConnected] = useState(false);
  const [testText, setTestText] = useState('TEST-123456');
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [toastMsg, setToastMsg] = useState<string | null>(null);

  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    // 1. Fetch server connection info
    fetchServerInfo();

    // Determine target API socket address
    const host = window.location.hostname;
    const socketUrl = window.location.port === '5173' ? `http://${host}:5000` : '/';

    // 2. Establish Socket Connection
    const socket = io(socketUrl, {
      transports: ['websocket'],
      reconnectionAttempts: 10,
    });
    socketRef.current = socket;

    socket.on('connect', () => {
      setSocketConnected(true);
      // Register this socket as a dashboard client
      socket.emit('register', { type: 'dashboard', name: 'Web Desktop Admin' });
    });

    socket.on('disconnect', () => {
      setSocketConnected(false);
    });

    socket.on('devices-list', (deviceList: Device[]) => {
      setDevices(deviceList);
    });

    socket.on('barcode-scanned', (scan: ScanRecord) => {
      setHistory(prev => [scan, ...prev]);
      showToast(`Scanned: ${scan.code}`);
      if (soundEnabled) {
        playScannerBeep();
      }
    });

    socket.on('settings-changed', (data: { wedgeMode: boolean }) => {
      setWedgeMode(data.wedgeMode);
    });

    return () => {
      socket.disconnect();
    };
  }, [soundEnabled]);

  const fetchServerInfo = async () => {
    try {
      const host = window.location.hostname;
      const apiEndpoint = window.location.port === '5173' ? `http://${host}:5000/api/info` : '/api/info';
      const res = await fetch(apiEndpoint);
      const data = await res.json();
      setServerInfo(data);
      setWedgeMode(data.wedgeMode);
    } catch (err) {
      console.error('Failed to fetch server info:', err);
    }
  };

  const toggleWedgeMode = async () => {
    const nextVal = !wedgeMode;
    setWedgeMode(nextVal);
    try {
      const host = window.location.hostname;
      const apiEndpoint = window.location.port === '5173' ? `http://${host}:5000/api/settings` : '/api/settings';
      await fetch(apiEndpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ wedge: nextVal }),
      });
      showToast(`Wedge mode ${nextVal ? 'ENABLED' : 'DISABLED'}`);
    } catch (err) {
      console.error('Failed to update wedge mode:', err);
    }
  };

  const triggerTestWedge = () => {
    if (socketRef.current) {
      socketRef.current.emit('test-wedge', { text: testText });
      showToast(`Wedge Test sent: "${testText}"`);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const showToast = (msg: string) => {
    setToastMsg(msg);
    setTimeout(() => setToastMsg(null), 3000);
  };

  const clearHistoryLog = () => {
    if (confirm('Are you sure you want to clear scan history from dashboard?')) {
      setHistory([]);
      showToast('Dashboard scan history cleared');
    }
  };

  const exportCSV = () => {
    if (history.length === 0) return;
    const headers = 'Barcode,Format,Timestamp,Scanner\n';
    const rows = history
      .map(
        item =>
          `"${item.code.replace(/"/g, '""')}","${item.format}","${new Date(
            item.timestamp
          ).toLocaleString()}","${item.scannerName}"`
      )
      .join('\n');
    const blob = new Blob([headers + rows], { type: 'text/csv;charset=utf-8;' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `scans_${new Date().toISOString().split('T')[0]}.csv`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  const exportJSON = () => {
    if (history.length === 0) return;
    const blob = new Blob([JSON.stringify(history, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.setAttribute('href', url);
    link.setAttribute('download', `scans_${new Date().toISOString().split('T')[0]}.json`);
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);
  };

  // Filter history based on search
  const filteredHistory = history.filter(
    item =>
      item.code.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.format.toLowerCase().includes(searchQuery.toLowerCase()) ||
      item.scannerName.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Grouped stats
  const totalScans = history.length;
  const uniqueScansCount = new Set(history.map(item => item.code)).size;
  const activeScanners = devices.filter(d => d.type === 'scanner').length;

  return (
    <div style={styles.appContainer}>
      {/* Toast Notification */}
      {toastMsg && <div style={styles.toast}>{toastMsg}</div>}

      {/* Main Header */}
      <header style={styles.header}>
        <div style={styles.brand}>
          <div style={styles.logoCircle}>
            <Wifi size={24} color="#6366f1" />
          </div>
          <div>
            <h1 style={styles.title}>Antigravity Scanner Wedge</h1>
            <p style={styles.subtitle}>Real-time Local Network Barcode Transmission System</p>
          </div>
        </div>

        <div style={styles.networkStatusContainer}>
          <div style={styles.statusBadge(socketConnected)}>
            {socketConnected ? (
              <>
                <Wifi size={14} style={{ marginRight: 6 }} />
                <span>Server Connected</span>
              </>
            ) : (
              <>
                <WifiOff size={14} style={{ marginRight: 6 }} />
                <span>Connecting...</span>
              </>
            )}
          </div>
          <div style={styles.scannersCountBadge}>
            <Phone size={14} style={{ marginRight: 6 }} />
            <span>{activeScanners} Scanners Active</span>
          </div>
        </div>
      </header>

      {/* Main Layout Grid */}
      <main style={styles.grid}>
        {/* Left Side: Server pairing QR & Controls */}
        <section style={styles.leftCol}>
          {/* Server Info Card */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              <QrCode size={18} style={{ marginRight: 8, color: '#8b5cf6' }} />
              Scanner Pairing
            </h2>
            <p style={styles.cardDesc}>
              Make sure your phone is connected to the same Wi-Fi network as this PC, then scan the pairing code.
            </p>

            {serverInfo ? (
              <div style={styles.qrWrapper}>
                <div style={styles.qrFrame}>
                  <img src={serverInfo.qrCodeDataUrl} alt="Pairing QR Code" style={styles.qrImage} />
                  <div style={styles.qrScanLine} />
                </div>
                <div style={styles.connectionDetails}>
                  <span style={styles.connLabel}>Primary Server Address:</span>
                  <code style={styles.connCode}>{serverInfo.connectionUrl}</code>
                  
                  <div style={styles.ipList}>
                    <span style={styles.ipListTitle}>Available Network Interfaces:</span>
                    {serverInfo.ips.map(ip => (
                      <div key={ip} style={styles.ipBadge}>
                        {ip}
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            ) : (
              <div style={styles.loader}>
                <RotateCcw className="animate-spin" size={24} style={{ color: '#6366f1', marginBottom: 8 }} />
                <span>Fetching Server Details...</span>
              </div>
            )}
          </div>

          {/* Wedge & Sound Configuration */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              <Keyboard size={18} style={{ marginRight: 8, color: '#6366f1' }} />
              Dashboard Settings
            </h2>

            {/* Toggle Keyboard Wedge */}
            <div style={styles.settingRow}>
              <div style={styles.settingText}>
                <span style={styles.settingLabel}>Keyboard Wedge Mode</span>
                <span style={styles.settingDesc}>
                  Instantly type scanned barcodes into your active cursor field.
                </span>
              </div>
              <button 
                onClick={toggleWedgeMode} 
                style={styles.toggleBtn(wedgeMode)}
              >
                {wedgeMode ? 'ENABLED' : 'DISABLED'}
              </button>
            </div>

            {/* Toggle sound beep */}
            <div style={styles.settingRow}>
              <div style={styles.settingText}>
                <span style={styles.settingLabel}>Audio Notification</span>
                <span style={styles.settingDesc}>
                  Play a beep sound on the PC speaker when a scan is received.
                </span>
              </div>
              <button 
                onClick={() => setSoundEnabled(!soundEnabled)} 
                style={styles.toggleBtn(soundEnabled)}
              >
                {soundEnabled ? (
                  <Volume2 size={16} />
                ) : (
                  <VolumeX size={16} />
                )}
                <span style={{ marginLeft: 6 }}>{soundEnabled ? 'ON' : 'OFF'}</span>
              </button>
            </div>
          </div>

          {/* Keyboard Wedge Tester */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              <Sparkles size={18} style={{ marginRight: 8, color: '#06b6d4' }} />
              Keystroke Simulator Test
            </h2>
            <p style={styles.cardDesc}>
              Test if the keyboard wedge typing works. Clicking run will type the text below and press Enter after 2 seconds. Focus your cursor in another input (like a text editor) during the delay!
            </p>
            <div style={styles.testForm}>
              <input
                type="text"
                value={testText}
                onChange={e => setTestText(e.target.value)}
                style={styles.input}
                placeholder="Enter test text..."
              />
              <button onClick={triggerTestWedge} style={styles.runBtn}>
                <Play size={14} style={{ marginRight: 6 }} />
                Simulate
              </button>
            </div>
          </div>

          {/* Connected Device Manager */}
          <div style={styles.card}>
            <h2 style={styles.cardTitle}>
              <Layers size={18} style={{ marginRight: 8, color: '#10b981' }} />
              Active Connections ({devices.length})
            </h2>
            <div style={styles.devicesList}>
              {devices.length === 0 ? (
                <span style={styles.noDevices}>No devices connected yet.</span>
              ) : (
                devices.map(dev => (
                  <div key={dev.id} style={styles.deviceItem}>
                    <div style={styles.deviceMeta}>
                      {dev.type === 'scanner' ? (
                        <Phone size={14} style={{ color: '#10b981', marginRight: 8 }} />
                      ) : (
                        <Monitor size={14} style={{ color: '#6366f1', marginRight: 8 }} />
                      )}
                      <div>
                        <span style={styles.deviceName}>{dev.name}</span>
                        <span style={styles.deviceId}>{dev.id}</span>
                      </div>
                    </div>
                    <span style={styles.deviceConnectedTime}>
                      {new Date(dev.connectedAt).toLocaleTimeString()}
                    </span>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>

        {/* Right Side: Live Feeds & Metrics */}
        <section style={styles.rightCol}>
          {/* Stats Bar */}
          <div style={styles.statsGrid}>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Total Scanned</span>
              <span style={styles.statVal}>{totalScans}</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Unique Barcodes</span>
              <span style={styles.statVal}>{uniqueScansCount}</span>
            </div>
            <div style={styles.statCard}>
              <span style={styles.statLabel}>Active Scanners</span>
              <span style={styles.statVal}>{activeScanners}</span>
            </div>
          </div>

          {/* Scan Feed Section */}
          <div style={styles.feedCard}>
            <div style={styles.feedHeader}>
              <h2 style={styles.cardTitle}>
                <Monitor size={18} style={{ marginRight: 8, color: '#6366f1' }} />
                Live Barcode Scanner Stream
              </h2>
              
              {/* Export and Clear controls */}
              <div style={styles.feedActions}>
                <button 
                  onClick={exportCSV} 
                  disabled={history.length === 0} 
                  style={styles.actionBtn}
                >
                  <FileSpreadsheet size={14} style={{ marginRight: 6 }} />
                  CSV
                </button>
                <button 
                  onClick={exportJSON} 
                  disabled={history.length === 0} 
                  style={styles.actionBtn}
                >
                  <FileJson size={14} style={{ marginRight: 6 }} />
                  JSON
                </button>
                <button 
                  onClick={clearHistoryLog} 
                  disabled={history.length === 0} 
                  style={styles.clearBtn}
                >
                  <Trash2 size={14} style={{ marginRight: 6 }} />
                  Clear Log
                </button>
              </div>
            </div>

            {/* Search filter input */}
            <div style={styles.searchBar}>
              <Search size={16} style={{ color: '#64748b', marginRight: 8 }} />
              <input
                type="text"
                placeholder="Search scans by code, format, or scanner..."
                value={searchQuery}
                onChange={e => setSearchQuery(e.target.value)}
                style={styles.searchInput}
              />
            </div>

            {/* Live scans list */}
            <div style={styles.feedList}>
              {filteredHistory.length === 0 ? (
                <div style={styles.emptyFeed}>
                  <div style={styles.radarWaveContainer}>
                    <div style={styles.radarPulse} />
                    <Wifi size={40} style={{ color: '#334155' }} />
                  </div>
                  <h3 style={styles.emptyFeedTitle}>Awaiting Transmissions</h3>
                  <p style={styles.emptyFeedDesc}>
                    When a paired mobile scanner scans a barcode, it will stream here in real-time.
                  </p>
                </div>
              ) : (
                filteredHistory.map((item, idx) => (
                  <div key={idx} style={styles.feedItem} className="animate-slide-in">
                    <div style={styles.feedItemMain}>
                      <span style={styles.feedBarcode}>{item.code}</span>
                      <div style={styles.feedMeta}>
                        <span style={styles.formatTag}>{item.format}</span>
                        <span style={styles.deviceTag}>
                          <Phone size={10} style={{ marginRight: 4 }} />
                          {item.scannerName}
                        </span>
                        <span style={styles.feedTime}>
                          {new Date(item.timestamp).toLocaleTimeString()}
                        </span>
                      </div>
                    </div>

                    <button
                      onClick={() => copyToClipboard(item.code, idx)}
                      style={styles.copyBtn(copiedIndex === idx)}
                    >
                      {copiedIndex === idx ? (
                        <>
                          <CheckCircle size={14} style={{ color: '#10b981', marginRight: 4 }} />
                          <span>Copied</span>
                        </>
                      ) : (
                        <>
                          <Copy size={14} style={{ marginRight: 4 }} />
                          <span>Copy</span>
                        </>
                      )}
                    </button>
                  </div>
                ))
              )}
            </div>
          </div>
        </section>
      </main>
    </div>
  );
}

const styles = {
  appContainer: {
    maxWidth: '1280px',
    margin: '0 auto',
    padding: '24px',
    minHeight: '100vh',
    display: 'flex',
    flexDirection: 'column' as const,
  },
  toast: {
    position: 'fixed' as const,
    bottom: '24px',
    right: '24px',
    backgroundColor: '#10b981',
    color: '#ffffff',
    padding: '12px 24px',
    borderRadius: '8px',
    fontWeight: 'bold',
    boxShadow: '0 10px 15px -3px rgba(0, 0, 0, 0.3)',
    zIndex: 9999,
    animation: 'slideIn 0.2s ease',
  },
  header: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingBottom: '20px',
    marginBottom: '24px',
    borderBottom: '1px solid var(--border-color)',
    flexWrap: 'wrap' as const,
    gap: '16px',
  },
  brand: {
    display: 'flex',
    alignItems: 'center',
    gap: '16px',
  },
  logoCircle: {
    width: '48px',
    height: '48px',
    borderRadius: '12px',
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    border: '1px solid rgba(99, 102, 241, 0.3)',
  },
  title: {
    margin: 0,
    fontSize: '24px',
    fontWeight: 700,
    letterSpacing: '-0.5px',
    color: '#ffffff',
  },
  subtitle: {
    margin: '2px 0 0 0',
    fontSize: '14px',
    color: 'var(--text-secondary)',
  },
  networkStatusContainer: {
    display: 'flex',
    gap: '12px',
  },
  statusBadge: (connected: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 600,
    backgroundColor: connected ? 'rgba(16, 185, 129, 0.15)' : 'rgba(244, 63, 94, 0.15)',
    color: connected ? '#10b981' : '#f43f5e',
    border: connected ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid rgba(244, 63, 94, 0.3)',
  }),
  scannersCountBadge: {
    display: 'flex',
    alignItems: 'center',
    padding: '6px 14px',
    borderRadius: '20px',
    fontSize: '13px',
    fontWeight: 600,
    backgroundColor: 'rgba(99, 102, 241, 0.15)',
    color: '#818cf8',
    border: '1px solid rgba(99, 102, 241, 0.3)',
  },
  grid: {
    display: 'grid',
    gridTemplateColumns: '400px 1fr',
    gap: '24px',
    flex: 1,
    alignItems: 'start',
    '@media (max-width: 1024px)': {
      gridTemplateColumns: '1fr',
    },
  },
  leftCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '24px',
  },
  rightCol: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '24px',
  },
  card: {
    backgroundColor: 'var(--bg-card)',
    borderRadius: '16px',
    padding: '20px',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-glow)',
    backdropFilter: 'blur(8px)',
  },
  cardTitle: {
    margin: '0 0 8px 0',
    fontSize: '16px',
    fontWeight: 600,
    color: '#ffffff',
    display: 'flex',
    alignItems: 'center',
  },
  cardDesc: {
    margin: '0 0 16px 0',
    fontSize: '13px',
    color: 'var(--text-secondary)',
    lineHeight: '18px',
  },
  qrWrapper: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    gap: '16px',
    marginTop: '16px',
  },
  qrFrame: {
    width: '180px',
    height: '180px',
    backgroundColor: '#ffffff',
    padding: '8px',
    borderRadius: '12px',
    position: 'relative' as const,
    overflow: 'hidden',
  },
  qrImage: {
    width: '100%',
    height: '100%',
    display: 'block',
  },
  qrScanLine: {
    position: 'absolute' as const,
    width: '100%',
    height: '2px',
    backgroundColor: '#ef4444',
    left: 0,
    animation: 'scanLineAnim 3s linear infinite',
  },
  connectionDetails: {
    width: '100%',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  connLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  connCode: {
    padding: '8px 12px',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    borderRadius: '8px',
    border: '1px solid var(--border-color)',
    fontSize: '14px',
    color: '#38bdf8',
    wordBreak: 'break-all' as const,
    fontFamily: 'var(--font-mono)',
  },
  ipList: {
    marginTop: '10px',
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  ipListTitle: {
    fontSize: '11px',
    color: 'var(--text-muted)',
    fontWeight: 700,
  },
  ipBadge: {
    fontSize: '12px',
    color: 'var(--text-secondary)',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    padding: '4px 10px',
    borderRadius: '6px',
    border: '1px solid rgba(51, 65, 85, 0.4)',
  },
  loader: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    padding: '30px 0',
    color: 'var(--text-secondary)',
    fontSize: '13px',
  },
  settingRow: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: '12px 0',
    borderBottom: '1px solid rgba(51, 65, 85, 0.4)',
  },
  settingText: {
    flex: 1,
    paddingRight: '12px',
  },
  settingLabel: {
    display: 'block',
    fontSize: '14px',
    fontWeight: 600,
    color: '#ffffff',
  },
  settingDesc: {
    display: 'block',
    fontSize: '11px',
    color: 'var(--text-muted)',
    marginTop: '2px',
    lineHeight: '14px',
  },
  toggleBtn: (active: boolean) => ({
    padding: '8px 14px',
    borderRadius: '8px',
    border: active ? '1px solid rgba(99, 102, 241, 0.4)' : '1px solid var(--border-color)',
    backgroundColor: active ? '#6366f1' : 'transparent',
    color: active ? '#ffffff' : 'var(--text-secondary)',
    fontWeight: 600,
    fontSize: '12px',
    cursor: 'pointer',
    transition: 'all 0.2s ease',
    display: 'flex',
    alignItems: 'center',
    justifyContent: 'center',
  }),
  testForm: {
    display: 'flex',
    gap: '8px',
  },
  input: {
    flex: 1,
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid var(--border-color)',
    color: '#ffffff',
    borderRadius: '8px',
    padding: '8px 12px',
    fontSize: '13px',
  },
  runBtn: {
    backgroundColor: '#06b6d4',
    border: 'none',
    color: '#ffffff',
    fontWeight: 600,
    padding: '8px 14px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
  },
  devicesList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '8px',
  },
  noDevices: {
    color: 'var(--text-muted)',
    fontSize: '12px',
    textAlign: 'center' as const,
    padding: '10px 0',
  },
  deviceItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    padding: '10px 12px',
    borderRadius: '8px',
    border: '1px solid rgba(51, 65, 85, 0.4)',
  },
  deviceMeta: {
    display: 'flex',
    alignItems: 'center',
  },
  deviceName: {
    display: 'block',
    fontSize: '13px',
    fontWeight: 600,
    color: '#f8fafc',
  },
  deviceId: {
    display: 'block',
    fontSize: '10px',
    color: 'var(--text-muted)',
    fontFamily: 'var(--font-mono)',
  },
  deviceConnectedTime: {
    fontSize: '11px',
    color: 'var(--text-muted)',
  },
  statsGrid: {
    display: 'grid',
    gridTemplateColumns: 'repeat(3, 1fr)',
    gap: '16px',
  },
  statCard: {
    backgroundColor: 'var(--bg-card)',
    border: '1px solid var(--border-color)',
    borderRadius: '16px',
    padding: '16px 20px',
    display: 'flex',
    flexDirection: 'column' as const,
    boxShadow: 'var(--shadow-glow)',
  },
  statLabel: {
    fontSize: '12px',
    color: 'var(--text-muted)',
    fontWeight: 600,
  },
  statVal: {
    fontSize: '28px',
    fontWeight: 800,
    color: '#ffffff',
    marginTop: '4px',
  },
  feedCard: {
    backgroundColor: 'var(--bg-card)',
    borderRadius: '16px',
    padding: '24px',
    border: '1px solid var(--border-color)',
    boxShadow: 'var(--shadow-glow)',
    display: 'flex',
    flexDirection: 'column' as const,
    flex: 1,
    minHeight: '480px',
  },
  feedHeader: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: '16px',
    flexWrap: 'wrap' as const,
    gap: '12px',
  },
  feedActions: {
    display: 'flex',
    gap: '8px',
  },
  actionBtn: {
    backgroundColor: 'rgba(51, 65, 85, 0.4)',
    border: '1px solid var(--border-color)',
    color: 'var(--text-secondary)',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.2s ease',
    ':disabled': {
      opacity: 0.5,
      cursor: 'not-allowed',
    },
  },
  clearBtn: {
    backgroundColor: 'rgba(244, 63, 94, 0.1)',
    border: '1px solid rgba(244, 63, 94, 0.3)',
    color: '#f43f5e',
    fontWeight: 600,
    padding: '6px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    cursor: 'pointer',
    display: 'flex',
    alignItems: 'center',
    transition: 'all 0.2s ease',
  },
  searchBar: {
    display: 'flex',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.6)',
    border: '1px solid var(--border-color)',
    borderRadius: '8px',
    padding: '8px 12px',
    marginBottom: '16px',
  },
  searchInput: {
    flex: 1,
    backgroundColor: 'transparent',
    border: 'none',
    color: '#ffffff',
    fontSize: '13px',
    outline: 'none',
  },
  feedList: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '10px',
    maxHeight: '520px',
    overflowY: 'auto' as const,
    flex: 1,
  },
  emptyFeed: {
    display: 'flex',
    flexDirection: 'column' as const,
    alignItems: 'center',
    justifyContent: 'center',
    flex: 1,
    padding: '40px 0',
  },
  radarWaveContainer: {
    position: 'relative' as const,
    width: '80px',
    height: '80px',
    display: 'flex',
    justifyContent: 'center',
    alignItems: 'center',
    marginBottom: '16px',
  },
  radarPulse: {
    position: 'absolute' as const,
    width: '100%',
    height: '100%',
    borderRadius: '50%',
    border: '1px solid rgba(99, 102, 241, 0.2)',
    animation: 'pulseGlow 2s infinite',
  },
  emptyFeedTitle: {
    margin: 0,
    fontSize: '16px',
    fontWeight: 600,
    color: '#f8fafc',
  },
  emptyFeedDesc: {
    margin: '4px 0 0 0',
    fontSize: '12px',
    color: 'var(--text-muted)',
    textAlign: 'center' as const,
    maxWidth: '280px',
  },
  feedItem: {
    display: 'flex',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: 'rgba(15, 23, 42, 0.4)',
    border: '1px solid var(--border-color)',
    borderRadius: '12px',
    padding: '12px 16px',
    transition: 'all 0.2s ease',
  },
  feedItemMain: {
    display: 'flex',
    flexDirection: 'column' as const,
    gap: '6px',
  },
  feedBarcode: {
    fontSize: '18px',
    fontWeight: 700,
    color: '#ffffff',
    fontFamily: 'var(--font-mono)',
    letterSpacing: '0.5px',
  },
  feedMeta: {
    display: 'flex',
    alignItems: 'center',
    gap: '8px',
    flexWrap: 'wrap' as const,
  },
  formatTag: {
    fontSize: '10px',
    fontWeight: 700,
    backgroundColor: 'rgba(139, 92, 246, 0.15)',
    color: '#c084fc',
    padding: '2px 8px',
    borderRadius: '4px',
    border: '1px solid rgba(139, 92, 246, 0.3)',
  },
  deviceTag: {
    fontSize: '10px',
    fontWeight: 600,
    color: 'var(--text-secondary)',
    display: 'flex',
    alignItems: 'center',
  },
  feedTime: {
    fontSize: '10px',
    color: 'var(--text-muted)',
  },
  copyBtn: (copied: boolean) => ({
    display: 'flex',
    alignItems: 'center',
    backgroundColor: copied ? 'rgba(16, 185, 129, 0.1)' : 'rgba(51, 65, 85, 0.3)',
    border: copied ? '1px solid rgba(16, 185, 129, 0.3)' : '1px solid var(--border-color)',
    color: copied ? '#10b981' : 'var(--text-secondary)',
    padding: '6px 12px',
    borderRadius: '8px',
    fontSize: '12px',
    fontWeight: 600,
    cursor: 'pointer',
    transition: 'all 0.2s ease',
  }),
};
