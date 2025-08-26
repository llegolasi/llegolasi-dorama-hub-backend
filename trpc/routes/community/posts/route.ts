import { z } from 'zod';
import { publicProcedure, protectedProcedure, type Context } from '../../../create-context';
import { createClient } from '@supabase/supabase-js';

const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL;
const supabaseServiceKey = process.env.SUPABASE_SERVICE_ROLE_KEY || process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY;

if (!supabaseUrl || !supabaseServiceKey) {
  console.warn('Supabase configuration missing. Community features will not work properly.');
}

const supabase = supabaseUrl && supabaseServiceKey 
  ? createClient(supabaseUrl, supabaseServiceKey)
  : null;

// Helper function to get authenticated supabase client
const getAuthenticatedSupabase = (ctx: Context) => {
  if (!supabaseUrl) {
    throw new Error('Supabase URL not configured');
  }
  
  // Extract token from request headers
  const authHeader = ctx.req.headers.get('authorization');
  if (!authHeader?.startsWith('Bearer ')) {
    throw new Error('No valid authorization header found');
  }
  
  const token = authHeader.substring(7);
  
  // Create client with user's token for RLS
  return createClient(supabaseUrl, process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY!, {
    global: {
      headers: {
        Authorization: `Bearer ${token}`
      }
    }
  });
};

// Get community posts
export const getCommunityPostsProcedure = publicProcedure
  .input(z.object({
    type: z.enum(['all', 'rankings', 'discussions', 'following']).optional(),
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0),
    sortBy: z.enum(['recent', 'popular']).default('recent')
  }))
  .query(async ({ input, ctx }: { input: { type?: 'all' | 'rankings' | 'discussions' | 'following'; limit: number; offset: number; sortBy: 'recent' | 'popular' }; ctx: Context }) => {
    // Development mode - return mock posts
    if (ctx.isDevelopmentMode) {
      const mockPosts = [
        {
          id: 'mock_post_1',
          user_id: 'dev_demo_user',
          post_type: 'ranking',
          content: 'Meu ranking dos melhores K-dramas de romance!',
          mentioned_drama_id: null,
          ranking_id: 'mock_ranking_1',
          likes_count: 15,
          comments_count: 8,
          is_pinned: false,
          created_at: new Date().toISOString(),
          updated_at: new Date().toISOString(),
          users: {
            username: 'demo_user',
            display_name: 'Demo User',
            profile_image: null,
            user_type: 'normal',
            is_verified: false,
            current_badge_id: null,
            current_avatar_border_id: null
          },
          user_rankings: {
            id: 'mock_ranking_1',
            title: 'Top 10 K-dramas de Romance',
            description: 'Minha lista pessoal dos melhores doramas românticos',
            ranking_items: [
              {
                drama_id: 1,
                rank_position: 1,
                drama_title: 'Crash Landing on You',
                poster_image: '/t6jVlbPBwJlBMOtGXMJjAJQMppz.jpg',
                cover_image: null
              },
              {
                drama_id: 2,
                rank_position: 2,
                drama_title: 'Goblin',
                poster_image: '/x2BHx02VoVmKMHcSOab9NkJf88X.jpg',
                cover_image: null
              }
            ]
          }
        },
        {
          id: 'mock_post_2',
          user_id: 'dev_demo_user',
          post_type: 'discussion',
          content: 'Acabei de assistir Squid Game e estou impressionado! Que série incrível.',
          mentioned_drama_id: 87739,
          ranking_id: null,
          likes_count: 23,
          comments_count: 12,
          is_pinned: false,
          created_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          updated_at: new Date(Date.now() - 60 * 60 * 1000).toISOString(),
          users: {
            username: 'demo_user',
            display_name: 'Demo User',
            profile_image: null,
            user_type: 'normal',
            is_verified: false,
            current_badge_id: null,
            current_avatar_border_id: null
          },
          user_rankings: null
        }
      ];
      
      return mockPosts.slice(input.offset, input.offset + input.limit);
    }
    
    const isAuthed = Boolean(ctx?.user?.id);
    const client = isAuthed ? (ctx.supabase ?? supabase) : ctx.admin;
    if (!client) {
      throw new Error('Supabase not configured');
    }
    
    try {
      console.log('Fetching community posts with input:', input);

      // Specialized query when requesting rankings
      if (input.type === 'rankings') {
        let query = client
          .from('community_posts')
          .select(`
            *,
            users!inner (
              username,
              display_name,
              profile_image,
              user_type,
              is_verified,
              current_badge_id,
              current_avatar_border_id
            ),
            user_rankings (
              id,
              title,
              description,
              ranking_items (
                drama_id,
                rank_position,
                drama_title,
                poster_image,
                cover_image
              )
            ),
            post_likes!left(id),
            post_comments!left(id)
          `)
          .eq('post_type', 'ranking');

        // Apply sorting
        if (input.sortBy === 'popular') {
          // For popular, we'll order by a combination of likes and comments count
          // Since we can't easily do complex sorting in Supabase, we'll fetch and sort in memory
          query = query.order('created_at', { ascending: false });
        } else {
          query = query.order('created_at', { ascending: false });
        }

        const { data: posts, error } = await query.range(input.offset, input.offset + input.limit - 1);

        if (error) {
          console.error('Supabase error (rankings):', error);
          // Return empty array instead of throwing to prevent crashes
          console.warn('Error fetching ranking posts, returning empty array:', error.message);
          return [];
        }

        console.log('Fetched ranking posts count:', posts?.length ?? 0);
        
        // Process posts to add engagement counts and sort if needed
        const processedPosts = (posts || []).map((post: any) => ({
          ...post,
          likes_count: post.post_likes?.length || 0,
          comments_count: post.post_comments?.length || 0,
          engagement_score: (post.post_likes?.length || 0) + (post.post_comments?.length || 0) * 2
        }));

        // Sort by popularity if requested
        if (input.sortBy === 'popular') {
          processedPosts.sort((a, b) => b.engagement_score - a.engagement_score);
        }

        return processedPosts;
      }
      
      // Specialized query for following posts
      if (input.type === 'following') {
        if (!isAuthed || !ctx.user?.id) {
          console.log('User not authenticated for following posts');
          return []; // Return empty array if not authenticated
        }
        
        console.log('Fetching following posts for user:', ctx.user.id);
        
        try {
          // First get the list of users that the current user follows
          const { data: followedUsers, error: followError } = await client
            .from('user_follows')
            .select('following_id')
            .eq('follower_id', ctx.user.id);
            
          if (followError) {
            console.error('Error fetching followed users:', followError);
            // If the table doesn't exist or there's a schema issue, return empty array instead of throwing
            if (followError.code === '42P01' || followError.message?.includes('relation "user_follows" does not exist')) {
              console.warn('user_follows table does not exist, returning empty array');
              return [];
            }
            // For any other error, also return empty array to prevent crashes
            console.warn('Error fetching followed users, returning empty array:', followError.message);
            return [];
          }
          
          console.log('Found followed users:', followedUsers?.length ?? 0);
          
          if (!followedUsers || followedUsers.length === 0) {
            console.log('No followed users found, returning empty array');
            return []; // No followed users, return empty array
          }
          
          const followedUserIds = followedUsers.map(f => f.following_id);
          console.log('Following user IDs:', followedUserIds);
          
          // Check if community_posts table exists and has the required structure
          let query = client
            .from('community_posts')
            .select(`
              *,
              users!inner (
                username,
                display_name,
                profile_image,
                user_type,
                is_verified,
                current_badge_id,
                current_avatar_border_id
              ),
              user_rankings (
                id,
                title,
                description,
                ranking_items (
                  drama_id,
                  rank_position,
                  drama_title,
                  poster_image,
                  cover_image
                )
              ),
              post_likes!left(id),
              post_comments!left(id)
            `)
            .in('user_id', followedUserIds);

          // Apply sorting
          if (input.sortBy === 'popular') {
            query = query.order('created_at', { ascending: false });
          } else {
            query = query.order('created_at', { ascending: false });
          }

          const { data: posts, error } = await query.range(input.offset, input.offset + input.limit - 1);

          if (error) {
            console.error('Supabase error (following):', error);
            // Return empty array instead of throwing to prevent crashes
            console.warn('Error fetching following posts, returning empty array:', error.message);
            return [];
          }

          console.log('Fetched following posts count:', posts?.length ?? 0);
          
          // Process posts to add engagement counts and sort if needed
          const processedPosts = (posts || []).map((post: any) => ({
            ...post,
            likes_count: post.post_likes?.length || 0,
            comments_count: post.post_comments?.length || 0,
            engagement_score: (post.post_likes?.length || 0) + (post.post_comments?.length || 0) * 2
          }));

          // Sort by popularity if requested
          if (input.sortBy === 'popular') {
            processedPosts.sort((a, b) => b.engagement_score - a.engagement_score);
          }

          return processedPosts;
        } catch (followingError) {
          console.error('Error in following posts section:', followingError);
          // Return empty array instead of throwing to prevent the entire endpoint from failing
          return [];
        }
      }
      
      // Generic query for other types
      let query = client
        .from('community_posts')
        .select(`
          *,
          users!inner (
            username,
            display_name,
            profile_image,
            user_type,
            is_verified,
            current_badge_id,
            current_avatar_border_id
          ),
          user_rankings (
            id,
            title,
            description,
            ranking_items (
              drama_id,
              rank_position,
              drama_title,
              poster_image,
              cover_image
            )
          ),
          post_likes!left(id),
          post_comments!left(id)
        `);

      // Apply sorting
      if (input.sortBy === 'popular') {
        query = query.order('created_at', { ascending: false });
      } else {
        query = query.order('created_at', { ascending: false });
      }

      query = query.range(input.offset, input.offset + input.limit - 1);

      if (input.type === 'discussions') {
        query = query.eq('post_type', 'discussion');
      }

      const { data: posts, error } = await query;

      if (error) {
        console.error('Supabase error:', error);
        // Return empty array instead of throwing to prevent crashes
        console.warn('Error fetching posts, returning empty array:', error.message);
        return [];
      }

      // Process posts to add engagement counts and sort if needed
      const processedPosts = (posts || []).map((post: any) => ({
        ...post,
        likes_count: post.post_likes?.length || 0,
        comments_count: post.post_comments?.length || 0,
        engagement_score: (post.post_likes?.length || 0) + (post.post_comments?.length || 0) * 2
      }));

      // Sort by popularity if requested
      if (input.sortBy === 'popular') {
        processedPosts.sort((a, b) => b.engagement_score - a.engagement_score);
      }

      return processedPosts;
    } catch (error) {
      console.error('Error fetching community posts:', error);
      
      // Check if it's a specific database error we can handle
      if (error && typeof error === 'object' && 'message' in error) {
        const errorMessage = (error as any).message;
        if (errorMessage.includes('column') && errorMessage.includes('does not exist')) {
          console.warn('Database schema issue detected, returning empty array:', errorMessage);
          return [];
        }
      }
      
      // For any other error, return empty array to prevent crashes
      console.warn('Unexpected error fetching community posts, returning empty array:', error);
      return [];
    }
  });

// Create community post
export const createCommunityPostProcedure = protectedProcedure
  .input(z.object({
    content: z.string().min(1).max(1000),
    postType: z.enum(['discussion', 'ranking']),
    mentionedDramaId: z.number().optional(),
    posterImage: z.string().optional(),
    dramaName: z.string().optional(),
    dramaYear: z.number().optional(),
    rankingId: z.string().uuid().optional()
  }))
  .mutation(async ({ input, ctx }: { input: { content: string; postType: 'discussion' | 'ranking'; mentionedDramaId?: number; posterImage?: string; dramaName?: string; dramaYear?: number; rankingId?: string }; ctx: Context }) => {
    try {
      console.log('Creating post with input:', input);
      console.log('User context:', ctx.user);
      
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      const insertData: any = {
        user_id: ctx.user.id,
        post_type: input.postType,
        content: input.content,
      };
      
      if (input.mentionedDramaId) {
        insertData.mentioned_drama_id = input.mentionedDramaId;
      }
      
      if (input.posterImage) {
        insertData.poster_image = input.posterImage;
      }
      
      if (input.dramaName) {
        insertData.drama_name = input.dramaName;
      }
      
      if (input.dramaYear) {
        insertData.drama_year = input.dramaYear;
      }
      
      if (input.rankingId) {
        insertData.ranking_id = input.rankingId;
      }
      
      const { data: post, error } = await authSupabase
        .from('community_posts')
        .insert(insertData)
        .select(`
          *,
          users (
            username,
            display_name,
            profile_image,
            user_type,
            is_verified,
            current_badge_id,
            current_avatar_border_id
          )
        `)
        .single();

      if (error) {
        console.error('Supabase error creating post:', error);
        console.error('Insert data was:', insertData);
        throw new Error(`Database error: ${error.message}`);
      }
      
      if (!post) {
        throw new Error('Post was not created - no data returned');
      }
      
      console.log('Post created successfully:', post);

      return post;
    } catch (error) {
      console.error('Error creating community post:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to create post: ${error.message}`);
      }
      throw new Error('Failed to create post');
    }
  });

// Get post details with comments
export const getPostDetailsProcedure = publicProcedure
  .input(z.object({
    postId: z.string().uuid()
  }))
  .query(async ({ input, ctx }: { input: { postId: string }; ctx: Context }) => {
    const isAuthed = Boolean(ctx?.user?.id);
    const client = isAuthed ? (ctx.supabase ?? supabase) : ctx.admin;
    if (!client) {
      throw new Error('Supabase not configured');
    }
    
    try {
      const { data: post, error: postError } = await client
        .from('community_posts')
        .select(`
          *,
          users!inner (
            username,
            display_name,
            profile_image,
            user_type,
            is_verified,
            current_badge_id,
            current_avatar_border_id
          ),
          user_rankings (
            title,
            description,
            ranking_items (
              drama_id,
              rank_position,
              drama_title,
              poster_image,
              cover_image
            )
          )
        `)
        .eq('id', input.postId)
        .single();

      if (postError) throw postError;

      const { data: comments, error: commentsError } = await client
        .from('post_comments')
        .select(`
          *,
          users!inner (
            username,
            display_name,
            profile_image,
            user_type,
            is_verified,
            current_badge_id,
            current_avatar_border_id
          )
        `)
        .eq('post_id', input.postId)
        .is('parent_comment_id', null)
        .order('created_at', { ascending: true });

      if (commentsError) throw commentsError;

      const commentIds = (comments ?? []).map((c: any) => c.id);
      let repliesByParent: Record<string, any[]> = {};
      if (commentIds.length > 0) {
        const { data: replies, error: repliesError } = await client
          .from('post_comments')
          .select(`
            *,
            users!inner (
              username,
              display_name,
              profile_image,
              user_type,
              is_verified,
              current_badge_id,
              current_avatar_border_id
            )
          `)
          .in('parent_comment_id', commentIds)
          .order('created_at', { ascending: true });
        if (repliesError) throw repliesError;
        repliesByParent = (replies || []).reduce((acc: Record<string, any[]>, r: any) => {
          const key = r.parent_comment_id as string;
          if (!acc[key]) acc[key] = [];
          acc[key].push(r);
          return acc;
        }, {});
      }

      // Get like information for current user if authenticated
      let userLikedComments = new Set<string>();
      if (isAuthed && ctx.user?.id) {
        const allCommentIds = [
          ...(comments || []).map((c: any) => c.id),
          ...Object.values(repliesByParent).flat().map((r: any) => r.id)
        ];
        
        if (allCommentIds.length > 0) {
          const { data: likedComments } = await client
            .from('post_comment_likes')
            .select('comment_id')
            .eq('user_id', ctx.user.id)
            .in('comment_id', allCommentIds);
          
          userLikedComments = new Set((likedComments || []).map((l: any) => l.comment_id));
        }
      }

      const commentsWithReplies = (comments || []).map((c: any) => ({
        ...c,
        user_liked: userLikedComments.has(c.id),
        replies: (repliesByParent[c.id] ?? []).map((r: any) => ({
          ...r,
          user_liked: userLikedComments.has(r.id)
        }))
      }));

      return {
        post,
        comments: commentsWithReplies
      };
    } catch (error) {
      console.error('Error fetching post details:', error);
      throw new Error('Failed to fetch post details');
    }
  });

// Like/unlike post
export const togglePostLikeProcedure = protectedProcedure
  .input(z.object({
    postId: z.string().uuid(),
    reactionType: z.string().default('like')
  }))
  .mutation(async ({ input, ctx }: { input: { postId: string; reactionType: string }; ctx: Context }) => {
    try {
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      console.log('Toggling like for post:', input.postId, 'by user:', ctx.user.id);
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      // Check if user already liked this post
      const { data: existingLike, error: checkError } = await authSupabase
        .from('post_likes')
        .select('id')
        .eq('post_id', input.postId)
        .eq('user_id', ctx.user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingLike) {
        // Unlike the post
        const { error: deleteError } = await authSupabase
          .from('post_likes')
          .delete()
          .eq('post_id', input.postId)
          .eq('user_id', ctx.user.id);

        if (deleteError) throw deleteError;
        return { liked: false };
      } else {
        // Like the post
        const { error: insertError } = await authSupabase
          .from('post_likes')
          .insert({
            post_id: input.postId,
            user_id: ctx.user.id,
            reaction_type: input.reactionType
          });

        if (insertError) throw insertError;
        return { liked: true };
      }
    } catch (error) {
      console.error('Error toggling post like:', error);
      throw new Error('Failed to toggle like');
    }
  });

// Add comment to post
export const addPostCommentProcedure = protectedProcedure
  .input(z.object({
    postId: z.string().uuid(),
    content: z.string().min(1).max(500),
    parentCommentId: z.string().uuid().optional()
  }))
  .mutation(async ({ input, ctx }: { input: { postId: string; content: string; parentCommentId?: string }; ctx: Context }) => {
    try {
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      const { data, error } = await authSupabase
        .from('post_comments')
        .insert({
          post_id: input.postId,
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
            user_type,
            is_verified,
            current_badge_id,
            current_avatar_border_id
          )
        `)
        .single();

      if (error) throw error;

      return data;
    } catch (error) {
      console.error('Error adding comment:', error);
      throw new Error('Failed to add comment');
    }
  });

// Delete post comment
export const deletePostCommentProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }: { input: { commentId: string }; ctx: Context }) => {
    try {
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      // Check if comment exists and belongs to user
      const { data: comment, error: fetchError } = await authSupabase
        .from('post_comments')
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
      const { error: deleteError } = await authSupabase
        .from('post_comments')
        .delete()
        .eq('id', input.commentId)
        .eq('user_id', ctx.user.id);

      if (deleteError) {
        console.error('Error deleting comment:', deleteError);
        throw new Error('Failed to delete comment');
      }

      return { success: true };
    } catch (error) {
      console.error('Delete post comment procedure error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete comment');
    }
  });

// Toggle post comment like
export const togglePostCommentLikeProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }: { input: { commentId: string }; ctx: Context }) => {
    try {
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      // Check if user already liked this comment
      const { data: existingLike, error: checkError } = await authSupabase
        .from('post_comment_likes')
        .select('id')
        .eq('comment_id', input.commentId)
        .eq('user_id', ctx.user.id)
        .single();

      if (checkError && checkError.code !== 'PGRST116') {
        throw checkError;
      }

      if (existingLike) {
        // Unlike the comment
        const { error: deleteError } = await authSupabase
          .from('post_comment_likes')
          .delete()
          .eq('comment_id', input.commentId)
          .eq('user_id', ctx.user.id);

        if (deleteError) throw deleteError;
        return { liked: false };
      } else {
        // Like the comment
        const { error: insertError } = await authSupabase
          .from('post_comment_likes')
          .insert({
            comment_id: input.commentId,
            user_id: ctx.user.id
          });

        if (insertError) throw insertError;
        return { liked: true };
      }
    } catch (error) {
      console.error('Error toggling post comment like:', error);
      throw new Error('Failed to toggle comment like');
    }
  });

// Get news posts from posts table
export const getNewsPostsProcedure = publicProcedure
  .input(z.object({
    limit: z.number().min(1).max(50).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }: { input: { limit: number; offset: number }; ctx: Context }) => {
    const client = ctx.admin || supabase;
    if (!client) {
      throw new Error('Supabase not configured');
    }
    
    try {
      console.log('Fetching news posts with input:', input);

      const { data: posts, error } = await client
        .from('posts')
        .select('*')
        .eq('status', 'published')
        .order('published_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (error) {
        console.error('Supabase error fetching news:', error);
        throw error;
      }

      console.log('Fetched news posts count:', posts?.length ?? 0);
      return posts || [];
    } catch (error) {
      console.error('Error fetching news posts:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to fetch news posts: ${error.message}`);
      }
      throw new Error('Failed to fetch news posts');
    }
  });

// Delete community post
export const deletePostProcedure = protectedProcedure
  .input(z.object({
    postId: z.string().uuid()
  }))
  .mutation(async ({ input, ctx }: { input: { postId: string }; ctx: Context }) => {
    try {
      if (!ctx.user?.id) {
        throw new Error('User ID is required');
      }
      
      // Use authenticated supabase client for RLS
      const authSupabase = getAuthenticatedSupabase(ctx);
      
      // Check if post exists and belongs to user
      const { data: post, error: fetchError } = await authSupabase
        .from('community_posts')
        .select('user_id')
        .eq('id', input.postId)
        .single();

      if (fetchError) {
        console.error('Error fetching post:', fetchError);
        if ((fetchError as any)?.code === 'PGRST116') {
          throw new Error('Post not found');
        }
        throw new Error('Failed to fetch post');
      }

      if (!post) {
        throw new Error('Post not found');
      }

      if (post.user_id !== ctx.user.id) {
        throw new Error('You can only delete your own posts');
      }

      // Delete the post
      const { error: deleteError } = await authSupabase
        .from('community_posts')
        .delete()
        .eq('id', input.postId)
        .eq('user_id', ctx.user.id);

      if (deleteError) {
        console.error('Error deleting post:', deleteError);
        throw new Error('Failed to delete post');
      }

      return { success: true };
    } catch (error) {
      console.error('Delete post procedure error:', error);
      if (error instanceof Error) {
        throw error;
      }
      throw new Error('Failed to delete post');
    }
  });

// Get single news post by ID
export const getNewsPostByIdProcedure = publicProcedure
  .input(z.object({
    postId: z.string().uuid()
  }))
  .query(async ({ input, ctx }: { input: { postId: string }; ctx: Context }) => {
    const client = ctx.admin || supabase;
    if (!client) {
      throw new Error('Supabase not configured');
    }
    
    try {
      const { data: post, error } = await client
        .from('posts')
        .select('*')
        .eq('id', input.postId)
        .eq('status', 'published')
        .single();

      if (error) {
        console.error('Supabase error fetching news post:', error);
        throw error;
      }

      return post;
    } catch (error) {
      console.error('Error fetching news post:', error);
      if (error instanceof Error) {
        throw new Error(`Failed to fetch news post: ${error.message}`);
      }
      throw new Error('Failed to fetch news post');
    }
  });
