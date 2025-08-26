import { z } from 'zod';
import { publicProcedure, protectedProcedure } from '../../create-context';
import { TRPCError } from '@trpc/server';

// Get user rankings
export const getUserRankingsProcedure = publicProcedure
  .input(z.object({
    userId: z.string().uuid()
  }))
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('user_rankings')
        .select(`
          *,
          ranking_items (
            drama_id,
            rank_position,
            drama_title,
            poster_image,
            cover_image
          ),
          users!inner (
            username,
            display_name,
            profile_image,
            user_type
          )
        `)
        .eq('user_id', input.userId)
        .eq('is_public', true)
        .order('created_at', { ascending: false });

      if (error) throw error;

      return data || [];
    } catch (error) {
      console.error('Error fetching user rankings:', error);
      throw new Error('Failed to fetch user rankings');
    }
  });

// Get ranking details
export const getRankingDetailsProcedure = publicProcedure
  .input(z.object({
    rankingId: z.string().uuid()
  }))
  .query(async ({ input, ctx }) => {
    try {
      const { data: ranking, error: rankingError } = await ctx.supabase
        .from('user_rankings')
        .select(`
          *,
          ranking_items (
            drama_id,
            rank_position,
            drama_title,
            poster_image,
            cover_image
          ),
          users!inner (
            username,
            display_name,
            profile_image,
            user_type
          )
        `)
        .eq('id', input.rankingId)
        .single();

      if (rankingError) throw rankingError;

      const { data: comments, error: commentsError } = await ctx.supabase
        .from('ranking_comments')
        .select(`
          *,
          users!inner (
            username,
            display_name,
            profile_image,
            user_type
          )
        `)
        .eq('ranking_id', input.rankingId)
        .is('parent_comment_id', null)
        .order('created_at', { ascending: true });

      if (commentsError) throw commentsError;

      const parentIds = (comments ?? []).map((c: any) => c.id);
      let repliesByParent: Record<string, any[]> = {};
      if (parentIds.length > 0) {
        const { data: replies, error: repliesError } = await ctx.supabase
          .from('ranking_comments')
          .select(`
            *,
            users!inner (
              username,
              display_name,
              profile_image,
              user_type
            )
          `)
          .in('parent_comment_id', parentIds)
          .order('created_at', { ascending: true });
        if (repliesError) throw repliesError;
        repliesByParent = (replies || []).reduce((acc: Record<string, any[]>, r: any) => {
          const key = r.parent_comment_id as string;
          if (!acc[key]) acc[key] = [];
          acc[key].push(r);
          return acc;
        }, {});
      }

      const commentsWithReplies = (comments || []).map((c: any) => ({
        ...c,
        replies: repliesByParent[c.id] ?? []
      }));

      return {
        ranking,
        comments: commentsWithReplies
      };
    } catch (error) {
      console.error('Error fetching ranking details:', error);
      throw new Error('Failed to fetch ranking details');
    }
  });

// Create new ranking
export const saveRankingProcedure = protectedProcedure
  .input(z.object({
    title: z.string().min(1).max(100),
    description: z.string().max(500).optional(),
    items: z.array(z.object({
      dramaId: z.number(),
      dramaTitle: z.string(),
      posterImage: z.string().nullable().optional(),
      coverImage: z.string().nullable().optional(),
      dramaYear: z.number().nullable().optional(),
    })).min(1).max(20),
    isPublic: z.boolean().default(true)
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      const { data: ranking, error: createError } = await ctx.supabase
        .from('user_rankings')
        .insert({
          user_id: ctx.user.id,
          title: input.title,
          description: input.description ?? null,
          is_public: input.isPublic
        })
        .select('*')
        .single();

      if (createError || !ranking) {
        console.error('Create ranking error:', createError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Create ranking failed: ${createError?.message ?? 'unknown error'}`, cause: createError });
      }

      const rankingItems = input.items.map((item, index) => ({
        ranking_id: ranking.id,
        drama_id: Number(item.dramaId),
        rank_position: index + 1,
        drama_title: item.dramaTitle,
        poster_image: item.posterImage ?? null,
        cover_image: item.coverImage ?? null,
        drama_year: item.dramaYear ?? null,
      }));

      const { error: itemsError } = await ctx.supabase
        .from('ranking_items')
        .insert(rankingItems);

      if (itemsError) {
        console.error('Insert ranking items error:', itemsError);
        throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: `Failed inserting ranking items: ${itemsError.message}` , cause: itemsError });
      }

      const postContent = (input.description && input.description.trim().length > 0)
        ? input.description
        : `Meu ranking: ${input.title}`;

      const { error: postError } = await ctx.supabase
        .from('community_posts')
        .insert({
          user_id: ctx.user.id,
          post_type: 'ranking',
          content: postContent,
          ranking_id: ranking.id,
        });

      if (postError) {
        console.error('Create community post for ranking error:', postError);
        // Do not fail the whole operation if community post fails, but surface as TRPCError
      }

      return ranking;
    } catch (error: unknown) {
      console.error('Error saving ranking:', error);
      if (error instanceof TRPCError) throw error;
      throw new TRPCError({ code: 'INTERNAL_SERVER_ERROR', message: 'Failed to save ranking', cause: error });
    }
  });

// Like/unlike ranking
export const toggleRankingLikeProcedure = protectedProcedure
  .input(z.object({
    rankingId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      // Check if user already liked the ranking
      const { data: existingLike } = await ctx.supabase
        .from('ranking_likes')
        .select('id')
        .eq('ranking_id', input.rankingId)
        .eq('user_id', ctx.user.id)
        .single();

      if (existingLike) {
        // Unlike
        const { error } = await ctx.supabase
          .from('ranking_likes')
          .delete()
          .eq('id', existingLike.id);

        if (error) throw error;
        return { liked: false };
      } else {
        // Like
        const { error } = await ctx.supabase
          .from('ranking_likes')
          .insert({
            ranking_id: input.rankingId,
            user_id: ctx.user.id
          });

        if (error) throw error;
        return { liked: true };
      }
    } catch (error) {
      console.error('Error toggling ranking like:', error);
      throw new Error('Failed to toggle like');
    }
  });

// Add comment to ranking
export const addRankingCommentProcedure = protectedProcedure
  .input(z.object({
    rankingId: z.string().uuid(),
    content: z.string().min(1).max(500),
    parentCommentId: z.string().uuid().optional()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('ranking_comments')
        .insert({
          ranking_id: input.rankingId,
          user_id: ctx.user.id,
          content: input.content,
          parent_comment_id: input.parentCommentId
        })
        .select(`
          *,
          users!inner (
            username,
            display_name,
            profile_image,
            user_type
          )
        `)
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error adding ranking comment:', error);
      throw new Error('Failed to add comment');
    }
  });

// Delete ranking comment
export const deleteRankingCommentProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      // Check if comment exists and belongs to user
      const { data: comment, error: fetchError } = await ctx.supabase
        .from('ranking_comments')
        .select('user_id')
        .eq('id', input.commentId)
        .single();

      if (fetchError) {
        console.error('Error fetching comment:', fetchError);
        if ((fetchError as any)?.code === 'PGRST116') {
          throw new Error('Comment not found');
        }
        throw new Error('Failed to fetch comment');
      }

      if (!comment) {
        throw new Error('Comment not found');
      }

      if (comment.user_id !== ctx.user.id) {
        throw new Error('You can only delete your own comments');
      }

      // Delete the comment
      const { error: deleteError } = await ctx.supabase
        .from('ranking_comments')
        .delete()
        .eq('id', input.commentId)
        .eq('user_id', ctx.user.id);

      if (deleteError) {
        console.error('Error deleting comment:', deleteError);
        throw new Error('Failed to delete comment');
      }

      return { success: true };
    } catch (error) {
      console.error('Delete ranking comment procedure error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete comment');
    }
  });

// Toggle ranking comment like
export const toggleRankingCommentLikeProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      // Check if user already liked this comment
      const { data: existingLike, error: checkError } = await ctx.supabase
        .from('ranking_comment_likes')
        .select('id')
        .eq('comment_id', input.commentId)
        .eq('user_id', ctx.user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingLike) {
        // Unlike the comment
        const { error: deleteError } = await ctx.supabase
          .from('ranking_comment_likes')
          .delete()
          .eq('comment_id', input.commentId)
          .eq('user_id', ctx.user.id);

        if (deleteError) throw deleteError;
        return { liked: false };
      } else {
        // Like the comment
        const { error: insertError } = await ctx.supabase
          .from('ranking_comment_likes')
          .insert({
            comment_id: input.commentId,
            user_id: ctx.user.id
          });

        if (insertError) throw insertError;
        return { liked: true };
      }
    } catch (error) {
      console.error('Error toggling ranking comment like:', error);
      throw new Error('Failed to toggle comment like');
    }
  });

// Delete ranking
export const deleteRankingProcedure = protectedProcedure
  .input(z.object({
    rankingId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }) => {
    try {
      // Check if ranking exists and belongs to user
      const { data: ranking, error: fetchError } = await ctx.supabase
        .from('user_rankings')
        .select('user_id')
        .eq('id', input.rankingId)
        .single();

      if (fetchError) {
        console.error('Error fetching ranking:', fetchError);
        if ((fetchError as any)?.code === 'PGRST116') {
          throw new Error('Ranking not found');
        }
        throw new Error('Failed to fetch ranking');
      }

      if (!ranking) {
        throw new Error('Ranking not found');
      }

      if (ranking.user_id !== ctx.user.id) {
        throw new Error('You can only delete your own rankings');
      }

      // Delete the ranking (this will cascade delete related items and posts)
      const { error: deleteError } = await ctx.supabase
        .from('user_rankings')
        .delete()
        .eq('id', input.rankingId)
        .eq('user_id', ctx.user.id);

      if (deleteError) {
        console.error('Error deleting ranking:', deleteError);
        throw new Error('Failed to delete ranking');
      }

      return { success: true };
    } catch (error) {
      console.error('Delete ranking procedure error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete ranking');
    }
  });