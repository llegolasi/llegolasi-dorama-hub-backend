import { z } from 'zod';
import { publicProcedure, createTRPCRouter } from '../../create-context';

export const episodesRouter = createTRPCRouter({
  getByDramaId: publicProcedure
    .input(z.object({
      dramaId: z.number(),
      seasonNumber: z.number().optional(),
    }))
    .query(async ({ input, ctx }) => {
      const { data, error } = await ctx.supabase
        .rpc('get_drama_episodes', {
          p_drama_id: input.dramaId,
          p_season_number: input.seasonNumber || null,
        });

      if (error) {
        console.error('Error fetching drama episodes:', error);
        throw new Error('Failed to fetch episodes');
      }

      return data || [];
    }),

  getStats: publicProcedure
    .input(z.object({
      dramaId: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      const { data, error } = await ctx.supabase
        .rpc('get_drama_episode_stats', {
          p_drama_id: input.dramaId,
        });

      if (error) {
        console.error('Error fetching episode stats:', error);
        throw new Error('Failed to fetch episode statistics');
      }

      return data?.[0] || null;
    }),

  getUpcoming: publicProcedure
    .input(z.object({
      limit: z.number().default(10),
    }))
    .query(async ({ input, ctx }) => {
      const { data, error } = await ctx.supabase
        .rpc('get_upcoming_episodes', {
          p_limit: input.limit,
        });

      if (error) {
        console.error('Error fetching upcoming episodes:', error);
        throw new Error('Failed to fetch upcoming episodes');
      }

      return data || [];
    }),

  markAsWatched: publicProcedure
    .input(z.object({
      dramaId: z.number(),
      episodeNumber: z.number(),
    }))
    .mutation(async ({ input, ctx }) => {
      if (!ctx.user) {
        throw new Error('Authentication required');
      }

      const { error } = await ctx.supabase
        .rpc('mark_episodes_watched_up_to', {
          p_user_id: ctx.user.id,
          p_drama_id: input.dramaId,
          p_episode_number: input.episodeNumber,
        });

      if (error) {
        console.error('Error marking episodes as watched:', error);
        throw new Error('Failed to update episode progress');
      }

      return { success: true };
    }),

  getUserProgress: publicProcedure
    .input(z.object({
      dramaId: z.number(),
    }))
    .query(async ({ input, ctx }) => {
      if (!ctx.user) {
        return null;
      }

      const { data, error } = await ctx.supabase
        .from('user_drama_lists')
        .select('watched_episodes, episodes_watched, current_episode, list_type')
        .eq('user_id', ctx.user.id)
        .eq('drama_id', input.dramaId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching user progress:', error);
        throw new Error('Failed to fetch user progress');
      }

      return data || null;
    }),
});
