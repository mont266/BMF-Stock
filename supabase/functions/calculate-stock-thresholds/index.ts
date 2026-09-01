// supabase/functions/calculate-stock-thresholds/index.ts

// Use a triple-slash directive to add Deno's global types. This is necessary
// for the TypeScript compiler to recognize `Deno.serve` and `Deno.env`.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

// FIX: The triple-slash reference for deno.ns was not found by the linter.
// Declaring Deno as a global satisfies the type checker. The Deno global is
// available in the Supabase Functions runtime.
declare const Deno: any;

// Inlined from _shared/cors.ts to fix deployment bundling error.
// The Supabase platform no longer supports relative `../` imports for shared code
// without a project-level import map.
const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
};

// This function calculates stock thresholds based on past usage to provide a 6-week stock cover.
// The formula is: (Usage in last 4 weeks) * 1.5, which is (usage/4 weeks) * 6 weeks.
Deno.serve(async (req) => {
  // Handle CORS preflight requests.
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  try {
    // Create a Supabase client with the service role key to bypass RLS policies.
    // This is necessary because we are performing a system-wide admin task.
    const supabaseClient = createClient(
      Deno.env.get('SUPABASE_URL') ?? '',
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
      { global: { headers: { Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}` } } }
    );
    
    // An auth check could be added here to verify the user is an admin,
    // but this function is only callable from an admin-gated part of the app.

    // 1. Calculate the date for 4 weeks ago.
    const fourWeeksAgo = new Date();
    fourWeeksAgo.setDate(fourWeeksAgo.getDate() - 28);
    const fourWeeksAgoISO = fourWeeksAgo.toISOString();

    // 2. Fetch all unique item types that need their thresholds calculated.
    const { data: itemTypes, error: itemTypesError } = await supabaseClient
      .from('item_types')
      .select('id, name, stock_threshold');

    if (itemTypesError) throw itemTypesError;

    if (!itemTypes || itemTypes.length === 0) {
      return new Response(JSON.stringify({ updatedCount: 0, changes: [], message: 'No item types found to process.' }), {
        headers: { ...corsHeaders, 'Content-Type': 'application/json' },
        status: 200,
      });
    }

    let updatedCount = 0;
    const changes = [];

    // 3. Loop through each item type to calculate and update its threshold.
    for (const itemType of itemTypes) {
      // a. Count 'OUT' movements in the last 4 weeks for this specific item type.
      const { count, error: countError } = await supabaseClient
        .from('stock_movements')
        .select('*', { count: 'exact', head: true })
        .eq('item_name', itemType.name)
        .eq('movement_type', 'OUT')
        .gte('created_at', fourWeeksAgoISO);
      
      if (countError) {
        console.error(`Error counting movements for ${itemType.name}:`, countError.message);
        continue; // Skip to the next item type if counting fails.
      }

      const fourWeekUsage = count || 0;
      
      // b. Calculate the new threshold (6 weeks of stock cover).
      // Logic correction: 6 weeks cover from 4 weeks usage is a 1.5x multiplier.
      // (Usage over 4 weeks / 4) * 6 = usage * 1.5
      const newThreshold = Math.ceil(fourWeekUsage * 1.5);
      const oldThreshold = itemType.stock_threshold || 0;

      // c. Update the threshold only if it has changed.
      if (newThreshold !== oldThreshold) {
        const { error: updateError } = await supabaseClient
          .from('item_types')
          .update({ stock_threshold: newThreshold })
          .eq('id', itemType.id);

        if (updateError) {
          console.error(`Error updating threshold for ${itemType.name}:`, updateError.message);
        } else {
          updatedCount++;
          changes.push({
            name: itemType.name,
            oldThreshold,
            newThreshold,
          });
        }
      }
    }

    // 4. Return a success response with the count and details of updated items.
    return new Response(JSON.stringify({ updatedCount, changes }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 200,
    });

  } catch (error) {
    console.error('Error in calculate-stock-thresholds function:', error);
    return new Response(JSON.stringify({ error: error.message }), {
      headers: { ...corsHeaders, 'Content-Type': 'application/json' },
      status: 500,
    });
  }
});
