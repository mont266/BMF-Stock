import fs from 'fs';

for (const file of ['components/StockManagerApp.jsx', 'components/PurchasingPage.jsx']) {
    let content = fs.readFileSync(file, 'utf8');

    content = content.replace(
      /const \{ data: \{ user \} \} = await supabase\.auth\.getUser\(\);/g,
      'const { data: { session } } = await supabase.auth.getSession();\n      const user = session?.user;'
    );
    
    // There are cases where it might be structured slightly differently:
    // const { data: { user } } = await supabase.auth.getUser();
    content = content.replace(
      /const \{\s*data:\s*\{\s*user\s*\}\s*\}\s*=\s*await supabase\.auth\.getUser\(\);/g,
      'const { data: { session } } = await supabase.auth.getSession();\nconst user = session?.user;'
    );

    fs.writeFileSync(file, content, 'utf8');
}
console.log('Done patching components');
