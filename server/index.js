const express = require('express');
const http = require('http');
const { Server } = require('socket.io');
const cors = require('cors');
const qrcode = require('qrcode');
const os = require('os');
const path = require('path');
const { exec } = require('child_process');

let keyboard = null;
let Key = null;
let clipboard = null;

try {
  const nut = require('@nut-tree-fork/nut-js');
  keyboard = nut.keyboard;
  Key = nut.Key;
  clipboard = nut.clipboard;
  console.log('[Wedge] Native nut-js keyboard wedge initialized.');
} catch (e) {
  console.log('[Wedge] Native nut-js not available. Will use OS command-line fallback wedge.');
}

const app = express();
app.use(cors());
app.use(express.json());

// Serve frontend build static files
app.use(express.static(path.join(__dirname, '../frontend/dist')));

const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: '*',
    methods: ['GET', 'POST']
  }
});

// App State
let wedgeMode = true; // Default Keyboard Wedge Mode to TRUE
let connectedDevices = [];

// Helper to get local IP addresses
function getLocalIPs() {
  const interfaces = os.networkInterfaces();
  const addresses = [];
  for (const interfaceName in interfaces) {
    for (const iface of interfaces[interfaceName]) {
      // Skip loopback and non-IPv4 addresses
      if (iface.family === 'IPv4' && !iface.internal) {
        addresses.push(iface.address);
      }
    }
  }
  return addresses;
}

// REST Endpoints
app.get('/api/info', async (req, res) => {
  const ips = getLocalIPs();
  const primaryIp = ips.find(ip => ip.startsWith('192.168.') || ip.startsWith('10.')) || ips[0] || 'localhost';
  const port = process.env.PORT || 5000;
  const connectionUrl = `http://${primaryIp}:${port}`;

  try {
    const qrCodeDataUrl = await qrcode.toDataURL(JSON.stringify({ ip: primaryIp, port }));
    res.json({
      ips,
      primaryIp,
      port,
      connectionUrl,
      qrCodeDataUrl,
      wedgeMode
    });
  } catch (err) {
    res.status(500).json({ error: 'Failed to generate QR Code', details: err.message });
  }
});

app.post('/api/settings', (req, res) => {
  const { wedge } = req.body;
  if (typeof wedge === 'boolean') {
    wedgeMode = wedge;
    io.emit('settings-changed', { wedgeMode });
    console.log(`[Settings] Keyboard Wedge Mode updated to: ${wedgeMode}`);
    return res.json({ success: true, wedgeMode });
  }
  res.status(400).json({ error: 'Invalid settings payload' });
});

// Keystroke wedges using nut-js
// Keystroke wedges using nut-js or OS command-line fallback
async function sendKeystroke(text) {
  // Method 1: Use nut-js if available (preferred, smooth)
  if (keyboard && Key && clipboard) {
    try {
      // Save current clipboard content if possible
      let oldClipboard = '';
      try {
        oldClipboard = await clipboard.getContent();
      } catch (e) {
        // ignore
      }

      // Set clipboard to barcode text
      await clipboard.setContent(text);

      // Paste based on platform
      if (process.platform === 'darwin') {
        // macOS: Cmd + V
        await keyboard.pressKey(Key.LeftSuper);
        await keyboard.pressKey(Key.V);
        await keyboard.releaseKey(Key.V);
        await keyboard.releaseKey(Key.LeftSuper);
      } else {
        // Windows and Linux: Ctrl + V (LeftControl)
        await keyboard.pressKey(Key.LeftControl);
        await keyboard.pressKey(Key.V);
        await keyboard.releaseKey(Key.V);
        await keyboard.releaseKey(Key.LeftControl);
      }

      // Press Enter to submit
      await keyboard.pressKey(Key.Enter);
      await keyboard.releaseKey(Key.Enter);

      console.log(`[Wedge via nut-js] Pasted: ${text}`);

      // Restore old clipboard content after a brief delay
      if (oldClipboard) {
        setTimeout(async () => {
          try {
            await clipboard.setContent(oldClipboard);
          } catch (e) {
            // ignore
          }
        }, 800);
      }
      return;
    } catch (err) {
      console.warn('[Wedge nut-js failed] Falling back to command-line wedge:', err.message);
    }
  }

  // Method 2: OS-specific command line fallbacks (used when compiled with Bun/packaged)
  const platform = process.platform;
  if (platform === 'win32') {
    // Windows: Use PowerShell to set clipboard, paste, and press enter
    const escapedText = text.replace(/'/g, "''");
    const psCommand = `Set-Clipboard -Value '${escapedText}'; Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms::SendKeys]::SendWait('^v{ENTER}')`;
    exec(`powershell -Command "${psCommand}"`, (err) => {
      if (err) {
        console.error('[Wedge Error] Windows PowerShell simulation failed:', err.message);
      } else {
        console.log(`[Wedge via PowerShell] Sent: ${text}`);
      }
    });
  } else if (platform === 'linux') {
    // Linux: Try using xclip to copy to clipboard, and xdotool to paste and press enter
    const escapedText = text.replace(/'/g, "'\\''");
    const cmd = `echo -n '${escapedText}' | xclip -selection clipboard && xdotool key ctrl+v Return`;
    exec(cmd, (err) => {
      if (err) {
        // If xclip/xdotool fails, fall back to pure xdotool type (character by character)
        const pureTypeCmd = `xdotool type --delay 10 '${escapedText}' && xdotool key Return`;
        exec(pureTypeCmd, (typeErr) => {
          if (typeErr) {
            console.warn('[Wedge Warning] Linux typing failed. Make sure xclip and xdotool are installed: sudo dnf install xclip xdotool');
          } else {
            console.log(`[Wedge via xdotool type] Typed: ${text}`);
          }
        });
      } else {
        console.log(`[Wedge via xclip + xdotool] Pasted: ${text}`);
      }
    });
  } else if (platform === 'darwin') {
    // macOS: Use AppleScript to set clipboard, paste, and press enter
    const escapedText = text.replace(/"/g, '\\"');
    const appleScript = `
      set the clipboard to "${escapedText}"
      tell application "System Events"
        keystroke "v" using command down
        keystroke return
      end tell
    `;
    exec(`osascript -e '${appleScript}'`, (err) => {
      if (err) {
        console.error('[Wedge Error] macOS AppleScript simulation failed:', err.message);
      } else {
        console.log(`[Wedge via AppleScript] Pasted: ${text}`);
      }
    });
  } else {
    console.warn(`[Wedge Error] Keyboard wedge not supported on platform: ${platform}`);
  }
}

// Socket.IO Connection Handler
io.on('connection', (socket) => {
  console.log(`[Socket] Device connected: ${socket.id}`);
  
  // Register client type
  socket.on('register', (data) => {
    const deviceType = data.type || 'dashboard'; // 'scanner' or 'dashboard'
    const deviceName = data.name || (deviceType === 'scanner' ? 'Mobile Phone' : 'Web Dashboard');
    
    const device = {
      id: socket.id,
      type: deviceType,
      name: deviceName,
      connectedAt: new Date().toISOString()
    };
    
    connectedDevices.push(device);
    io.emit('devices-list', connectedDevices);
    console.log(`[Socket] Registered as ${deviceType}: ${deviceName} (${socket.id})`);
  });

  // Handle incoming barcode scan from mobile
  socket.on('scan-barcode', (data) => {
    // Expected structure: { code: '12345678', format: 'EAN-13', timestamp: '...' }
    console.log(`[Barcode Received] ${data.code} (${data.format}) from scanner: ${socket.id}`);
    
    const scanPayload = {
      code: data.code,
      format: data.format || 'UNKNOWN',
      timestamp: data.timestamp || new Date().toISOString(),
      scannerId: socket.id,
      scannerName: connectedDevices.find(d => d.id === socket.id)?.name || 'Mobile Phone'
    };

    // 1. Broadcast to all connected dashboards
    io.emit('barcode-scanned', scanPayload);

    // 2. Perform keyboard wedge typing if active
    if (wedgeMode) {
      sendKeystroke(data.code);
    }
  });

  // Handle manual keyboard wedge test
  socket.on('test-wedge', (data) => {
    console.log('[Socket] Wedge test requested:', data.text);
    if (wedgeMode) {
      sendKeystroke(data.text || 'TEST-BARCODE-123');
    }
  });

  socket.on('disconnect', () => {
    console.log(`[Socket] Device disconnected: ${socket.id}`);
    connectedDevices = connectedDevices.filter(d => d.id !== socket.id);
    io.emit('devices-list', connectedDevices);
  });
});

// Fallback to React index.html for UI Routing
app.use((req, res) => {
  res.sendFile(path.join(__dirname, '../frontend/dist/index.html'));
});

// Function to open default browser
function openBrowser(url) {
  const platform = process.platform;
  let command = '';
  if (platform === 'win32') {
    command = `start ${url}`;
  } else if (platform === 'darwin') {
    command = `open ${url}`;
  } else {
    command = `xdg-open ${url}`;
  }
  exec(command, (err) => {
    if (err) {
      console.warn(`[Browser Warning] Could not automatically open browser:`, err.message);
    }
  });
}

// Function to open default browser (already defined earlier)
const PORT = process.env.PORT || 5000;
function startServer() {
  server.listen(PORT, '0.0.0.0', () => {
    const ips = getLocalIPs();
    console.log(`===============================================`);
    console.log(`  BARCODE SCANNER PC SERVER RUNNING`);
    console.log(`  Listening on Port: ${PORT}`);
    console.log(`  Local Access IP Addresses:`);
    ips.forEach(ip => console.log(`   - http://${ip}:${PORT}`));
    console.log(`===============================================`);
    // Open browser after short delay
    setTimeout(() => openBrowser(`http://localhost:${PORT}`), 800);
  });
}

// Handle server errors, especially port already in use
server.on('error', (err) => {
  if (err.code === 'EADDRINUSE') {
    console.warn(`[Server] Port ${PORT} is already in use. Attempting to free it...`);
    // Platform-specific command to kill process using the port
    const platform = process.platform;
    let killCmd = '';
    if (platform === 'win32') {
      // Windows: find PID and kill it
      killCmd = `netstat -ano | findstr :${PORT}`;
    } else {
      // Linux/macOS: use fuser to kill
      killCmd = `fuser -k ${PORT}/tcp`;
    }
    exec(killCmd, (killErr, stdout, stderr) => {
      if (killErr) {
        console.error('[Server] Failed to free the port:', killErr.message);
        process.exit(1);
      } else {
        console.log('[Server] Port freed. Restarting server...');
        // Give a small delay then restart
        setTimeout(() => startServer(), 500);
      }
    });
  } else {
    console.error('[Server] Unexpected error:', err);
    process.exit(1);
  }
});

// Initial start
startServer();

