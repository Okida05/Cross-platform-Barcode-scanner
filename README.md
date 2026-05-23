# 📱 Wireless Local Wi-Fi Barcode Scanner & Keyboard Wedge

A production-ready, ultra-low latency (<100ms) barcode scanner system that allows your mobile phone to act as a wireless barcode reader. It transmits scanned data directly to a PC web dashboard and simulates keyboard keystrokes (keyboard wedge mode) on Windows, macOS, and Linux over local Wi-Fi, completely offline.

---

## 📲 Direct Downloads

*   **Android App (APK):** [Download mobile.apk directly from this repository](https://github.com/Okida05/Cross-platform-Barcode-scanner/raw/main/mobile.apk)
*   **PC Server (Linux):** [Download Linux binary](https://github.com/Okida05/Cross-platform-Barcode-scanner/raw/main/server/scanner-server-linux)
*   **PC Server (Windows):** [Download Windows executable](https://github.com/Okida05/Cross-platform-Barcode-scanner/raw/main/server/scanner-server-win.exe)

---

## ⚠️ CRITICAL: The `:5000` Port & Firewall Setup

> [!IMPORTANT]
> Since this app operates completely offline over your local Wi-Fi, **your PC's firewall will block the connection by default on port `5000`**, causing the mobile app to show a `"Connection Error / Reconnecting..."` message.
>
> You **MUST** open port `5000` on your PC for the mobile app to communicate with the server. Run the command below corresponding to your OS:

### 🐧 For Linux Users:
*   **Fedora / Nobara (Firewalld):**
    ```bash
    sudo firewall-cmd --add-port=5000/tcp --zone=FedoraWorkstation --permanent
    sudo firewall-cmd --reload
    ```
*   **Ubuntu / Debian (UFW):**
    ```bash
    sudo ufw allow 5000/tcp
    ```

### 🏁 For Windows Users:
1. Open the **Start Menu**, search for **Windows Defender Firewall with Advanced Security**, and open it.
2. Click **Inbound Rules** on the left panel, then click **New Rule...** on the right panel.
3. Select **Port** -> Click **Next**.
4. Choose **TCP** and enter `5000` in **Specific local ports** -> Click **Next**.
5. Select **Allow the connection** -> Click **Next**.
6. Check all profiles (Domain, Private, Public) -> Click **Next**.
7. Name it `Barcode Scanner Server` and click **Finish**.

---



---

## 📂 Directory Layout

*   `server/`: Node.js Express & Socket.IO server. Handles pairing, keyboard wedge inputs, and client synchronization.
*   `frontend/`: Vite React + TypeScript PC dashboard featuring live scan streaming, device management, and keystroke simulator settings.
*   `mobile/`: React Native Expo mobile app utilizing `expo-camera`, haptic engine, and offline history persistence.

---

## ⚡ Quick Start: Running the Server & Dashboard

### Method A: Running Compiled Standalone Binaries (Easiest)
We have pre-compiled standalone single-file executables for Linux and Windows using **Bun**. These executables bundle the entire server logic and the compiled React frontend, and require zero dependencies (no Node.js or Bun installation needed on the host PC).

*   **Linux Standalone Binary:** Located at `server/scanner-server-linux`
    *   To run: `./server/scanner-server-linux`
    *   **🚨 IMPORTANT LINUX REQUIREMENT:** Keyboard wedge mode on Linux compiled binary REQUIRES `xclip` and `xdotool` to simulate pasting. It will NOT type barcodes without them. 
        *   Install on Ubuntu/Debian: `sudo apt install xclip xdotool`
        *   Install on Fedora/RedHat: `sudo dnf install xclip xdotool`
        *   Install on Arch: `sudo pacman -S xclip xdotool`
*   **Windows Standalone Binary:** Located at `server/scanner-server-win.exe`
    *   To run: Double-click or run `server/scanner-server-win.exe` in cmd/PowerShell.
    *   *(Note: Keyboard wedge mode on Windows compiled binary automatically uses native PowerShell script execution to set the clipboard and simulate pasting, requiring no external tools!)*

On start, the server will **automatically open your default web browser** to the dashboard page (`http://localhost:5000`)!

### Method B: Running from Source Code (Developers)
#### 1. Prerequisites
Ensure you have [Node.js](https://nodejs.org/) installed (v18 or higher recommended).

#### 2. Setup the Server & Frontend
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

#### 3. Launch the Server
Go to the `server/` directory and start the server:
```bash
cd ../server
npm start
```
Open your PC web browser and go to `http://localhost:5000` to view the live dashboard!

To manually re-compile the standalone binaries:
```bash
# Compile Linux binary
cd server
bun build --compile --target=bun-linux-x64 index.js --outfile scanner-server-linux

# Compile Windows binary
bun build --compile --target=bun-windows-x64 index.js --outfile scanner-server-win.exe
```

---

## 📱 Running & Building the Mobile App

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

*   **Layout Independence (AZERTY / QWERTY):** Keyboard wedge typing uses a layout-independent clipboard-paste mechanism. It copies the scanned barcode to your system clipboard, simulates a paste key combination (`Ctrl+V` or `Cmd+V`) and triggers `Enter`, then automatically restores your previous clipboard contents. This prevents characters from being typed incorrectly on different keyboard layouts.
*   **PC Dashboard Toggle:** In the dashboard under settings, you can toggle **Keyboard Wedge Mode** on/off.
*   **Testing Keystroke simulator:** Go to the PC dashboard, enter test text in the "Keystroke Simulator Test" box, click **Simulate**, then immediately click into your code editor or notepad. It will automatically type the test characters after a 2-second delay!

---

## 📶 Network Troubleshooting Guide

Since this application operates fully locally, successful connection depends on devices reaching each other over your local Wi-Fi. If the phone says "Disconnected/Reconnecting...":

1.  **Verify Wi-Fi Match:** Ensure both the PC server and the mobile phone are connected to the **exact same Wi-Fi router network SSID**.
2.  **Firewall Configuration:** Ensure port 5000 is open (see the **Firewall Setup** section at the top).
3.  **Router AP Isolation:** Some corporate or public Wi-Fi networks (hotels, cafes, schools) have **Access Point (AP) Isolation** enabled. This prevents local devices from pinging or communicating with each other. If this is the case, configure a temporary Wi-Fi hotspot on your mobile phone, connect your PC to it, and pair them.
4.  **IP Address Changes:** If you restarted your computer or router, your PC's local IP address might have changed. Re-pair the phone by scanning the new pairing QR code displayed on the PC screen.
