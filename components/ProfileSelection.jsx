import React, { useState, useEffect, useCallback, useRef } from 'react';
import { supabase } from '../lib/supabaseClient';
import { BrandIcon, UsersIcon, LogoutIcon } from './Icons';
import { Spinner } from './StockManagerApp';
import Modal from './Modal';

const ProfileSelection = ({ onProfileSelect, session, onLogout }) => {
    const [profiles, setProfiles] = useState([]);
    const [loading, setLoading] = useState(true);
    const [error, setError] = useState(null);
    
    const [pinModal, setPinModal] = useState({ isOpen: false, profile: null });
    const [pinValue, setPinValue] = useState(Array(4).fill(''));
    const [pinError, setPinError] = useState('');
    const pinInputRefs = useRef([]);


    const fetchProfiles = useCallback(async () => {
        if (!session?.user?.id) return;
        setLoading(true);
        setError(null);
        try {
            const { data, error } = await supabase
                .from('profiles')
                .select('id, name, pin, role')
                .eq('user_id', session.user.id)
                .order('name');
            if (error) throw error;
            setProfiles(data);
        } catch (err) {
            setError('Could not load profiles. Please try again.');
            console.error(err);
        } finally {
            setLoading(false);
        }
    }, [session?.user?.id]);

    useEffect(() => {
        fetchProfiles();
    }, [fetchProfiles]);
    
    useEffect(() => {
        if (pinModal.isOpen) {
            pinInputRefs.current[0]?.focus();
        }
    }, [pinModal.isOpen]);

    const handleProfileClick = (profile) => {
        if (profile.pin) {
            setPinModal({ isOpen: true, profile });
            setPinError('');
            setPinValue(Array(4).fill(''));
        } else {
            onProfileSelect(profile);
        }
    };

    const handlePinChange = (e, index) => {
        const { value } = e.target;
        const newPin = [...pinValue];

        if (value.length > 1) { // Handle paste
            const cleanedValue = value.replace(/[^0-9]/g, "");
            for (let i = 0; i < cleanedValue.length; i++) {
                if (index + i < 4) {
                    newPin[index + i] = cleanedValue[i];
                }
            }
            setPinValue(newPin);
            const nextFocus = Math.min(3, index + cleanedValue.length);
            pinInputRefs.current[nextFocus]?.focus();
            return;
        }

        if (/^[0-9]$/.test(value)) { // Handle single digit entry
            newPin[index] = value;
            setPinValue(newPin);
            if (index < 3) {
                pinInputRefs.current[index + 1]?.focus();
            }
        } else if (value === '') { // Handle manual deletion
            newPin[index] = '';
            setPinValue(newPin);
        }
    };

    const handleKeyDown = (e, index) => {
        if (e.key === 'Backspace' && pinValue[index] === '' && index > 0) {
            pinInputRefs.current[index - 1].focus();
        }
    };

    const handlePinSubmit = (e) => {
        e.preventDefault();
        const enteredPin = pinValue.join('');
        if (enteredPin === pinModal.profile.pin) {
            onProfileSelect(pinModal.profile);
            setPinModal({ isOpen: false, profile: null });
        } else {
            setPinError('Incorrect PIN. Please try again.');
            setPinValue(Array(4).fill(''));
            pinInputRefs.current[0]?.focus();
        }
    };
    
    const closePinModal = () => {
        setPinModal({ isOpen: false, profile: null });
        setPinValue(Array(4).fill(''));
        setPinError('');
    };

    return (
        <>
        <div className="relative flex flex-col items-center justify-center min-h-screen bg-zinc-100 dark:bg-zinc-900 p-4">
            <div 
                className="absolute right-4"
                style={{ top: 'max(1rem, env(safe-area-inset-top, 0px))' }}
            >
                <button
                    onClick={onLogout}
                    className="flex items-center space-x-2 px-3 py-2 md:px-4 md:py-2 text-sm font-medium text-zinc-600 dark:text-zinc-400 bg-white dark:bg-zinc-800 rounded-lg shadow-sm hover:bg-zinc-50 dark:hover:bg-zinc-700 transition-colors focus:outline-none focus:ring-2 focus:ring-blue-500"
                    aria-label="Log out"
                >
                    <LogoutIcon className="w-5 h-5" />
                    <span className="hidden sm:inline">Log Out</span>
                </button>
            </div>
            
            <div className="w-full max-w-4xl mx-auto text-center mt-12 md:mt-0">
                <BrandIcon className="w-20 h-20 mx-auto text-blue-600 mb-4" />
                <h1 className="text-3xl font-bold text-zinc-900 dark:text-white">Who's using the app?</h1>
                <p className="mt-2 text-zinc-600 dark:text-zinc-400">Select your profile to continue.</p>

                <div className="mt-8">
                    {loading ? (
                        <div className="flex justify-center items-center h-48">
                            <Spinner className="w-8 h-8 text-blue-600 dark:text-blue-400" />
                        </div>
                    ) : error ? (
                        <div className="p-4 bg-red-100 text-red-700 dark:bg-red-900/20 dark:text-red-300 rounded-md">
                            {error}
                        </div>
                    ) : profiles.length > 0 ? (
                        <div className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
                            {profiles.map(profile => (
                                <button
                                    key={profile.id}
                                    onClick={() => handleProfileClick(profile)}
                                    className="w-full p-6 bg-white dark:bg-zinc-800 rounded-lg shadow-sm hover:shadow-md transition-shadow text-center focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-900"
                                >
                                    <UsersIcon className="w-10 h-10 mx-auto text-zinc-400 dark:text-zinc-500 mb-3" />
                                    <p className="font-semibold text-zinc-800 dark:text-zinc-100">{profile.name}</p>
                                </button>
                            ))}
                        </div>
                    ) : (
                        <div className="text-center py-10 px-6 bg-white dark:bg-zinc-800/50 rounded-lg shadow-sm border border-zinc-200 dark:border-zinc-700 max-w-md mx-auto">
                            <div className="mx-auto flex items-center justify-center h-12 w-12 rounded-full bg-zinc-100 dark:bg-zinc-800">
                                <UsersIcon className="w-6 h-6 text-zinc-500 dark:text-zinc-400" />
                            </div>
                            <h3 className="mt-4 text-lg font-semibold text-zinc-900 dark:text-white">No Profiles Found</h3>
                            <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">An administrator needs to create user profiles in the Admin Panel before you can proceed.</p>
                        </div>
                    )}
                </div>
            </div>
        </div>
        <Modal isOpen={pinModal.isOpen} onClose={closePinModal} title={`Enter PIN for ${pinModal.profile?.name}`}>
            <form onSubmit={handlePinSubmit}>
                <div className="text-center">
                    <label htmlFor="pin-input-0" className="block text-sm font-medium text-zinc-600 dark:text-zinc-400 mb-4">Enter your 4-digit PIN to continue</label>
                    <div className="flex justify-center space-x-2 sm:space-x-4">
                        {pinValue.map((digit, index) => (
                            <input
                                key={index}
                                ref={el => { pinInputRefs.current[index] = el; }}
                                id={`pin-input-${index}`}
                                type="tel"
                                inputMode="numeric"
                                autoComplete="one-time-code"
                                maxLength="1"
                                value={digit}
                                onChange={e => handlePinChange(e, index)}
                                onKeyDown={e => handleKeyDown(e, index)}
                                onFocus={e => e.target.select()}
                                className="w-12 h-14 sm:w-14 sm:h-16 text-center text-2xl font-mono p-2 border border-zinc-300 dark:border-zinc-600 bg-white dark:bg-zinc-700 rounded-md shadow-sm focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                            />
                        ))}
                    </div>
                    {pinError && <p className="mt-4 text-sm text-red-600 dark:text-red-400">{pinError}</p>}
                </div>
                <div className="mt-8 flex justify-end space-x-3">
                    <button type="button" onClick={closePinModal} className="px-4 py-2 text-sm font-medium text-zinc-700 dark:text-zinc-200 bg-white dark:bg-zinc-700 border border-zinc-300 dark:border-zinc-500 rounded-md hover:bg-zinc-50 dark:hover:bg-zinc-600">
                        Cancel
                    </button>
                    <button type="submit" disabled={pinValue.join('').length !== 4} className="px-4 py-2 text-sm font-medium text-white bg-blue-600 rounded-md hover:bg-blue-700 disabled:bg-blue-400 dark:disabled:bg-blue-800">
                        Continue
                    </button>
                </div>
            </form>
        </Modal>
        </>
    );
};

export default ProfileSelection;