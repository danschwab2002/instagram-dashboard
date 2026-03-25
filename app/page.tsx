import { getAccounts, getPosts, getStats } from "./lib/db";
import { Dashboard } from "./components/Dashboard";

export const dynamic = "force-dynamic";

export default async function Home({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const accountId = params.account ? parseInt(params.account) : undefined;
  const type = params.type || "all";
  const sortBy = params.sort || "performance_score";
  const sortDir = params.dir || "DESC";
  const page = parseInt(params.page || "1");
  const limit = 100;
  const offset = (page - 1) * limit;

  const [accounts, { posts, total }, stats] = await Promise.all([
    getAccounts(),
    getPosts({ accountId, type, sortBy, sortDir, limit, offset }),
    getStats(accountId),
  ]);

  return (
    <Dashboard
      accounts={accounts}
      posts={posts}
      stats={stats}
      total={total}
      currentPage={page}
      pageSize={limit}
      filters={{ accountId, type, sortBy, sortDir }}
    />
  );
}
