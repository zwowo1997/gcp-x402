import { NextRequest, NextResponse } from "next/server";

export function middleware(request: NextRequest) {
  if (process.env.V3_PREVIEW_ONLY !== "true") return NextResponse.next();
  const path = request.nextUrl.pathname;
  if (path.startsWith("/api/v3/") || path === "/api/beta/unlock") return NextResponse.next();
  return NextResponse.json({ error: "This isolated v3 preview disables legacy paid and provisioning APIs." }, { status: 503 });
}

export const config = { matcher: ["/api/:path*"] };
