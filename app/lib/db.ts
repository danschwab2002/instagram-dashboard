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
}

export async function getAccounts(): Promise<Account[]> {
  const result = await pool.query(`
    SELECT id, username, full_name, followers_count, profile_pic_url, account_type
    FROM accounts
    ORDER BY followers_count DESC
  `);
  return result.rows;
}

export async function getPosts(params: {
  accountId?: number;
  type?: string;
  sortBy?: string;
  sortDir?: string;
  limit?: number;
  offset?: number;
}): Promise<{ posts: Post[]; total: number }> {
  const {
    accountId,
    type,
    sortBy = "performance_score",
    sortDir = "DESC",
    limit = 50,
    offset = 0,
  } = params;

  const allowedSorts: Record<string, string> = {
    performance_score: "p.performance_score",
    engagement_rate: "p.engagement_rate",
    likes_count: "p.likes_count",
    comments_count: "p.comments_count",
    shares_count: "p.shares_count",
    video_view_count: "p.video_view_count",
    posted_at: "p.posted_at",
  };

  const orderCol = allowedSorts[sortBy] || "p.performance_score";
  const dir = sortDir === "ASC" ? "ASC" : "DESC";

  const conditions: string[] = [];
  const values: (string | number)[] = [];
  let paramIdx = 1;

  if (accountId) {
    conditions.push(`p.account_id = $${paramIdx++}`);
    values.push(accountId);
  }
  if (type && type !== "all") {
    conditions.push(`p.type = $${paramIdx++}`);
    values.push(type);
  }

  const where = conditions.length > 0 ? `WHERE ${conditions.join(" AND ")}` : "";

  const countResult = await pool.query(
    `SELECT COUNT(*) FROM posts p ${where}`,
    values
  );
  const total = parseInt(countResult.rows[0].count, 10);

  const result = await pool.query(
    `SELECT
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
      ) as hashtags
    FROM posts p
    LEFT JOIN accounts a ON a.id = p.account_id
    ${where}
    ORDER BY ${orderCol} ${dir} NULLS LAST
    LIMIT $${paramIdx++} OFFSET $${paramIdx++}`,
    [...values, limit, offset]
  );

  return { posts: result.rows, total };
}

export async function getStats(accountId?: number): Promise<{
  totalPosts: number;
  totalVideos: number;
  avgEngagement: number;
  avgViews: number;
  totalAccounts: number;
}> {
  const where = accountId ? `WHERE p.account_id = $1` : "";
  const values = accountId ? [accountId] : [];

  const result = await pool.query(
    `SELECT
      COUNT(*)::int as total_posts,
      COUNT(*) FILTER (WHERE p.type = 'Video')::int as total_videos,
      ROUND(AVG(p.engagement_rate)::numeric, 4) as avg_engagement,
      ROUND(AVG(p.video_view_count) FILTER (WHERE p.video_view_count IS NOT NULL))::int as avg_views
    FROM posts p ${where}`,
    values
  );

  const accountsResult = await pool.query(`SELECT COUNT(*)::int as total FROM accounts`);

  return {
    totalPosts: result.rows[0].total_posts || 0,
    totalVideos: result.rows[0].total_videos || 0,
    avgEngagement: parseFloat(result.rows[0].avg_engagement) || 0,
    avgViews: result.rows[0].avg_views || 0,
    totalAccounts: accountsResult.rows[0].total || 0,
  };
}
