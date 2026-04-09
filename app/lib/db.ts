import { Pool } from "pg";

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  max: 10,
});

export interface Account {
  id: number;
  username: string;
  full_name: string | null;
  followers_count: number;
  profile_pic_url: string | null;
  account_type: string;
}

export interface Post {
  id: number;
  short_code: string;
  username: string;
  account_type: string;
  followers_count: number;
  type: string;
  caption: string | null;
  likes_count: number;
  comments_count: number;
  shares_count: number;
  video_view_count: number | null;
  video_play_count: number | null;
  video_duration: number | null;
  engagement_rate: number | null;
  performance_score: number | null;
  posted_at: string;
  url: string | null;
  display_url: string | null;
  stored_url: string | null;
  product_type: string | null;
  hashtags: string[];
  owner_email: string | null;
  scraped_at: string | null;
  analysis_status: string | null;
  outlier_views: number | null;
  outlier_engagement: number | null;
  outlier_confidence: string | null;
  outlier_confidence_score: number | null;
}

export interface Research {
  id: number;
  name: string;
  accounts_count: number;
}

export interface PostFilters {
  researchId?: number;
  accountIds?: number[];
  ownerEmail?: string;
  type?: string;
  captionSearch?: string;
  hashtag?: string;
  viewsMin?: number;
  viewsMax?: number;
  likesMin?: number;
  likesMax?: number;
  commentsMin?: number;
  commentsMax?: number;
  engagementMin?: number;
  engagementMax?: number;
  scoreMin?: number;
  scoreMax?: number;
  durationMin?: number;
  durationMax?: number;
  dateFrom?: string;
  dateTo?: string;
  scrapedFrom?: string;
  scrapedTo?: string;
  outlierViewsMin?: number;
  outlierViewsMax?: number;
  outlierEngMin?: number;
  outlierEngMax?: number;
  outlierConfidence?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
  offset?: number;
}

export async function getResearches(userId?: string): Promise<Research[]> {
  if (userId) {
    const result = await pool.query(`
      SELECT r.id, r.name, COUNT(ra.account_id)::int as accounts_count
      FROM researches r
      LEFT JOIN research_accounts ra ON ra.research_id = r.id
      WHERE r.user_id = $1
      GROUP BY r.id
      ORDER BY r.created_at DESC
    `, [userId]);
    return result.rows;
  }
  const result = await pool.query(`
    SELECT r.id, r.name, COUNT(ra.account_id)::int as accounts_count
    FROM researches r
    LEFT JOIN research_accounts ra ON ra.research_id = r.id
    GROUP BY r.id
    ORDER BY r.created_at DESC
  `);
  return result.rows;
}

export async function getAccounts(researchId?: number): Promise<Account[]> {
  if (researchId) {
    const result = await pool.query(`
      SELECT a.id, a.username, a.full_name, a.followers_count, a.profile_pic_url, a.account_type
      FROM accounts a
      JOIN research_accounts ra ON ra.account_id = a.id
      WHERE ra.research_id = $1
      ORDER BY a.followers_count DESC
    `, [researchId]);
    return result.rows;
  }
  const result = await pool.query(`
    SELECT id, username, full_name, followers_count, profile_pic_url, account_type
    FROM accounts
    ORDER BY followers_count DESC
  `);
  return result.rows;
}

export async function getOwners(): Promise<string[]> {
  const result = await pool.query(`
    SELECT DISTINCT u.email
    FROM posts p
    JOIN auth.users u ON u.id = p.scraped_by
    WHERE p.scraped_by IS NOT NULL
    ORDER BY u.email
  `);
  return result.rows.map((r: { email: string }) => r.email);
}

export async function getPosts(params: PostFilters): Promise<{ posts: Post[]; total: number }> {
  const {
    researchId, accountIds, ownerEmail, type, captionSearch, hashtag,
    viewsMin, viewsMax, likesMin, likesMax, commentsMin, commentsMax,
    engagementMin, engagementMax, scoreMin, scoreMax,
    durationMin, durationMax, dateFrom, dateTo, scrapedFrom, scrapedTo,
    outlierViewsMin, outlierViewsMax, outlierEngMin, outlierEngMax, outlierConfidence,
    sortBy = "performance_score", sortDir = "DESC",
    limit = 100, offset = 0,
  } = params;

  const allowedSorts: Record<string, string> = {
    performance_score: "p.performance_score",
    engagement_rate: "p.engagement_rate",
    likes_count: "p.likes_count",
    comments_count: "p.comments_count",
    shares_count: "p.shares_count",
    video_view_count: "p.video_view_count",
    video_duration: "p.video_duration",
    posted_at: "p.posted_at",
    outlier_views: "p.outlier_views",
    outlier_engagement: "p.outlier_engagement",
  };

  const orderCol = allowedSorts[sortBy] || "p.performance_score";
  const dir = sortDir === "ASC" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;
  let joinClause = "";
  // needsOwnerJoin removed — owner now uses p.scraped_by directly

  // Research filter
  if (researchId) {
    joinClause = `JOIN research_accounts ra ON ra.account_id = p.account_id`;
    conditions.push(`ra.research_id = $${paramIdx++}`);
    values.push(researchId);
  }

  // Account filter (multiple)
  if (accountIds && accountIds.length > 0) {
    const placeholders = accountIds.map(() => `$${paramIdx++}`).join(",");
    conditions.push(`p.account_id IN (${placeholders})`);
    values.push(...accountIds);
  }

  // Owner filter
  if (ownerEmail) {
    conditions.push(`EXISTS (SELECT 1 FROM auth.users ou WHERE ou.id = p.scraped_by AND ou.email = $${paramIdx++})`);
    values.push(ownerEmail);
  }

  // Type filter
  if (type && type !== "all") {
    conditions.push(`p.type = $${paramIdx++}`);
    values.push(type);
  }

  // Caption search
  if (captionSearch) {
    conditions.push(`p.caption ILIKE $${paramIdx++}`);
    values.push(`%${captionSearch}%`);
  }

  // Hashtag filter
  if (hashtag) {
    conditions.push(`EXISTS (
      SELECT 1 FROM post_hashtags ph
      JOIN hashtags h ON h.id = ph.hashtag_id
      WHERE ph.post_id = p.id AND h.tag ILIKE $${paramIdx++}
    )`);
    values.push(hashtag);
  }

  // Metric range filters
  if (viewsMin != null) { conditions.push(`p.video_view_count >= $${paramIdx++}`); values.push(viewsMin); }
  if (viewsMax != null) { conditions.push(`p.video_view_count <= $${paramIdx++}`); values.push(viewsMax); }
  if (likesMin != null) { conditions.push(`p.likes_count >= $${paramIdx++}`); values.push(likesMin); }
  if (likesMax != null) { conditions.push(`p.likes_count <= $${paramIdx++}`); values.push(likesMax); }
  if (commentsMin != null) { conditions.push(`p.comments_count >= $${paramIdx++}`); values.push(commentsMin); }
  if (commentsMax != null) { conditions.push(`p.comments_count <= $${paramIdx++}`); values.push(commentsMax); }
  if (engagementMin != null) { conditions.push(`p.engagement_rate >= $${paramIdx++}`); values.push(engagementMin); }
  if (engagementMax != null) { conditions.push(`p.engagement_rate <= $${paramIdx++}`); values.push(engagementMax); }
  if (scoreMin != null) { conditions.push(`p.performance_score >= $${paramIdx++}`); values.push(scoreMin); }
  if (scoreMax != null) { conditions.push(`p.performance_score <= $${paramIdx++}`); values.push(scoreMax); }
  if (durationMin != null) { conditions.push(`p.video_duration >= $${paramIdx++}`); values.push(durationMin); }
  if (durationMax != null) { conditions.push(`p.video_duration <= $${paramIdx++}`); values.push(durationMax); }

  // Outlier filters
  if (outlierViewsMin != null) { conditions.push(`p.outlier_views >= $${paramIdx++}`); values.push(outlierViewsMin); }
  if (outlierViewsMax != null) { conditions.push(`p.outlier_views <= $${paramIdx++}`); values.push(outlierViewsMax); }
  if (outlierEngMin != null) { conditions.push(`p.outlier_engagement >= $${paramIdx++}`); values.push(outlierEngMin); }
  if (outlierEngMax != null) { conditions.push(`p.outlier_engagement <= $${paramIdx++}`); values.push(outlierEngMax); }
  if (outlierConfidence && outlierConfidence !== "all") { conditions.push(`p.outlier_confidence = $${paramIdx++}`); values.push(outlierConfidence); }

  // Date range (posted)
  if (dateFrom) { conditions.push(`p.posted_at >= $${paramIdx++}`); values.push(dateFrom); }
  if (dateTo) { conditions.push(`p.posted_at <= $${paramIdx++}`); values.push(dateTo + "T23:59:59Z"); }

  // Date range (scraped)
  if (scrapedFrom) { conditions.push(`p.scraped_at >= $${paramIdx++}`); values.push(scrapedFrom); }
  if (scrapedTo) { conditions.push(`p.scraped_at <= $${paramIdx++}`); values.push(scrapedTo + "T23:59:59Z"); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT p.id) FROM posts p
     LEFT JOIN accounts a ON a.id = p.account_id
     ${joinClause} ${where}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await pool.query(
    `SELECT DISTINCT ON (p.id, ${orderCol})
      p.id, p.short_code, COALESCE(a.username, 'desconocido') as username,
      COALESCE(a.account_type, 'competitor') as account_type,
      COALESCE(a.followers_count, 0) as followers_count,
      p.type, p.caption, p.likes_count, p.comments_count, p.shares_count,
      p.video_view_count, p.video_play_count, p.video_duration,
      p.engagement_rate, p.performance_score, p.posted_at, p.url,
      p.display_url, p.stored_url, p.product_type,
      p.scraped_at, p.analysis_status,
      p.outlier_views, p.outlier_engagement, p.outlier_confidence, p.outlier_confidence_score,
      COALESCE(
        (SELECT array_agg(h.tag) FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id),
        ARRAY[]::TEXT[]
      ) as hashtags,
      (SELECT u.email FROM auth.users u WHERE u.id = p.scraped_by) as owner_email
    FROM posts p
    LEFT JOIN accounts a ON a.id = p.account_id
    ${joinClause}
    ${where}
    ORDER BY ${orderCol} ${dir} NULLS LAST, p.id
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, limit, offset]
  );

  return { posts: result.rows, total };
}

function buildFilterClauses(params: PostFilters) {
  const {
    researchId, accountIds, ownerEmail, type, captionSearch, hashtag,
    viewsMin, viewsMax, likesMin, likesMax, commentsMin, commentsMax,
    engagementMin, engagementMax, scoreMin, scoreMax,
    durationMin, durationMax, dateFrom, dateTo, scrapedFrom, scrapedTo,
    outlierViewsMin, outlierViewsMax, outlierEngMin, outlierEngMax, outlierConfidence,
  } = params;

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;
  let joinClause = "";
  if (researchId) {
    joinClause = `JOIN research_accounts ra ON ra.account_id = p.account_id`;
    conditions.push(`ra.research_id = $${paramIdx++}`);
    values.push(researchId);
  }
  if (accountIds && accountIds.length > 0) {
    const placeholders = accountIds.map(() => `$${paramIdx++}`).join(",");
    conditions.push(`p.account_id IN (${placeholders})`);
    values.push(...accountIds);
  }
  if (ownerEmail) {
    conditions.push(`EXISTS (SELECT 1 FROM auth.users ou WHERE ou.id = p.scraped_by AND ou.email = $${paramIdx++})`);
    values.push(ownerEmail);
  }
  if (type && type !== "all") { conditions.push(`p.type = $${paramIdx++}`); values.push(type); }
  if (captionSearch) { conditions.push(`p.caption ILIKE $${paramIdx++}`); values.push(`%${captionSearch}%`); }
  if (hashtag) {
    conditions.push(`EXISTS (SELECT 1 FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id AND h.tag ILIKE $${paramIdx++})`);
    values.push(hashtag);
  }
  if (viewsMin != null) { conditions.push(`p.video_view_count >= $${paramIdx++}`); values.push(viewsMin); }
  if (viewsMax != null) { conditions.push(`p.video_view_count <= $${paramIdx++}`); values.push(viewsMax); }
  if (likesMin != null) { conditions.push(`p.likes_count >= $${paramIdx++}`); values.push(likesMin); }
  if (likesMax != null) { conditions.push(`p.likes_count <= $${paramIdx++}`); values.push(likesMax); }
  if (commentsMin != null) { conditions.push(`p.comments_count >= $${paramIdx++}`); values.push(commentsMin); }
  if (commentsMax != null) { conditions.push(`p.comments_count <= $${paramIdx++}`); values.push(commentsMax); }
  if (engagementMin != null) { conditions.push(`p.engagement_rate >= $${paramIdx++}`); values.push(engagementMin); }
  if (engagementMax != null) { conditions.push(`p.engagement_rate <= $${paramIdx++}`); values.push(engagementMax); }
  if (scoreMin != null) { conditions.push(`p.performance_score >= $${paramIdx++}`); values.push(scoreMin); }
  if (scoreMax != null) { conditions.push(`p.performance_score <= $${paramIdx++}`); values.push(scoreMax); }
  if (durationMin != null) { conditions.push(`p.video_duration >= $${paramIdx++}`); values.push(durationMin); }
  if (durationMax != null) { conditions.push(`p.video_duration <= $${paramIdx++}`); values.push(durationMax); }
  if (dateFrom) { conditions.push(`p.posted_at >= $${paramIdx++}`); values.push(dateFrom); }
  if (dateTo) { conditions.push(`p.posted_at <= $${paramIdx++}`); values.push(dateTo + "T23:59:59Z"); }
  if (scrapedFrom) { conditions.push(`p.scraped_at >= $${paramIdx++}`); values.push(scrapedFrom); }
  if (scrapedTo) { conditions.push(`p.scraped_at <= $${paramIdx++}`); values.push(scrapedTo + "T23:59:59Z"); }
  if (outlierViewsMin != null) { conditions.push(`p.outlier_views >= $${paramIdx++}`); values.push(outlierViewsMin); }
  if (outlierViewsMax != null) { conditions.push(`p.outlier_views <= $${paramIdx++}`); values.push(outlierViewsMax); }
  if (outlierEngMin != null) { conditions.push(`p.outlier_engagement >= $${paramIdx++}`); values.push(outlierEngMin); }
  if (outlierEngMax != null) { conditions.push(`p.outlier_engagement <= $${paramIdx++}`); values.push(outlierEngMax); }
  if (outlierConfidence && outlierConfidence !== "all") { conditions.push(`p.outlier_confidence = $${paramIdx++}`); values.push(outlierConfidence); }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { conditions, values, paramIdx, joinClause, where };
}

export interface Stats {
  totalPosts: number;
  totalVideos: number;
  totalAccounts: number;
  avgEngagement: number;
  minEngagement: number;
  maxEngagement: number;
  avgViews: number;
  minViews: number;
  maxViews: number;
  avgLikes: number;
  minLikes: number;
  maxLikes: number;
  avgComments: number;
  minComments: number;
  maxComments: number;
}

export async function getStats(filters: PostFilters = {}): Promise<Stats> {
  const { values, joinClause, where } = buildFilterClauses(filters);

  const result = await pool.query(
    `SELECT
      COUNT(DISTINCT p.id)::int as total_posts,
      COUNT(DISTINCT p.id) FILTER (WHERE p.type = 'Video')::int as total_videos,
      COUNT(DISTINCT p.account_id)::int as total_accounts,
      ROUND(AVG(p.engagement_rate)::numeric, 4) as avg_engagement,
      ROUND(MIN(p.engagement_rate)::numeric, 4) as min_engagement,
      ROUND(MAX(p.engagement_rate)::numeric, 4) as max_engagement,
      ROUND(AVG(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL))::int as avg_views,
      MIN(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL) as min_views,
      MAX(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL) as max_views,
      ROUND(AVG(p.likes_count))::int as avg_likes,
      MIN(p.likes_count) as min_likes,
      MAX(p.likes_count) as max_likes,
      ROUND(AVG(p.comments_count))::int as avg_comments,
      MIN(p.comments_count) as min_comments,
      MAX(p.comments_count) as max_comments
    FROM posts p
    LEFT JOIN accounts a ON a.id = p.account_id
    ${joinClause} ${where}`,
    values
  );

  const r = result.rows[0];
  return {
    totalPosts: r.total_posts || 0,
    totalVideos: r.total_videos || 0,
    totalAccounts: r.total_accounts || 0,
    avgEngagement: parseFloat(r.avg_engagement) || 0,
    minEngagement: parseFloat(r.min_engagement) || 0,
    maxEngagement: parseFloat(r.max_engagement) || 0,
    avgViews: r.avg_views || 0,
    minViews: r.min_views || 0,
    maxViews: r.max_views || 0,
    avgLikes: r.avg_likes || 0,
    minLikes: r.min_likes || 0,
    maxLikes: r.max_likes || 0,
    avgComments: r.avg_comments || 0,
    minComments: r.min_comments || 0,
    maxComments: r.max_comments || 0,
  };
}

// ── Datasets ────────────────────────────────────────────

export interface DatasetMetrics {
  total_posts: number;
  total_creators: number;
  median_views: number | null;
  min_views: number | null;
  max_views: number | null;
  median_likes: number | null;
  min_likes: number | null;
  max_likes: number | null;
  median_comments: number | null;
  min_comments: number | null;
  max_comments: number | null;
  median_engagement: number | null;
  min_engagement: number | null;
  max_engagement: number | null;
  median_duration: number | null;
  min_duration: number | null;
  max_duration: number | null;
}

export interface Dataset {
  id: number;
  name: string;
  description: string | null;
  context: string | null;
  niche: string | null;
  objective: string | null;
  tags: string[];
  keywords: string[];
  additional_notes: string | null;
  status: string;
  created_at: string;
  updated_at: string;
  posts_count: number;
  creators_count: number;
  metrics: DatasetMetrics;
}

export interface DatasetDetail extends Dataset {
  creators: string[];
  researches: { id: number; name: string }[];
  scraped_range: { min: string | null; max: string | null };
}

export interface DatasetPost extends Post {
  dataset_note: string | null;
  added_at: string;
}

function rowToDataset(r: Record<string, unknown>): Dataset {
  return {
    id: r.id as number,
    name: r.name as string,
    description: r.description as string | null,
    context: r.context as string | null,
    niche: r.niche as string | null,
    objective: r.objective as string | null,
    tags: (r.tags as string[]) || [],
    keywords: (r.keywords as string[]) || [],
    additional_notes: r.additional_notes as string | null,
    status: r.status as string,
    created_at: r.created_at as string,
    updated_at: r.updated_at as string,
    posts_count: (r.total_posts as number) || 0,
    creators_count: (r.total_creators as number) || 0,
    metrics: {
      total_posts: (r.total_posts as number) || 0,
      total_creators: (r.total_creators as number) || 0,
      median_views: r.median_views as number | null,
      min_views: r.min_views as number | null,
      max_views: r.max_views as number | null,
      median_likes: r.median_likes as number | null,
      min_likes: r.min_likes as number | null,
      max_likes: r.max_likes as number | null,
      median_comments: r.median_comments as number | null,
      min_comments: r.min_comments as number | null,
      max_comments: r.max_comments as number | null,
      median_engagement: r.median_engagement as number | null,
      min_engagement: r.min_engagement as number | null,
      max_engagement: r.max_engagement as number | null,
      median_duration: r.median_duration as number | null,
      min_duration: r.min_duration as number | null,
      max_duration: r.max_duration as number | null,
    },
  };
}

export async function getDatasets(userId: string): Promise<Dataset[]> {
  const result = await pool.query(`
    SELECT *
    FROM datasets
    WHERE user_id = $1
    ORDER BY updated_at DESC
  `, [userId]);
  return result.rows.map(rowToDataset);
}

export async function getDataset(datasetId: number, userId: string): Promise<DatasetDetail | null> {
  const result = await pool.query(`
    SELECT * FROM datasets WHERE id = $1 AND user_id = $2
  `, [datasetId, userId]);

  if (result.rows.length === 0) return null;
  const dataset = rowToDataset(result.rows[0]);

  // Fetch derived fields in parallel
  const [creatorsRes, researchesRes, scrapedRes] = await Promise.all([
    pool.query(`
      SELECT DISTINCT a.username
      FROM dataset_posts dp
      JOIN posts p ON p.id = dp.post_id
      JOIN accounts a ON a.id = p.account_id
      WHERE dp.dataset_id = $1
      ORDER BY a.username
    `, [datasetId]),
    pool.query(`
      SELECT DISTINCT r.id, r.name
      FROM dataset_posts dp
      JOIN posts p ON p.id = dp.post_id
      JOIN research_accounts ra ON ra.account_id = p.account_id
      JOIN researches r ON r.id = ra.research_id
      WHERE dp.dataset_id = $1
      ORDER BY r.name
    `, [datasetId]),
    pool.query(`
      SELECT MIN(p.scraped_at) as min, MAX(p.scraped_at) as max
      FROM dataset_posts dp
      JOIN posts p ON p.id = dp.post_id
      WHERE dp.dataset_id = $1
    `, [datasetId]),
  ]);

  return {
    ...dataset,
    creators: creatorsRes.rows.map((r: { username: string }) => r.username),
    researches: researchesRes.rows,
    scraped_range: scrapedRes.rows[0] || { min: null, max: null },
  };
}

export async function getDatasetPosts(datasetId: number, sortBy = "added_at", sortDir = "DESC"): Promise<DatasetPost[]> {
  const allowedSorts: Record<string, string> = {
    added_at: "dp.added_at",
    performance_score: "p.performance_score",
    engagement_rate: "p.engagement_rate",
    likes_count: "p.likes_count",
    video_view_count: "p.video_view_count",
    posted_at: "p.posted_at",
  };
  const orderCol = allowedSorts[sortBy] || "dp.added_at";
  const dir = sortDir === "ASC" ? "ASC" : "DESC";

  const result = await pool.query(`
    SELECT
      p.id, p.short_code, COALESCE(a.username, 'desconocido') as username,
      COALESCE(a.account_type, 'competitor') as account_type,
      COALESCE(a.followers_count, 0) as followers_count,
      p.type, p.caption, p.likes_count, p.comments_count, p.shares_count,
      p.video_view_count, p.video_play_count, p.video_duration,
      p.engagement_rate, p.performance_score, p.posted_at, p.url,
      p.display_url, p.stored_url, p.product_type,
      p.scraped_at, p.analysis_status,
      COALESCE(
        (SELECT array_agg(h.tag) FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id),
        ARRAY[]::TEXT[]
      ) as hashtags,
      (SELECT u.email FROM auth.users u WHERE u.id = p.scraped_by) as owner_email,
      dp.note as dataset_note,
      dp.added_at
    FROM dataset_posts dp
    JOIN posts p ON p.id = dp.post_id
    LEFT JOIN accounts a ON a.id = p.account_id
    WHERE dp.dataset_id = $1
    ORDER BY ${orderCol} ${dir} NULLS LAST, p.id
  `, [datasetId]);

  return result.rows;
}

export async function getDatasetsForUser(userId: string): Promise<{ id: number; name: string; posts_count: number }[]> {
  const result = await pool.query(`
    SELECT d.id, d.name, COUNT(dp.post_id)::int as posts_count
    FROM datasets d
    LEFT JOIN dataset_posts dp ON dp.dataset_id = d.id
    WHERE d.user_id = $1 AND d.status != 'archived'
    GROUP BY d.id
    ORDER BY d.updated_at DESC
  `, [userId]);
  return result.rows;
}

// ── AI Sessions ─────────────────────────────────────────

export interface AiSession {
  id: number;
  user_id: string;
  name: string;
  agent_type: string;
  dataset_id: number;
  tags: string[];
  status: string;
  phase: string;
  created_at: string;
  updated_at: string;
}

export interface AiSessionListItem extends AiSession {
  dataset_name: string;
  message_count: number;
}

export interface AiMessage {
  id: number;
  session_id: number;
  role: string;
  content: string;
  created_at: string;
}

export async function getAiSessions(userId: string): Promise<AiSessionListItem[]> {
  const result = await pool.query(`
    SELECT
      s.*,
      d.name as dataset_name,
      (SELECT COUNT(*)::int FROM ai_messages m WHERE m.session_id = s.id AND m.role != 'system') as message_count
    FROM ai_sessions s
    JOIN datasets d ON d.id = s.dataset_id
    WHERE s.user_id = $1
    ORDER BY s.updated_at DESC
  `, [userId]);
  return result.rows;
}

export async function getAiSession(sessionId: number, userId: string): Promise<AiSession | null> {
  const result = await pool.query(
    `SELECT * FROM ai_sessions WHERE id = $1 AND user_id = $2`,
    [sessionId, userId]
  );
  return result.rows[0] || null;
}

export async function getAiMessages(sessionId: number): Promise<AiMessage[]> {
  const result = await pool.query(
    `SELECT * FROM ai_messages WHERE session_id = $1 ORDER BY created_at ASC`,
    [sessionId]
  );
  return result.rows;
}

export async function addAiMessage(sessionId: number, role: string, content: string): Promise<AiMessage> {
  const result = await pool.query(
    `INSERT INTO ai_messages (session_id, role, content) VALUES ($1, $2, $3) RETURNING *`,
    [sessionId, role, content]
  );
  // Update session's updated_at
  await pool.query(`UPDATE ai_sessions SET updated_at = NOW() WHERE id = $1`, [sessionId]);
  return result.rows[0];
}

export async function getDatasetMetadataForAgent(datasetId: number) {
  const [dsRes, creatorsRes] = await Promise.all([
    pool.query(`SELECT * FROM datasets WHERE id = $1`, [datasetId]),
    pool.query(`
      SELECT DISTINCT a.username, a.followers_count
      FROM dataset_posts dp
      JOIN posts p ON p.id = dp.post_id
      JOIN accounts a ON a.id = p.account_id
      WHERE dp.dataset_id = $1
      ORDER BY a.followers_count DESC
    `, [datasetId]),
  ]);

  if (dsRes.rows.length === 0) return null;
  const ds = dsRes.rows[0];

  return {
    name: ds.name,
    description: ds.description,
    context: ds.context,
    niche: ds.niche,
    objective: ds.objective,
    tags: ds.tags || [],
    keywords: ds.keywords || [],
    total_posts: ds.total_posts || 0,
    total_creators: ds.total_creators || 0,
    metrics: {
      views: { median: ds.median_views, min: ds.min_views, max: ds.max_views },
      likes: { median: ds.median_likes, min: ds.min_likes, max: ds.max_likes },
      comments: { median: ds.median_comments, min: ds.min_comments, max: ds.max_comments },
      engagement: { median: ds.median_engagement, min: ds.min_engagement, max: ds.max_engagement },
      duration: { median: ds.median_duration, min: ds.min_duration, max: ds.max_duration },
    },
    creators: creatorsRes.rows.map((r: { username: string; followers_count: number }) => ({
      username: r.username,
      followers: r.followers_count,
    })),
  };
}

// ── Instagram Dashboard (cuentas propias via Meta API) ──

export interface IgConnection {
  id: number;
  ig_account_id: string;
  ig_username: string;
  ig_name: string | null;
  ig_profile_picture_url: string | null;
  ig_followers_count: number;
  ig_following_count: number | null;
  ig_media_count: number;
  ig_biography: string | null;
  ig_website: string | null;
  ig_account_type: string | null;
  is_active: boolean;
  connected_at: string;
  last_synced_at: string | null;
}

export interface IgDailyMetrics {
  metric_date: string;
  reach: number;
  views: number;
  accounts_engaged: number;
  total_interactions: number;
  likes: number;
  comments: number;
  shares: number;
  saves: number;
  replies: number;
  reposts: number;
  follows: number;
  unfollows: number;
  follows_net: number;
  profile_links_taps: number;
  breakdowns: Record<string, Record<string, number>>;
}

export interface IgMedia {
  id: number;
  ig_media_id: string;
  media_type: string;
  media_product_type: string | null;
  caption: string | null;
  permalink: string | null;
  media_url: string | null;
  thumbnail_url: string | null;
  published_at: string | null;
  like_count: number;
  comments_count: number;
  reach: number | null;
  views: number | null;
  saves: number | null;
  shares: number | null;
  total_interactions: number | null;
  follows: number | null;
  profile_visits: number | null;
  ig_reels_avg_watch_time: number | null;
  ig_reels_video_view_total_time: number | null;
  skip_rate: number | null;
  engagement_rate: number | null;
  performance_score: number | null;
  outlier_views: number | null;
  outlier_engagement: number | null;
  outlier_confidence: string | null;
  outlier_confidence_score: number | null;
}

export interface IgPulseStats {
  followers: number;
  followers_delta: number;
  avg_reach_7d: number;
  avg_reach_prev_7d: number;
  avg_engagement_7d: number;
  avg_engagement_prev_7d: number;
  total_posts: number;
}

export async function getIgConnection(userId: string): Promise<IgConnection | null> {
  const result = await pool.query(
    `SELECT *
     FROM ig_connections
     WHERE user_id = $1 AND is_active = true
     ORDER BY connected_at DESC LIMIT 1`,
    [userId]
  );
  return result.rows[0] || null;
}

export async function getIgDailyMetrics(connectionId: number, days: number = 30): Promise<IgDailyMetrics[]> {
  const result = await pool.query(
    `SELECT metric_date, reach, views, accounts_engaged, total_interactions,
            likes, comments, shares, saves, replies, reposts,
            follows, unfollows, follows_net, profile_links_taps, breakdowns
     FROM ig_account_daily_metrics
     WHERE ig_connection_id = $1
       AND metric_date >= CURRENT_DATE - $2::int
     ORDER BY metric_date ASC`,
    [connectionId, days]
  );
  return result.rows.map((r: Record<string, unknown>) => ({
    ...r,
    breakdowns: typeof r.breakdowns === 'string' ? JSON.parse(r.breakdowns as string) : (r.breakdowns || {}),
  })) as IgDailyMetrics[];
}

export async function getIgPulseStats(connectionId: number): Promise<IgPulseStats> {
  const result = await pool.query(
    `WITH recent AS (
       SELECT * FROM ig_account_daily_metrics
       WHERE ig_connection_id = $1 AND metric_date >= CURRENT_DATE - 14
     ),
     last7 AS (SELECT * FROM recent WHERE metric_date >= CURRENT_DATE - 7),
     prev7 AS (SELECT * FROM recent WHERE metric_date < CURRENT_DATE - 7)
     SELECT
       (SELECT ig_followers_count FROM ig_connections WHERE id = $1) as followers,
       COALESCE((SELECT SUM(follows_net) FROM last7), 0) as followers_delta,
       COALESCE((SELECT ROUND(AVG(reach)) FROM last7), 0) as avg_reach_7d,
       COALESCE((SELECT ROUND(AVG(reach)) FROM prev7), 0) as avg_reach_prev_7d,
       COALESCE((SELECT ROUND(AVG(total_interactions)) FROM last7), 0) as avg_engagement_7d,
       COALESCE((SELECT ROUND(AVG(total_interactions)) FROM prev7), 0) as avg_engagement_prev_7d,
       (SELECT COUNT(*)::int FROM ig_media WHERE ig_connection_id = $1) as total_posts`,
    [connectionId]
  );
  const r = result.rows[0];
  return {
    followers: parseInt(r.followers) || 0,
    followers_delta: parseInt(r.followers_delta) || 0,
    avg_reach_7d: parseInt(r.avg_reach_7d) || 0,
    avg_reach_prev_7d: parseInt(r.avg_reach_prev_7d) || 0,
    avg_engagement_7d: parseInt(r.avg_engagement_7d) || 0,
    avg_engagement_prev_7d: parseInt(r.avg_engagement_prev_7d) || 0,
    total_posts: parseInt(r.total_posts) || 0,
  };
}

export async function getIgMedia(
  connectionId: number,
  sortBy: string = "published_at",
  sortDir: string = "DESC",
  limit: number = 100,
  offset: number = 0
): Promise<{ media: IgMedia[]; total: number }> {
  const allowedSorts: Record<string, string> = {
    published_at: "m.published_at",
    reach: "m.reach",
    views: "m.views",
    likes: "m.like_count",
    saves: "m.saves",
    shares: "m.shares",
    total_interactions: "m.total_interactions",
    ig_reels_avg_watch_time: "m.ig_reels_avg_watch_time",
    skip_rate: "m.skip_rate",
    engagement_rate: "m.engagement_rate",
    performance_score: "m.performance_score",
    outlier_views: "m.outlier_views",
    outlier_engagement: "m.outlier_engagement",
  };
  const orderCol = allowedSorts[sortBy] || "m.published_at";
  const dir = sortDir === "ASC" ? "ASC" : "DESC";

  const countResult = await pool.query(
    `SELECT COUNT(*)::int FROM ig_media WHERE ig_connection_id = $1`,
    [connectionId]
  );

  const result = await pool.query(
    `SELECT *
     FROM ig_media m
     WHERE ig_connection_id = $1
     ORDER BY ${orderCol} ${dir} NULLS LAST
     LIMIT $2 OFFSET $3`,
    [connectionId, limit, offset]
  );

  return { media: result.rows, total: countResult.rows[0].count };
}

export async function getDatasetFullContent(datasetId: number) {
  const result = await pool.query(`
    SELECT
      p.id, p.short_code, p.caption, p.type, p.product_type,
      p.likes_count, p.comments_count, p.shares_count,
      p.video_view_count, p.video_duration,
      p.engagement_rate, p.performance_score,
      p.posted_at,
      COALESCE(a.username, 'desconocido') as username,
      COALESCE(a.followers_count, 0) as creator_followers,
      COALESCE(
        (SELECT array_agg(h.tag) FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id),
        ARRAY[]::TEXT[]
      ) as hashtags,
      pd.description as ai_analysis
    FROM dataset_posts dp
    JOIN posts p ON p.id = dp.post_id
    LEFT JOIN accounts a ON a.id = p.account_id
    LEFT JOIN LATERAL (
      SELECT description FROM post_descriptions WHERE post_id = p.id ORDER BY created_at DESC LIMIT 1
    ) pd ON true
    WHERE dp.dataset_id = $1
    ORDER BY p.performance_score DESC NULLS LAST
    LIMIT 75
  `, [datasetId]);

  return result.rows.map((r: Record<string, unknown>) => {
    let analysis = null;
    if (r.ai_analysis) {
      try {
        analysis = typeof r.ai_analysis === "string" ? JSON.parse(r.ai_analysis as string) : r.ai_analysis;
      } catch {
        analysis = r.ai_analysis;
      }
    }
    return { ...r, ai_analysis: analysis };
  });
}
