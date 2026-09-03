import fs from 'fs';

let content = fs.readFileSync('App.jsx', 'utf8');

content = content.replace("import Auth from './components/Auth';", "import Auth from './components/Auth';\nimport UpdatePassword from './components/UpdatePassword';");
content = content.replace("const [selectedProfile, setSelectedProfile] = useState(null);", "const [selectedProfile, setSelectedProfile] = useState(null);\n    const [recoveryMode, setRecoveryMode] = useState(false);");

const authListenerCode = `const { data: authListener } = supabase.auth.onAuthStateChange((_event, session) => {
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
        });`;

content = content.replace(/const \{ data: authListener \} = supabase\.auth\.onAuthStateChange\(\(_event, session\) => \{[\s\S]*?\}\);/, authListenerCode);

const checkHash = `
    useEffect(() => {
        // Also check hash on load just in case the event fired before we started listening
        const hash = window.location.hash;
        if (hash && hash.includes('type=recovery')) {
            setRecoveryMode(true);
        }
    }, []);
`;
content = content.replace("useInactivityTimeout(handleSwitchProfile, 600000);", "useInactivityTimeout(handleSwitchProfile, 600000);\n" + checkHash);

const renderCode = `
    if (recoveryMode) {
        return <UpdatePassword onPasswordUpdated={() => setRecoveryMode(false)} />;
    }

    if (loading) {`;

content = content.replace("if (loading) {", renderCode);

fs.writeFileSync('App.jsx', content);
