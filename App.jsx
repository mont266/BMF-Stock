import React, { useState, useEffect, useCallback } from 'react';
import StockManagerApp from './components/StockManagerApp';
import Auth from './components/Auth';
import UpdatePassword from './components/UpdatePassword';
import { supabase } from './lib/supabaseClient';
import { BrandIcon } from './components/Icons';
import { App as CapacitorApp } from '@capacitor/app';
import ProfileSelection from './components/ProfileSelection';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';

const App = () => {
    const [session, setSession] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileError, setProfileError] = useState(null);
    const [selectedProfile, setSelectedProfile] = useState(null);
    const [recoveryMode, setRecoveryMode] = useState(false);

    const fetchUserProfile = useCallback(async (user) => {
        if (!user) {
            setUserProfile(null);
            return;
        }
        try {
            const { data, error } = await supabase
                .from('users')
                .select('*')
                .eq('id', user.id)
                .single();

            if (error) {
                // Throw the error to be caught by the catch block
                throw error;
            }
            
            setUserProfile(data);
            // Clear any previous errors on a successful fetch
            setProfileError(null); 
            
        } catch (e) {
            console.error("Error fetching user profile:", e.message);
            if (e.message && e.message.includes('infinite recursion')) {
                setProfileError("Database Configuration Error: A security policy on the 'users' table is causing an infinite loop. An administrator must fix the RLS policy.");
            } else {
                setProfileError(`Failed to load user profile: ${e.message}`);
            }
            setUserProfile(null);
        }
    }, []);

    useEffect(() => {
        setLoading(true);
        setProfileError(null);
    
        supabase.auth.getSession().then(async ({ data: { session } }) => {
            if (session?.user) {
                await fetchUserProfile(session.user);
            } else {
                setUserProfile(null);
            }
            setSession(session);
            setLoading(false);
        }).catch(err => {
            console.error("Error fetching session on load:", err);
            setLoading(false);
            setProfileError("Could not verify your session. Please try logging in again.");
        });
    
        const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
            if (_event === 'PASSWORD_RECOVERY') {
                setRecoveryMode(true);
            }
            
            setSession(session);
            if (session?.user) {
                fetchUserProfile(session.user);
            } else {
                setUserProfile(null);
                setSelectedProfile(null); // Clear profile on logout
            }
        });
    
        return () => {
            authListener?.subscription?.unsubscribe();
        };
    }, [fetchUserProfile]);

    const handleLogout = async () => {
        const { error } = await supabase.auth.signOut();
        if (error) console.error('Error logging out:', error.message);
        setSelectedProfile(null);
    };

    const handleSwitchProfile = useCallback(() => {
        setSelectedProfile(null);
    }, []);

    // Add inactivity timeout hook. If a profile is selected, start the timer.
    // After 10 minutes of inactivity, it will call `handleSwitchProfile`, locking the app.
    useInactivityTimeout(handleSwitchProfile, 600000);

    useEffect(() => {
        // Also check hash on load just in case the event fired before we started listening
        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
            setRecoveryMode(true);
        }
    }, []);


    
    if (recoveryMode) {
        return <UpdatePassword onPasswordUpdated={() => setRecoveryMode(false)} />;
    }

    if (loading) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900">
                <BrandIcon className="w-16 h-16 text-blue-600 animate-pulse" />
                <p className="text-zinc-600 dark:text-zinc-400 mt-4">Loading Application...</p>
            </div>
        );
    }

    if (profileError) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-red-50 text-red-800 p-4 text-center">
                 <BrandIcon className="w-16 h-16 text-red-500 mb-4" />
                <h1 className="text-2xl font-bold mb-2">Application Error</h1>
                <p className="max-w-md">{profileError}</p>
            </div>
        );
    }
    
    if (!session) {
        return <Auth />;
    }

    if (!selectedProfile) {
        return <ProfileSelection onProfileSelect={setSelectedProfile} session={session} onLogout={handleLogout} />;
    }

    return (
        <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900">
            <StockManagerApp
                key={session.user.id}
                userProfile={userProfile}
                selectedProfile={selectedProfile}
                onSwitchProfile={handleSwitchProfile}
                onLogout={handleLogout}
            />
        </div>
    );
};

export default App;