const fs = require('fs');
let code = fs.readFileSync('hooks/useStock.js', 'utf8');

const oldHandleOffline = `    const handleOffline = () => {
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName, tempId },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);
        
        const tempId = Math.random().toString(36).substr(2, 9);`;

const newHandleOffline = `    const handleOffline = () => {
        const tempId = Math.random().toString(36).substr(2, 9);
        const task = {
            id: Math.random().toString(36).substr(2, 9),
            action: 'ADD_STOCK',
            payload: { item, assignerName, tempId },
            timestamp: new Date().toISOString()
        };
        setSyncQueue(prev => [...prev, task]);
`;

code = code.replace(oldHandleOffline, newHandleOffline);
fs.writeFileSync('hooks/useStock.js', code);
