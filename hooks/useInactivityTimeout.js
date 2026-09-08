import { useEffect, useRef, useState, useCallback } from 'react';

/**
 * A custom hook to detect user inactivity and trigger a callback.
 * @param {() => void} onIdle - The function to call when the user is idle.
 * @param {number} idleTimeout - The inactivity duration in milliseconds (default 5 minutes).
 * @param {number} warningDuration - How long before the timeout to show the warning (default 1 minute).
 * @param {boolean} isActive - Whether the timeout is currently active (e.g. true only when logged in).
 */
export const useInactivityTimeout = (onIdle, idleTimeout = 300000, warningDuration = 60000, isActive = true) => {
  const [showWarning, setShowWarning] = useState(false);
  const [countdown, setCountdown] = useState(Math.floor(warningDuration / 1000));
  
  const timeoutIdRef = useRef(null);
  const intervalIdRef = useRef(null);
  const isWarningRef = useRef(false);

  const resetTimer = useCallback(() => {
    if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
    if (intervalIdRef.current) clearInterval(intervalIdRef.current);
    
    setShowWarning(false);
    isWarningRef.current = false;
    setCountdown(Math.floor(warningDuration / 1000));

    if (!isActive) return;

    timeoutIdRef.current = setTimeout(() => {
      // Trigger warning
      setShowWarning(true);
      isWarningRef.current = true;
      
      let timeLeft = Math.floor(warningDuration / 1000);
      setCountdown(timeLeft);
      
      intervalIdRef.current = setInterval(() => {
        timeLeft -= 1;
        setCountdown(timeLeft);
        if (timeLeft <= 0) {
          clearInterval(intervalIdRef.current);
          setShowWarning(false);
          isWarningRef.current = false;
          onIdle();
        }
      }, 1000);

    }, idleTimeout - warningDuration);
  }, [idleTimeout, warningDuration, onIdle, isActive]);

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'];
    const handleActivity = () => {
      if (!isWarningRef.current) {
        resetTimer();
      }
    };

    // Set up event listeners to detect activity
    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));
    
    // Initialize the timer
    resetTimer();

    // Cleanup function
    return () => {
      if (timeoutIdRef.current) clearTimeout(timeoutIdRef.current);
      if (intervalIdRef.current) clearInterval(intervalIdRef.current);
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [resetTimer]);

  return { showWarning, countdown, resetTimer };
};
