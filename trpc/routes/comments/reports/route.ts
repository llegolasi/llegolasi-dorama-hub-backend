import { z } from 'zod';
import { protectedProcedure, publicProcedure } from '../../../create-context';
import type { Context } from '../../../create-context';

const reportReasonSchema = z.enum([
  'spam',
  'harassment', 
  'hate_speech',
  'inappropriate_content',
  'misinformation',
  'other'
]);

export const createCommentReportProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid(),
    commentType: z.enum(['ranking', 'post', 'news', 'review']),
    reason: reportReasonSchema,
    description: z.string().optional()
  }))
  .mutation(async ({ input, ctx }: { input: any; ctx: Context & { user: NonNullable<Context['user']> } }) => {
    const { supabase, user } = ctx;
    
    try {
      const { data, error } = await supabase
        .from('comment_reports')
        .insert({
          comment_id: input.commentId,
          comment_type: input.commentType,
          reporter_id: user.id,
          reason: input.reason,
          description: input.description
        })
        .select()
        .single();

      if (error) {
        if (error.code === '23505') { // Unique constraint violation
          throw new Error('Você já denunciou este comentário');
        }
        throw new Error('Erro ao criar denúncia: ' + error.message);
      }

      return { success: true, report: data };
    } catch (error) {
      console.error('Error creating comment report:', error);
      throw new Error(error instanceof Error ? error.message : 'Erro ao criar denúncia');
    }
  });

export const getCommentReportsProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid().optional(),
    status: z.enum(['pending', 'reviewed', 'resolved', 'dismissed']).optional(),
    limit: z.number().min(1).max(100).default(20),
    offset: z.number().min(0).default(0)
  }))
  .query(async ({ input, ctx }: { input: any; ctx: Context & { user: NonNullable<Context['user']> } }) => {
    const { supabase, user } = ctx;
    
    try {
      let query = supabase
        .from('comment_reports')
        .select(`
          *,
          comments!inner(
            id,
            content,
            created_at,
            users!inner(
              id,
              username,
              avatar_url
            )
          ),
          reporter:users!reporter_id(
            id,
            username,
            avatar_url
          )
        `)
        .eq('reporter_id', user.id)
        .order('created_at', { ascending: false })
        .range(input.offset, input.offset + input.limit - 1);

      if (input.commentId) {
        query = query.eq('comment_id', input.commentId);
      }

      if (input.status) {
        query = query.eq('status', input.status);
      }

      const { data, error } = await query;

      if (error) {
        throw new Error('Erro ao buscar denúncias: ' + error.message);
      }

      return { reports: data || [] };
    } catch (error) {
      console.error('Error fetching comment reports:', error);
      throw new Error(error instanceof Error ? error.message : 'Erro ao buscar denúncias');
    }
  });

export const checkUserReportedCommentProcedure = protectedProcedure
  .input(z.object({
    commentId: z.string().uuid(),
    commentType: z.enum(['ranking', 'post', 'news', 'review'])
  }))
  .query(async ({ input, ctx }: { input: any; ctx: Context & { user: NonNullable<Context['user']> } }) => {
    const { supabase, user } = ctx;
    
    try {
      const { data, error } = await supabase
        .from('comment_reports')
        .select('id')
        .eq('comment_id', input.commentId)
        .eq('comment_type', input.commentType)
        .eq('reporter_id', user.id)
        .single();

      if (error && error.code !== 'PGRST116') { // PGRST116 = no rows returned
        throw new Error('Erro ao verificar denúncia: ' + error.message);
      }

      return { hasReported: !!data };
    } catch (error) {
      console.error('Error checking user report:', error);
      return { hasReported: false };
    }
  });

export const getCommentReportCountProcedure = publicProcedure
  .input(z.object({
    commentId: z.string().uuid(),
    commentType: z.enum(['ranking', 'post', 'news', 'review'])
  }))
  .query(async ({ input, ctx }: { input: any; ctx: Context }) => {
    const { supabase } = ctx;
    
    try {
      const { data, error } = await supabase
        .rpc('get_comment_report_count', { 
          comment_uuid: input.commentId,
          comment_type_param: input.commentType
        });

      if (error) {
        throw new Error('Erro ao contar denúncias: ' + error.message);
      }

      return { count: data || 0 };
    } catch (error) {
      console.error('Error getting comment report count:', error);
      return { count: 0 };
    }
  });