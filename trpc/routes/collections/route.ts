import { z } from 'zod';
import { publicProcedure } from '../../create-context';
import { supabase } from '@/lib/supabase';

export const getHomepageCollections = publicProcedure
  .query(async () => {
    try {
      const { data, error } = await supabase
        .rpc('get_homepage_collections');

      if (error) {
        console.error('Error fetching homepage collections:', error);
        throw new Error('Failed to fetch homepage collections');
      }

      return data || [];
    } catch (error) {
      console.error('Homepage collections error:', error);
      throw new Error('Failed to fetch homepage collections');
    }
  });

export const getCollectionDramas = publicProcedure
  .input(z.object({
    collectionId: z.string().uuid(),
    limit: z.number().min(1).max(50).optional().default(20),
  }))
  .query(async ({ input }) => {
    try {
      const { data, error } = await supabase
        .rpc('get_collection_dramas', { 
          collection_uuid: input.collectionId 
        });

      if (error) {
        console.error('Error fetching collection dramas:', error);
        throw new Error('Failed to fetch collection dramas');
      }

      // Apply limit if specified
      const limitedData = data?.slice(0, input.limit) || [];
      
      return limitedData;
    } catch (error) {
      console.error('Collection dramas error:', error);
      throw new Error('Failed to fetch collection dramas');
    }
  });

export const getCollectionById = publicProcedure
  .input(z.object({
    collectionId: z.string().uuid(),
  }))
  .query(async ({ input }) => {
    try {
      const { data, error } = await supabase
        .from('custom_collections')
        .select('*')
        .eq('id', input.collectionId)
        .eq('is_visible', true)
        .single();

      if (error) {
        console.error('Error fetching collection:', error);
        throw new Error('Collection not found');
      }

      return data;
    } catch (error) {
      console.error('Collection fetch error:', error);
      throw new Error('Failed to fetch collection');
    }
  });
