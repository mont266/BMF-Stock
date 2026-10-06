import React, { useState } from 'react';
import { supabase } from '../lib/supabaseClient';

const Auth = () => {
  const [loading, setLoading] = useState(false);
  const [password, setPassword] = useState('');
  const [email, setEmail] = useState('');
  const [error, setError] = useState(null);

  const handleLogin = async (e) => {
    e.preventDefault();
    setError(null);
    setLoading(true);

    const { error } = await supabase.auth.signInWithPassword({ email, password });
    if (error) {
      setError(error.message);
    }
    setLoading(false);
  };
  
  const formInputStyle = "appearance-none block w-full px-3 py-2 border border-zinc-300 dark:border-zinc-700 rounded-md shadow-sm placeholder-zinc-400 dark:placeholder-zinc-500 focus:outline-none focus:ring-blue-500 focus:border-blue-500 sm:text-sm bg-zinc-50 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100";
  
  return (
    <div className="flex min-h-screen bg-white dark:bg-zinc-900">
      <div className="relative hidden w-0 flex-1 lg:block">
        <div className="absolute inset-0 h-full w-full bg-zinc-900 flex flex-col justify-center items-center p-12">
            <img src="/favicon.svg" alt="Bregan MainsFlow Logo" className="w-32" />
            <h1 className="mt-6 text-4xl font-bold tracking-tight text-white">Bregan MainsFlow Stock</h1>
            <p className="mt-2 text-lg text-zinc-400">Inventory control, streamlined for professionals.</p>
        </div>
      </div>
      <div className="flex flex-1 flex-col justify-center py-12 px-4 sm:px-6 lg:flex-none lg:px-20 xl:px-24">
        <div className="mx-auto w-full max-w-sm lg:w-96">
            <div>
                <div className="lg:hidden flex justify-center mb-6">
                    <img src="/favicon.svg" alt="Bregan MainsFlow Logo" className="w-24" />
                </div>
                <h2 className="text-3xl font-bold tracking-tight text-zinc-900 dark:text-white">
                Sign in to your account
                </h2>
            </div>

            <div className="mt-8">
                <div className="mt-6">
                <form className="space-y-6" onSubmit={handleLogin}>
                    <div>
                        <label htmlFor="email" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Email Address
                        </label>
                        <div className="mt-1">
                        <input id="email" name="email" type="email" autoComplete="email" required autoFocus value={email} onChange={(e) => setEmail(e.target.value)} className={formInputStyle} />
                        </div>
                    </div>
                    <div>
                        <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Password
                        </label>
                        <div className="mt-1">
                        <input id="password" name="password" type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={formInputStyle} />
                        </div>
                    </div>
                    {error && <p className="mt-2 text-sm text-center text-red-600">{error}</p>}
                    <div>
                        <button type="submit" disabled={loading} className="w-full flex justify-center py-2.5 px-4 border border-transparent rounded-md shadow-sm text-sm font-medium text-white bg-blue-600 hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-offset-2 focus:ring-blue-500 disabled:bg-blue-500 disabled:cursor-not-allowed dark:focus:ring-offset-zinc-900">
                        {loading ? 'Signing in...' : 'Sign in'}
                        </button>
                    </div>
                </form>
                </div>
            </div>
        </div>
      </div>
    </div>
  );
};

export default Auth;