import { useEffect, useRef } from 'react';

/**
 * A custom hook to detect user inactivity and trigger a callback.
 * @param {() => void} onIdle - The function to call when the user is idle.
 * @param {number} idleTimeout - The inactivity duration in milliseconds.
 */
export const useInactivityTimeout = (onIdle, idleTimeout = 300000) => { // Default 5 minutes
  const timeoutIdRef = useRef(null);

  const resetTimer = () => {
    if (timeoutIdRef.current) {
      clearTimeout(timeoutIdRef.current);
    }
    timeoutIdRef.current = setTimeout(onIdle, idleTimeout);
  };

  useEffect(() => {
    const events = ['mousemove', 'mousedown', 'keypress', 'touchstart', 'scroll'];

    const handleActivity = () => {
      resetTimer();
    };

    // Set up event listeners to detect activity
    events.forEach(event => window.addEventListener(event, handleActivity, { passive: true }));
    
    // Initialize the timer
    resetTimer();

    // Cleanup function
    return () => {
      if (timeoutIdRef.current) {
        clearTimeout(timeoutIdRef.current);
      }
      events.forEach(event => window.removeEventListener(event, handleActivity));
    };
  }, [onIdle, idleTimeout]); // Rerun if the callback or timeout changes

  return null; // This hook does not render anything
};
