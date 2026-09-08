import { supabase } from './lib/supabaseClient.js';
async function run() {
  const { error: itemsError } = await supabase
    .from('stock_take_items')
    .delete()
    .eq('id', -1);
  console.log('items error:', itemsError);
}
run();
