import React, { useState } from 'react';

/**
 * AnimatedLogo
 * One-off spiral load-in animation that settles completely static.
 * Features:
 * - Spiral vortex entrance: 720-degree uncoil with elastic settling into a crisp static state
 * - One-off ambient spiral shockwave/aura that fades to 0% opacity upon landing
 * - One-off light-sweep glint across emblem facets
 * - Completely static afterwards (no continuous loop or hover floating)
 * - Click/Tap to replay the spiral entrance
 */
const AnimatedLogo = ({
    className = 'w-24 h-24',
    alt = 'Bregan MainsFlow Stock Logo',
    showAura = true,
    auraClassName = '',
    interactive = true
}) => {
    const [animationKey, setAnimationKey] = useState(0);

    const handleReplay = () => {
        if (!interactive) return;
        setAnimationKey(prev => prev + 1);
    };

    return (
        <div 
            key={animationKey}
            className="relative inline-flex items-center justify-center select-none"
            onClick={handleReplay}
            title={interactive ? "Click to replay animation" : undefined}
            role="img"
            aria-label={alt}
        >
            {/* One-off Spiral Ambient Aura Burst (Fades completely away to opacity 0) */}
            {showAura && (
                <div 
                    aria-hidden="true"
                    className={`absolute -inset-6 rounded-full bg-gradient-to-tr from-cyan-400/30 via-blue-500/25 to-teal-300/20 blur-xl pointer-events-none animate-logo-spiral-aura ${auraClassName}`}
                />
            )}

            {/* Main Logo Container with Spiral Load-In */}
            <div className={`relative overflow-hidden rounded-2xl flex items-center justify-center p-1 ${interactive ? 'cursor-pointer active:scale-95 transition-transform' : ''}`}>
                <img 
                    src="/favicon.svg" 
                    alt={alt} 
                    className={`${className} object-contain filter drop-shadow-sm animate-logo-spiral`} 
                />

                {/* One-off Glint / Shimmer across emblem facets on landing */}
                <div 
                    aria-hidden="true" 
                    className="pointer-events-none absolute inset-0 w-full h-full bg-gradient-to-r from-transparent via-white/50 dark:via-cyan-100/40 to-transparent -translate-x-full animate-logo-spiral-shimmer mix-blend-overlay"
                />
            </div>
        </div>
    );
};

export default AnimatedLogo;
