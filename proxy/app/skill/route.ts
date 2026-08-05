// GET /skill — serve the Claude skill (SKILL.md) straight from the service, so
// agents install it from the deployment URL rather than depending on GitHub.
//
// The file is synced into public/skill.md at deploy time from the canonical
// skill/bigquery-public-data/SKILL.md (see scripts/sync-skill.sh). public/ is
// copied into the container image, so this read works at runtime on Cloud Run.

import { NextResponse } from "next/server";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { publicSkillOrigin, renderSkillForOrigin, shouldServeV3Skill } from "@/lib/skill";
import { config } from "@/lib/config";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const filename = shouldServeV3Skill(config) ? "v3-skill.md" : "skill.md";
    const md = await readFile(join(process.cwd(), "public", filename), "utf8");
    // A replica should advertise itself, not the original operator deployment.
    // The canonical source remains directly usable for the official service.
    const serviceUrl = publicSkillOrigin(request.url, config.publicBaseUrl);
    const rendered = renderSkillForOrigin(md, serviceUrl);
    return new NextResponse(rendered, {
      status: 200,
      headers: {
        "content-type": "text/markdown; charset=utf-8",
        "cache-control": "public, max-age=300",
      },
    });
  } catch {
    return NextResponse.json({ error: "skill file not bundled in this deployment" }, { status: 404 });
  }
}
