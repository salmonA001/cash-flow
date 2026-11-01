import { Body, Controller, Get, HttpCode, Inject, Post, Req, Res, UnauthorizedException } from '@nestjs/common';
import { Throttle } from '@nestjs/throttler';
import { loginSchema } from '@cfe/validation';
import type { CookieOptions, Request, Response } from 'express';
import { ACCESS_COOKIE, REFRESH_COOKIE } from '../common/auth.guard';
import { AuthUser, CurrentUser, Public } from '../common/decorators';
import { ZodPipe } from '../common/zod.pipe';
import { APP_CONFIG, AppConfig } from '../config';
import { ACCESS_TTL_SECONDS, AuthService, IssuedSession, REFRESH_TTL_MS } from './auth.service';

@Controller('auth')
export class AuthController {
  constructor(private readonly auth: AuthService, @Inject(APP_CONFIG) private readonly config: AppConfig) {}

  private cookieBase(): CookieOptions {
    return { httpOnly: true, secure: this.config.COOKIE_SECURE, sameSite: 'strict' };
  }

  private setCookies(res: Response, s: IssuedSession) {
    res.cookie(ACCESS_COOKIE, s.accessToken, { ...this.cookieBase(), path: '/', maxAge: ACCESS_TTL_SECONDS * 1000 });
    res.cookie(REFRESH_COOKIE, s.refreshToken, { ...this.cookieBase(), path: '/api/v1/auth', maxAge: REFRESH_TTL_MS });
  }

  private meta(req: Request) {
    return { ip: req.ip, userAgent: req.headers['user-agent'] };
  }

  @Public()
  @Throttle({ default: { limit: 5, ttl: 60_000 } })
  @Post('login')
  @HttpCode(204)
  async login(@Body(new ZodPipe(loginSchema)) body: { email: string; password: string }, @Req() req: Request, @Res({ passthrough: true }) res: Response) {
    this.setCookies(res, await this.auth.login(body.email, body.password, this.meta(req)));
  }

  @Public()
  @Throttle({ default: { limit: 30, ttl: 60_000 } })
  @Post('refresh')
  @HttpCode(204)
  async refresh(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    const token = req.cookies?.[REFRESH_COOKIE];
    if (!token) throw new UnauthorizedException('No session');
    this.setCookies(res, await this.auth.refresh(token, this.meta(req)));
  }

  @Public()
  @Post('logout')
  @HttpCode(204)
  async logout(@Req() req: Request, @Res({ passthrough: true }) res: Response) {
    await this.auth.logout(req.cookies?.[REFRESH_COOKIE]);
    res.clearCookie(ACCESS_COOKIE, { ...this.cookieBase(), path: '/' });
    res.clearCookie(REFRESH_COOKIE, { ...this.cookieBase(), path: '/api/v1/auth' });
  }

  @Get('me')
  me(@CurrentUser() user: AuthUser) {
    return user;
  }
}
