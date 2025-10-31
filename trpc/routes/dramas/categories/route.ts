import { z } from 'zod';
import { protectedProcedure } from '../../../create-context';

// Backfill drama categories for existing records
export const backfillDramaCategoriesProcedure = protectedProcedure
  .input(z.object({
    limit: z.number().min(1).max(100).default(50)
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      console.log('Starting drama categories backfill...');
      
      // Get dramas without categories
      const { data: dramasWithoutCategories, error: fetchError } = await ctx.supabase
        .from('user_drama_lists')
        .select('drama_id, drama_name')
        .is('drama_category', null)
        .limit(input.limit);
      
      if (fetchError) {
        console.error('Error fetching dramas without categories:', fetchError);
        throw new Error('Failed to fetch dramas without categories');
      }
      
      if (!dramasWithoutCategories || dramasWithoutCategories.length === 0) {
        return { 
          success: true, 
          message: 'No dramas found without categories',
          processed: 0,
          updated: 0
        };
      }
      
      console.log(`Found ${dramasWithoutCategories.length} dramas without categories`);
      
      // Get unique drama IDs
      const uniqueDramas = dramasWithoutCategories.reduce((acc, drama) => {
        if (!acc.find(d => d.drama_id === drama.drama_id)) {
          acc.push(drama);
        }
        return acc;
      }, [] as typeof dramasWithoutCategories);
      
      console.log(`Processing ${uniqueDramas.length} unique dramas`);
      
      const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
      const TMDB_BASE_URL = 'https://api.themoviedb.org/3';
      
      if (!TMDB_API_KEY) {
        throw new Error('TMDB API key not configured');
      }
      
      let updatedCount = 0;
      let processedCount = 0;
      
      // Process each unique drama
      for (const drama of uniqueDramas) {
        try {
          processedCount++;
          console.log(`Processing drama ${drama.drama_id}: ${drama.drama_name} (${processedCount}/${uniqueDramas.length})`);
          
          // Fetch drama details from TMDB
          const response = await fetch(
            `${TMDB_BASE_URL}/tv/${drama.drama_id}?language=pt-BR`,
            {
              headers: {
                Authorization: `Bearer ${TMDB_API_KEY}`,
                'Content-Type': 'application/json',
              },
            }
          );
          
          if (!response.ok) {
            console.warn(`Failed to fetch details for drama ${drama.drama_id}: ${response.status}`);
            continue;
          }
          
          const dramaDetails = await response.json();
          
          // Extract primary genre
          let category = null;
          if (dramaDetails.genres && Array.isArray(dramaDetails.genres) && dramaDetails.genres.length > 0) {
            category = dramaDetails.genres[0].name;
          }
          
          if (!category) {
            console.warn(`No genres found for drama ${drama.drama_id}`);
            continue;
          }
          
          console.log(`Found category "${category}" for drama ${drama.drama_id}`);
          
          // Update all records for this drama
          const { error: updateError } = await ctx.supabase
            .from('user_drama_lists')
            .update({ 
              drama_category: category,
              updated_at: new Date().toISOString()
            })
            .eq('drama_id', drama.drama_id)
            .is('drama_category', null);
          
          if (updateError) {
            console.error(`Error updating drama ${drama.drama_id}:`, updateError);
            continue;
          }
          
          updatedCount++;
          console.log(`Successfully updated category for drama ${drama.drama_id}`);
          
          // Add a small delay to avoid rate limiting
          await new Promise(resolve => setTimeout(resolve, 100));
          
        } catch (error) {
          console.error(`Error processing drama ${drama.drama_id}:`, error);
          continue;
        }
      }
      
      console.log(`Backfill completed. Processed: ${processedCount}, Updated: ${updatedCount}`);
      
      return {
        success: true,
        message: `Successfully processed ${processedCount} dramas and updated ${updatedCount} with categories`,
        processed: processedCount,
        updated: updatedCount
      };
      
    } catch (error) {
      console.error('Error in backfillDramaCategoriesProcedure:', error);
      throw new Error('Failed to backfill drama categories');
    }
  });

// Get statistics about drama categories
export const getDramaCategoryStatsProcedure = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      // Get total counts
      const { data: totalStats, error: totalError } = await ctx.supabase
        .from('user_drama_lists')
        .select('drama_category', { count: 'exact' });
      
      if (totalError) throw totalError;
      
      // Get records with categories
      const { data: withCategoryStats, error: categoryError } = await ctx.supabase
        .from('user_drama_lists')
        .select('drama_category', { count: 'exact' })
        .not('drama_category', 'is', null);
      
      if (categoryError) throw categoryError;
      
      // Get category breakdown
      const { data: categoryBreakdown, error: breakdownError } = await ctx.supabase
        .from('user_drama_lists')
        .select('drama_category')
        .not('drama_category', 'is', null);
      
      if (breakdownError) throw breakdownError;
      
      // Count categories
      const categoryCounts = categoryBreakdown?.reduce((acc, item) => {
        const category = item.drama_category || 'Unknown';
        acc[category] = (acc[category] || 0) + 1;
        return acc;
      }, {} as Record<string, number>) || {};
      
      const totalRecords = totalStats?.length || 0;
      const recordsWithCategory = withCategoryStats?.length || 0;
      const recordsMissingCategory = totalRecords - recordsWithCategory;
      
      return {
        totalRecords,
        recordsWithCategory,
        recordsMissingCategory,
        categoryBreakdown: categoryCounts,
        completionPercentage: totalRecords > 0 ? Math.round((recordsWithCategory / totalRecords) * 100) : 0
      };
      
    } catch (error) {
      console.error('Error in getDramaCategoryStatsProcedure:', error);
      throw new Error('Failed to get drama category statistics');
    }
  });