import { z } from 'zod';
import { protectedProcedure } from '../../create-context';

export const completeDramaProcedure = protectedProcedure
  .input(
    z.object({
      dramaId: z.number(),
      dramaName: z.string(),
      totalRuntimeMinutes: z.number(),
    })
  )
  .mutation(async ({ ctx, input }) => {
    const { supabase, user } = ctx;
    const { dramaId, dramaName, totalRuntimeMinutes } = input;

    try {
      console.log('Completing drama for user:', user.id, 'Drama:', dramaId);

      // Get the drama from user_drama_lists to update it
      const { data: dramaData, error: fetchError } = await supabase
        .from('user_drama_lists')
        .select('*')
        .eq('user_id', user.id)
        .eq('drama_id', dramaId)
        .single();

      if (fetchError || !dramaData) {
        console.error('Error fetching drama data:', fetchError);
        throw new Error('Drama not found in user lists');
      }

      // Update the drama to completed status with all episodes watched
      const finalWatchedMinutes = dramaData.total_runtime_minutes || totalRuntimeMinutes;
      console.log(`Completing drama: total_runtime_minutes=${dramaData.total_runtime_minutes}, input totalRuntimeMinutes=${totalRuntimeMinutes}, final=${finalWatchedMinutes}`);
      
      const { error: updateError } = await supabase
        .from('user_drama_lists')
        .update({
          list_type: 'completed',
          current_episode: dramaData.total_episodes,
          episodes_watched: dramaData.total_episodes,
          watched_minutes: finalWatchedMinutes,
          updated_at: new Date().toISOString()
        })
        .eq('id', dramaData.id);

      if (updateError) {
        console.error('Error updating drama to completed:', updateError);
        throw new Error('Failed to complete drama');
      }

      console.log('Drama completed successfully in user_drama_lists');
      return { success: true, dramaId, totalRuntimeMinutes };
    } catch (error) {
      console.error('Error in completeDramaProcedure:', error);
      throw new Error('Failed to complete drama');
    }
  });

export const getCompletionHistoryProcedure = protectedProcedure
  .input(
    z.object({
      limit: z.number().optional().default(10),
    })
  )
  .query(async ({ ctx, input }) => {
    const { supabase, user } = ctx;
    const { limit } = input;

    try {
      const { data, error } = await supabase.rpc('get_user_completion_history', {
        p_user_id: user.id,
        p_limit: limit,
      });

      if (error) {
        console.error('Error fetching completion history:', error);
        throw new Error('Failed to fetch completion history');
      }

      return data || [];
    } catch (error) {
      console.error('Error in getCompletionHistoryProcedure:', error);
      throw new Error('Failed to fetch completion history');
    }
  });

export const getCompletionStatsProcedure = protectedProcedure
  .query(async ({ ctx }) => {
    const { supabase, user } = ctx;

    try {
      const { data, error } = await supabase.rpc('get_user_completion_stats', {
        p_user_id: user.id,
      });

      if (error) {
        console.error('Error fetching completion stats:', error);
        throw new Error('Failed to fetch completion stats');
      }

      return data || {
        total_completions: 0,
        total_watch_time_minutes: 0,
        average_drama_length_minutes: 0,
        first_completion_date: null,
        latest_completion_date: null,
      };
    } catch (error) {
      console.error('Error in getCompletionStatsProcedure:', error);
      throw new Error('Failed to fetch completion stats');
    }
  });

export const checkDramaCompletionProcedure = protectedProcedure
  .input(
    z.object({
      dramaId: z.number(),
    })
  )
  .query(async ({ ctx, input }) => {
    const { supabase, user } = ctx;
    const { dramaId } = input;

    try {
      const { data, error } = await supabase
        .from('user_drama_lists')
        .select('*')
        .eq('user_id', user.id)
        .eq('drama_id', dramaId)
        .eq('list_type', 'completed')
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error checking drama completion:', error);
        throw new Error('Failed to check drama completion');
      }

      return {
        isCompleted: !!data,
        completion: data || null,
      };
    } catch (error) {
      console.error('Error in checkDramaCompletionProcedure:', error);
      throw new Error('Failed to check drama completion');
    }
  });