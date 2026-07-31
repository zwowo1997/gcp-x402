// GET /guide — the rich HTML user guide, served from the deployment.
// Reads public/guide.html (copied into the container image).

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { renderSkillForOrigin } from "@/lib/skill";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const html = await readFile(join(process.cwd(), "public", "guide.html"), "utf8");
    const rendered = renderSkillForOrigin(html, new URL(request.url).origin);
    return new NextResponse(rendered, {
      status: 200,
      headers: {
        "content-type": "text/html; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "guide not bundled in this deployment" }, { status: 404 });
  }
}
