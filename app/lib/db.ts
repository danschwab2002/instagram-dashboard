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
    durationMin, durationMax, dateFrom, dateTo,
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

  // Date range
  if (dateFrom) { conditions.push(`p.posted_at >= $${paramIdx++}`); values.push(dateFrom); }
  if (dateTo) { conditions.push(`p.posted_at <= $${paramIdx++}`); values.push(dateTo + "T23:59:59Z"); }

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

export async function getStats(filters: PostFilters = {}): Promise<{
  totalPosts: number;
  totalVideos: number;
  avgEngagement: number;
  avgViews: number;
  totalAccounts: number;
}> {
  // Reuse getPosts logic for consistent filtering, but just get counts
  const { total } = await getPosts({ ...filters, limit: 0, offset: 0 });

  // For stats, do a simpler query with same filters
  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;
  let joinClause = "";

  if (filters.researchId) {
    joinClause = `JOIN research_accounts ra ON ra.account_id = p.account_id`;
    conditions.push(`ra.research_id = $${paramIdx++}`);
    values.push(filters.researchId);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const result = await pool.query(
    `SELECT
      COUNT(*)::int as total_posts,
      COUNT(*) FILTER (WHERE p.type = 'Video')::int as total_videos,
      ROUND(AVG(p.engagement_rate)::numeric, 4) as avg_engagement,
      ROUND(AVG(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL))::int as avg_views
    FROM posts p ${joinClause} ${where}`,
    values
  );

  let accountsTotal: number;
  if (filters.researchId) {
    const accountsResult = await pool.query(
      `SELECT COUNT(*)::int as total FROM research_accounts WHERE research_id = $1`,
      [filters.researchId]
    );
    accountsTotal = accountsResult.rows[0].total || 0;
  } else {
    const accountsResult = await pool.query(`SELECT COUNT(*)::int as total FROM accounts`);
    accountsTotal = accountsResult.rows[0].total || 0;
  }

  return {
    totalPosts: result.rows[0].total_posts || 0,
    totalVideos: result.rows[0].total_videos || 0,
    avgEngagement: parseFloat(result.rows[0].avg_engagement) || 0,
    avgViews: result.rows[0].avg_views || 0,
    totalAccounts: accountsTotal,
  };
}
