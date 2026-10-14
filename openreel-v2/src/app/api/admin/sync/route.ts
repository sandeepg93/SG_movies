import { NextResponse } from "next/server";
import { revalidatePath } from "next/cache";
import { safeEqual } from "@/lib/admin/auth";
import { syncAllSources } from "@/lib/admin/sync";

export const dynamic = "force-dynamic";
export const maxDuration = 300;

/** For scheduled syncing: call with  Authorization: Bearer <CRON_SECRET>  (or ?token=<CRON_SECRET>). */
async function handle(request: Request) {
  const secret = process.env.CRON_SECRET || "";
  if (secret.length < 16) {
    return NextResponse.json({ error: "Set CRON_SECRET (16+ characters) in .env.local to enable scheduled sync." }, { status: 503 });
  }
  const auth = request.headers.get("authorization") || "";
  const token = auth.startsWith("Bearer ") ? auth.slice(7) : new URL(request.url).searchParams.get("token") || "";
  if (!safeEqual(token, secret)) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const results = await syncAllSources();
  revalidatePath("/", "layout");
  return NextResponse.json({ ok: true, syncedAt: new Date().toISOString(), results });
}

export async function GET(request: Request) {
  return handle(request);
}

export async function POST(request: Request) {
  return handle(request);
}
