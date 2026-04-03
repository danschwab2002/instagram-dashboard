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
    FROM researches r
    JOIN auth.users u ON u.id = r.user_id
    WHERE r.user_id IS NOT NULL
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
  };

  const orderCol = allowedSorts[sortBy] || "p.performance_score";
  const dir = sortDir === "ASC" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;
  let joinClause = "";
  let needsOwnerJoin = false;

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
    needsOwnerJoin = true;
    conditions.push(`owner_u.email = $${paramIdx++}`);
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

  // Date range (posted)
  if (dateFrom) { conditions.push(`p.posted_at >= $${paramIdx++}`); values.push(dateFrom); }
  if (dateTo) { conditions.push(`p.posted_at <= $${paramIdx++}`); values.push(dateTo + "T23:59:59Z"); }

  // Date range (scraped)
  if (scrapedFrom) { conditions.push(`p.scraped_at >= $${paramIdx++}`); values.push(scrapedFrom); }
  if (scrapedTo) { conditions.push(`p.scraped_at <= $${paramIdx++}`); values.push(scrapedTo + "T23:59:59Z"); }

  const ownerJoin = needsOwnerJoin
    ? `JOIN research_accounts owner_ra ON owner_ra.account_id = p.account_id
       JOIN researches owner_r ON owner_r.id = owner_ra.research_id
       JOIN auth.users owner_u ON owner_u.id = owner_r.user_id`
    : "";

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(DISTINCT p.id) FROM posts p
     LEFT JOIN accounts a ON a.id = p.account_id
     ${joinClause} ${ownerJoin} ${where}`,
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
      COALESCE(
        (SELECT array_agg(h.tag) FROM post_hashtags ph JOIN hashtags h ON h.id = ph.hashtag_id WHERE ph.post_id = p.id),
        ARRAY[]::TEXT[]
      ) as hashtags,
      (SELECT u.email FROM researches r
       JOIN research_accounts ra2 ON ra2.research_id = r.id
       JOIN auth.users u ON u.id = r.user_id
       WHERE ra2.account_id = p.account_id
       ORDER BY r.created_at ASC LIMIT 1
      ) as owner_email
    FROM posts p
    LEFT JOIN accounts a ON a.id = p.account_id
    ${joinClause} ${ownerJoin}
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
  } = params;

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;
  let joinClause = "";
  let ownerJoin = "";

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
    ownerJoin = `JOIN research_accounts owner_ra ON owner_ra.account_id = p.account_id
       JOIN researches owner_r ON owner_r.id = owner_ra.research_id
       JOIN auth.users owner_u ON owner_u.id = owner_r.user_id`;
    conditions.push(`owner_u.email = $${paramIdx++}`);
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

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";
  return { conditions, values, paramIdx, joinClause, ownerJoin, where };
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
  const { values, joinClause, ownerJoin, where } = buildFilterClauses(filters);

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
    ${joinClause} ${ownerJoin} ${where}`,
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
