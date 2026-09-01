import fs from 'fs';

let content = fs.readFileSync('hooks/useStock.js', 'utf8');

content = content.replace(
  'const newItem = { ...item, location: Location.LEADING_STORES, assigned_to: Team.UNASSIGNED, user_id: user.id };',
  'const newItem = { ...item, location: Location.LEADING_STORES, assigned_to: Team.UNASSIGNED, user_id: user.id };'
);

// Actually, I don't need to patch queue. It already uses `const newItem = { ...item }`.
