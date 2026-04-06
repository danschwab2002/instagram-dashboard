import { requireUser } from "../lib/auth";
import { getDatasets } from "../lib/db";
import { DatasetsPage } from "./DatasetsPage";

export const dynamic = "force-dynamic";

export const metadata = {
  title: "Datasets — Antigravity",
};

export default async function Page() {
  const user = await requireUser();
  const datasets = await getDatasets(user.id);
  return <DatasetsPage datasets={datasets} />;
}
