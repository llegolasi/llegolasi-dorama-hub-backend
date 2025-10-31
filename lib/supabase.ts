import { createClient } from '@supabase/supabase-js';

// Development fallback configuration
const supabaseUrl = process.env.EXPO_PUBLIC_SUPABASE_URL || 'https://demo.supabase.co';
const supabaseAnonKey = process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY || 'demo-key';

// Check if we have valid Supabase configuration
export const hasValidSupabaseConfig = 
  process.env.EXPO_PUBLIC_SUPABASE_URL && 
  process.env.EXPO_PUBLIC_SUPABASE_URL !== 'your_supabase_project_url' &&
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY && 
  process.env.EXPO_PUBLIC_SUPABASE_ANON_KEY !== 'your_supabase_anon_key';

export const supabase = createClient(supabaseUrl, supabaseAnonKey, {
  auth: {
    autoRefreshToken: true,
    persistSession: true,
    detectSessionInUrl: false,
  },
});

export type Database = {
  public: {
    Tables: {
      users: {
        Row: {
          id: string;
          username: string;
          display_name: string;
          bio: string | null;
          profile_image: string | null;
          is_onboarding_complete: boolean;
          followers_count: number;
          following_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id: string;
          username: string;
          display_name: string;
          bio?: string | null;
          profile_image?: string | null;
          is_onboarding_complete?: boolean;
          followers_count?: number;
          following_count?: number;
        };
        Update: {
          username?: string;
          display_name?: string;
          bio?: string | null;
          profile_image?: string | null;
          is_onboarding_complete?: boolean;
        };
      };
      user_preferences: {
        Row: {
          id: string;
          user_id: string;
          favorite_genres: string[];
          loved_dramas: number[];
          notification_settings: any;
          privacy_settings: any;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          favorite_genres?: string[];
          loved_dramas?: number[];
          notification_settings?: any;
          privacy_settings?: any;
        };
        Update: {
          favorite_genres?: string[];
          loved_dramas?: number[];
          notification_settings?: any;
          privacy_settings?: any;
        };
      };
      user_drama_lists: {
        Row: {
          id: string;
          user_id: string;
          drama_id: number;
          list_type: 'watching' | 'watchlist' | 'completed';
          current_episode: number;
          total_episodes: number | null;
          rating: number | null;
          notes: string | null;
          added_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          drama_id: number;
          list_type: 'watching' | 'watchlist' | 'completed';
          current_episode?: number;
          total_episodes?: number | null;
          rating?: number | null;
          notes?: string | null;
        };
        Update: {
          current_episode?: number;
          rating?: number | null;
          notes?: string | null;
        };
      };
      user_rankings: {
        Row: {
          id: string;
          user_id: string;
          title: string;
          description: string | null;
          is_public: boolean;
          likes_count: number;
          comments_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          title: string;
          description?: string | null;
          is_public?: boolean;
        };
        Update: {
          title?: string;
          description?: string | null;
          is_public?: boolean;
        };
      };
      ranking_items: {
        Row: {
          id: string;
          ranking_id: string;
          drama_id: number;
          rank_position: number;
          created_at: string;
        };
        Insert: {
          ranking_id: string;
          drama_id: number;
          rank_position: number;
        };
        Update: {
          rank_position?: number;
        };
      };
      community_posts: {
        Row: {
          id: string;
          user_id: string;
          post_type: 'discussion' | 'ranking';
          content: string;
          mentioned_drama_id: number | null;
          ranking_id: string | null;
          likes_count: number;
          comments_count: number;
          is_pinned: boolean;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          user_id: string;
          post_type: 'discussion' | 'ranking';
          content: string;
          mentioned_drama_id?: number | null;
          ranking_id?: string | null;
        };
        Update: {
          content?: string;
          mentioned_drama_id?: number | null;
        };
      };
      post_likes: {
        Row: {
          id: string;
          post_id: string;
          user_id: string;
          reaction_type: string;
          created_at: string;
        };
        Insert: {
          post_id: string;
          user_id: string;
          reaction_type?: string;
        };
        Update: {
          reaction_type?: string;
        };
      };
      post_comments: {
        Row: {
          id: string;
          post_id: string;
          user_id: string;
          content: string;
          parent_comment_id: string | null;
          likes_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          post_id: string;
          user_id: string;
          content: string;
          parent_comment_id?: string | null;
        };
        Update: {
          content?: string;
        };
      };
      ranking_comments: {
        Row: {
          id: string;
          ranking_id: string;
          user_id: string;
          content: string;
          parent_comment_id: string | null;
          likes_count: number;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          ranking_id: string;
          user_id: string;
          content: string;
          parent_comment_id?: string | null;
        };
        Update: {
          content?: string;
        };
      };
      user_follows: {
        Row: {
          id: string;
          follower_id: string;
          following_id: string;
          created_at: string;
        };
        Insert: {
          follower_id: string;
          following_id: string;
        };
        Update: never;
      };
      posts: {
        Row: {
          id: string;
          user_id: string | null;
          status: 'draft' | 'published';
          title: string;
          slug: string;
          tags: string[];
          cover_image_url: string | null;
          html_content: string;
          plain_text_content: string;
          created_at: string;
          updated_at: string;
          published_at: string | null;
        };
        Insert: {
          user_id?: string | null;
          status?: 'draft' | 'published';
          title: string;
          slug: string;
          tags?: string[];
          cover_image_url?: string | null;
          html_content: string;
          plain_text_content: string;
          published_at?: string | null;
        };
        Update: {
          status?: 'draft' | 'published';
          title?: string;
          slug?: string;
          tags?: string[];
          cover_image_url?: string | null;
          html_content?: string;
          plain_text_content?: string;
          published_at?: string | null;
        };
      };
    };
  };
};