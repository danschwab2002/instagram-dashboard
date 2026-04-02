import { NextRequest, NextResponse } from "next/server";
import { getPosts, PostFilters } from "../../../lib/db";
import { createClient } from "../../../lib/supabase/server";

function parseNum(v: string | null): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

function parseIds(v: string | null): number[] | undefined {
  if (!v) return undefined;
  const ids = v.split(",").map(Number).filter(n => !isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

// GET /api/posts/ids — returns all post IDs matching current filters (no pagination)
export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "No autorizado" }, { status: 401 });

  const sp = request.nextUrl.searchParams;

  const filters: PostFilters = {
    researchId: parseNum(sp.get("research")),
    accountIds: parseIds(sp.get("accounts")),
    ownerEmail: sp.get("owner") || undefined,
    type: sp.get("type") || "all",
    captionSearch: sp.get("caption") || undefined,
    hashtag: sp.get("hashtag") || undefined,
    viewsMin: parseNum(sp.get("viewsMin")),
    viewsMax: parseNum(sp.get("viewsMax")),
    likesMin: parseNum(sp.get("likesMin")),
    likesMax: parseNum(sp.get("likesMax")),
    commentsMin: parseNum(sp.get("commentsMin")),
    commentsMax: parseNum(sp.get("commentsMax")),
    engagementMin: parseNum(sp.get("engMin")),
    engagementMax: parseNum(sp.get("engMax")),
    scoreMin: parseNum(sp.get("scoreMin")),
    scoreMax: parseNum(sp.get("scoreMax")),
    durationMin: parseNum(sp.get("durMin")),
    durationMax: parseNum(sp.get("durMax")),
    dateFrom: sp.get("dateFrom") || undefined,
    dateTo: sp.get("dateTo") || undefined,
    sortBy: sp.get("sort") || "performance_score",
    sortDir: sp.get("dir") || "DESC",
    limit: 10000,
    offset: 0,
  };

  const { posts } = await getPosts(filters);
  return NextResponse.json({ ids: posts.map(p => p.id) });
}
