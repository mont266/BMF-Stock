import { supabase } from './lib/supabaseClient.js';
async function run() {
  const { data, error } = await supabase.from('profiles').select('*').limit(1);
  console.log(error || data);
}
run();
