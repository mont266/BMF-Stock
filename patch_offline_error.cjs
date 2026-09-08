const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

const offlineErrorHelper = `
const isOfflineError = (err) => {
    if (!navigator.onLine) return true;
    const msg = (err?.message || err?.toString() || '').toLowerCase();
    return msg === 'failed to fetch' || msg.includes('fetch') || msg.includes('network');
};
`;

code = code.replace(
    /export const useStock = \(\) => \{/,
    `${offlineErrorHelper}\nexport const useStock = () => {`
);

// Now replace all the err.message === 'Failed to fetch' checks
code = code.replace(
    /if \(err\.message === 'Failed to fetch' \|\| err\.message\?\.includes\('fetch'\)\) \{/g,
    `if (isOfflineError(err)) {`
);

code = code.replace(
    /if \(err\.message === 'Failed to fetch' \|\| err\.message\.includes\('fetch'\)\) \{/g,
    `if (isOfflineError(err)) {`
);

code = code.replace(
    /if \(err\.message === 'Failed to fetch' \|\| err\.message\?\.includes\('fetch'\) \|\| err\.message\?\.includes\('Network'\)\) \{/g,
    `if (isOfflineError(err)) {`
);

fs.writeFileSync('hooks/useStock.js', code);
