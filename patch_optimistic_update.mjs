import fs from 'fs';

let content = fs.readFileSync('hooks/useStock.js', 'utf8');

content = content.replace(
  'return { id: itemId, location, assigned_to };',
  'return { ...stock.find(i => i.id === itemId), location, assigned_to };'
);

content = content.replace(
  'return { id: itemId, location, assigned_to };',
  'return { ...stock.find(i => i.id === itemId), location, assigned_to };'
);

fs.writeFileSync('hooks/useStock.js', content, 'utf8');
console.log('Done!');
