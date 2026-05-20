# Cross-Platform Local Wi-Fi Barcode Scanner Wedge System

A production-ready, ultra-low latency (<100ms) barcode scanner system that allows your mobile phone to act as a wireless barcode reader. It transmits scanned data directly to a PC web dashboard and simulates keyboard keystrokes (keyboard wedge mode) on Windows, macOS, and Linux over local Wi-Fi, completely offline.

---

## 🏗️ Architecture Layout

```mermaid
graph TD
    subgraph Mobile App (Android APK)
        Camera[Expo Camera Scanner] -->|Scans Barcode| Handler[App Control Room]
        Handler -->|Plays feedback| Sound[Haptic & Audio Beep]
        Handler -->|Sends JSON| WSClient[Socket.IO Client]
    end

    subgraph PC Server & Dashboard
        WSServer[Socket.IO Server] <-->|Real-time Websockets| WSClient
        WSServer <-->|Updates Stream| Dashboard[Vite React Dashboard]
        WSServer -->|Types Barcode| KeyboardWedge[nut-js Keystroke Simulator]
    end
    
    Dashboard -->|Wedge Mode Settings| WSServer
    WSServer -->|Pairing Info & QR Code| Dashboard
```

---

## 📂 Directory Layout

*   `server/`: Node.js Express & Socket.IO server. Handles pairing, keyboard wedge inputs, and client synchronization.
*   `frontend/`: Vite React + TypeScript PC dashboard featuring live scan streaming, device management, and keystroke simulator settings.
*   `mobile/`: React Native Expo mobile app utilizing `expo-camera`, haptic engine, and offline history persistence.

---

## ⚡ Quick Start: Running the Server & Dashboard

### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18 or higher recommended).

### 2. Setup the Server & Frontend
Navigate to the root project folder:

```bash
# 1. Install server dependencies
cd server
npm install

# 2. Build the frontend dashboard
cd ../frontend
npm install
npm run build
```

### 3. Launch the Server
Go to the `server/` directory and start the server:

```bash
cd ../server
npm start
```

You will see an output similar to this:
```text
===============================================
  BARCODE SCANNER PC SERVER RUNNING
  Listening on Port: 5000
  Local Access IP Addresses:
   - http://192.168.1.50:5000
===============================================
```

Open your PC web browser and go to `http://localhost:5000` to view the live dashboard!

### 4. Running Standalone Compiled Binaries (Bun Compiled)
We have pre-compiled standalone single-file executables for Linux and Windows using **Bun**. These executables bundle the entire server logic and the compiled React frontend, and require zero dependencies (no Node.js or Bun installation needed on the host PC).

*   **Linux Standalone Binary:** Located at `server/scanner-server-linux`
    *   To run: `./server/scanner-server-linux`
    *   *(Note: Keyboard wedge mode on Linux compiled binary requires `xclip` and `xdotool` to simulate pasting. Install them via your package manager, e.g. `sudo dnf install xclip xdotool` or `sudo apt install xclip xdotool`)*
*   **Windows Standalone Binary:** Located at `server/scanner-server-win.exe`
    *   To run: Double-click or run `server/scanner-server-win.exe` in cmd/PowerShell.
    *   *(Note: Keyboard wedge mode on Windows compiled binary automatically uses native PowerShell script execution to set the clipboard and simulate pasting, requiring no external tools!)*

To re-compile the binaries manually:
```bash
# Compile Linux binary
cd server
bun build --compile --target=bun-linux-x64 index.js --outfile scanner-server-linux

# Compile Windows binary
bun build --compile --target=bun-windows-x64 index.js --outfile scanner-server-win.exe
```

---

## 📱 Running & Building the Mobile App (Android APK)

The mobile app is built with **React Native (Expo)**, giving you two ways to run it: **Developer Mode (Instant)** or **Standalone Production Build (APK)**.

### Method A: Run Instantly via Expo Go (No Compile Required)
1. Install the **Expo Go** app from the Google Play Store or iOS App Store on your mobile device.
2. In your terminal on the PC, navigate to the `mobile/` directory and start the server:
   ```bash
   cd mobile
   npm install
   npx expo start
   ```
3. A QR code will appear in your terminal. Scan this QR code with your phone's camera (or the Expo Go app on Android) to launch the app instantly over local Wi-Fi!

### Method B: Build the Standalone Android APK (Cloud Compile)
Since local compilation requires Java and Android SDK installations, the recommended production approach is using Expo's cloud build pipeline (**EAS Build**), which builds the APK in the cloud and gives you a direct download link.

1. Install the EAS CLI globally:
   ```bash
   npm install -g eas-cli
   ```
2. Log in or create a free Expo account:
   ```bash
   eas login
   ```
3. Configure your build project:
   ```bash
   cd mobile
   eas build:configure
   ```
4. Run the Android build command to compile a preview APK:
   ```bash
   eas build -p android --profile preview
   ```
5. Once the build finishes (usually ~5 minutes), the terminal will output a QR code and URL. Scan or open it to download and install the **APK file** directly on your Android phone!

---

## 🔌 Keyboard Wedge Simulation Modes

*   **PC Dashboard Toggle:** In the dashboard under settings, you can toggle **Keyboard Wedge Mode** on/off.
*   **Operating Systems Supported:** Keyboard wedge typing uses `@nut-tree-fork/nut-js` natively to type barcodes into any selected text box, spreadsheet cell, or database input field.
*   **Testing Keystroke simulator:** Go to the PC dashboard, enter test text in the "Keystroke Simulator Test" box, click **Simulate**, then immediately click into your code editor or notepad. It will automatically type the test characters after a 2-second delay!

---

## 📶 Network Troubleshooting Guide

Since this application operates fully locally, successful connection depends on devices reaching each other over your local Wi-Fi. If the phone says "Disconnected/Reconnecting...":

1.  **Verify Wi-Fi Match:** Ensure both the PC server and the mobile phone are connected to the **exact same Wi-Fi router network SSID**.
2.  **Firewall Configuration:** Windows/Linux firewalls may block port `5000` by default. You must allow incoming TCP traffic on port `5000` in your PC's firewall:
    *   **Linux (UFW):** `sudo ufw allow 5000/tcp`
    *   **Linux (Firewalld):** `sudo firewall-cmd --add-port=5000/tcp --permanent && sudo firewall-cmd --reload`
    *   **Windows Defender Firewall:** Go to Advanced Settings -> Inbound Rules -> New Rule -> Port -> TCP -> Specific local ports: 5000 -> Allow the connection.
3.  **Router AP Isolation:** Some corporate or public Wi-Fi networks (hotels, cafes, schools) have **Access Point (AP) Isolation** enabled. This prevents local devices from pinging or communicating with each other. If this is the case, configure a temporary Wi-Fi hotspot on your mobile phone, connect your PC to it, and pair them.
4.  **IP Address Changes:** If you restarted your computer or router, your PC's local IP address might have changed. Re-pair the phone by scanning the new pairing QR code displayed on the PC screen.
