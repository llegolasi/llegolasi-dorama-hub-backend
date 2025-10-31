import { z } from 'zod';
import { publicProcedure, protectedProcedure } from '../../create-context';

// Get user profile
export const getUserProfileProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .query(async ({ input, ctx }) => {
    try {
      const { data: user, error: userError } = await ctx.supabase
        .from('users')
        .select('*')
        .eq('id', input.userId)
        .single();

      if (userError) throw userError;

      // Check if current user is following this user
      let isFollowing = false;
      if (ctx.user?.id && ctx.user.id !== input.userId) {
        const { data: followData } = await ctx.supabase
          .from('user_follows')
          .select('id')
          .eq('follower_id', ctx.user.id)
          .eq('following_id', input.userId)
          .single();
        
        isFollowing = !!followData;
      }

      // Get user's drama lists
      const { data: lists } = await ctx.supabase
        .from('user_drama_lists')
        .select('*')
        .eq('user_id', input.userId);

      // Get user's rankings
      const { data: rankings } = await ctx.supabase
        .from('user_rankings')
        .select(`
          *,
          ranking_items (
            drama_id,
            rank_position
          )
        `)
        .eq('user_id', input.userId)
        .eq('is_public', true);

      return {
        user: {
          ...user,
          isFollowing
        },
        lists: lists || [],
        rankings: rankings || []
      };
    } catch (error) {
      console.error('Error fetching user profile:', error);
      throw new Error('Failed to fetch user profile');
    }
  });

// Update user profile
export const updateUserProfileProcedure = protectedProcedure
  .input(z.object({
    displayName: z.string().min(1).max(100).optional(),
    bio: z.string().max(500).optional(),
    profileImage: z.string().url().optional(),
    userProfileCover: z.string().url().optional()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('users')
        .update({
          display_name: input.displayName,
          bio: input.bio,
          profile_image: input.profileImage,
          user_profile_cover: input.userProfileCover
        })
        .eq('id', ctx.user.id)
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error updating user profile:', error);
      throw new Error('Failed to update profile');
    }
  });

// Follow/unfollow user
export const toggleFollowUserProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      if (input.userId === ctx.user.id) {
        throw new Error('Cannot follow yourself');
      }

      // Check if already following
      const { data: existingFollow } = await ctx.supabase
        .from('user_follows')
        .select('id')
        .eq('follower_id', ctx.user.id)
        .eq('following_id', input.userId)
        .single();

      if (existingFollow) {
        // Unfollow
        const { error } = await ctx.supabase
          .from('user_follows')
          .delete()
          .eq('id', existingFollow.id);

        if (error) throw error;
        return { following: false };
      } else {
        // Follow
        const { error } = await ctx.supabase
          .from('user_follows')
          .insert({
            follower_id: ctx.user.id,
            following_id: input.userId
          });

        if (error) throw error;
        return { following: true };
      }
    } catch (error) {
      console.error('Error toggling follow:', error);
      throw new Error('Failed to toggle follow');
    }
  });

// Get user followers
export const getUserFollowersProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('user_follows')
        .select(`
          follower_id,
          users!user_follows_follower_id_fkey (
            id,
            username,
            display_name,
            profile_image
          )
        `)
        .eq('following_id', input.userId)
        .range(input.offset, input.offset + input.limit - 1);

      if (error) throw error;

      return data?.map(item => item.users) || [];
    } catch (error) {
      console.error('Error fetching followers:', error);
      throw new Error('Failed to fetch followers');
    }
  });

// Get user following
export const getUserFollowingProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('user_follows')
        .select(`
          following_id,
          users!user_follows_following_id_fkey (
            id,
            username,
            display_name,
            profile_image
          )
        `)
        .eq('follower_id', input.userId)
        .range(input.offset, input.offset + input.limit - 1);

      if (error) throw error;

      return data?.map(item => item.users) || [];
    } catch (error) {
      console.error('Error fetching following:', error);
      throw new Error('Failed to fetch following');
    }
  });

// Get followers with enhanced data for followers screen
export const getFollowersWithDetailsProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid().optional(),
    search: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      const targetUserId = input.userId || ctx.user.id;
      
      let query = ctx.supabase
        .from('user_follows')
        .select(`
          follower_id,
          created_at,
          users!user_follows_follower_id_fkey (
            id,
            username,
            display_name,
            profile_image,
            followers_count
          )
        `)
        .eq('following_id', targetUserId);

      if (input.search) {
        query = query.or(`users.display_name.ilike.%${input.search}%,users.username.ilike.%${input.search}%`);
      }

      const { data, error } = await query
        .range(input.offset, input.offset + input.limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        return [];
      }

      // Check if current user is following each follower
      const followersWithStatus = await Promise.all(
        data.map(async (item: any) => {
          const follower = item.users;
          if (!follower) return null;

          // Check if current user follows this follower (mutual follow)
          const { data: isFollowingData } = await ctx.supabase
            .from('user_follows')
            .select('id')
            .eq('follower_id', ctx.user.id)
            .eq('following_id', follower.id)
            .single();

          return {
            id: follower.id,
            username: follower.username,
            displayName: follower.display_name,
            profileImage: follower.profile_image,
            followersCount: follower.followers_count || 0,
            isFollowing: !!isFollowingData,
            isFollowingYou: true, // They are following the target user
            followedAt: item.created_at
          };
        })
      );

      return followersWithStatus.filter(Boolean);
    } catch (error) {
      console.error('Error fetching followers with details:', error);
      throw new Error('Failed to fetch followers');
    }
  });

// Get following with enhanced data for following screen
export const getFollowingWithDetailsProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid().optional(),
    search: z.string().optional(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      const targetUserId = input.userId || ctx.user.id;
      
      let query = ctx.supabase
        .from('user_follows')
        .select(`
          following_id,
          created_at,
          users!user_follows_following_id_fkey (
            id,
            username,
            display_name,
            profile_image,
            followers_count
          )
        `)
        .eq('follower_id', targetUserId);

      if (input.search) {
        query = query.or(`users.display_name.ilike.%${input.search}%,users.username.ilike.%${input.search}%`);
      }

      const { data, error } = await query
        .range(input.offset, input.offset + input.limit - 1)
        .order('created_at', { ascending: false });

      if (error) throw error;

      if (!data || data.length === 0) {
        return [];
      }

      // Check if each followed user follows back
      const followingWithStatus = await Promise.all(
        data.map(async (item: any) => {
          const followedUser = item.users;
          if (!followedUser) return null;

          // Check if this user follows back
          const { data: isFollowingBackData } = await ctx.supabase
            .from('user_follows')
            .select('id')
            .eq('follower_id', followedUser.id)
            .eq('following_id', targetUserId)
            .single();

          return {
            id: followedUser.id,
            username: followedUser.username,
            displayName: followedUser.display_name,
            profileImage: followedUser.profile_image,
            followersCount: followedUser.followers_count || 0,
            isFollowingYou: !!isFollowingBackData,
            followedAt: item.created_at
          };
        })
      );

      return followingWithStatus.filter(Boolean);
    } catch (error) {
      console.error('Error fetching following with details:', error);
      throw new Error('Failed to fetch following');
    }
  });

// Get user statistics with detailed analytics
export const getUserStatsProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().optional(),
    timeFilter: z.enum(['week', 'month', 'quarter', 'year', 'all']).default('month')
  }).transform((data) => {
    if (!data.userId || data.userId.trim() === '' || data.userId === 'undefined') {
      return { userId: undefined, timeFilter: data.timeFilter };
    }
    return { userId: data.userId, timeFilter: data.timeFilter };
  }))
  .query(async ({ input, ctx }) => {
    try {
      const targetUserId = input.userId || ctx.user.id;
      
      // Development mode - return mock stats
      if (ctx.isDevelopmentMode) {
        return {
          user_id: targetUserId,
          total_watch_time_minutes: 2340,
          total_episodes_watched: 156,
          dramas_completed: 12,
          dramas_watching: 3,
          dramas_in_watchlist: 8,
          average_drama_runtime: 195,
          completion_rate: 75,
          average_episodes_per_day: 1.2,
          most_active_hour: 20,
          time_data: [
            { label: 'Seg', value: 120, color: '#6366f1' },
            { label: 'Ter', value: 90, color: '#6366f1' },
            { label: 'Qua', value: 150, color: '#6366f1' },
            { label: 'Qui', value: 180, color: '#6366f1' },
            { label: 'Sex', value: 200, color: '#6366f1' },
            { label: 'Sáb', value: 240, color: '#6366f1' },
            { label: 'Dom', value: 160, color: '#6366f1' }
          ],
          genre_data: [
            { label: 'Romance', value: 35, color: '#FF6B9D' },
            { label: 'Drama', value: 25, color: '#96CEB4' },
            { label: 'Comédia', value: 20, color: '#45B7D1' },
            { label: 'Thriller', value: 15, color: '#4ECDC4' },
            { label: 'Histórico', value: 5, color: '#FFEAA7' }
          ],
          recent_completions: [
            { drama_id: 1, completed_at: new Date().toISOString() },
            { drama_id: 2, completed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString() }
          ],
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        };
      }
      
      // Get basic stats from user_drama_lists
      const { data: watchingDramas } = await ctx.supabase
        .from('user_drama_lists')
        .select('id, watched_minutes, total_runtime_minutes, drama_category')
        .eq('user_id', targetUserId)
        .eq('list_type', 'watching');

      const { data: watchlistDramas } = await ctx.supabase
        .from('user_drama_lists')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('list_type', 'watchlist');

      const { data: completedDramas } = await ctx.supabase
        .from('user_drama_lists')
        .select('id, watched_minutes, total_runtime_minutes, drama_category, updated_at')
        .eq('user_id', targetUserId)
        .eq('list_type', 'completed');

      // Get episode watch history for detailed analytics
      const { data: episodeHistory } = await ctx.supabase
        .from('episode_watch_history')
        .select('episode_number, episode_duration_minutes, watched_at, drama_id')
        .eq('user_id', targetUserId)
        .order('watched_at', { ascending: false });

      const totalEpisodesWatched = episodeHistory?.length || 0;
      
      // Calculate total watch time
      const totalWatchTime = (completedDramas || []).reduce((sum, drama) => {
        return sum + (drama.total_runtime_minutes || drama.watched_minutes || 0);
      }, 0) + (watchingDramas || []).reduce((sum, drama) => {
        return sum + (drama.watched_minutes || 0);
      }, 0);

      // Calculate time-based analytics
      const now = new Date();
      const timeData: { label: string; value: number; color: string }[] = [];
      const genreData: Record<string, number> = {};
      
      // Process episode history for time analytics
      if (episodeHistory && episodeHistory.length > 0) {
        const timeMap: Record<string, number> = {};
        
        episodeHistory.forEach(episode => {
          const watchDate = new Date(episode.watched_at);
          let key = '';
          
          switch (input.timeFilter) {
            case 'week':
              const dayOfWeek = watchDate.getDay();
              const days = ['Dom', 'Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb'];
              key = days[dayOfWeek];
              break;
            case 'month':
              key = watchDate.getDate().toString();
              break;
            case 'quarter':
            case 'year':
              key = watchDate.toLocaleDateString('pt-BR', { month: 'short' });
              break;
            case 'all':
              key = watchDate.getFullYear().toString();
              break;
          }
          
          timeMap[key] = (timeMap[key] || 0) + (episode.episode_duration_minutes || 60);
        });
        
        // Convert to array format for charts
        Object.entries(timeMap).forEach(([label, value]) => {
          timeData.push({ label, value, color: '#6366f1' });
        });
      }
      
      // Process genre data
      [...(completedDramas || []), ...(watchingDramas || [])].forEach(drama => {
        if (drama.drama_category) {
          genreData[drama.drama_category] = (genreData[drama.drama_category] || 0) + 1;
        }
      });
      
      // Convert genre data to percentage
      const totalDramas = Object.values(genreData).reduce((sum, count) => sum + count, 0);
      const genrePercentages = Object.entries(genreData).map(([genre, count]) => ({
        label: genre,
        value: totalDramas > 0 ? Math.round((count / totalDramas) * 100) : 0,
        color: getGenreColor(genre)
      }));
      
      // Calculate completion rate
      const totalDramasInLists = (completedDramas?.length || 0) + (watchingDramas?.length || 0) + (watchlistDramas?.length || 0);
      const completionRate = totalDramasInLists > 0 ? ((completedDramas?.length || 0) / totalDramasInLists) * 100 : 0;
      
      // Calculate average episodes per day
      const oldestEpisode = episodeHistory?.[episodeHistory.length - 1];
      const daysSinceStart = oldestEpisode ? 
        Math.max(1, Math.ceil((now.getTime() - new Date(oldestEpisode.watched_at).getTime()) / (1000 * 60 * 60 * 24))) : 1;
      const avgEpisodesPerDay = totalEpisodesWatched / daysSinceStart;
      
      // Find most active hour
      const hourCounts: Record<number, number> = {};
      episodeHistory?.forEach(episode => {
        const hour = new Date(episode.watched_at).getHours();
        hourCounts[hour] = (hourCounts[hour] || 0) + 1;
      });
      const mostActiveHour = Object.entries(hourCounts).reduce((max, [hour, count]) => 
        count > max.count ? { hour: parseInt(hour), count } : max, { hour: 20, count: 0 }).hour;
      
      return {
        user_id: targetUserId,
        total_watch_time_minutes: totalWatchTime,
        total_episodes_watched: totalEpisodesWatched,
        dramas_completed: completedDramas?.length || 0,
        dramas_watching: watchingDramas?.length || 0,
        dramas_in_watchlist: watchlistDramas?.length || 0,
        average_drama_runtime: (completedDramas?.length || 0) > 0 ? totalWatchTime / completedDramas!.length : 0,
        completion_rate: completionRate,
        average_episodes_per_day: avgEpisodesPerDay,
        most_active_hour: mostActiveHour,
        time_data: timeData,
        genre_data: genrePercentages,
        recent_completions: completedDramas?.slice(0, 5).map(drama => ({
          drama_id: drama.id,
          completed_at: drama.updated_at
        })) || [],
        created_at: new Date().toISOString(),
        updated_at: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in getUserStatsProcedure:', error);
      throw new Error('Failed to fetch user statistics');
    }
  });

// Helper function to get genre colors
function getGenreColor(genre: string): string {
  const colors: Record<string, string> = {
    'Romance': '#FF6B9D',
    'Comédia': '#45B7D1',
    'Drama': '#96CEB4',
    'Thriller': '#4ECDC4',
    'Ação': '#FF8C42',
    'Histórico': '#FFEAA7',
    'Fantasia': '#DDA0DD',
    'Mistério': '#87CEEB',
    'Slice of Life': '#98D8C8',
    'Médico': '#F7DC6F'
  };
  return colors[genre] || '#6366f1';
}

// Mark episode as watched
export const markEpisodeWatchedProcedure = protectedProcedure
  .input(z.object({
    dramaId: z.number(),
    episodeNumber: z.number().min(1),
    episodeDurationMinutes: z.number().min(1).default(60),
    startedAt: z.string().datetime().optional(),
    completedAt: z.string().datetime().optional()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      console.log('markEpisodeWatchedProcedure called with:', {
        userId: ctx.user.id,
        dramaId: input.dramaId,
        episodeNumber: input.episodeNumber,
        episodeDurationMinutes: input.episodeDurationMinutes
      });

      const completedAt = input.completedAt ? new Date(input.completedAt).toISOString() : new Date().toISOString();
      const startedAt = input.startedAt ? new Date(input.startedAt).toISOString() : new Date(Date.now() - 60 * 60 * 1000).toISOString();

      // First, check if episode_watch_history table exists
      const { error: tableCheckError } = await ctx.supabase
        .from('episode_watch_history')
        .select('id')
        .limit(1);

      if (tableCheckError) {
        console.error('episode_watch_history table does not exist or is not accessible:', tableCheckError);
        
        // Fallback: directly update user_drama_lists without using episode_watch_history
        const { data: currentDrama, error: getDramaError } = await ctx.supabase
          .from('user_drama_lists')
          .select('episodes_watched, watched_minutes, total_episodes, total_runtime_minutes')
          .eq('user_id', ctx.user.id)
          .eq('drama_id', input.dramaId)
          .single();

        if (getDramaError) {
          console.error('Error getting current drama data:', getDramaError);
          throw new Error(`Failed to get drama data: ${getDramaError.message}`);
        }

        const newEpisodesWatched = Math.max(currentDrama.episodes_watched || 0, input.episodeNumber);
        const newWatchedMinutes = (currentDrama.watched_minutes || 0) + input.episodeDurationMinutes;

        const { error: updateError } = await ctx.supabase
          .from('user_drama_lists')
          .update({
            episodes_watched: newEpisodesWatched,
            current_episode: newEpisodesWatched,
            watched_minutes: newWatchedMinutes,
            updated_at: new Date().toISOString()
          })
          .eq('user_id', ctx.user.id)
          .eq('drama_id', input.dramaId);

        if (updateError) {
          console.error('Error updating drama list (fallback):', updateError);
          throw new Error(`Failed to update drama progress: ${updateError.message}`);
        }

        return { success: true, message: 'Episode marked as watched successfully (fallback mode)' };
      }

      // Insert or update episode watch history
      const { error: historyError } = await ctx.supabase
        .from('episode_watch_history')
        .upsert({
          user_id: ctx.user.id,
          drama_id: input.dramaId,
          episode_number: input.episodeNumber,
          episode_duration_minutes: input.episodeDurationMinutes,
          watch_started_at: startedAt,
          watch_completed_at: completedAt,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString()
        }, {
          onConflict: 'user_id,drama_id,episode_number'
        });

      if (historyError) {
        console.error('Error inserting episode history:', historyError);
        throw new Error(`Failed to record episode history: ${historyError.message}`);
      }

      // Get the count of watched episodes for this drama
      const { data: watchedEpisodes, error: countError } = await ctx.supabase
        .from('episode_watch_history')
        .select('episode_number, episode_duration_minutes')
        .eq('user_id', ctx.user.id)
        .eq('drama_id', input.dramaId);

      if (countError) {
        console.error('Error counting watched episodes:', countError);
        throw new Error(`Failed to count watched episodes: ${countError.message}`);
      }

      const episodesWatched = watchedEpisodes?.length || 0;
      const totalWatchTime = watchedEpisodes?.reduce((sum, ep) => sum + (ep.episode_duration_minutes || 60), 0) || 0;

      // Update user_drama_lists with the new episode count and watch time
      const { error: updateError } = await ctx.supabase
        .from('user_drama_lists')
        .update({
          episodes_watched: episodesWatched,
          current_episode: episodesWatched,
          watched_minutes: totalWatchTime,
          updated_at: new Date().toISOString()
        })
        .eq('user_id', ctx.user.id)
        .eq('drama_id', input.dramaId);

      if (updateError) {
        console.error('Error updating drama list:', updateError);
        throw new Error(`Failed to update drama progress: ${updateError.message}`);
      }

      console.log('Episode marked as watched successfully:', {
        episodesWatched,
        totalWatchTime
      });

      return { success: true, message: 'Episode marked as watched successfully' };
    } catch (error) {
      console.error('Error in markEpisodeWatchedProcedure:', error);
      throw new Error(`Failed to mark episode as watched: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

// Complete drama with date range
export const completeDramaWithDateRangeProcedure = protectedProcedure
  .input(z.object({
    dramaId: z.number(),
    totalEpisodes: z.number().min(1),
    startDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    endDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/),
    episodeDurationMinutes: z.number().min(1).default(60),
    dramaCategory: z.string().optional(),
    dramaName: z.string().optional(),
    posterPath: z.string().optional(),
    posterImage: z.string().optional(),
    dramaYear: z.number().optional(),
    totalRuntimeMinutes: z.number().optional()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      console.log('completeDramaWithDateRangeProcedure called with:', {
        userId: ctx.user.id,
        dramaId: input.dramaId,
        totalEpisodes: input.totalEpisodes,
        startDate: input.startDate,
        endDate: input.endDate,
        episodeDurationMinutes: input.episodeDurationMinutes,
        dramaCategory: input.dramaCategory
      });

      // Use the database function to complete drama with date range
      const { data, error } = await ctx.supabase.rpc('complete_drama_with_date_range', {
        p_user_id: ctx.user.id,
        p_drama_id: input.dramaId,
        p_total_episodes: input.totalEpisodes,
        p_start_date: input.startDate,
        p_end_date: input.endDate,
        p_episode_duration_minutes: input.episodeDurationMinutes,
        p_drama_category: input.dramaCategory,
        p_drama_name: input.dramaName,
        p_poster_path: input.posterPath,
        p_poster_image: input.posterImage,
        p_drama_year: input.dramaYear,
        p_total_runtime_minutes: input.totalRuntimeMinutes
      });
      
      if (error) {
        console.error('Error calling complete_drama_with_date_range RPC:', error);
        throw new Error(`Failed to complete drama with date range: ${error.message}`);
      }
      
      if (!data) {
        throw new Error('RPC function returned no data');
      }
      
      console.log('Drama completed with date range successfully:', data);
      return { success: true, message: 'Drama completed with date range successfully' };
    } catch (error) {
      console.error('Error in completeDramaWithDateRangeProcedure:', error);
      throw new Error(`Failed to complete drama with date range: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  });

// Update user statistics manually (for debugging)
export const updateUserStatsProcedure = protectedProcedure
  .mutation(async ({ ctx }) => {
    try {
      // First try the RPC function
      const { error: rpcError } = await ctx.supabase.rpc('update_user_statistics', {
        p_user_id: ctx.user.id
      });

      if (rpcError) {
        console.log('RPC function failed, updating manually:', rpcError);
        
        // Fallback: manually update stats
        // Count dramas in each list
        const { data: watchingDramas } = await ctx.supabase
          .from('user_drama_lists')
          .select('id')
          .eq('user_id', ctx.user.id)
          .eq('list_type', 'watching');

        const { data: watchlistDramas } = await ctx.supabase
          .from('user_drama_lists')
          .select('id')
          .eq('user_id', ctx.user.id)
          .eq('list_type', 'watchlist');

        const { data: completedDramas } = await ctx.supabase
          .from('user_drama_lists')
          .select('id')
          .eq('user_id', ctx.user.id)
          .eq('list_type', 'completed');

        // Get total watch time from user_drama_lists only
        const { data: allDramas } = await ctx.supabase
          .from('user_drama_lists')
          .select('watched_minutes, total_runtime_minutes, list_type')
          .eq('user_id', ctx.user.id);

        const totalWatchTime = allDramas?.reduce((sum, drama) => {
          // For completed dramas, use total_runtime_minutes
          // For watching dramas, use watched_minutes (partial progress)
          if (drama.list_type === 'completed') {
            return sum + (drama.total_runtime_minutes || 0);
          } else if (drama.list_type === 'watching') {
            return sum + (drama.watched_minutes || 0);
          }
          return sum;
        }, 0) || 0;

        // Update user stats
        const { error: updateError } = await ctx.supabase
          .from('user_stats')
          .upsert({
            user_id: ctx.user.id,
            total_watch_time_minutes: totalWatchTime,
            dramas_completed: completedDramas?.length || 0,
            dramas_watching: watchingDramas?.length || 0,
            dramas_in_watchlist: watchlistDramas?.length || 0,
            updated_at: new Date().toISOString()
          });

        if (updateError) {
          console.error('Error manually updating user stats:', updateError);
          throw new Error('Failed to update user statistics');
        }
      }

      return { success: true, message: 'User statistics updated successfully' };
    } catch (error) {
      console.error('Error in updateUserStatsProcedure:', error);
      throw new Error('Failed to update user statistics');
    }
  });

// Get user's completed dramas with details
export const getUserCompletedDramasProcedure = publicProcedure
  .input(z.object({
    userId: z.string(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      // Development mode - return mock completed dramas
      if (ctx.isDevelopmentMode) {
        return [
          {
            id: 1,
            name: 'Crash Landing on You',
            poster_path: '/t6jVlbPBwJlBMOtGXMJjAJQMppz.jpg',
            first_air_date: '2019-12-14',
            rating: 9,
            completed_at: new Date().toISOString()
          },
          {
            id: 2,
            name: 'Goblin',
            poster_path: '/x2BHx02VoVmKMHcSOab9NkJf88X.jpg',
            first_air_date: '2016-12-02',
            rating: 8,
            completed_at: new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString()
          },
          {
            id: 3,
            name: 'Descendants of the Sun',
            poster_path: '/lKkThflmJFONZXoI7xFdQbh4dFE.jpg',
            first_air_date: '2016-02-24',
            rating: 7,
            completed_at: new Date(Date.now() - 48 * 60 * 60 * 1000).toISOString()
          }
        ].slice(input.offset, input.offset + input.limit);
      }
      const { data: completedDramas, error } = await ctx.supabase
        .from('user_drama_lists')
        .select(`*`)
        .eq('user_id', input.userId)
        .eq('list_type', 'completed')
        .order('updated_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (error) throw error;

      if (!completedDramas || completedDramas.length === 0) {
        return [];
      }

      const TMDB_API_KEY = process.env.EXPO_PUBLIC_TMDB_API_KEY;
      const TMDB_BASE_URL = 'https://api.themoviedb.org/3';

      const results = await Promise.all(
        completedDramas.map(async (item: any) => {
          const name: string | undefined = item.drama_name ?? item.name;
          const posterPath: string | null = item.poster_path ?? null;
          const posterImage: string | null = item.poster_image ?? null;
          const year: number | null = item.drama_year ?? null;

          if (name && (posterPath || posterImage)) {
            return {
              id: item.drama_id,
              name,
              poster_path: posterPath ?? posterImage,
              first_air_date: year ? `${year}-01-01` : '',
              rating: item.rating ?? null,
              completed_at: item.updated_at,
            };
          }

          if (!TMDB_API_KEY) {
            return {
              id: item.drama_id,
              name: name ?? '—',
              poster_path: posterPath ?? null,
              first_air_date: year ? `${year}-01-01` : '',
              rating: item.rating ?? null,
              completed_at: item.updated_at,
            };
          }

          try {
            const response = await fetch(
              `${TMDB_BASE_URL}/tv/${item.drama_id}?language=pt-BR`,
              {
                headers: {
                  Authorization: `Bearer ${TMDB_API_KEY}`,
                  'Content-Type': 'application/json',
                },
              }
            );

            if (!response.ok) {
              console.error(`Failed to fetch drama ${item.drama_id}: ${response.status}`);
              return {
                id: item.drama_id,
                name: name ?? '—',
                poster_path: posterPath ?? null,
                first_air_date: year ? `${year}-01-01` : '',
                rating: item.rating ?? null,
                completed_at: item.updated_at,
              };
            }

            const dramaData = await response.json();
            return {
              id: dramaData.id,
              name: dramaData.name,
              poster_path: dramaData.poster_path,
              first_air_date: dramaData.first_air_date ?? (year ? `${year}-01-01` : ''),
              rating: item.rating ?? null,
              completed_at: item.updated_at,
            };
          } catch (e) {
            console.error(`Error fetching drama ${item.drama_id}:`, e);
            return {
              id: item.drama_id,
              name: name ?? '—',
              poster_path: posterPath ?? null,
              first_air_date: year ? `${year}-01-01` : '',
              rating: item.rating ?? null,
              completed_at: item.updated_at,
            };
          }
        })
      );

      return results.filter((d: any) => d && d.id);
    } catch (error) {
      console.error('Error fetching completed dramas:', error);
      throw new Error('Failed to fetch completed dramas');
    }
  });

// Update user profile cover
export const updateUserProfileCoverProcedure = protectedProcedure
  .input(z.object({
    coverImageUrl: z.string().url()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      // Development mode - return mock success
      if (ctx.isDevelopmentMode) {
        return {
          id: ctx.user.id,
          user_profile_cover: input.coverImageUrl,
          updated_at: new Date().toISOString()
        };
      }

      // Check if user has premium subscription
      const { data: subscription } = await ctx.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .gte('expires_at', new Date().toISOString())
        .single();

      if (!subscription) {
        throw new Error('Premium subscription required to set profile cover');
      }

      const { data, error } = await ctx.supabase
        .from('users')
        .update({
          user_profile_cover: input.coverImageUrl
        })
        .eq('id', ctx.user.id)
        .select()
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error updating user profile cover:', error);
      throw new Error(error instanceof Error ? error.message : 'Failed to update profile cover');
    }
  });

// Get available profile avatars
export const getProfileAvatarsProcedure = publicProcedure
  .query(async ({ ctx }) => {
    try {
      const { data: avatars, error } = await ctx.supabase
        .from('profileavatares')
        .select('id, profile_avatares_url')
        .order('id', { ascending: true });

      if (error) {
        console.error('Error fetching avatars:', error);
        return [];
      }

      if (!avatars || avatars.length === 0) {
        return [];
      }

      // Map to the expected format
      return avatars.map(avatar => ({
        id: avatar.id.toString(),
        name: `Avatar ${avatar.id}`,
        url: avatar.profile_avatares_url
      }));
    } catch (error) {
      console.error('Error in getProfileAvatarsProcedure:', error);
      return [];
    }
  });

// Check if user has premium subscription
export const checkUserPremiumStatusProcedure = protectedProcedure
  .query(async ({ ctx }) => {
    try {
      // Development mode - return mock premium status
      if (ctx.isDevelopmentMode) {
        return {
          isPremium: true, // Mock premium for development
          subscription: {
            id: 'dev_subscription',
            user_id: ctx.user.id,
            plan_id: 'premium_monthly',
            status: 'active',
            expires_at: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString(), // 30 days from now
            created_at: new Date().toISOString(),
            updated_at: new Date().toISOString()
          }
        };
      }

      const { data: subscription } = await ctx.supabase
        .from('user_subscriptions')
        .select('*')
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .gte('expires_at', new Date().toISOString())
        .single();

      return {
        isPremium: !!subscription,
        subscription: subscription || null
      };
    } catch (error) {
      console.error('Error checking premium status:', error);
      return {
        isPremium: false,
        subscription: null
      };
    }
  });