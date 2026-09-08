const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

code = code.replace(
    /payload: \{ item, assignerName \}/,
    `payload: { item, assignerName, tempId }`
);

code = code.replace(
    /const task = \{\n            id: Math.random\(\).toString\(36\).substr\(2, 9\),\n            action: 'ADD_STOCK',\n            payload: \{ item, assignerName \},\n            timestamp: new Date\(\).toISOString\(\)\n        \};\n        setSyncQueue\(prev => \[\.\.\.prev, task\]\);\n        \n        const tempId = Math.random\(\).toString\(36\).substr\(2, 9\);/,
    `const tempId = Math.random().toString(36).substr(2, 9);
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName, tempId },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);`
);

fs.writeFileSync('hooks/useStock.js', code);
