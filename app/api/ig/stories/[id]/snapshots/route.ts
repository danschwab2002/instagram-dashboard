import { NextRequest, NextResponse } from "next/server";
import { getIgStorySnapshots } from "../../../../../lib/db";

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const mediaId = parseInt(id);
  if (isNaN(mediaId)) {
    return NextResponse.json({ error: "Invalid ID" }, { status: 400 });
  }

  const snapshots = await getIgStorySnapshots(mediaId);
  return NextResponse.json({ snapshots });
}
