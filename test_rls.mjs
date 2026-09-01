import { createClient } from '@supabase/supabase-js';
import fs from 'fs';

const env = fs.readFileSync('.env.local', 'utf8');
const supabaseUrl = env.match(/VITE_SUPABASE_URL=(.*)/)[1].trim();
const supabaseKey = env.match(/VITE_SUPABASE_ANON_KEY=(.*)/)[1].trim();
const supabase = createClient(supabaseUrl, supabaseKey);

async function test() {
  // Try to read profiles without user login (anon)
  console.log("Anon reading profiles...");
  const { data, error } = await supabase.from('profiles').select('*').limit(5);
  console.log("Error:", error?.message);
  console.log("Data length:", data?.length);
  
  // Try to login as stores@breganmainsflow.com if we know password, wait we don't.
}
test();
