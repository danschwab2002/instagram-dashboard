import { notFound } from "next/navigation";
import { requireUser } from "../../lib/auth";
import { getDataset, getDatasetPosts } from "../../lib/db";
import { DatasetDetail } from "./DatasetDetail";

export const dynamic = "force-dynamic";

export async function generateMetadata({ params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const user = await requireUser();
  const dataset = await getDataset(parseInt(id), user.id);
  if (!dataset) return { title: "No encontrado" };
  return { title: `${dataset.name} — Antigravity` };
}

export default async function Page({ params }: { params: Promise<{ id: string }> }) {
  const user = await requireUser();
  const { id } = await params;
  const datasetId = parseInt(id);

  const dataset = await getDataset(datasetId, user.id);
  if (!dataset) notFound();

  const posts = await getDatasetPosts(datasetId);

  return <DatasetDetail dataset={dataset} posts={posts} />;
}
