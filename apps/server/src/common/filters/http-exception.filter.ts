import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Response } from 'express';

interface ErrorBody {
  bizCode?: string;
  message?: string;
}

/** 全局异常过滤器：业务错误码 PMS-XXXX → HTTP 语义映射，统一响应体输出 */
@Catch()
export class HttpExceptionFilter implements ExceptionFilter {
  private readonly logger = new Logger(HttpExceptionFilter.name);

  catch(exception: unknown, host: ArgumentsHost) {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code: string | number = 'PMS-9000';
    let message = '系统内部错误';

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const body = exception.getResponse() as string | ErrorBody;
      if (typeof body === 'string') {
        message = body;
      } else if (body && typeof body === 'object') {
        code = (body as ErrorBody).bizCode ?? status;
        message = (body as ErrorBody).message ?? exception.message;
        if (Array.isArray((body as { message?: unknown }).message)) {
          code = 'PMS-1001';
          message = ((body as unknown as { message: string[] }).message).join('; ');
        }
      }
      if (code === 'PMS-9000' && status === HttpStatus.INTERNAL_SERVER_ERROR) {
        // 未知 500 保留 PMS-9000
      } else if (typeof code === 'number') {
        message = exception.message;
      }
    }

    if (status >= 500) {
      this.logger.error(exception instanceof Error ? exception.stack : String(exception));
    }

    response.status(status).json({ code, message, data: null });
  }
}