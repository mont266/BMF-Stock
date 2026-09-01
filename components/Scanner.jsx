import React, { useEffect, useRef } from 'react';
import { Capacitor } from '@capacitor/core';

const Scanner = ({ onScanSuccess, onScanError, onCancel, persistent = false }) => {
  const onScanSuccessRef = useRef(onScanSuccess);
  const onScanErrorRef = useRef(onScanError);
  const onCancelRef = useRef(onCancel);
  const BarcodeScannerRef = useRef(null);
  
  useEffect(() => {
    onScanSuccessRef.current = onScanSuccess;
    onScanErrorRef.current = onScanError;
    onCancelRef.current = onCancel;
  });

  useEffect(() => {
    let isMounted = true;
    let hasFired = false;
    let listener = null;

    const stopScanner = async () => {
      document.documentElement.classList.remove('barcode-scan-active');
      document.body.classList.remove('barcode-scan-active');
      try {
        if (listener) {
          await listener.remove();
          listener = null;
        }
        if (BarcodeScannerRef.current) {
          await BarcodeScannerRef.current.stopScan();
        }
      } catch (e) {
        // Suppress errors if scanner is not running or already stopped
      }
    };

    const startScanner = async () => {
      if (!Capacitor.isNativePlatform()) {
        onScanErrorRef.current('Barcode scanning is only available on native mobile devices.');
        return;
      }

      try {
        const { BarcodeScanner } = await import('@capacitor-mlkit/barcode-scanning');
        BarcodeScannerRef.current = BarcodeScanner;
        
        const supportResult = await BarcodeScanner.isSupported();
        if(!supportResult.supported) {
          onScanErrorRef.current('Barcode scanning not supported on this device. This could be due to missing Google Play Services or an incompatible device.');
          return;
        }

        // --- New, More Robust Permission Handling ---
        const checkAndRequestPermission = async () => {
          let { camera: permissionStatus } = await BarcodeScanner.checkPermissions();

          if (permissionStatus === 'granted') {
            return true;
          }

          if (permissionStatus === 'denied') {
            const confirmed = confirm('Camera permission is required to scan. Would you like to open app settings to grant it?');
            if (confirmed) {
              await BarcodeScanner.openSettings();
            }
            // After returning from settings, the user needs to re-initiate the scan.
            onScanErrorRef.current('Camera permission is required. Please grant it in app settings and try scanning again.');
            return false;
          }

          // If not granted or denied, it's 'prompt' or 'prompt-with-rationale'
          const { camera: newStatus } = await BarcodeScanner.requestPermissions();

          if (newStatus !== 'granted') {
            onScanErrorRef.current('Camera permission is required to scan barcodes.');
            return false;
          }

          return true;
        };
        
        const hasPermission = await checkAndRequestPermission();
        if (!isMounted || !hasPermission) {
          // If permission was denied and settings were opened, or the prompt was rejected,
          // we stop here. We also stop if the component unmounted during async permission checks.
          return;
        }
        // --- End of Permission Handling ---
        
        document.documentElement.classList.add('barcode-scan-active');
        document.body.classList.add('barcode-scan-active');

        listener = await BarcodeScanner.addListener(
          'barcodeScanned',
          async (result) => {
            if (!isMounted || !result.barcode) return;

            if (persistent) {
              onScanSuccessRef.current(result.barcode.displayValue);
            } else {
              if (hasFired) return;
              hasFired = true;
              await stopScanner();
              onScanSuccessRef.current(result.barcode.displayValue);
            }
          }
        );

        await BarcodeScanner.startScan();

      } catch (err) {
        if (isMounted) {
            await stopScanner();
            // The capacitor plugin throws an error with a 'cancelled' message when the user backs out of the scanner.
            // This is not a true error state, so we just trigger the onCancel callback.
            if (err.message && err.message.toLowerCase().includes('cancelled')) {
                onCancelRef.current();
            } else {
                // Any other error is a real problem that we should report to the user.
                onScanErrorRef.current(err.message || 'An unexpected error occurred with the scanner.');
            }
        }
      }
    };
    
    startScanner();

    return () => {
      isMounted = false;
      // For persistent mode, hasFired is never set, so this cleanup always runs on unmount.
      // For non-persistent mode, it only runs if the user cancels before a successful scan.
      if (!hasFired) {
        stopScanner();
      }
    };
  }, [persistent]); // Rerun effect if persistent mode changes.

  return (
    <div className="fixed inset-0 z-[9999] flex flex-col justify-center items-center p-8 scanner-ui-container">
      <div className="w-full max-w-sm flex flex-col items-center">
        <p className="text-white text-lg font-semibold mb-4 text-shadow">
          Position the barcode inside the frame
        </p>
        
        <div className="relative w-full aspect-[4/3] max-w-sm rounded-xl scanner-frame">
          <div className="scanner-line"></div>
        </div>

        <button 
          onClick={() => onCancelRef.current()}
          className="mt-8 px-8 py-3 bg-white/20 text-white rounded-lg backdrop-blur-md text-lg font-semibold"
          aria-label="Cancel scanning"
        >
          Cancel
        </button>
      </div>
    </div>
  );
};

export default Scanner;