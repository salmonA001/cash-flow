import { NextResponse, type NextRequest } from 'next/server';

/**
 * Sends visitors without an access cookie to /login, which silently refreshes the session if
 * the (path-scoped) refresh cookie is still valid. The API remains the authority on access.
 */
export function middleware(req: NextRequest) {
  if (!req.cookies.has('cfe_at')) {
    const url = req.nextUrl.clone();
    url.pathname = '/login';
    url.search = `?next=${encodeURIComponent(req.nextUrl.pathname)}`;
    return NextResponse.redirect(url);
  }
  return NextResponse.next();
}

export const config = {
  matcher: ['/((?!login|api|health|_next|favicon.ico).*)'],
};
