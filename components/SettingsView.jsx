import React from 'react';
import { Page } from './StockManagerApp';
import {
  SunIcon,
  ScanIcon,
  UsersIcon,
  AdminIcon,
  SettingsIcon
} from './Icons';
import { Capacitor } from '@capacitor/core';

export const SettingsView = ({
  userProfile,
  selectedProfile,
  isDarkMode,
  toggleDarkMode,
  isBeepEnabled,
  setIsBeepEnabled,
  scannerPreference,
  setScannerPreference,
  isAdminProfile,
  handleAdminClick,
  setPinChangeError,
  setPinChangeData,
  setIsChangePinModalOpen,
  isDevMode,
  setIsDevMode,
  setIsDevLoginModalOpen,
  setIsDevPurgeModalOpen,
  setIsDevResetModalOpen,
  isTrainingMode,
  setIsResetTrainingModalOpen,
  setIsExitTrainingModalOpen,
  onEnterTrainingMode,
}) => {
  return (
    <Page title="App Settings">
      <div className="max-w-3xl space-y-6 pb-32 md:pb-10">
        {/* Card: Appearance */}
        <div className="bg-white dark:bg-zinc-800/80 p-5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xs">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-2">
            <SunIcon className="w-5 h-5 text-amber-500" />
            <span>Appearance</span>
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Customise the visual appearance and color theme of the app.
          </p>
          <div className="flex items-center justify-between p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
            <div>
              <label htmlFor="settings-dark-mode-toggle" className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 block">Dark Mode</label>
              <span className="text-xs text-zinc-500 dark:text-zinc-400">{isDarkMode ? 'Dark theme active' : 'Light theme active'}</span>
            </div>
            <button
              id="settings-dark-mode-toggle"
              type="button"
              onClick={toggleDarkMode}
              className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 ${
                  isDarkMode ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
              }`}
            >
              <span
                aria-hidden="true"
                className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                  isDarkMode ? 'translate-x-5' : 'translate-x-0'
                }`}
              />
            </button>
          </div>
        </div>

        {/* Card: Scanner Hardware & Feedback */}
        <div className="bg-white dark:bg-zinc-800/80 p-5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xs">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-2">
            <ScanIcon className="w-5 h-5 text-blue-600" />
            <span>Scanner Hardware & Feedback</span>
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Manage barcode scanning audio alerts and hardware scanner inputs.
          </p>
          <div className="space-y-3">
            <div className="flex items-center justify-between p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
              <div>
                <label htmlFor="settings-beep-toggle" className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 block">Audible Beep on Scan</label>
                <span className="text-xs text-zinc-500 dark:text-zinc-400">Play confirmation tone when a barcode is recognized</span>
              </div>
              <button
                id="settings-beep-toggle"
                type="button"
                onClick={() => setIsBeepEnabled(!isBeepEnabled)}
                className={`relative inline-flex h-6 w-11 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 ease-in-out focus:outline-none focus:ring-2 focus:ring-blue-500 focus:ring-offset-2 dark:focus:ring-offset-zinc-800 ${
                    isBeepEnabled ? 'bg-blue-600' : 'bg-zinc-300 dark:bg-zinc-600'
                }`}
              >
                <span className="sr-only">Enable beep</span>
                <span
                  className={`inline-block h-5 w-5 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                    isBeepEnabled ? 'translate-x-5' : 'translate-x-0'
                  }`}
                />
              </button>
            </div>
            {Capacitor.isNativePlatform() && (
              <div className="p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
                  <label className="block font-semibold text-sm text-zinc-800 dark:text-zinc-200">Scanner Input Source</label>
                  <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">Choose whether to use the device camera or an external Bluetooth / USB handheld barcode scanner.</p>
                  <div className="flex rounded-md shadow-xs">
                      <button
                          type="button"
                          onClick={() => setScannerPreference('camera')}
                          className={`relative inline-flex items-center rounded-l-md px-4 py-2 text-sm font-medium border focus:z-10 focus:outline-none focus:ring-1 focus:ring-blue-500 ${scannerPreference === 'camera' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                      >
                          Device Camera
                      </button>
                      <button
                          type="button"
                          onClick={() => setScannerPreference('external')}
                          className={`relative -ml-px inline-flex items-center rounded-r-md px-4 py-2 text-sm font-medium border focus:z-10 focus:outline-none focus:ring-1 focus:ring-blue-500 ${scannerPreference === 'external' ? 'bg-blue-600 text-white border-blue-600' : 'bg-white dark:bg-zinc-800 border-zinc-300 dark:border-zinc-600 text-zinc-700 dark:text-zinc-200 hover:bg-zinc-50 dark:hover:bg-zinc-700'}`}
                      >
                          External Scanner
                      </button>
                  </div>
              </div>
            )}
          </div>
        </div>

        {/* Card: Security & PIN */}
        <div className="bg-white dark:bg-zinc-800/80 p-5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xs">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-2">
            <UsersIcon className="w-5 h-5 text-purple-600" />
            <span>Security & Access</span>
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-4">
            Manage your personal profile authentication PIN code.
          </p>
          <div className="p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
            <button 
                type="button"
                onClick={() => {
                    setPinChangeError('');
                    setPinChangeData({ currentPin: '', newPin: '', confirmNewPin: '' });
                    setIsChangePinModalOpen(true);
                }}
                className="w-full text-left"
            >
                <div className="flex justify-between items-center">
                    <div>
                      <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 block">Change Your PIN</span>
                      <span className="text-xs text-zinc-500 dark:text-zinc-400">Update the 4-digit login PIN for {selectedProfile?.name || 'your profile'}</span>
                    </div>
                    <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold flex items-center gap-1">
                      Edit &rarr;
                    </span>
                </div>
            </button>
          </div>
        </div>

        {/* Card: Training Sandbox Mode */}
        <div className="bg-white dark:bg-zinc-800/80 p-5 rounded-xl border border-amber-400/40 dark:border-amber-500/30 shadow-xs">
          <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 mb-1 flex items-center gap-2">
            <span className="text-lg">🎓</span>
            <span>Training Sandbox Mode</span>
          </h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
            Practice scanning, stock additions, returns, stock counts, and reporting in a 100% isolated sandbox.
          </p>
          <div className="p-4 bg-amber-500/10 dark:bg-amber-500/15 border border-amber-500/30 rounded-xl space-y-3">
            {isTrainingMode ? (
              <>
                <div className="flex items-center justify-between">
                  <div>
                    <span className="text-xs font-bold uppercase tracking-wider text-amber-800 dark:text-amber-300">Status: Sandbox Active</span>
                    <p className="text-xs text-zinc-600 dark:text-zinc-400 mt-0.5">
                      All scanned data, counts, and movements are held in memory. Zero backend writes.
                    </p>
                  </div>
                  <span className="w-3 h-3 rounded-full bg-emerald-500 animate-pulse shrink-0 ml-3" title="Sandbox active" />
                </div>
                <div className="flex flex-wrap gap-2 pt-2 border-t border-amber-500/20">
                  <button
                    type="button"
                    onClick={() => setIsResetTrainingModalOpen(true)}
                    className="px-3.5 py-2 text-xs font-semibold rounded-lg bg-white dark:bg-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-600 text-zinc-800 dark:text-zinc-200 transition-colors border border-zinc-200 dark:border-zinc-600"
                  >
                    Reset Sandbox Stock
                  </button>
                  <button
                    type="button"
                    onClick={() => setIsExitTrainingModalOpen(true)}
                    className="px-4 py-2 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors shadow-xs ml-auto"
                  >
                    Exit Training Mode
                  </button>
                </div>
              </>
            ) : (
              <>
                <p className="text-xs text-zinc-600 dark:text-zinc-400">
                  Practice scanning, stock additions, returns, stock counts, and reporting with complete peace of mind. All training data is completely isolated in memory and cleared when you exit.
                </p>
                {typeof onEnterTrainingMode === 'function' && (
                  <button
                    type="button"
                    onClick={onEnterTrainingMode}
                    className="w-full py-2.5 px-3 text-xs font-bold rounded-lg bg-amber-500 hover:bg-amber-400 text-zinc-950 transition-colors shadow-xs flex items-center justify-center gap-1.5"
                  >
                    <span>Enter Training Sandbox Mode</span>
                    <span aria-hidden="true">&rarr;</span>
                  </button>
                )}
              </>
            )}
          </div>
        </div>

        {/* Card: Admin & Developer Tools */}
        {isAdminProfile && (
          <div className="bg-white dark:bg-zinc-800/80 p-5 rounded-xl border border-zinc-200 dark:border-zinc-700 shadow-xs space-y-4">
            <h3 className="text-base font-bold text-zinc-900 dark:text-zinc-100 flex items-center gap-2">
              <AdminIcon className="w-5 h-5 text-indigo-600" />
              <span>System Administration & Developer Tools</span>
            </h3>
            <div className="space-y-3">
              <div className="p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
                <button 
                    type="button"
                    onClick={handleAdminClick}
                    className="w-full text-left"
                >
                    <div className="flex justify-between items-center">
                        <div>
                          <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 block">Go to Admin Panel</span>
                          <span className="text-xs text-zinc-500 dark:text-zinc-400">Manage user profiles, teams, categories, and system permissions</span>
                        </div>
                        <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold flex items-center gap-1">Manage &rarr;</span>
                    </div>
                </button>
              </div>

              <div className="p-3.5 bg-zinc-50 dark:bg-zinc-700/40 rounded-lg border border-zinc-200/60 dark:border-zinc-700/60">
                  {!isDevMode ? (
                      <button 
                          type="button"
                          onClick={() => setIsDevLoginModalOpen(true)}
                          className="w-full text-left"
                      >
                          <div className="flex justify-between items-center">
                              <div>
                                <span className="font-semibold text-sm text-zinc-800 dark:text-zinc-200 block">Developer Tools</span>
                                <span className="text-xs text-zinc-500 dark:text-zinc-400">Unlock database maintenance and purge tools</span>
                              </div>
                              <span className="text-blue-600 dark:text-blue-400 text-sm font-semibold">Unlock &rarr;</span>
                          </div>
                      </button>
                  ) : (
                      <div className="space-y-3">
                          <div className="flex items-center justify-between">
                              <span className="text-green-600 dark:text-green-400 font-bold text-xs uppercase tracking-wider">Dev Mode Active</span>
                              <button type="button" onClick={() => setIsDevMode(false)} className="text-xs text-red-600 hover:underline">Disable</button>
                          </div>
                          <button 
                              type="button"
                              onClick={() => setIsDevPurgeModalOpen(true)}
                              className="w-full text-left font-medium text-red-600 dark:text-red-400 bg-red-50 dark:bg-red-900/20 p-3 rounded-md border border-red-200 dark:border-red-800/30 hover:bg-red-100 dark:hover:bg-red-900/30 transition-colors"
                          >
                              <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-bold text-sm block">Purge Specific Barcode Items</span>
                                    <span className="text-xs text-red-700/80 dark:text-red-300/80 font-normal">Search barcode to delete matching stock items and optional item type</span>
                                  </div>
                                  <span className="text-sm font-semibold ml-2">&rarr;</span>
                              </div>
                          </button>
                          <button 
                              type="button"
                              onClick={() => setIsDevResetModalOpen(true)}
                              className="w-full text-left font-medium text-amber-700 dark:text-amber-300 bg-amber-50 dark:bg-amber-900/20 p-3 rounded-md border border-amber-200 dark:border-amber-800/40 hover:bg-amber-100 dark:hover:bg-amber-900/30 transition-colors"
                          >
                              <div className="flex justify-between items-center">
                                  <div>
                                    <span className="font-bold text-sm block">Reset Inventory & Movement Logs</span>
                                    <span className="text-xs text-amber-800/80 dark:text-amber-300/80 font-normal">Wipes physical stock & movements. Keeps item types, barcodes, suppliers, teams & locations intact.</span>
                                  </div>
                                  <span className="text-sm font-semibold ml-2">&rarr;</span>
                              </div>
                          </button>
                      </div>
                  )}
              </div>
            </div>
          </div>
        )}

        {/* Version & Build Info */}
        <div className="pt-2 flex flex-col items-center justify-center text-center space-y-1">
            <span className="px-3.5 py-1 bg-white dark:bg-zinc-800 border border-zinc-200 dark:border-zinc-700 text-zinc-500 dark:text-zinc-400 text-xs font-mono rounded-full font-semibold shadow-2xs tracking-wide">
                Version V0.14
            </span>
            <p className="text-[11px] text-zinc-400 dark:text-zinc-500">
              Bregan MainsFlow Stock Management System
            </p>
        </div>
      </div>
    </Page>
  );
};

export default SettingsView;
