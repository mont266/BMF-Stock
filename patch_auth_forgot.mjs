import fs from 'fs';

let content = fs.readFileSync('components/Auth.jsx', 'utf8');

const forgotLogic = `  const handleResetPassword = async (e) => {
    e.preventDefault();
    setError(null);
    if (!email) {
      setError('Please enter your email address to reset password.');
      return;
    }
    setLoading(true);
    const { error } = await supabase.auth.resetPasswordForEmail(email, {
      redirectTo: window.location.origin,
    });
    if (error) {
      setError(error.message);
    } else {
      setError('Password reset email sent! Check your inbox.');
    }
    setLoading(false);
  };

  const handleLogin = async (e) => {`;

content = content.replace("const handleLogin = async (e) => {", forgotLogic);

const linkHTML = `<div className="flex items-center justify-between mt-2">
                            <label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                            Password
                            </label>
                            <div className="text-sm">
                                <button type="button" onClick={handleResetPassword} className="font-medium text-blue-600 hover:text-blue-500">
                                Forgot your password?
                                </button>
                            </div>
                        </div>`;

content = content.replace(`<label htmlFor="password" className="block text-sm font-medium text-zinc-700 dark:text-zinc-300">
                        Password
                        </label>`, linkHTML);

fs.writeFileSync('components/Auth.jsx', content);
