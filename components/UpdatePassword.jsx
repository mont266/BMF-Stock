import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const UpdatePassword = ({ onPasswordUpdated }) => {
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState(null);

  const handleUpdatePassword = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);
    
    const { error } = await supabase.auth.updateUser({ password });
    
    if (error) {
      setError(error.message);
      setLoading(false);
    } else {
      setLoading(false);
      onPasswordUpdated();
    }
  };

  const formInputStyle = "appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100";

  return (
    <div className="flex min-h-screen bg-white dark:bg-zinc-900 flex-col justify-center py-12 px-4 sm:px-6 lg:px-8">
        <div className="mx-auto w-full max-w-sm">
            <div>
                <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white text-center">
                Update Password
                </h2>
                <p className="mt-2 text-sm text-zinc-600 dark:text-zinc-400 text-center">
                Please enter your new password below.
                </p>
            </div>
            <div className="mt-8">
                <form className="space-y-6" onSubmit={handleUpdatePassword}>
                    <div>
                        <label htmlFor="new-password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        New Password
                        </label>
                        <div className="mt-1">
                        <input id="new-password" name="password" type="password" required value={password} onChange={(e) => setPassword(e.target.value)} className={formInputStyle} />
                        </div>
                    </div>
                    {error && <p className="mt-2 text-sm text-center text-red-600">{error}</p>}
                    <div>
                        <button type="submit" disabled={loading} className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-500 disabled:cursor-not-allowed dark:focus:ring-offset-zinc-900">
                        {loading ? 'Updating...' : 'Update Password'}
                        </button>
                    </div>
                </form>
            </div>
        </div>
    </div>
  );
};

export default UpdatePassword;
