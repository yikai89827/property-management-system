import { HttpException, HttpStatus } from '@nestjs/common';
import { ErrorCode, ErrorMessages } from '@pms/shared';

export class BusinessException extends HttpException {
  constructor(
    public readonly bizCode: ErrorCode,
    message?: string,
    status: HttpStatus = HttpStatus.BAD_REQUEST,
  ) {
    super(
      { bizCode, message: message ?? ErrorMessages[bizCode] },
      status,
    );
  }

  /** HTTP 语义映射：1002→401、1003→403、6001→401、9100→501，其余 400/500 */
  static statusFor(bizCode: ErrorCode): HttpStatus {
    switch (bizCode) {
      case 'PMS-1002':
      case 'PMS-6001':
        return HttpStatus.UNAUTHORIZED;
      case 'PMS-1003':
        return HttpStatus.FORBIDDEN;
      case 'PMS-9000':
        return HttpStatus.INTERNAL_SERVER_ERROR;
      case 'PMS-9100':
        return HttpStatus.NOT_IMPLEMENTED;
      default:
        return HttpStatus.BAD_REQUEST;
    }
  }
}