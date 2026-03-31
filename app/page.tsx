import { getAccounts, getPosts, getStats, getResearches } from "./lib/db";
import { requireUser } from "./lib/auth";
import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const user = await requireUser();
  const params = await searchParams;
  const accountId = params.account ? parseInt(params.account) : undefined;
  const researchId = params.research ? parseInt(params.research) : undefined;
  const type = params.type || "all";
  const sortBy = params.sort || "performance_score";
  const sortDir = params.dir || "DESC";
  const page = parseInt(params.page || "1");
  const limit = 100;
  const offset = (page - 1) * limit;

  const [accounts, { posts, total }, stats, researches] = await Promise.all([
    getAccounts(researchId),
    getPosts({ accountId, researchId, type, sortBy, sortDir, limit, offset }),
    getStats(accountId, researchId),
    getResearches(user.id),
  ]);

  return (
    <Dashboard
      accounts={accounts}
      posts={posts}
      stats={stats}
      total={total}
      currentPage={page}
      pageSize={limit}
      filters={{ accountId, researchId, type, sortBy, sortDir }}
      researches={researches}
      userEmail={user.email}
    />
  );
}
