import { Body, Controller, Get, Param } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { ErrorCodes } from '@pms/shared';
import { BusinessException } from '../../common/exceptions/business.exception';

/**
 * 二期框架占位接口（任务 10.1）：
 * 工单/HR/增值服务返回统一"二期开发范围"占位响应（PMS-9100 / HTTP 501），
 * Swagger 标注 Experimental；不影响一期任何功能。
 */
function phase2Placeholder(endpoint: string): never {
  throw new BusinessException(ErrorCodes.NOT_IMPLEMENTED_PHASE2, `接口 ${endpoint} 属于二期开发范围`, 501);
}

@ApiTags('work-orders (Phase 2, Experimental)')
@Controller('work-orders')
export class WorkOrderController {
  @Get()
  list(): never {
    phase2Placeholder('GET /work-orders');
  }
}

@ApiTags('hr (Phase 2, Experimental)')
@Controller('hr')
export class HrController {
  @Get('employees')
  employees(): never {
    phase2Placeholder('GET /hr/employees');
  }

  @Get('attendance')
  attendance(): never {
    phase2Placeholder('GET /hr/attendance');
  }

  @Get('expense-requests')
  expenseRequests(): never {
    phase2Placeholder('GET /hr/expense-requests');
  }
}

@ApiTags('value-added-services (Phase 2, Experimental)')
@Controller('value-added-services')
export class ValueAddedServiceController {
  @Get()
  list(): never {
    phase2Placeholder('GET /value-added-services');
  }

  @Get('orders')
  orders(@Param('id') _id?: string, @Body() _body?: unknown): never {
    phase2Placeholder('GET /value-added-services/orders');
  }
}