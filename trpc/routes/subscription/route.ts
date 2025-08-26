import { z } from 'zod';
import { protectedProcedure, publicProcedure } from '../../create-context';

export const subscriptionProcedures = {
  getPlans: publicProcedure
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from('subscription_plans')
        .select('*')
        .eq('is_active', true)
        .order('price', { ascending: true });

      if (error) throw new Error(error.message);
      return data;
    }),

  getUserSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .from('user_subscriptions')
        .select(`
          *,
          plan:subscription_plans(*)
        `)
        .eq('user_id', ctx.user.id)
        .eq('status', 'active')
        .single();

      if (error && error.code !== 'PGRST116') {
        throw new Error(error.message);
      }
      
      return data;
    }),

  createSubscription: protectedProcedure
    .input(z.object({
      planId: z.string(),
      paymentMethod: z.string(),
      transactionId: z.string().optional(),
    }))
    .mutation(async ({ ctx, input }) => {
      // Get plan details
      const { data: plan, error: planError } = await ctx.supabase
        .from('subscription_plans')
        .select('*')
        .eq('id', input.planId)
        .single();

      if (planError) throw new Error(planError.message);

      // Calculate expiration date
      const expiresAt = new Date();
      expiresAt.setMonth(expiresAt.getMonth() + plan.duration_months);

      // Create subscription
      const { data, error } = await ctx.supabase
        .from('user_subscriptions')
        .insert({
          user_id: ctx.user.id,
          plan_id: input.planId,
          payment_method: input.paymentMethod,
          transaction_id: input.transactionId,
          expires_at: expiresAt.toISOString(),
          status: 'active'
        })
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    }),

  cancelSubscription: protectedProcedure
    .input(z.object({
      subscriptionId: z.string(),
    }))
    .mutation(async ({ ctx, input }) => {
      const { data, error } = await ctx.supabase
        .from('user_subscriptions')
        .update({ status: 'cancelled' })
        .eq('id', input.subscriptionId)
        .eq('user_id', ctx.user.id)
        .select()
        .single();

      if (error) throw new Error(error.message);
      return data;
    }),

  hasActiveSubscription: protectedProcedure
    .query(async ({ ctx }) => {
      const { data, error } = await ctx.supabase
        .rpc('has_active_subscription', { user_uuid: ctx.user.id });

      if (error) throw new Error(error.message);
      return data;
    }),
};