const fs = require('fs');
let code = fs.readFileSync('App.jsx', 'utf8');

code = code.replace(
    /const \[selectedProfile, setSelectedProfile\] = useState\(null\);/g,
    `const [selectedProfile, _setSelectedProfile] = useState(() => {
        try {
            const saved = sessionStorage.getItem('selectedProfile');
            return saved ? JSON.parse(saved) : null;
        } catch (e) {
            return null;
        }
    });

    const setSelectedProfile = useCallback((profile) => {
        if (profile) {
            sessionStorage.setItem('selectedProfile', JSON.stringify(profile));
        } else {
            sessionStorage.removeItem('selectedProfile');
        }
        _setSelectedProfile(profile);
    }, []);`
);

fs.writeFileSync('App.jsx', code);
