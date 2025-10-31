import { z } from 'zod';
import { protectedProcedure } from '../../create-context';

export const blockUserProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    const { error } = await ctx.supabase.rpc('block_user', {
      blocked_uuid: input.userId
    });

    if (error) {
      throw new Error(`Failed to block user: ${error.message}`);
    }

    return { success: true };
  });

export const unblockUserProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    const { error } = await ctx.supabase.rpc('unblock_user', {
      blocked_uuid: input.userId
    });

    if (error) {
      throw new Error(`Failed to unblock user: ${error.message}`);
    }

    return { success: true };
  });

export const isUserBlockedProcedure = protectedProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .query(async ({ input, ctx }) => {
    const { data, error } = await ctx.supabase.rpc('is_user_blocked', {
      blocker_uuid: ctx.user.id,
      blocked_uuid: input.userId
    });

    if (error) {
      throw new Error(`Failed to check if user is blocked: ${error.message}`);
    }

    return { isBlocked: data || false };
  });

export const getBlockedUsersProcedure = protectedProcedure
  .query(async ({ ctx }) => {
    const { data, error } = await ctx.supabase
      .from('user_blocks')
      .select(`
        blocked_id,
        created_at,
        blocked_user:users!user_blocks_blocked_id_fkey(
          id,
          username,
          display_name,
          profile_image
        )
      `)
      .eq('blocker_id', ctx.user.id);

    if (error) {
      throw new Error(`Failed to get blocked users: ${error.message}`);
    }

    return data || [];
  });