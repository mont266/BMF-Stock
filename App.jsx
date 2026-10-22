import React, { useState, useEffect, useCallback } from 'react';
import StockManagerApp from './components/StockManagerApp';
import Auth from './components/Auth';
import { supabase } from './lib/supabaseClient';
import { BrandIcon } from './components/Icons';
import AnimatedLogo from './components/AnimatedLogo';
import { App as CapacitorApp } from '@capacitor/app';
import ProfileSelection from './components/ProfileSelection';
import { useInactivityTimeout } from './hooks/useInactivityTimeout';
import { trainingManager } from './lib/trainingEnvironment';

const App = () => {
    const [session, setSession] = useState(null);
    const [userProfile, setUserProfile] = useState(null);
    const [loading, setLoading] = useState(true);
    const [profileError, setProfileError] = useState(null);
    const [selectedProfile, setSelectedProfileState] = useState(() => {
        try {
            localStorage.removeItem('active_selected_profile');
            const saved = sessionStorage.getItem('active_selected_profile');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const setSelectedProfile = useCallback((profileOrUpdater) => {
        setSelectedProfileState(prev => {
            const nextProfile = typeof profileOrUpdater === 'function' ? profileOrUpdater(prev) : profileOrUpdater;
            try {
                if (nextProfile) {
                    sessionStorage.setItem('active_selected_profile', JSON.stringify(nextProfile));
                } else {
                    sessionStorage.removeItem('active_selected_profile');
                }
                localStorage.removeItem('active_selected_profile');
            } catch (e) {
                console.warn('Could not persist selectedProfile to sessionStorage:', e);
            }
            return nextProfile;
        });
    }, []);
    const [isTrainingMode, setIsTrainingMode] = useState(() => trainingManager.isActive);
    const [isStartingTraining, setIsStartingTraining] = useState(false);

    const handleEnterTrainingMode = useCallback(async (profile = null) => {
        setIsStartingTraining(true);
        let liveSnapshot = {};
        try {
            const fetchAllStock = async () => {
                const { count } = await supabase.from('stock_items').select('*', { count: 'exact', head: true });
                const total = count || 0;
                if (total === 0) {
                    const { data } = await supabase.from('stock_items').select('*');
                    return data || [];
                }
                const pageSize = 1000;
                const pages = Math.ceil(total / pageSize);
                const promises = [];
                for (let i = 0; i < pages; i++) {
                    promises.push(
                        supabase.from('stock_items').select('*').range(i * pageSize, (i + 1) * pageSize - 1)
                    );
                }
                const results = await Promise.all(promises);
                return results.flatMap(r => r.data || []);
            };

            const [
                liveStock,
                { data: liveMovements },
                { data: liveItemTypes },
                { data: liveSupplierParts },
                { data: liveTeams },
                { data: liveLocations },
                { data: liveSuppliers },
                { data: liveCategories }
            ] = await Promise.all([
                fetchAllStock(),
                supabase.from('stock_movements').select('*').order('created_at', { ascending: false }).limit(200),
                supabase.from('item_types').select('*, item_subcategory(name), suppliers(*)').order('name'),
                supabase.from('item_supplier_part_numbers').select('*, suppliers(id, name), item_types(id, name, category, barcode)').order('id'),
                supabase.from('teams').select('*').order('name'),
                supabase.from('locations').select('*').order('name'),
                supabase.from('suppliers').select('*').order('name'),
                supabase.from('item_category').select('*').order('name')
            ]);

            liveSnapshot = {
                stock: liveStock || [],
                movements: liveMovements || [],
                itemTypes: liveItemTypes || [],
                supplierPartNumbers: liveSupplierParts || [],
                teams: liveTeams || [],
                locations: liveLocations || [],
                suppliers: liveSuppliers || [],
                categories: liveCategories || []
            };
        } catch (e) {
            console.warn("Could not fetch live database snapshot for training mode:", e);
        } finally {
            setIsStartingTraining(false);
        }

        trainingManager.startTrainingSession(
            liveSnapshot.stock,
            liveSnapshot.movements,
            liveSnapshot.itemTypes,
            liveSnapshot.supplierPartNumbers,
            liveSnapshot.teams,
            liveSnapshot.locations,
            liveSnapshot.suppliers,
            liveSnapshot.categories
        );
        setIsTrainingMode(true);
        setSelectedProfile(profile || { id: 'training_user', name: 'Training User (Admin)', role: 'Admin' });
    }, [setSelectedProfile]);

    const handleExitTrainingMode = useCallback(() => {
        trainingManager.exitTrainingSession();
        setIsTrainingMode(false);
        setSelectedProfile(null);
    }, []);

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
                .maybeSingle();

            if (error) {
                // If permission denied or infinite recursion, log warning and fallback
                console.warn("Could not fetch user record from users table:", error.message);
                if (error.message && error.message.includes('infinite recursion')) {
                    setProfileError("Database Configuration Error: A security policy on the 'users' table is causing an infinite loop. An administrator must fix the RLS policy.");
                    return;
                }
            }
            
            setUserProfile(data || { id: user.id, email: user.email, role: 'User' });
            setProfileError(null); 
            
        } catch (e) {
            console.error("Error fetching user profile:", e.message);
            setUserProfile({ id: user.id, email: user.email, role: 'User' });
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

    // Ensure training session is cleaned up if app/tab is closed
    useEffect(() => {
        const handleUnload = () => {
            if (trainingManager.isActive) {
                trainingManager.exitTrainingSession();
            }
        };
        window.addEventListener('beforeunload', handleUnload);
        return () => window.removeEventListener('beforeunload', handleUnload);
    }, []);

    const handleLogout = async () => {
        if (isTrainingMode) {
            trainingManager.exitTrainingSession();
            setIsTrainingMode(false);
        }
        const { error } = await supabase.auth.signOut();
        if (error) console.error('Error logging out:', error.message);
        setSelectedProfile(null);
    };

    const handleSwitchProfile = useCallback(() => {
        if (isTrainingMode) {
            trainingManager.exitTrainingSession();
            setIsTrainingMode(false);
        }
        setSelectedProfile(null);
    }, [isTrainingMode]);

    // Add inactivity timeout hook. If a profile is selected, start the timer.
    // After 10 minutes of inactivity, it will call `handleSwitchProfile`, locking the app.
    useInactivityTimeout(handleSwitchProfile, 600000);

    if (loading || isStartingTraining) {
        return (
            <div className="flex flex-col justify-center items-center min-h-screen bg-zinc-100 dark:bg-zinc-900">
                <AnimatedLogo className="w-16 h-16" />
                <p className="text-zinc-600 dark:text-zinc-400 mt-4 font-medium text-sm">
                    {isStartingTraining ? 'Snapshotting Live Storehouse for Training Sandbox...' : 'Loading Application...'}
                </p>
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
        return (
            <ProfileSelection 
                onProfileSelect={setSelectedProfile} 
                session={session} 
                onLogout={handleLogout}
                onEnterTrainingMode={handleEnterTrainingMode}
            />
        );
    }

    return (
        <div className="min-h-screen bg-zinc-100 dark:bg-zinc-900">
            <StockManagerApp
                key={isTrainingMode ? 'training-session' : session.user.id}
                userProfile={userProfile}
                selectedProfile={selectedProfile}
                onSwitchProfile={handleSwitchProfile}
                onLogout={handleLogout}
                isTrainingMode={isTrainingMode}
                onEnterTrainingMode={handleEnterTrainingMode}
                onExitTrainingMode={handleExitTrainingMode}
            />
        </div>
    );
};

export default App;