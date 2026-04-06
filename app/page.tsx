import { getAccounts, getPosts, getStats, getResearches, getOwners, getDatasetsForUser, PostFilters } from "./lib/db";
import { requireUser } from "./lib/auth";
import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

function parseNum(v: string | undefined): number | undefined {
  if (!v) return undefined;
  const n = parseFloat(v);
  return isNaN(n) ? undefined : n;
}

function parseIds(v: string | undefined): number[] | undefined {
  if (!v) return undefined;
  const ids = v.split(",").map(Number).filter(n => !isNaN(n));
  return ids.length > 0 ? ids : undefined;
}

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;

  const filters: PostFilters = {
    researchId: parseNum(params.research),
    accountIds: parseIds(params.accounts),
    ownerEmail: params.owner,
    type: params.type || "all",
    captionSearch: params.caption,
    hashtag: params.hashtag,
    viewsMin: parseNum(params.viewsMin),
    viewsMax: parseNum(params.viewsMax),
    likesMin: parseNum(params.likesMin),
    likesMax: parseNum(params.likesMax),
    commentsMin: parseNum(params.commentsMin),
    commentsMax: parseNum(params.commentsMax),
    engagementMin: parseNum(params.engMin) != null ? parseNum(params.engMin)! / 100 : undefined,
    engagementMax: parseNum(params.engMax) != null ? parseNum(params.engMax)! / 100 : undefined,
    scoreMin: parseNum(params.scoreMin),
    scoreMax: parseNum(params.scoreMax),
    durationMin: parseNum(params.durMin),
    durationMax: parseNum(params.durMax),
    dateFrom: params.dateFrom,
    dateTo: params.dateTo,
    scrapedFrom: params.scrapedFrom,
    scrapedTo: params.scrapedTo,
    sortBy: params.sort || "performance_score",
    sortDir: params.dir || "DESC",
    limit: 100,
    offset: ((parseInt(params.page || "1") - 1) * 100),
  };

  const page = parseInt(params.page || "1");

  const [accounts, { posts, total }, stats, researches, owners, datasets] = await Promise.all([
    getAccounts(filters.researchId),
    getPosts(filters),
    getStats(filters),
    getResearches(user.id),
    getOwners(),
    getDatasetsForUser(user.id),
  ]);

  return (
    <Dashboard
      accounts={accounts}
      posts={posts}
      stats={stats}
      total={total}
      currentPage={page}
      pageSize={100}
      filters={filters}
      researches={researches}
      owners={owners}
      datasets={datasets}
      userEmail={user.email}
    />
  );
}
