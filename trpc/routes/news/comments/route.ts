import { z } from 'zod';
import { protectedProcedure, publicProcedure } from '../../../create-context';

// Get comments for an article
export const getCommentsProcedure = publicProcedure
  .input(z.object({
    articleId: z.string().uuid()
  }))
  .query(async ({ ctx, input }) => {
    const { data: parentComments, error: commentsError } = await ctx.supabase
      .from('news_article_comments')
      .select(
        'id, article_id, user_id, parent_comment_id, content, is_edited, is_deleted, like_count, created_at, updated_at'
      )
      .eq('article_id', input.articleId)
      .eq('is_deleted', false)
      .is('parent_comment_id', null)
      .order('created_at', { ascending: false });

    if (commentsError) {
      console.error('Error fetching comments:', commentsError);
      throw new Error('Failed to fetch comments');
    }

    const safeParents = parentComments ?? [];

    const { data: replies, error: repliesError } = await ctx.supabase
      .from('news_article_comments')
      .select(
        'id, article_id, user_id, parent_comment_id, content, is_edited, is_deleted, like_count, created_at, updated_at'
      )
      .eq('article_id', input.articleId)
      .eq('is_deleted', false)
      .not('parent_comment_id', 'is', null)
      .order('created_at', { ascending: true });

    if (repliesError) {
      console.error('Error fetching replies:', repliesError);
    }

    const safeReplies = replies ?? [];

    const allUserIds = Array.from(new Set([...safeParents.map((c) => c.user_id), ...safeReplies.map((r) => r.user_id)]));

    let profilesById = new Map<string, { id: string; username: string | null; display_name: string | null; profile_image: string | null }>();

    if (allUserIds.length > 0) {
      const { data: profiles, error: usersError } = await ctx.supabase
        .from('users')
        .select('id, username, display_name, profile_image, user_type')
        .in('id', allUserIds);

      if (usersError) {
        console.error('Error fetching users for comments:', usersError);
      } else if (profiles) {
        profilesById = new Map(profiles.map((p) => [p.id, p]));
      }
    }

    const mapWithUser = (comment: any) => {
      const user = profilesById.get(comment.user_id) as (ReturnType<typeof profilesById.get> & { user_type?: string }) | undefined;
      const usernameFallback = `user_${String(comment.user_id).substring(0, 8)}`;
      return {
        id: comment.id,
        article_id: comment.article_id,
        user_id: comment.user_id,
        parent_comment_id: comment.parent_comment_id,
        content: comment.content,
        is_edited: comment.is_edited,
        is_deleted: comment.is_deleted,
        like_count: comment.like_count ?? 0,
        created_at: comment.created_at,
        updated_at: comment.updated_at,
        username: user?.username ?? usernameFallback,
        full_name: user?.display_name ?? user?.username ?? 'Usuário',
        avatar_url: user?.profile_image ?? null,
        user_type: (user?.user_type as string | undefined) ?? 'normal',
        replies_count: 0,
        user_liked: false,
      };
    };

    const parentsWithUser = safeParents.map(mapWithUser);
    const repliesWithUser = safeReplies.map(mapWithUser);

    const repliesByParent = new Map<string, ReturnType<typeof mapWithUser>[]>();
    for (const r of repliesWithUser) {
      const parentId = r.parent_comment_id as string | null;
      if (!parentId) continue;
      const list = repliesByParent.get(parentId) ?? [];
      list.push(r);
      repliesByParent.set(parentId, list);
    }

    const result = parentsWithUser.map((p) => ({
      ...p,
      replies: repliesByParent.get(p.id) ?? [],
      replies_count: (repliesByParent.get(p.id) ?? []).length,
    }));

    if (ctx.user && result.length > 0) {
      const allCommentIds = [
        ...result.map((c) => c.id),
        ...result.flatMap((c) => (c.replies ?? []).map((r) => r.id)),
      ];
      const { data: likedComments } = await ctx.supabase
        .from('news_comment_likes')
        .select('comment_id')
        .eq('user_id', ctx.user.id)
        .in('comment_id', allCommentIds);

      const likedSet = new Set((likedComments ?? []).map((l) => l.comment_id));

      return result.map((c) => ({
        ...c,
        user_liked: likedSet.has(c.id),
        replies: (c.replies ?? []).map((r) => ({ ...r, user_liked: likedSet.has(r.id) })),
      }));
    }

    return result;
  });

// Add a comment
export const addCommentProcedure = protectedProcedure
  .input(z.object({
    articleId: z.string().uuid(),
    content: z.string().min(1).max(1000),
    parentCommentId: z.string().uuid().optional()
  }))
  .mutation(async ({ ctx, input }) => {
    const { data, error } = await ctx.supabase
      .from('news_article_comments')
      .insert({
        article_id: input.articleId,
        user_id: ctx.user.id,
        content: input.content,
        parent_comment_id: input.parentCommentId || null
      })
      .select()
      .single();

    if (error) {
      console.error('Error adding comment:', error);
      throw new Error('Failed to add comment');
    }

    return data;
  });

// Toggle comment like
export const toggleCommentLikeProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ ctx, input }) => {
    const { data: existingLike } = await ctx.supabase
      .from('news_comment_likes')
      .select('id')
      .eq('user_id', ctx.user.id)
      .eq('comment_id', input.commentId)
      .single();

    if (existingLike) {
      const { error } = await ctx.supabase
        .from('news_comment_likes')
        .delete()
        .eq('user_id', ctx.user.id)
        .eq('comment_id', input.commentId);

      if (error) {
        console.error('Error removing comment like:', error);
        throw new Error('Failed to unlike comment');
      }

      return { liked: false };
    } else {
      const { error } = await ctx.supabase
        .from('news_comment_likes')
        .insert({
          user_id: ctx.user.id,
          comment_id: input.commentId
        });

      if (error) {
        console.error('Error adding comment like:', error);
        throw new Error('Failed to like comment');
      }

      return { liked: true };
    }
  });

// Get article likes count
export const getArticleLikesProcedure = publicProcedure
  .input(z.object({
    articleId: z.string().uuid()
  }))
  .query(async ({ ctx, input }) => {
    const { count, error } = await ctx.supabase
      .from('news_article_likes')
      .select('*', { count: 'exact', head: true })
      .eq('article_id', input.articleId);

    if (error) {
      console.error('Error fetching article likes:', error);
      throw new Error('Failed to fetch article likes');
    }

    return { count: count || 0 };
  });

// Check if user liked article
export const getUserLikedArticleProcedure = protectedProcedure
  .input(z.object({
    articleId: z.string().uuid()
  }))
  .query(async ({ ctx, input }) => {
    const { data, error } = await ctx.supabase
      .from('news_article_likes')
      .select('id')
      .eq('user_id', ctx.user.id)
      .eq('article_id', input.articleId)
      .single();

    if (error && error.code !== 'PGRST116') {
      console.error('Error checking user article like:', error);
      throw new Error('Failed to check article like status');
    }

    return !!data;
  });

// Toggle article like
export const toggleArticleLikeProcedure = protectedProcedure
  .input(z.object({
    articleId: z.string().uuid()
  }))
  .mutation(async ({ ctx, input }) => {
    const { data: existingLike } = await ctx.supabase
      .from('news_article_likes')
      .select('id')
      .eq('user_id', ctx.user.id)
      .eq('article_id', input.articleId)
      .single();

    if (existingLike) {
      const { error } = await ctx.supabase
        .from('news_article_likes')
        .delete()
        .eq('user_id', ctx.user.id)
        .eq('article_id', input.articleId);

      if (error) {
        console.error('Error removing article like:', error);
        throw new Error('Failed to unlike article');
      }

      return { liked: false };
    } else {
      const { error } = await ctx.supabase
        .from('news_article_likes')
        .insert({
          user_id: ctx.user.id,
          article_id: input.articleId
        });

      if (error) {
        console.error('Error adding article like:', error);
        throw new Error('Failed to like article');
      }

      return { liked: true };
    }
  });

// Delete a comment
export const deleteCommentProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ ctx, input }) => {
    try {
      const { data: comment, error: fetchError } = await ctx.supabase
        .from('news_article_comments')
        .select('user_id, is_deleted')
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

      // Try hard delete first (RLS policy allows deleting own comments). This will also cascade to likes/replies.
      const { error: hardDeleteError } = await ctx.supabase
        .from('news_article_comments')
        .delete()
        .eq('id', input.commentId)
        .eq('user_id', ctx.user.id);

      if (!hardDeleteError) {
        return { success: true };
      }

      console.warn('Hard delete failed, falling back to soft delete:', hardDeleteError);

      // Fallback to soft delete: mark as deleted
      const { error: softDeleteError } = await ctx.supabase
        .from('news_article_comments')
        .update({
          is_deleted: true,
          updated_at: new Date().toISOString(),
        })
        .eq('id', input.commentId)
        .eq('user_id', ctx.user.id);

      if (softDeleteError) {
        console.error('Error soft deleting comment:', softDeleteError);
        throw new Error('Failed to delete comment');
      }

      return { success: true };
    } catch (error) {
      console.error('Delete comment procedure error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete comment');
    }
  });