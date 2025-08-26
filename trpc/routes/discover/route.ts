import { z } from 'zod';
import { protectedProcedure } from '../../create-context';

// Procedure para obter dramas pré-carregados para descobrir
export const getDiscoverDramasProcedure = protectedProcedure
  .input(z.object({
    limit: z.number().min(1).max(50).default(30)
  }))
  .query(async ({ ctx, input }) => {
    try {
      console.log(`Fetching discover dramas for user ${ctx.user.id}, limit: ${input.limit}`);
      
      // Get user's drama lists to exclude (all statuses)
      const { data: userLists, error: listsError } = await ctx.supabase
        .from('user_drama_lists')
        .select('drama_id')
        .eq('user_id', ctx.user.id);

      if (listsError) {
        console.error('Error fetching user lists:', listsError);
      }

      const excludedDramaIds = userLists?.map(item => item.drama_id) || [];
      console.log(`Found ${excludedDramaIds.length} dramas in user lists to exclude`);

      // Get skipped dramas that haven't expired
      const { data: skippedDramas, error: skippedError } = await ctx.supabase
        .from('user_skipped_dramas')
        .select('drama_id')
        .eq('user_id', ctx.user.id)
        .gt('expires_at', new Date().toISOString());

      if (skippedError) {
        console.error('Error fetching skipped dramas:', skippedError);
      }

      const skippedDramaIds = skippedDramas?.map(item => item.drama_id) || [];
      console.log(`Found ${skippedDramaIds.length} skipped dramas to exclude`);
      
      const allExcludedIds = [...excludedDramaIds, ...skippedDramaIds];
      console.log(`Total excluded dramas: ${allExcludedIds.length}`);

      // Fetch popular K-dramas from TMDB API
      const tmdbApiKey = '8265bd1679663a7ea12ac168da84d2e8';
      let allKDramas: number[] = [];
      
      // Fetch multiple pages to get more dramas
      for (let page = 1; page <= 5; page++) {
        try {
          const response = await fetch(
            `https://api.themoviedb.org/3/discover/tv?api_key=${tmdbApiKey}&with_origin_country=KR&sort_by=popularity.desc&page=${page}&vote_average.gte=6.0`
          );
          
          if (response.ok) {
            const data = await response.json();
            const dramaIds = data.results?.map((drama: any) => drama.id) || [];
            allKDramas.push(...dramaIds);
          }
        } catch (error) {
          console.error(`Error fetching TMDB page ${page}:`, error);
        }
      }
      
      console.log(`Fetched ${allKDramas.length} K-dramas from TMDB`);
      
      // Remove duplicates
      const uniqueKDramas = [...new Set(allKDramas)];
      
      // Filter out excluded dramas
      const availableIds = uniqueKDramas.filter(id => !allExcludedIds.includes(id));
      
      console.log(`Available dramas after filtering: ${availableIds.length}`);
      
      if (availableIds.length === 0) {
        console.log('No available dramas after filtering, returning fallback list');
        // Fallback to a basic list if no dramas are available
        const fallbackDramas = [124834, 83097, 69050, 100757, 71712, 85552, 88329, 95479];
        const fallbackAvailable = fallbackDramas.filter(id => !allExcludedIds.includes(id));
        return fallbackAvailable.slice(0, Math.min(input.limit, fallbackAvailable.length));
      }
      
      // Shuffle and limit
      const shuffled = availableIds.sort(() => Math.random() - 0.5);
      const result = shuffled.slice(0, input.limit);
      
      console.log(`Returning ${result.length} discover dramas`);
      return result;

    } catch (error) {
      console.error('Error in getDiscoverDramasProcedure:', error);
      throw new Error('Failed to fetch discover dramas');
    }
  });

// Procedure para pular um drama
export const skipDramaProcedure = protectedProcedure
  .input(z.object({
    dramaId: z.number()
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const { error } = await ctx.supabase
        .from('user_skipped_dramas')
        .upsert({
          user_id: ctx.user.id,
          drama_id: input.dramaId,
          skipped_at: new Date().toISOString(),
          expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString() // 7 dias
        }, {
          onConflict: 'user_id,drama_id'
        });

      if (error) {
        console.error('Error skipping drama:', error);
        throw new Error('Failed to skip drama');
      }

      return { success: true };
    } catch (error) {
      console.error('Error in skipDramaProcedure:', error);
      throw new Error('Failed to skip drama');
    }
  });

// Procedure para obter status de swipes diários
export const getDailySwipesStatusProcedure = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      console.log(`Getting daily swipes status for user ${ctx.user.id}`);
      
      // Check if user is premium
      const { data: premiumData } = await ctx.supabase
        .from('premium_subscriptions')
        .select('status, expires_at')
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .single();

      const isPremium = !!premiumData;
      console.log(`User premium status: ${isPremium}`);

      // Get today's swipes
      const today = new Date().toISOString().split('T')[0];
      const { data: swipeData, error: swipeError } = await ctx.supabase
        .from('user_daily_swipes')
        .select('swipes_used, daily_limit')
        .eq('user_id', ctx.user.id)
        .eq('swipe_date', today)
        .single();

      if (swipeError && swipeError.code !== 'PGRST116') {
        console.error('Error fetching swipe data:', swipeError);
      }

      const swipesUsed = swipeData?.swipes_used || 0;
      const dailyLimit = swipeData?.daily_limit || 20;
      const remainingSwipes = isPremium ? -1 : Math.max(0, dailyLimit - swipesUsed);

      console.log(`Swipes used: ${swipesUsed}, Daily limit: ${dailyLimit}, Remaining: ${remainingSwipes}`);

      return {
        swipes_used: swipesUsed,
        daily_limit: dailyLimit,
        remaining_swipes: remainingSwipes,
        can_swipe: isPremium || swipesUsed < dailyLimit,
        is_premium: isPremium
      };
    } catch (error) {
      console.error('Error in getDailySwipesStatusProcedure:', error);
      // Return default values on error
      return {
        swipes_used: 0,
        daily_limit: 20,
        remaining_swipes: 20,
        can_swipe: true,
        is_premium: false
      };
    }
  });

// Procedure para incrementar contador de swipes
export const incrementDailySwipesProcedure = protectedProcedure
  .mutation(async ({ ctx }) => {
    try {
      console.log(`Incrementing daily swipes for user ${ctx.user.id}`);
      
      // Check if user is premium
      const { data: premiumData } = await ctx.supabase
        .from('premium_subscriptions')
        .select('status, expires_at')
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .gt('expires_at', new Date().toISOString())
        .single();

      const isPremium = !!premiumData;
      const today = new Date().toISOString().split('T')[0];
      const dailyLimit = 20;

      console.log(`User premium status: ${isPremium}, Today: ${today}`);

      // Get current swipes for today
      const { data: currentData, error: fetchError } = await ctx.supabase
        .from('user_daily_swipes')
        .select('swipes_used, daily_limit')
        .eq('user_id', ctx.user.id)
        .eq('swipe_date', today)
        .single();

      let newSwipesUsed = 1;
      
      if (fetchError && fetchError.code === 'PGRST116') {
        // No record exists, create new one
        console.log('Creating new daily swipes record');
        const { error: insertError } = await ctx.supabase
          .from('user_daily_swipes')
          .insert({
            user_id: ctx.user.id,
            swipe_date: today,
            swipes_used: 1,
            daily_limit: dailyLimit,
            is_premium: isPremium
          });

        if (insertError) {
          console.error('Error inserting new swipes record:', insertError);
          throw new Error('Failed to create swipes record');
        }
      } else if (currentData) {
        // Record exists, increment it
        newSwipesUsed = currentData.swipes_used + 1;
        console.log(`Updating existing record. Current: ${currentData.swipes_used}, New: ${newSwipesUsed}`);
        
        // Check if user has reached limit (only for non-premium users)
        if (!isPremium && newSwipesUsed > dailyLimit) {
          console.log('User has reached daily limit');
          return {
            success: false,
            swipes_used: currentData.swipes_used,
            daily_limit: dailyLimit,
            remaining_swipes: 0,
            is_premium: isPremium,
            message: 'Daily limit reached'
          };
        }
        
        const { error: updateError } = await ctx.supabase
          .from('user_daily_swipes')
          .update({ 
            swipes_used: newSwipesUsed,
            is_premium: isPremium,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', ctx.user.id)
          .eq('swipe_date', today);

        if (updateError) {
          console.error('Error updating swipes record:', updateError);
          throw new Error('Failed to update swipes record');
        }
      } else {
        console.error('Unexpected error fetching swipes data:', fetchError);
        throw new Error('Failed to fetch swipes data');
      }

      const remainingSwipes = isPremium ? -1 : Math.max(0, dailyLimit - newSwipesUsed);
      const canSwipe = isPremium || newSwipesUsed < dailyLimit;

      console.log(`Swipe successful. Used: ${newSwipesUsed}, Remaining: ${remainingSwipes}, Can swipe: ${canSwipe}`);

      return {
        success: true,
        swipes_used: newSwipesUsed,
        daily_limit: dailyLimit,
        remaining_swipes: remainingSwipes,
        is_premium: isPremium,
        message: 'Swipe successful'
      };
    } catch (error) {
      console.error('Error in incrementDailySwipesProcedure:', error);
      // Return a permissive response on error to not block the user
      return {
        success: true,
        swipes_used: 1,
        daily_limit: 20,
        remaining_swipes: 19,
        is_premium: false,
        message: 'Swipe successful (fallback)'
      };
    }
  });

// Procedure para limpar dramas pulados expirados (para uso administrativo)
export const cleanExpiredSkippedDramasProcedure = protectedProcedure
  .mutation(async ({ ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .rpc('clean_expired_skipped_dramas');

      if (error) {
        console.error('Error cleaning expired skipped dramas:', error);
        throw new Error('Failed to clean expired skipped dramas');
      }

      return { deletedCount: data || 0 };
    } catch (error) {
      console.error('Error in cleanExpiredSkippedDramasProcedure:', error);
      throw new Error('Failed to clean expired skipped dramas');
    }
  });