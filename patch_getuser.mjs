import fs from 'fs';

let content = fs.readFileSync('hooks/useStock.js', 'utf8');

content = content.replace(
  /const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);/g,
  'const { data: { session } } = await supabase.auth.getSession();\n    const user = session?.user;'
);

fs.writeFileSync('hooks/useStock.js', content, 'utf8');
console.log('Done!');
