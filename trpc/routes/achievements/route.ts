import { z } from 'zod';
import { publicProcedure, protectedProcedure } from '@/backend/trpc/create-context';

// Get all achievements with user's unlock status
export const getUserAchievementsProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid().optional()
  }))
  .query(async ({ input, ctx }) => {
    try {
      const targetUserId = input.userId || ctx.user.id;
      
      // Get all achievements
      const { data: achievements, error: achievementsError } = await ctx.supabase
        .from('achievements')
        .select('*')
        .order('rarity', { ascending: true });

      if (achievementsError) throw achievementsError;

      // Get user's unlocked achievements
      const { data: userAchievements, error: userAchievementsError } = await ctx.supabase
        .from('user_achievements')
        .select('achievement_id, unlocked_at')
        .eq('user_id', targetUserId);

      if (userAchievementsError) throw userAchievementsError;

      // Create a map of unlocked achievements
      const unlockedMap = new Map(
        userAchievements?.map(ua => [ua.achievement_id, ua.unlocked_at]) || []
      );

      // Combine achievements with unlock status
      const achievementsWithStatus = achievements?.map(achievement => ({
        id: achievement.id,
        name: achievement.name,
        description: achievement.description,
        icon: achievement.icon,
        rarity: achievement.rarity as 'common' | 'rare' | 'legendary',
        isPremium: achievement.is_premium,
        unlockedAt: unlockedMap.get(achievement.id) || undefined
      })) || [];

      return achievementsWithStatus;
    } catch (error) {
      console.error('Error fetching user achievements:', error);
      throw new Error('Failed to fetch achievements');
    }
  });

// Get user's completed achievements only
export const getUserCompletedAchievementsProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }) => {
    try {
      // Get user's unlocked achievements with achievement details
      const { data: userAchievements, error } = await ctx.supabase
        .from('user_achievements')
        .select(`
          achievement_id,
          unlocked_at,
          achievements (
            id,
            name,
            description,
            icon,
            rarity,
            is_premium
          )
        `)
        .eq('user_id', input.userId)
        .order('unlocked_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (error) throw error;

      // Transform the data to match the expected format
      const completedAchievements = userAchievements?.map((ua: any) => ({
        id: ua.achievements.id,
        name: ua.achievements.name,
        description: ua.achievements.description,
        icon: ua.achievements.icon,
        rarity: ua.achievements.rarity as 'common' | 'rare' | 'legendary',
        isPremium: ua.achievements.is_premium,
        unlockedAt: ua.unlocked_at
      })) || [];

      return completedAchievements;
    } catch (error) {
      console.error('Error fetching completed achievements:', error);
      throw new Error('Failed to fetch completed achievements');
    }
  });

// Get achievement statistics for a user
export const getUserAchievementStatsProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .query(async ({ input, ctx }) => {
    try {
      // Get total achievements count
      const { count: totalAchievements, error: totalError } = await ctx.supabase
        .from('achievements')
        .select('*', { count: 'exact', head: true });

      if (totalError) throw totalError;

      // Get user's unlocked achievements count
      const { count: unlockedAchievements, error: unlockedError } = await ctx.supabase
        .from('user_achievements')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', input.userId);

      if (unlockedError) throw unlockedError;

      // Get achievements by rarity
      const { data: achievementsByRarity, error: rarityError } = await ctx.supabase
        .from('user_achievements')
        .select(`
          achievements (
            rarity
          )
        `)
        .eq('user_id', input.userId);

      if (rarityError) throw rarityError;

      // Count by rarity
      const rarityCount = {
        common: 0,
        rare: 0,
        legendary: 0
      };

      achievementsByRarity?.forEach((ua: any) => {
        const rarity = ua.achievements?.rarity as keyof typeof rarityCount;
        if (rarity && rarityCount.hasOwnProperty(rarity)) {
          rarityCount[rarity]++;
        }
      });

      // Get most recent achievement
      const { data: recentAchievement, error: recentError } = await ctx.supabase
        .from('user_achievements')
        .select(`
          unlocked_at,
          achievements (
            id,
            name,
            icon,
            rarity
          )
        `)
        .eq('user_id', input.userId)
        .order('unlocked_at', { ascending: false })
        .limit(1)
        .single();

      if (recentError && recentError.code !== 'PGRST116') {
        throw recentError;
      }

      return {
        totalAchievements: totalAchievements || 0,
        unlockedAchievements: unlockedAchievements || 0,
        completionPercentage: totalAchievements ? Math.round(((unlockedAchievements || 0) / totalAchievements) * 100) : 0,
        rarityBreakdown: rarityCount,
        mostRecentAchievement: recentAchievement ? {
          id: (recentAchievement as any).achievements.id,
          name: (recentAchievement as any).achievements.name,
          icon: (recentAchievement as any).achievements.icon,
          rarity: (recentAchievement as any).achievements.rarity,
          unlockedAt: recentAchievement.unlocked_at
        } : null
      };
    } catch (error) {
      console.error('Error fetching achievement stats:', error);
      throw new Error('Failed to fetch achievement statistics');
    }
  });

// Unlock achievement (for system use)
export const unlockAchievementProcedure = protectedProcedure
  .input(z.object({
    achievementId: z.string(),
    userId: z.string().uuid().optional()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      const targetUserId = input.userId || ctx.user.id;

      // Check if achievement exists
      const { data: achievement, error: achievementError } = await ctx.supabase
        .from('achievements')
        .select('*')
        .eq('id', input.achievementId)
        .single();

      if (achievementError) throw achievementError;
      if (!achievement) throw new Error('Achievement not found');

      // Check if already unlocked
      const { data: existingUnlock } = await ctx.supabase
        .from('user_achievements')
        .select('id')
        .eq('user_id', targetUserId)
        .eq('achievement_id', input.achievementId)
        .single();

      if (existingUnlock) {
        return { success: false, message: 'Achievement already unlocked' };
      }

      // Unlock the achievement
      const { error: unlockError } = await ctx.supabase
        .from('user_achievements')
        .insert({
          user_id: targetUserId,
          achievement_id: input.achievementId,
          unlocked_at: new Date().toISOString()
        });

      if (unlockError) throw unlockError;

      return { 
        success: true, 
        message: 'Achievement unlocked successfully',
        achievement: {
          id: achievement.id,
          name: achievement.name,
          description: achievement.description,
          icon: achievement.icon,
          rarity: achievement.rarity
        }
      };
    } catch (error) {
      console.error('Error unlocking achievement:', error);
      throw new Error('Failed to unlock achievement');
    }
  });