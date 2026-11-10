import { NextResponse, type NextRequest } from "next/server";

// Basic auth in front of the dashboard. API routes check their own bearer tokens.
export function middleware(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  const [scheme, encoded] = (req.headers.get("authorization") ?? "").split(" ");
  if (expected && scheme === "Basic" && encoded) {
    const [, password] = atob(encoded).split(":");
    if (password === expected) return NextResponse.next();
  }
  return new NextResponse("Auth required", { status: 401, headers: { "WWW-Authenticate": 'Basic realm="stockline"' } });
}

export const config = { matcher: ["/((?!api/|_next/|favicon.ico).*)"] };
