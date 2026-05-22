import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  TextInput,
  ScrollView,
  ActivityIndicator,
  Alert,
  Vibration,
  Platform
} from 'react-native';
import { StatusBar } from 'expo-status-bar';
import { CameraView, useCameraPermissions } from 'expo-camera';
import { Audio } from 'expo-av';
import * as Haptics from 'expo-haptics';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { io } from 'socket.io-client';

// ─────────────────────────────────────────────────────────────────────────────
// IMPORTANT: NEVER use localhost / 127.0.0.1 / 0.0.0.0 here.
// In a compiled APK, those point to the phone itself, NOT the PC server.
// The user enters the PC LAN IP (e.g. 192.168.1.32) at pairing time,
// which gets stored and reused on every subsequent launch.
// ─────────────────────────────────────────────────────────────────────────────

const STORAGE_KEYS = {
  SERVER_CONFIG: '@server_config',
  DUPLICATE_DELAY: '@duplicate_delay',
  SOUND_ENABLED: '@sound_enabled',
  VIBRATION_ENABLED: '@vibration_enabled',
  SCAN_HISTORY: '@scan_history',
  INVENTORY_MODE: '@inventory_mode',
};

// Connection retry config (exponential backoff)
const RECONNECT_BASE_MS   = 2000;  // first retry after 2 s
const RECONNECT_MAX_MS    = 30000; // cap at 30 s
const RECONNECT_MAX_TRIES = 15;    // give up after this many attempts

export default function App() {
  const [permission, requestPermission] = useCameraPermissions();
  
  // Server Config
  const [serverIp, setServerIp]     = useState('');
  const [serverPort, setServerPort] = useState('5000');
  const [isConfigured, setIsConfigured] = useState(false);
  const [isConnected, setIsConnected]   = useState(false);
  const [isTesting, setIsTesting]       = useState(false);  // connection test in progress
  const [reconnectAttempt, setReconnectAttempt] = useState(0);

  // Scan settings
  const [soundEnabled, setSoundEnabled]         = useState(true);
  const [vibrationEnabled, setVibrationEnabled] = useState(true);
  const [duplicateDelay, setDuplicateDelay]     = useState(1500);
  const [inventoryMode, setInventoryMode]       = useState(false);
  const [torchEnabled, setTorchEnabled]         = useState(false);

  // App State
  const [scanningActive, setScanningActive] = useState(true);
  const [pairingMode, setPairingMode]       = useState(false);
  const [history, setHistory]               = useState([]);
  const [statusMessage, setStatusMessage]   = useState('Enter PC details or scan Pairing QR Code');

  // Offline scan queue – flushes automatically once connection is restored
  const offlineQueueRef   = useRef([]);
  const socketRef         = useRef(null);
  const reconnectTimerRef = useRef(null);
  const reconnectCountRef = useRef(0);
  const soundObjectRef    = useRef(new Audio.Sound());
  const lastScanTimesRef  = useRef({});

  // Load configuration and history on startup
  useEffect(() => {
    loadSettings();
    loadSound();
    return () => {
      clearTimeout(reconnectTimerRef.current);
      if (socketRef.current) socketRef.current.disconnect();
      soundObjectRef.current.unloadAsync().catch(() => {});
    };
  }, []);

  // Set up WebSocket connection when configuration changes
  useEffect(() => {
    if (isConfigured && serverIp && serverPort) {
      reconnectCountRef.current = 0;
      connectToPC();
    }
  }, [isConfigured, serverIp, serverPort]);

  // Load sound effect
  const loadSound = async () => {
    try {
      await soundObjectRef.current.loadAsync(require('./assets/beep.mp3'));
    } catch (error) {
      console.warn("Could not load sound asset:", error);
    }
  };

  // Play successful scan alert
  const playFeedback = async () => {
    if (vibrationEnabled) {
      if (Platform.OS !== 'web') {
        Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {
          Vibration.vibrate(100);
        });
      } else {
        Vibration.vibrate(100);
      }
    }
    if (soundEnabled) {
      try {
        await soundObjectRef.current.replayAsync();
      } catch (err) {
        // Fallback tone
        console.warn("Sound playback error:", err);
      }
    }
  };

  // Load states from local storage
  const loadSettings = async () => {
    try {
      const configJson = await AsyncStorage.getItem(STORAGE_KEYS.SERVER_CONFIG);
      if (configJson) {
        const { ip, port } = JSON.parse(configJson);
        setServerIp(ip);
        setServerPort(port);
        setIsConfigured(true);
      }
      
      const delay = await AsyncStorage.getItem(STORAGE_KEYS.DUPLICATE_DELAY);
      if (delay) setDuplicateDelay(parseInt(delay, 10));

      const sound = await AsyncStorage.getItem(STORAGE_KEYS.SOUND_ENABLED);
      if (sound !== null) setSoundEnabled(sound === 'true');

      const vibration = await AsyncStorage.getItem(STORAGE_KEYS.VIBRATION_ENABLED);
      if (vibration !== null) setVibrationEnabled(vibration === 'true');

      const invMode = await AsyncStorage.getItem(STORAGE_KEYS.INVENTORY_MODE);
      if (invMode !== null) setInventoryMode(invMode === 'true');

      const savedHistory = await AsyncStorage.getItem(STORAGE_KEYS.SCAN_HISTORY);
      if (savedHistory) setHistory(JSON.parse(savedHistory));
    } catch (err) {
      console.error('Failed to load settings from storage:', err);
    }
  };

  // Save specific settings to local storage
  const saveSetting = async (key, val) => {
    try {
      await AsyncStorage.setItem(key, String(val));
    } catch (err) {
      console.error(`Failed to save setting ${key}:`, err);
    }
  };

  // ──────────────────────────────────────────────────────────────────────────
  // connectToPC  –  builds the LAN URI from the user-supplied IP (never
  // localhost/127.0.0.1) and creates a Socket.IO socket with:
  //   • WebSocket-first transport
  //   • Manual exponential backoff (we manage retries ourselves so the UI
  //     can show attempt counts and a proper status message)
  //   • Offline-queue flush on reconnect
  // ──────────────────────────────────────────────────────────────────────────
  const connectToPC = useCallback(() => {
    clearTimeout(reconnectTimerRef.current);

    // Guard: we must have a real LAN IP entered by the user.
    // NEVER fall back to localhost – that means the phone itself in a prod APK.
    if (!serverIp || serverIp.trim() === '') {
      console.warn('[Socket] No server IP configured – skipping connect.');
      return;
    }

    // Tear down any existing socket cleanly
    if (socketRef.current) {
      socketRef.current.removeAllListeners();
      socketRef.current.disconnect();
      socketRef.current = null;
    }

    const uri = `http://${serverIp.trim()}:${serverPort}`;
    console.log(`[Socket] Connecting to: ${uri}  (attempt ${reconnectCountRef.current + 1})`);
    setStatusMessage(`Connecting to ${uri}…`);
    setIsTesting(true);

    const socket = io(uri, {
      // Allow polling first so Socket.IO completes the HTTP handshake, then
      // upgrades to WebSocket. Forcing websocket-only skips this handshake and
      // causes "WebSocket error" in standalone APKs even when cleartext is allowed.
      transports: ['polling', 'websocket'],
      upgrade: true,
      // Disable Socket.IO's built-in auto-reconnect; we do it ourselves with
      // exponential backoff so the UI stays accurate.
      reconnection: false,
      timeout: 8000,
      forceNew: true,
    });

    socketRef.current = socket;

    socket.on('connect', () => {
      console.log(`[Socket] ✅ Connected  socket.id=${socket.id}  uri=${uri}`);
      reconnectCountRef.current = 0;
      setReconnectAttempt(0);
      setIsConnected(true);
      setIsTesting(false);
      setStatusMessage(`✅ Connected to ${uri}`);

      // Register this device with the server
      socket.emit('register', {
        type: 'scanner',
        name: `${Platform.OS === 'android' ? 'Android' : 'iOS'} Scanner`,
      });

      // Flush offline queue
      if (offlineQueueRef.current.length > 0) {
        console.log(`[Socket] Flushing ${offlineQueueRef.current.length} queued scans…`);
        offlineQueueRef.current.forEach(payload => socket.emit('scan-barcode', payload));
        offlineQueueRef.current = [];
      }
    });

    socket.on('connect_error', (err) => {
      const attempt = reconnectCountRef.current + 1;
      console.warn(`[Socket] ❌ connect_error (attempt ${attempt}): ${err.message}`);
      setIsConnected(false);
      setIsTesting(false);

      if (attempt >= RECONNECT_MAX_TRIES) {
        setStatusMessage(`Cannot reach ${uri} after ${attempt} attempts. Tap "Reset Pair" to re-enter IP.`);
        console.error('[Socket] Max reconnect attempts reached. Giving up.');
        return;
      }

      // Exponential backoff: 2 s, 4 s, 8 s … capped at 30 s
      const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectCountRef.current, RECONNECT_MAX_MS);
      reconnectCountRef.current = attempt;
      setReconnectAttempt(attempt);
      setStatusMessage(`⚠️ ${err.message} – retry ${attempt}/${RECONNECT_MAX_TRIES} in ${delay / 1000}s…`);

      reconnectTimerRef.current = setTimeout(() => connectToPC(), delay);
    });

    socket.on('disconnect', (reason) => {
      console.warn(`[Socket] ⚠️ Disconnected: ${reason}`);
      setIsConnected(false);

      // Reconnect unless we deliberately called disconnect()
      if (reason !== 'io client disconnect') {
        const delay = Math.min(RECONNECT_BASE_MS * 2 ** reconnectCountRef.current, RECONNECT_MAX_MS);
        setStatusMessage(`⚠️ Disconnected (${reason}) – reconnecting in ${delay / 1000}s…`);
        reconnectTimerRef.current = setTimeout(() => connectToPC(), delay);
      } else {
        setStatusMessage('Disconnected.');
      }
    });
  }, [serverIp, serverPort]);

  // Handle barcode scanned event
  const handleBarcodeScanned = async ({ type, data }) => {
    // If we are currently pairing or scanning is inactive, ignore standard barcode scanning
    if (pairingMode) {
      handlePairingScan(data);
      return;
    }

    if (!scanningActive) return;

    // Check duplicate delay
    const now = Date.now();
    const lastScanTime = lastScanTimesRef.current[data] || 0;
    if (now - lastScanTime < duplicateDelay) {
      // Too soon, ignore duplicate
      return;
    }
    
    // Update scan timestamp
    lastScanTimesRef.current[data] = now;
    
    // Play sound/vibration immediately
    playFeedback();

    const timestamp = new Date().toLocaleTimeString();
    const newScan = {
      code: data,
      format: type,
      timestamp,
      quantity: 1
    };

    // Update scan history locally
    let updatedHistory = [];
    if (inventoryMode) {
      // In inventory mode, if we scan the same item, group it and update quantity
      const existingIndex = history.findIndex(item => item.code === data && item.format === type);
      if (existingIndex > -1) {
        updatedHistory = [...history];
        updatedHistory[existingIndex].quantity += 1;
        updatedHistory[existingIndex].timestamp = timestamp;
      } else {
        updatedHistory = [newScan, ...history];
      }
    } else {
      updatedHistory = [newScan, ...history];
    }
    
    setHistory(updatedHistory);
    AsyncStorage.setItem(STORAGE_KEYS.SCAN_HISTORY, JSON.stringify(updatedHistory));

    // Send to PC in real-time – or enqueue for when connection is restored
    const payload = {
      code: data,
      format: type,
      timestamp: new Date().toISOString(),
    };
    if (isConnected && socketRef.current?.connected) {
      console.log(`[Scan] Sending barcode: ${data} (${type})`);
      socketRef.current.emit('scan-barcode', payload);
    } else {
      console.warn(`[Scan] Offline – queuing barcode: ${data}`);
      offlineQueueRef.current.push(payload);
    }

    // Debounce temporary pause to visual confirmation
    setScanningActive(false);
    setTimeout(() => {
      setScanningActive(true);
    }, 400); // small lock to avoid instant double trigger
  };

  // Scan QR to pair app with server
  const handlePairingScan = (data) => {
    try {
      // Expecting JSON `{ "ip": "...", "port": ... }`
      const config = JSON.parse(data);
      if (config.ip && config.port) {
        setServerIp(config.ip);
        setServerPort(String(config.port));
        setIsConfigured(true);
        setPairingMode(false);
        saveSetting(STORAGE_KEYS.SERVER_CONFIG, JSON.stringify({ ip: config.ip, port: String(config.port) }));
        Alert.alert('Paired Successfully', `Connecting to PC at http://${config.ip}:${config.port}`);
      }
    } catch (e) {
      // Not a valid JSON or not server format
      console.warn("Scanned non-pairing barcode while in pairing mode", data);
    }
  };

  // Save manual connection config
  const handleManualConnect = () => {
    if (!serverIp) {
      Alert.alert('Error', 'Please enter a valid IP address');
      return;
    }
    setIsConfigured(true);
    saveSetting(STORAGE_KEYS.SERVER_CONFIG, JSON.stringify({ ip: serverIp, port: serverPort }));
  };

  const resetConnection = () => {
    setIsConfigured(false);
    setIsConnected(false);
    setStatusMessage('Config disconnected.');
    if (socketRef.current) {
      socketRef.current.disconnect();
    }
    AsyncStorage.removeItem(STORAGE_KEYS.SERVER_CONFIG);
  };

  const clearHistory = () => {
    Alert.alert('Clear History', 'Are you sure you want to clear local scan history?', [
      { text: 'Cancel', style: 'cancel' },
      { text: 'Clear', style: 'destructive', onPress: () => {
          setHistory([]);
          AsyncStorage.removeItem(STORAGE_KEYS.SCAN_HISTORY);
        }
      }
    ]);
  };

  if (!permission) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#4F46E5" />
        <Text style={styles.loadingText}>Requesting Camera Permissions...</Text>
      </View>
    );
  }

  if (!permission.granted) {
    return (
      <View style={styles.loadingContainer}>
        <Text style={styles.errorText}>Camera permission is required to scan barcodes.</Text>
        <TouchableOpacity style={styles.primaryButton} onPress={requestPermission}>
          <Text style={styles.primaryButtonText}>Grant Camera Permission</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Show a "testing connection" spinner before revealing the scanner page
  if (isConfigured && isTesting && !isConnected) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#10B981" />
        <Text style={styles.loadingText}>Testing connection to{"\n"}{serverIp}:{serverPort}</Text>
        {reconnectAttempt > 0 && (
          <Text style={styles.retryText}>Attempt {reconnectAttempt}/{RECONNECT_MAX_TRIES}</Text>
        )}
        <TouchableOpacity style={[styles.resetButton, { marginTop: 24 }]} onPress={resetConnection}>
          <Text style={styles.resetButtonText}>Cancel / Change IP</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <StatusBar style="light" />
      
      {/* Header status bar */}
      <View style={[styles.header, isConnected ? styles.headerConnected : styles.headerDisconnected]}>
        <Text style={styles.headerTitle}>Wi-Fi Barcode Scanner</Text>
        <Text style={styles.headerSubtitle}>{statusMessage}</Text>
      </View>

      {/* Main UI Area */}
      {!isConfigured && !pairingMode ? (
        <ScrollView contentContainerStyle={styles.setupContainer}>
          <View style={styles.card}>
            <Text style={styles.cardTitle}>Pairing Configuration</Text>
            <Text style={styles.cardText}>
              Scan the QR code displayed on your PC web dashboard to instantly connect, or enter the details manually below.
            </Text>

            <TouchableOpacity 
              style={styles.pairingButton} 
              onPress={() => setPairingMode(true)}
            >
              <Text style={styles.pairingButtonText}>Scan Pairing QR Code</Text>
            </TouchableOpacity>

            <View style={styles.divider}>
              <Text style={styles.dividerText}>OR ENTER MANUALLY</Text>
            </View>

            <Text style={styles.label}>PC Local IP Address</Text>
            <TextInput
              style={styles.input}
              placeholder="e.g. 192.168.1.50"
              placeholderTextColor="#9CA3AF"
              value={serverIp}
              onChangeText={setServerIp}
              keyboardType="numeric"
            />

            <Text style={styles.label}>Port</Text>
            <TextInput
              style={styles.input}
              placeholder="5000"
              placeholderTextColor="#9CA3AF"
              value={serverPort}
              onChangeText={setServerPort}
              keyboardType="numeric"
            />

            <TouchableOpacity style={styles.primaryButton} onPress={handleManualConnect}>
              <Text style={styles.primaryButtonText}>Connect to PC</Text>
            </TouchableOpacity>
          </View>
        </ScrollView>
      ) : (
        <View style={styles.scanWorkspace}>
          {/* Camera View */}
          <View style={styles.cameraFrame}>
            <CameraView
              style={StyleSheet.absoluteFillObject}
              facing="back"
              barcodeScannerSettings={{
                barcodeTypes: ['ean13', 'code128', 'upc_a', 'qr', 'code39'],
              }}
              onBarcodeScanned={handleBarcodeScanned}
              enableTorch={torchEnabled}
            >
              {/* Camera Overlays */}
              <View style={styles.overlayContainer}>
                {pairingMode ? (
                  <View style={styles.pairingOverlayBox}>
                    <Text style={styles.overlayText}>Aim at pairing QR code on PC screen</Text>
                    <TouchableOpacity 
                      style={styles.cancelPairingBtn}
                      onPress={() => setPairingMode(false)}
                    >
                      <Text style={styles.cancelPairingBtnText}>Cancel</Text>
                    </TouchableOpacity>
                  </View>
                ) : (
                  <View style={styles.scanOverlayBox}>
                    <View style={styles.scannerLine} />
                    <Text style={styles.overlayText}>Position barcode inside frame</Text>
                  </View>
                )}
                
                {/* Torch Toggle in bottom right of Camera */}
                <TouchableOpacity 
                  style={[styles.torchButton, torchEnabled && styles.torchActive]} 
                  onPress={() => setTorchEnabled(!torchEnabled)}
                >
                  <Text style={styles.torchButtonText}>{torchEnabled ? '🔦 ON' : '🔦 OFF'}</Text>
                </TouchableOpacity>
              </View>
            </CameraView>
          </View>

          {/* Quick Stats / Settings */}
          <View style={styles.quickSettingsBar}>
            <TouchableOpacity 
              style={[styles.settingsToggle, soundEnabled && styles.settingsToggleActive]}
              onPress={() => {
                const nextVal = !soundEnabled;
                setSoundEnabled(nextVal);
                saveSetting(STORAGE_KEYS.SOUND_ENABLED, String(nextVal));
              }}
            >
              <Text style={styles.settingsToggleText}>🔊 Sound {soundEnabled ? 'On' : 'Off'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.settingsToggle, vibrationEnabled && styles.settingsToggleActive]}
              onPress={() => {
                const nextVal = !vibrationEnabled;
                setVibrationEnabled(nextVal);
                saveSetting(STORAGE_KEYS.VIBRATION_ENABLED, String(nextVal));
              }}
            >
              <Text style={styles.settingsToggleText}>📳 Vib {vibrationEnabled ? 'On' : 'Off'}</Text>
            </TouchableOpacity>

            <TouchableOpacity 
              style={[styles.settingsToggle, inventoryMode && styles.settingsToggleActive]}
              onPress={() => {
                const nextVal = !inventoryMode;
                setInventoryMode(nextVal);
                saveSetting(STORAGE_KEYS.INVENTORY_MODE, String(nextVal));
              }}
            >
              <Text style={styles.settingsToggleText}>📦 Inv {inventoryMode ? 'On' : 'Off'}</Text>
            </TouchableOpacity>
          </View>

          {/* Configuration Reset / Delay control */}
          <View style={styles.detailSettingsRow}>
            <View style={styles.delayCol}>
              <Text style={styles.delayLabel}>Scan Delay: {duplicateDelay / 1000}s</Text>
              <View style={styles.delayButtons}>
                {[500, 1500, 3000].map(delayVal => (
                  <TouchableOpacity
                    key={delayVal}
                    style={[styles.delayBtn, duplicateDelay === delayVal && styles.delayBtnActive]}
                    onPress={() => {
                      setDuplicateDelay(delayVal);
                      saveSetting(STORAGE_KEYS.DUPLICATE_DELAY, String(delayVal));
                    }}
                  >
                    <Text style={styles.delayBtnText}>{delayVal / 1000}s</Text>
                  </TouchableOpacity>
                ))}
              </View>
            </View>

            <TouchableOpacity style={styles.resetButton} onPress={resetConnection}>
              <Text style={styles.resetButtonText}>Reset Pair</Text>
            </TouchableOpacity>
          </View>

          {/* Local Scan History */}
          <View style={styles.historySection}>
            <View style={styles.historyHeader}>
              <Text style={styles.historyTitle}>Scan History ({history.length})</Text>
              {history.length > 0 && (
                <TouchableOpacity onPress={clearHistory}>
                  <Text style={styles.clearText}>Clear</Text>
                </TouchableOpacity>
              )}
            </View>

            <ScrollView contentContainerStyle={styles.historyList}>
              {history.length === 0 ? (
                <Text style={styles.emptyText}>No barcodes scanned yet</Text>
              ) : (
                history.map((item, idx) => (
                  <View key={`${item.code}-${idx}`} style={styles.historyItem}>
                    <View>
                      <Text style={styles.historyCode}>{item.code}</Text>
                      <Text style={styles.historyMeta}>{item.format} • {item.timestamp}</Text>
                    </View>
                    {inventoryMode && (
                      <View style={styles.qtyBadge}>
                        <Text style={styles.qtyText}>Qty: {item.quantity}</Text>
                      </View>
                    )}
                  </View>
                ))
              )}
            </ScrollView>
          </View>
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#0F172A',
  },
  loadingContainer: {
    flex: 1,
    backgroundColor: '#0F172A',
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20
  },
  loadingText: {
    marginTop: 15,
    color: '#9CA3AF',
    fontSize: 16,
    textAlign: 'center',
    lineHeight: 24,
  },
  retryText: {
    marginTop: 8,
    color: '#F59E0B',
    fontSize: 14,
    textAlign: 'center',
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    textAlign: 'center',
    marginBottom: 20
  },
  header: {
    paddingTop: 50,
    paddingBottom: 15,
    paddingHorizontal: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  headerConnected: {
    backgroundColor: '#059669', // Emerald
  },
  headerDisconnected: {
    backgroundColor: '#DC2626', // Red
  },
  headerTitle: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  headerSubtitle: {
    color: '#E0F2FE',
    fontSize: 12,
    marginTop: 4,
    textAlign: 'center',
  },
  setupContainer: {
    padding: 20,
    flexGrow: 1,
    justifyContent: 'center',
  },
  card: {
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 24,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 5,
  },
  cardTitle: {
    color: '#F8FAFC',
    fontSize: 20,
    fontWeight: 'bold',
    marginBottom: 10,
    textAlign: 'center',
  },
  cardText: {
    color: '#94A3B8',
    fontSize: 14,
    lineHeight: 20,
    textAlign: 'center',
    marginBottom: 24,
  },
  pairingButton: {
    backgroundColor: '#4F46E5',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginBottom: 10,
  },
  pairingButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  divider: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 16,
  },
  dividerText: {
    color: '#475569',
    fontSize: 11,
    fontWeight: 'bold',
    flex: 1,
    textAlign: 'center',
  },
  label: {
    color: '#94A3B8',
    fontSize: 14,
    fontWeight: '600',
    marginBottom: 6,
  },
  input: {
    backgroundColor: '#0F172A',
    color: '#FFFFFF',
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: 10,
    fontSize: 16,
    marginBottom: 16,
    borderWidth: 1,
    borderColor: '#334155',
  },
  primaryButton: {
    backgroundColor: '#10B981',
    paddingVertical: 14,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 8,
  },
  primaryButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 16,
  },
  scanWorkspace: {
    flex: 1,
    padding: 16,
  },
  cameraFrame: {
    height: '35%',
    borderRadius: 16,
    overflow: 'hidden',
    position: 'relative',
    backgroundColor: '#000000',
  },
  overlayContainer: {
    flex: 1,
    backgroundColor: 'rgba(0,0,0,0.15)',
    justifyContent: 'center',
    alignItems: 'center',
  },
  scanOverlayBox: {
    width: '75%',
    height: '50%',
    borderWidth: 2,
    borderColor: '#10B981',
    borderRadius: 8,
    justifyContent: 'center',
    alignItems: 'center',
    position: 'relative',
  },
  pairingOverlayBox: {
    width: '80%',
    backgroundColor: 'rgba(15, 23, 42, 0.85)',
    borderRadius: 12,
    padding: 16,
    alignItems: 'center',
  },
  scannerLine: {
    position: 'absolute',
    width: '100%',
    height: 2,
    backgroundColor: '#EF4444',
  },
  overlayText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
    textAlign: 'center',
    marginTop: 12,
    textShadowColor: 'rgba(0, 0, 0, 0.75)',
    textShadowOffset: { width: -1, height: 1 },
    textShadowRadius: 10,
  },
  cancelPairingBtn: {
    marginTop: 12,
    backgroundColor: '#EF4444',
    paddingVertical: 6,
    paddingHorizontal: 16,
    borderRadius: 4,
  },
  cancelPairingBtnText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  torchButton: {
    position: 'absolute',
    bottom: 12,
    right: 12,
    backgroundColor: 'rgba(0,0,0,0.6)',
    paddingVertical: 8,
    paddingHorizontal: 12,
    borderRadius: 20,
    borderWidth: 1,
    borderColor: '#334155',
  },
  torchActive: {
    backgroundColor: '#F59E0B',
  },
  torchButtonText: {
    color: '#FFFFFF',
    fontSize: 12,
    fontWeight: 'bold',
  },
  quickSettingsBar: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginVertical: 12,
  },
  settingsToggle: {
    flex: 1,
    backgroundColor: '#1E293B',
    paddingVertical: 10,
    marginHorizontal: 4,
    borderRadius: 8,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#334155',
  },
  settingsToggleActive: {
    backgroundColor: '#4F46E5',
    borderColor: '#6366F1',
  },
  settingsToggleText: {
    color: '#F8FAFC',
    fontSize: 12,
    fontWeight: '600',
  },
  detailSettingsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#1E293B',
    borderRadius: 12,
    padding: 12,
    marginBottom: 12,
  },
  delayCol: {
    flex: 1,
  },
  delayLabel: {
    color: '#94A3B8',
    fontSize: 12,
    fontWeight: 'bold',
    marginBottom: 6,
  },
  delayButtons: {
    flexDirection: 'row',
  },
  delayBtn: {
    backgroundColor: '#0F172A',
    paddingVertical: 6,
    paddingHorizontal: 10,
    borderRadius: 6,
    marginRight: 6,
  },
  delayBtnActive: {
    backgroundColor: '#10B981',
  },
  delayBtnText: {
    color: '#F8FAFC',
    fontSize: 11,
    fontWeight: 'bold',
  },
  resetButton: {
    backgroundColor: '#EF4444',
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  resetButtonText: {
    color: '#FFFFFF',
    fontWeight: 'bold',
    fontSize: 12,
  },
  historySection: {
    flex: 1,
    backgroundColor: '#1E293B',
    borderRadius: 16,
    padding: 16,
  },
  historyHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#334155',
    paddingBottom: 8,
  },
  historyTitle: {
    color: '#F8FAFC',
    fontSize: 16,
    fontWeight: 'bold',
  },
  clearText: {
    color: '#EF4444',
    fontSize: 13,
    fontWeight: '600',
  },
  historyList: {
    flexGrow: 1,
  },
  emptyText: {
    color: '#64748B',
    textAlign: 'center',
    marginTop: 20,
    fontSize: 14,
  },
  historyItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 10,
    borderBottomWidth: 1,
    borderBottomColor: '#0F172A',
  },
  historyCode: {
    color: '#F1F5F9',
    fontSize: 15,
    fontWeight: 'bold',
  },
  historyMeta: {
    color: '#64748B',
    fontSize: 12,
    marginTop: 2,
  },
  qtyBadge: {
    backgroundColor: '#334155',
    borderRadius: 12,
    paddingHorizontal: 10,
    paddingVertical: 4,
  },
  qtyText: {
    color: '#38BDF8',
    fontSize: 12,
    fontWeight: 'bold',
  },
});
