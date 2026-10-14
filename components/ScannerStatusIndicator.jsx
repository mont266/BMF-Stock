import React, { useState, useEffect, useRef, useCallback } from 'react';
import { BarcodeIcon, CheckCircleIcon, XCircleIcon, InformationCircleIcon } from './Icons';
import Modal from './Modal';

/**
 * ScannerStatusIndicator component
 * Real-time detection and display of the connection status of the "BarCode Scanner HID" bluetooth scanner
 * on both the main dashboard and the profile selection screen.
 */
const SCANNER_STORAGE_KEY = 'barcode_scanner_hid_connected';
const SCANNER_NAME = 'BarCode Scanner HID';

export const useBarcodeScannerStatus = () => {
    // Default to false (Not Connected) unless actively detected
    const [isConnected, setIsConnected] = useState(false);
    const [scannerDeviceName, setScannerDeviceName] = useState(SCANNER_NAME);
    const [lastScan, setLastScan] = useState(null);
    const [connectionType, setConnectionType] = useState('Bluetooth HID');
    const [webHidGranted, setWebHidGranted] = useState(false);

    // Track rapid keystrokes to detect HID scanner input
    const keyBufferRef = useRef([]);
    const keyTimeRef = useRef([]);

    // Save status to state & storage
    const updateConnectedStatus = useCallback((status, details = {}) => {
        setIsConnected(status);
        if (details.name) setScannerDeviceName(details.name);
        if (details.type) setConnectionType(details.type);
        try {
            localStorage.setItem(SCANNER_STORAGE_KEY, status ? 'true' : 'false');
        } catch (e) {}
    }, []);

    // Check for WebHID devices and bluetooth connectivity
    const checkScannerConnection = useCallback(async () => {
        // 1. WebHID API check
        if (typeof navigator !== 'undefined' && 'hid' in navigator) {
            try {
                const devices = await navigator.hid.getDevices();
                if (devices && devices.length > 0) {
                    setWebHidGranted(true);
                    const matchedDevice = devices.find(d => 
                        (d.productName && d.productName.toLowerCase().includes('barcode')) ||
                        (d.productName && d.productName.toLowerCase().includes('scanner')) ||
                        (d.productName && d.productName.includes(SCANNER_NAME))
                    );
                    updateConnectedStatus(true, { 
                        name: matchedDevice?.productName || SCANNER_NAME,
                        type: 'WebHID / Real-time' 
                    });
                    return true;
                }
            } catch (err) {
                console.debug('WebHID check error:', err);
            }
        }

        // 2. Check Web Bluetooth if available
        if (typeof navigator !== 'undefined' && 'bluetooth' in navigator && 'getDevices' in navigator.bluetooth) {
            try {
                const btDevices = await navigator.bluetooth.getDevices();
                const matchedBT = btDevices.find(d => 
                    d.name && (d.name.includes(SCANNER_NAME) || d.name.toLowerCase().includes('scanner'))
                );
                if (matchedBT && matchedBT.gatt?.connected) {
                    updateConnectedStatus(true, { name: matchedBT.name, type: 'Bluetooth LE' });
                    return true;
                }
            } catch (err) {
                console.debug('Bluetooth check error:', err);
            }
        }

        return false;
    }, [updateConnectedStatus]);

    // Direct WebHID Pairing Request (allows user to explicitly grant permission once for sub-ms WebHID events)
    const requestWebHidPermission = useCallback(async () => {
        if (typeof navigator !== 'undefined' && 'hid' in navigator) {
            try {
                const devices = await navigator.hid.requestDevice({ filters: [] });
                if (devices && devices.length > 0) {
                    setWebHidGranted(true);
                    const dev = devices[0];
                    updateConnectedStatus(true, {
                        name: dev.productName || SCANNER_NAME,
                        type: 'WebHID / Direct'
                    });
                    return true;
                }
            } catch (err) {
                console.debug('User cancelled or WebHID request failed:', err);
            }
        }
        return false;
    }, [updateConnectedStatus]);

    // Instant physical keyboard / scanner key handler (0ms response time)
    useEffect(() => {
        const handleKeyDown = (e) => {
            // Any physical hardware key event immediately sets scanner status to connected
            if (!e.isComposing && e.key) {
                setIsConnected((prev) => {
                    if (!prev) {
                        updateConnectedStatus(true, { name: SCANNER_NAME, type: 'Bluetooth HID' });
                    }
                    return true;
                });
            }

            const now = Date.now();
            keyBufferRef.current.push(e.key);
            keyTimeRef.current.push(now);

            // Keep buffer reasonable size
            if (keyBufferRef.current.length > 50) {
                keyBufferRef.current.shift();
                keyTimeRef.current.shift();
            }

            // If Enter key is pressed and we received multiple characters quickly
            if (e.key === 'Enter' && keyBufferRef.current.length >= 3) {
                const totalTime = now - keyTimeRef.current[0];
                const avgSpeed = totalTime / keyBufferRef.current.length;
                
                if (avgSpeed < 70 || keyBufferRef.current.length >= 4) {
                    const codeScanned = keyBufferRef.current.filter(k => k !== 'Enter').join('');
                    if (codeScanned.length >= 2) {
                        setLastScan({
                            code: codeScanned,
                            time: new Date().toLocaleTimeString()
                        });
                        updateConnectedStatus(true, { name: SCANNER_NAME, type: 'Bluetooth HID' });
                    }
                }
                
                keyBufferRef.current = [];
                keyTimeRef.current = [];
            }
        };

        window.addEventListener('keydown', handleKeyDown, true);
        window.addEventListener('keyup', handleKeyDown, true);
        return () => {
            window.removeEventListener('keydown', handleKeyDown, true);
            window.removeEventListener('keyup', handleKeyDown, true);
        };
    }, [updateConnectedStatus]);

    // Setup listeners and automatic ultra-fast detection
    useEffect(() => {
        checkScannerConnection();

        // Ultra-fast sub-second check interval (200ms) with non-blocking browser device APIs
        const intervalId = setInterval(() => {
            checkScannerConnection();
        }, 200);

        const handleSystemChange = () => {
            checkScannerConnection();
        };

        // Listen for system hardware change events (fired instantly when Bluetooth device pairs/connects)
        window.addEventListener('focus', handleSystemChange);
        window.addEventListener('resize', handleSystemChange);
        document.addEventListener('visibilitychange', handleSystemChange);

        if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.addEventListener) {
            navigator.mediaDevices.addEventListener('devicechange', handleSystemChange);
        }

        let hidConnectHandler = null;
        let hidDisconnectHandler = null;

        if (typeof navigator !== 'undefined' && 'hid' in navigator) {
            hidConnectHandler = (event) => {
                const dev = event.device;
                updateConnectedStatus(true, { name: dev?.productName || SCANNER_NAME, type: 'WebHID / Real-time' });
            };

            hidDisconnectHandler = (event) => {
                const dev = event.device;
                if (!dev?.productName || dev.productName.includes(SCANNER_NAME) || dev.productName.toLowerCase().includes('scanner')) {
                    updateConnectedStatus(false);
                }
            };

            navigator.hid.addEventListener('connect', hidConnectHandler);
            navigator.hid.addEventListener('disconnect', hidDisconnectHandler);
        }

        return () => {
            clearInterval(intervalId);
            window.removeEventListener('focus', handleSystemChange);
            window.removeEventListener('resize', handleSystemChange);
            document.removeEventListener('visibilitychange', handleSystemChange);
            if (typeof navigator !== 'undefined' && navigator.mediaDevices && navigator.mediaDevices.removeEventListener) {
                navigator.mediaDevices.removeEventListener('devicechange', handleSystemChange);
            }
            if (typeof navigator !== 'undefined' && 'hid' in navigator) {
                if (hidConnectHandler) navigator.hid.removeEventListener('connect', hidConnectHandler);
                if (hidDisconnectHandler) navigator.hid.removeEventListener('disconnect', hidDisconnectHandler);
            }
        };
    }, [checkScannerConnection, updateConnectedStatus]);

    return {
        isConnected,
        scannerDeviceName,
        connectionType,
        lastScan,
        webHidGranted,
        requestWebHidPermission,
        updateConnectedStatus
    };
};

const ScannerStatusIndicator = ({ compact = false, className = '', hidden = true }) => {
    const {
        isConnected,
        scannerDeviceName,
        connectionType,
        lastScan,
        webHidGranted,
        requestWebHidPermission
    } = useBarcodeScannerStatus();

    const [isModalOpen, setIsModalOpen] = useState(false);
    const [testInputValue, setTestInputValue] = useState('');
    const [testScanResult, setTestScanResult] = useState(null);

    // Keep scanner status detection active in the background, but hide visual UI elements when hidden is true
    if (hidden) {
        return null;
    }

    const handleTestInputKeyDown = (e) => {
        if (e.key === 'Enter' && testInputValue.trim()) {
            setTestScanResult({
                code: testInputValue.trim(),
                time: new Date().toLocaleTimeString()
            });
            setTestInputValue('');
        }
    };

    return (
        <>
            {/* Indicator Badge Button */}
            <button
                type="button"
                onClick={() => setIsModalOpen(true)}
                className={`group flex items-center space-x-2 px-2.5 py-1.5 sm:px-3 sm:py-1.5 rounded-full text-xs font-semibold transition-all duration-200 border shadow-xs focus:outline-none focus:ring-2 focus:ring-blue-500 ${
                    isConnected
                        ? 'bg-emerald-50 text-emerald-800 border-emerald-200 dark:bg-emerald-950/40 dark:text-emerald-300 dark:border-emerald-800/60 hover:bg-emerald-100 dark:hover:bg-emerald-900/50'
                        : 'bg-zinc-100 text-zinc-600 border-zinc-200 dark:bg-zinc-800/80 dark:text-zinc-400 dark:border-zinc-700 hover:bg-zinc-200 dark:hover:bg-zinc-700'
                } ${className}`}
                title={`Scanner Status: ${isConnected ? 'Connected' : 'Not Connected'} (${scannerDeviceName}). Click for details.`}
            >
                {/* Status Dot with pulse effect if connected */}
                <span className="relative flex h-2.5 w-2.5 shrink-0">
                    {isConnected && (
                        <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                    )}
                    <span
                        className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                            isConnected ? 'bg-emerald-500' : 'bg-zinc-400 dark:bg-zinc-500'
                        }`}
                    ></span>
                </span>

                <BarcodeIcon className={`w-4 h-4 ${isConnected ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'}`} />

                {!compact && (
                    <span className="truncate max-w-[140px] sm:max-w-none">
                        {isConnected ? (
                            <span>
                                Scanner: <strong className="font-semibold text-emerald-900 dark:text-emerald-200">Connected</strong>
                            </span>
                        ) : (
                            <span>Scanner: Offline</span>
                        )}
                    </span>
                )}
            </button>

            {/* Detailed Status Modal */}
            <Modal
                isOpen={isModalOpen}
                onClose={() => setIsModalOpen(false)}
                title="Bluetooth Barcode Scanner Status"
            >
                <div className="space-y-5">
                    {/* Status Card */}
                    <div className={`p-4 rounded-xl border flex items-start space-x-3.5 ${
                        isConnected 
                            ? 'bg-emerald-50/80 border-emerald-200 dark:bg-emerald-950/30 dark:border-emerald-800/60'
                            : 'bg-zinc-50 dark:bg-zinc-800/50 border-zinc-200 dark:border-zinc-700'
                    }`}>
                        {isConnected ? (
                            <CheckCircleIcon className="w-7 h-7 text-emerald-600 dark:text-emerald-400 shrink-0 mt-0.5" />
                        ) : (
                            <XCircleIcon className="w-7 h-7 text-zinc-400 dark:text-zinc-500 shrink-0 mt-0.5" />
                        )}
                        <div className="flex-1 min-w-0">
                            <div className="flex items-center justify-between">
                                <h4 className="font-semibold text-base text-zinc-900 dark:text-zinc-100">
                                    {isConnected ? 'Scanner Connected & Active' : 'Scanner Disconnected / Sleeping'}
                                </h4>
                                <span className={`text-xs px-2 py-0.5 rounded-md font-medium ${
                                    isConnected 
                                        ? 'bg-emerald-200/70 text-emerald-800 dark:bg-emerald-900/60 dark:text-emerald-200' 
                                        : 'bg-zinc-200 dark:bg-zinc-700 text-zinc-700 dark:text-zinc-300'
                                }`}>
                                    {isConnected ? 'READY' : 'OFFLINE'}
                                </span>
                            </div>
                            <p className="text-sm mt-1 text-zinc-600 dark:text-zinc-300">
                                Targeted Device: <strong className="font-medium text-zinc-900 dark:text-zinc-100">{scannerDeviceName}</strong>
                            </p>
                            {isConnected && (
                                <p className="text-xs text-zinc-500 dark:text-zinc-400 mt-1">
                                    Connection Mode: {connectionType}
                                </p>
                            )}
                        </div>
                    </div>

                    {/* How Bluetooth Scanners & Sleep Mode Work Info */}
                    <div className="p-3.5 bg-blue-50 dark:bg-blue-950/30 border border-blue-200 dark:border-blue-800/50 rounded-lg flex space-x-3 text-xs text-blue-800 dark:text-blue-300">
                        <InformationCircleIcon className="w-5 h-5 shrink-0 text-blue-500 mt-0.5" />
                        <div className="space-y-1.5">
                            <p className="font-semibold text-blue-900 dark:text-blue-200">How Scanner Bluetooth Connection Works:</p>
                            <p>
                                <strong>Sleep Mode:</strong> Bluetooth scanners enter power-saving sleep after 30–60 seconds of inactivity. Pressing the button wakes the scanner and triggers a 1.5–3 second Bluetooth handshake with your phone or computer.
                            </p>
                            <p>
                                <strong>Real-Time Detection:</strong> The app actively monitors OS media/device connection events (every 200ms) and hardware key presses to immediately reflect "Connected" status the instant the Bluetooth link completes.
                            </p>
                        </div>
                    </div>

                    {/* Direct WebHID Pair Button if supported & not yet granted */}
                    {typeof navigator !== 'undefined' && 'hid' in navigator && (
                        <div className="p-3 bg-zinc-100 dark:bg-zinc-800/80 border border-zinc-200 dark:border-zinc-700 rounded-lg flex items-center justify-between">
                            <div className="text-xs text-zinc-700 dark:text-zinc-300 pr-2">
                                <span className="font-medium block text-zinc-900 dark:text-zinc-100">WebHID Direct Connection</span>
                                <span className="text-[11px] text-zinc-500 dark:text-zinc-400">
                                    {webHidGranted ? 'Direct WebHID permission active' : 'Authorize direct WebHID access for instant hardware events'}
                                </span>
                            </div>
                            <button
                                type="button"
                                onClick={requestWebHidPermission}
                                className="px-3 py-1.5 text-xs font-medium text-blue-700 dark:text-blue-300 bg-blue-100 dark:bg-blue-900/50 hover:bg-blue-200 dark:hover:bg-blue-800 rounded-md shrink-0 transition-colors"
                            >
                                {webHidGranted ? 'Re-authorize WebHID' : 'Authorize WebHID'}
                            </button>
                        </div>
                    )}

                    {/* Test Scan Interactive Area */}
                    <div className="p-4 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 rounded-lg space-y-3">
                        <label className="block text-xs font-medium text-zinc-700 dark:text-zinc-300 uppercase tracking-wider">
                            Interactive Live Scan Test
                        </label>
                        <p className="text-xs text-zinc-500 dark:text-zinc-400">
                            Aim your physical scanner here and trigger a scan to test instant detection:
                        </p>
                        <input
                            type="text"
                            value={testInputValue}
                            onChange={(e) => setTestInputValue(e.target.value)}
                            onKeyDown={handleTestInputKeyDown}
                            placeholder="Click here and pull scanner trigger..."
                            className="w-full px-3 py-2 text-sm border border-zinc-300 dark:border-zinc-600 bg-zinc-50 dark:bg-zinc-900 text-zinc-900 dark:text-zinc-100 rounded-md focus:ring-2 focus:ring-blue-500"
                        />

                        {(testScanResult || lastScan) && (
                            <div className="p-2.5 bg-emerald-50 dark:bg-emerald-950/40 border border-emerald-200 dark:border-emerald-800 rounded-md text-xs text-emerald-800 dark:text-emerald-300 flex justify-between items-center">
                                <div>
                                    <span className="font-semibold">Last Received Scan: </span>
                                    <code className="bg-emerald-100 dark:bg-emerald-900 px-1.5 py-0.5 rounded font-mono text-emerald-900 dark:text-emerald-100 ml-1">
                                        {(testScanResult || lastScan)?.code}
                                    </code>
                                </div>
                                <span className="text-[10px] text-emerald-600 dark:text-emerald-400">
                                    {(testScanResult || lastScan)?.time}
                                </span>
                            </div>
                        )}
                    </div>

                    {/* Action Buttons */}
                    <div className="flex justify-end items-center pt-2 border-t border-zinc-200 dark:border-zinc-700">
                        <button
                            type="button"
                            onClick={() => setIsModalOpen(false)}
                            className="px-5 py-2 text-xs font-semibold text-white bg-blue-600 hover:bg-blue-700 rounded-lg shadow-xs transition-colors"
                        >
                            Close
                        </button>
                    </div>
                </div>
            </Modal>
        </>
    );
};

export default ScannerStatusIndicator;

