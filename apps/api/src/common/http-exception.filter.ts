import { ArgumentsHost, Catch, ExceptionFilter, HttpException, HttpStatus, Logger } from '@nestjs/common';
import { Prisma } from '@cfe/database';
import type { ApiErrorBody } from '@cfe/shared-types';
import type { Request, Response } from 'express';

/** Consistent error envelope. Unknown errors are logged server-side and never leak internals. */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger('HttpError');

  catch(exception: unknown, host: ArgumentsHost) {
    const res = host.switchToHttp().getResponse<Response>();
    const req = host.switchToHttp().getRequest<Request>();
    const body = this.toBody(exception);
    if (body.statusCode >= 500) {
      this.logger.error(`${req.method} ${req.url} → ${body.statusCode}`, exception instanceof Error ? exception.stack : String(exception));
    }
    res.status(body.statusCode).json(body);
  }

  private toBody(exception: unknown): ApiErrorBody {
    if (exception instanceof HttpException) {
      const status = exception.getStatus();
      const response = exception.getResponse();
      const r = typeof response === 'string' ? { message: response } : (response as { message?: string | string[]; details?: unknown });
      return {
        statusCode: status,
        error: HttpStatus[status] ?? 'Error',
        message: Array.isArray(r.message) ? r.message.join('; ') : (r.message ?? exception.message),
        details: r.details,
      };
    }
    if (exception instanceof Prisma.PrismaClientKnownRequestError) {
      if (exception.code === 'P2002') {
        return { statusCode: 409, error: 'CONFLICT', message: 'A record with these unique values already exists', details: exception.meta?.target };
      }
      if (exception.code === 'P2025') return { statusCode: 404, error: 'NOT_FOUND', message: 'Record not found' };
      if (exception.code === 'P2003') return { statusCode: 409, error: 'CONFLICT', message: 'Record is referenced by other records' };
    }
    return { statusCode: 500, error: 'INTERNAL_SERVER_ERROR', message: 'Internal server error' };
  }
}
