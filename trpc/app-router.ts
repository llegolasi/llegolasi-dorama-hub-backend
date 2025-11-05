import { createTRPCRouter } from "./create-context";
import hiRoute from "./routes/example/hi/route";

// Community routes
import {
  getCommunityPostsProcedure,
  createCommunityPostProcedure,
  getPostDetailsProcedure,
  togglePostLikeProcedure,
  addPostCommentProcedure,
  deletePostCommentProcedure,
  togglePostCommentLikeProcedure,
  getNewsPostsProcedure,
  getNewsPostByIdProcedure,
  deletePostProcedure
} from "./routes/community/posts/route";

// News comments routes
import {
  getCommentsProcedure,
  addCommentProcedure,
  toggleCommentLikeProcedure,
  getArticleLikesProcedure,
  getUserLikedArticleProcedure,
  toggleArticleLikeProcedure,
  deleteCommentProcedure
} from "./routes/news/comments/route";

// Rankings routes
import {
  getUserRankingsProcedure,
  getRankingDetailsProcedure,
  saveRankingProcedure,
  toggleRankingLikeProcedure,
  addRankingCommentProcedure,
  deleteRankingCommentProcedure,
  toggleRankingCommentLikeProcedure,
  deleteRankingProcedure
} from "./routes/rankings/route";

// Users routes
import {
  getUserProfileProcedure,
  updateUserProfileProcedure,
  toggleFollowUserProcedure,
  getUserFollowersProcedure,
  getUserFollowingProcedure,
  getUserCompletedDramasProcedure,
  getFollowersWithDetailsProcedure,
  getFollowingWithDetailsProcedure,
  getUserStatsProcedure,
  updateUserStatsProcedure,
  markEpisodeWatchedProcedure,
  completeDramaWithDateRangeProcedure,
  updateUserProfileCoverProcedure,
  checkUserPremiumStatusProcedure,
  getProfileAvatarsProcedure
} from "./routes/users/route";

// Discover routes
import {
  getDiscoverDramasProcedure,
  skipDramaProcedure,
  getDailySwipesStatusProcedure,
  incrementDailySwipesProcedure,
  cleanExpiredSkippedDramasProcedure
} from "./routes/discover/route";

// Subscription routes
import { subscriptionProcedures } from "./routes/subscription/route";

// Completion routes
import {
  completeDramaProcedure,
  getCompletionHistoryProcedure,
  getCompletionStatsProcedure,
  checkDramaCompletionProcedure
} from "./routes/completions/route";

// Drama categories routes
import {
  backfillDramaCategoriesProcedure,
  getDramaCategoryStatsProcedure
} from "./routes/dramas/categories/route";

// Drama cache routes
import {
  getDramaById,
  searchDramas,
  getPopularDramas,
  getTrendingDramas,
  syncSeriesCache,
  cleanupCache,
  getDramaProviders
} from "./routes/dramas/cache/route";

// Comment reports routes
import {
  createCommentReportProcedure,
  getCommentReportsProcedure,
  checkUserReportedCommentProcedure,
  getCommentReportCountProcedure
} from "./routes/comments/reports/route";

// Collections routes
import {
  getHomepageCollections,
  getCollectionDramas,
  getCollectionById
} from "./routes/collections/route";

// Episodes routes
import { episodesRouter } from "./routes/episodes/route";

// Achievements routes
import {
  getUserAchievementsProcedure,
  getUserCompletedAchievementsProcedure,
  getUserAchievementStatsProcedure,
  unlockAchievementProcedure
} from "./routes/achievements/route";

export const appRouter = createTRPCRouter({
  example: createTRPCRouter({
    hi: hiRoute,
  }),
  
  community: createTRPCRouter({
    getPosts: getCommunityPostsProcedure,
    createPost: createCommunityPostProcedure,
    getPostDetails: getPostDetailsProcedure,
    togglePostLike: togglePostLikeProcedure,
    addPostComment: addPostCommentProcedure,
    deletePostComment: deletePostCommentProcedure,
    togglePostCommentLike: togglePostCommentLikeProcedure,
    deletePost: deletePostProcedure,
  }),
  
  news: createTRPCRouter({
    getPosts: getNewsPostsProcedure,
    getPostById: getNewsPostByIdProcedure,
    getComments: getCommentsProcedure,
    addComment: addCommentProcedure,
    toggleCommentLike: toggleCommentLikeProcedure,
    getArticleLikes: getArticleLikesProcedure,
    getUserLikedArticle: getUserLikedArticleProcedure,
    toggleArticleLike: toggleArticleLikeProcedure,
    deleteComment: deleteCommentProcedure,
  }),
  
  rankings: createTRPCRouter({
    getUserRankings: getUserRankingsProcedure,
    getRankingDetails: getRankingDetailsProcedure,
    saveRanking: saveRankingProcedure,
    toggleRankingLike: toggleRankingLikeProcedure,
    addRankingComment: addRankingCommentProcedure,
    deleteRankingComment: deleteRankingCommentProcedure,
    toggleRankingCommentLike: toggleRankingCommentLikeProcedure,
    deleteRanking: deleteRankingProcedure,
  }),
  
  users: createTRPCRouter({
    getUserProfile: getUserProfileProcedure,
    updateUserProfile: updateUserProfileProcedure,
    toggleFollowUser: toggleFollowUserProcedure,
    getUserFollowers: getUserFollowersProcedure,
    getUserFollowing: getUserFollowingProcedure,
    getUserCompletedDramas: getUserCompletedDramasProcedure,
    getFollowersWithDetails: getFollowersWithDetailsProcedure,
    getFollowingWithDetails: getFollowingWithDetailsProcedure,
    getStats: getUserStatsProcedure,
    updateStats: updateUserStatsProcedure,
    markEpisodeWatched: markEpisodeWatchedProcedure,
    completeDramaWithDateRange: completeDramaWithDateRangeProcedure,
    updateProfileCover: updateUserProfileCoverProcedure,
    checkPremiumStatus: checkUserPremiumStatusProcedure,
    getProfileAvatars: getProfileAvatarsProcedure,
  }),
  
  discover: createTRPCRouter({
    getDramas: getDiscoverDramasProcedure,
    skipDrama: skipDramaProcedure,
    getDailySwipesStatus: getDailySwipesStatusProcedure,
    incrementDailySwipes: incrementDailySwipesProcedure,
    cleanExpiredSkippedDramas: cleanExpiredSkippedDramasProcedure,
  }),
  
  subscription: createTRPCRouter({
    getPlans: subscriptionProcedures.getPlans,
    getUserSubscription: subscriptionProcedures.getUserSubscription,
    createSubscription: subscriptionProcedures.createSubscription,
    cancelSubscription: subscriptionProcedures.cancelSubscription,
    hasActiveSubscription: subscriptionProcedures.hasActiveSubscription,
  }),
  
  completions: createTRPCRouter({
    completeDrama: completeDramaProcedure,
    getHistory: getCompletionHistoryProcedure,
    getStats: getCompletionStatsProcedure,
    checkCompletion: checkDramaCompletionProcedure,
  }),
  
  dramas: createTRPCRouter({
    // Categories
    backfillCategories: backfillDramaCategoriesProcedure,
    getCategoryStats: getDramaCategoryStatsProcedure,
    // Cache system
    getById: getDramaById,
    search: searchDramas,
    getPopular: getPopularDramas,
    getTrending: getTrendingDramas,
    syncCache: syncSeriesCache,
    cleanupCache: cleanupCache,
    getProviders: getDramaProviders,
  }),
  
  comments: createTRPCRouter({
    reports: createTRPCRouter({
      create: createCommentReportProcedure,
      getAll: getCommentReportsProcedure,
      checkUserReported: checkUserReportedCommentProcedure,
      getCount: getCommentReportCountProcedure,
    }),
  }),
  
  collections: createTRPCRouter({
    getHomepage: getHomepageCollections,
    getDramas: getCollectionDramas,
    getById: getCollectionById,
  }),
  
  episodes: episodesRouter,
  
  achievements: createTRPCRouter({
    getUserAchievements: getUserAchievementsProcedure,
    getUserCompletedAchievements: getUserCompletedAchievementsProcedure,
    getUserAchievementStats: getUserAchievementStatsProcedure,
    unlockAchievement: unlockAchievementProcedure,
  }),
});

export type AppRouter = typeof appRouter;
