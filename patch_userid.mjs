import fs from 'fs';

const files = [
  'components/ProfileSelection.jsx',
  'components/StockManagerApp.jsx',
  'components/PurchasingPage.jsx',
  'hooks/useStock.js'
];

for (const file of files) {
  let content = fs.readFileSync(file, 'utf8');
  
  // Remove .eq('user_id', user.id)
  content = content.replace(/\.eq\('user_id',\s*user\.id\)/g, '');
  
  // Remove .eq('user_id', session.user.id)
  content = content.replace(/\.eq\('user_id',\s*session\.user\.id\)/g, '');
  
  fs.writeFileSync(file, content, 'utf8');
}
console.log('Done!');
