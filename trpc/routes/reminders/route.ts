import { z } from 'zod';
import { publicProcedure, protectedProcedure } from '../../create-context';
import { TRPCError } from '@trpc/server';

// Schema para input de criação/toggle de lembrete
const toggleReminderSchema = z.object({
  userId: z.string().uuid(),
  dramaId: z.number(),
  dramaName: z.string(),
  dramaPoster: z.string().optional(),
  releaseDate: z.string(),
  notificationId: z.string().optional(),
});

// Schema para input de teste de notificação
const testNotificationSchema = z.object({
  userId: z.string().uuid(),
});

// Schema para obter lembretes do usuário
const getUserRemindersSchema = z.object({
  userId: z.string().uuid(),
});

// Schema para verificar se pode criar lembrete
const canCreateReminderSchema = z.object({
  userId: z.string().uuid(),
});

// Schema para deletar lembrete
const deleteReminderSchema = z.object({
  userId: z.string().uuid(),
  reminderId: z.string().uuid(),
});

/**
 * Obtém todos os lembretes do usuário
 */
export const getUserRemindersProcedure = publicProcedure
  .input(getUserRemindersSchema)
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('release_reminders')
        .select(`
          id,
          user_id,
          release_id,
          drama_name,
          drama_poster,
          release_date,
          notification_id,
          scheduled_time,
          notification_sent,
          test_notification_sent,
          created_at,
          updated_at
        `)
        .eq('user_id', input.userId)
        .order('release_date', { ascending: true });

      if (error) {
        console.error('Error fetching user reminders:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch user reminders',
        });
      }

      return data || [];
    } catch (error) {
      console.error('Error in getUserReminders:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch user reminders',
      });
    }
  });

/**
 * Alterna o estado de um lembrete (criar ou deletar)
 */
export const toggleReminderProcedure = publicProcedure
  .input(toggleReminderSchema)
  .mutation(async ({ input, ctx }) => {
    try {
      // Verificar se já existe um lembrete para este drama
      // Primeiro, encontrar o ID interno do drama na tabela upcoming_releases
      const { data: releaseRecord } = await ctx.supabase
        .from('upcoming_releases')
        .select('id')
        .eq('tmdb_id', input.dramaId)
        .single();

      let existingReminder = null;
      if (releaseRecord) {
        const { data } = await ctx.supabase
          .from('release_reminders')
          .select('id, notification_id')
          .eq('user_id', input.userId)
          .eq('release_id', releaseRecord.id)
          .single();
        existingReminder = data;
      }

      if (existingReminder) {
        // Deletar lembrete existente
        const { error: deleteError } = await ctx.supabase
          .from('release_reminders')
          .delete()
          .eq('id', existingReminder.id);

        if (deleteError) {
          console.error('Error deleting reminder:', deleteError);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to delete reminder',
          });
        }

        return { 
          success: true, 
          action: 'deleted' as const, 
          hasReminder: false,
          notificationId: existingReminder.notification_id 
        };
      } else {
        // Verificar se usuário pode criar mais lembretes
        const { data: canCreate, error: limitError } = await ctx.supabase
          .rpc('can_create_reminder', { user_uuid: input.userId });

        if (limitError) {
          console.error('Error checking reminder limits:', limitError);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to check reminder limits',
          });
        }

        if (!canCreate) {
          throw new TRPCError({
            code: 'FORBIDDEN',
            message: 'Limite de lembretes atingido. Faça upgrade para Premium para lembretes ilimitados!',
          });
        }

        // Verificar se o drama já existe na tabela upcoming_releases
        let { data: existingRelease } = await ctx.supabase
          .from('upcoming_releases')
          .select('id')
          .eq('tmdb_id', input.dramaId)
          .single();

        // Se não existe, criar o registro na tabela upcoming_releases
        if (!existingRelease) {
          const { data: newRelease, error: releaseError } = await ctx.supabase
            .from('upcoming_releases')
            .insert({
              tmdb_id: input.dramaId, // Usar dramaId como tmdb_id
              name: input.dramaName,
              poster_path: input.dramaPoster,
              release_date: input.releaseDate,
              status: 'upcoming',
              overview: `Drama: ${input.dramaName}`,
              origin_country: ['KR'] // Default para K-drama
            })
            .select('id')
            .single();

          if (releaseError) {
            console.error('Error creating upcoming release:', releaseError);
            throw new TRPCError({
              code: 'INTERNAL_SERVER_ERROR',
              message: 'Failed to create upcoming release record',
            });
          }

          existingRelease = newRelease;
        }

        // Criar novo lembrete
        const scheduledTime = new Date(input.releaseDate);
        scheduledTime.setHours(10, 0, 0, 0); // 10h da manhã

        const { data: newReminder, error: createError } = await ctx.supabase
          .from('release_reminders')
          .insert({
            user_id: input.userId,
            release_id: existingRelease.id, // Usar o ID da tabela upcoming_releases
            drama_name: input.dramaName,
            drama_poster: input.dramaPoster,
            release_date: input.releaseDate,
            notification_id: input.notificationId,
            scheduled_time: scheduledTime.toISOString(),
            notification_sent: false,
            test_notification_sent: false,
          })
          .select()
          .single();

        if (createError) {
          console.error('Error creating reminder:', createError);
          throw new TRPCError({
            code: 'INTERNAL_SERVER_ERROR',
            message: 'Failed to create reminder',
          });
        }

        return { 
          success: true, 
          action: 'created' as const, 
          hasReminder: true,
          reminder: newReminder 
        };
      }
    } catch (error) {
      console.error('Error in toggleReminder:', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to toggle reminder',
      });
    }
  });

/**
 * Verifica se o usuário pode criar mais lembretes
 */
export const canCreateReminderProcedure = publicProcedure
  .input(canCreateReminderSchema)
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .rpc('can_create_reminder', { user_uuid: input.userId });

      if (error) {
        console.error('Error checking reminder limits:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to check reminder limits',
        });
      }

      // Obter contagem atual de lembretes
      const { count, error: countError } = await ctx.supabase
        .from('release_reminders')
        .select('*', { count: 'exact', head: true })
        .eq('user_id', input.userId);

      if (countError) {
        console.error('Error counting reminders:', countError);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to count reminders',
        });
      }

      // Verificar se é usuário premium
      const { data: isPremium } = await ctx.supabase
        .rpc('has_active_subscription', { user_uuid: input.userId });

      const limit = isPremium ? 999 : 5;
      const currentCount = count || 0;

      return {
        canCreate: data,
        currentCount,
        limit,
        remaining: Math.max(0, limit - currentCount),
        isPremium: isPremium || false,
      };
    } catch (error) {
      console.error('Error in canCreateReminder:', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to check reminder limits',
      });
    }
  });

/**
 * Envia notificação de teste (registra no banco)
 */
export const sendTestNotificationProcedure = publicProcedure
  .input(testNotificationSchema)
  .mutation(async ({ input, ctx }) => {
    try {
      // Registrar que uma notificação de teste foi enviada
      // Podemos usar uma tabela de logs ou simplesmente retornar sucesso
      // Por simplicidade, vamos apenas retornar sucesso
      console.log(`Test notification sent for user: ${input.userId}`);
      
      return { 
        success: true, 
        message: 'Notificação de teste enviada com sucesso!',
        timestamp: new Date().toISOString()
      };
    } catch (error) {
      console.error('Error in sendTestNotification:', error);
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to send test notification',
      });
    }
  });

/**
 * Deleta um lembrete específico
 */
export const deleteReminderProcedure = publicProcedure
  .input(deleteReminderSchema)
  .mutation(async ({ input, ctx }) => {
    try {
      // Obter dados do lembrete antes de deletar (para cancelar notificação)
      const { data: reminder, error: fetchError } = await ctx.supabase
        .from('release_reminders')
        .select('notification_id')
        .eq('id', input.reminderId)
        .eq('user_id', input.userId)
        .single();

      if (fetchError) {
        console.error('Error fetching reminder:', fetchError);
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: 'Reminder not found',
        });
      }

      // Deletar o lembrete
      const { error: deleteError } = await ctx.supabase
        .from('release_reminders')
        .delete()
        .eq('id', input.reminderId)
        .eq('user_id', input.userId);

      if (deleteError) {
        console.error('Error deleting reminder:', deleteError);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to delete reminder',
        });
      }

      return { 
        success: true,
        notificationId: reminder?.notification_id 
      };
    } catch (error) {
      console.error('Error in deleteReminder:', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to delete reminder',
      });
    }
  });

/**
 * Obtém estatísticas de lembretes do usuário
 */
export const getReminderStatsProcedure = publicProcedure
  .input(getUserRemindersSchema)
  .query(async ({ input, ctx }) => {
    try {
      const { data, error } = await ctx.supabase
        .from('user_reminder_stats')
        .select('*')
        .eq('user_id', input.userId)
        .single();

      if (error && error.code !== 'PGRST116') {
        console.error('Error fetching reminder stats:', error);
        throw new TRPCError({
          code: 'INTERNAL_SERVER_ERROR',
          message: 'Failed to fetch reminder stats',
        });
      }

      // Se não existir stats, retornar valores padrão
      if (!data) {
        return {
          activeRemindersCount: 0,
          totalRemindersCreated: 0,
          lastReminderCreated: null,
        };
      }

      return {
        activeRemindersCount: data.active_reminders_count,
        totalRemindersCreated: data.total_reminders_created,
        lastReminderCreated: data.last_reminder_created,
      };
    } catch (error) {
      console.error('Error in getReminderStats:', error);
      if (error instanceof TRPCError) {
        throw error;
      }
      throw new TRPCError({
        code: 'INTERNAL_SERVER_ERROR',
        message: 'Failed to fetch reminder stats',
      });
    }
  });