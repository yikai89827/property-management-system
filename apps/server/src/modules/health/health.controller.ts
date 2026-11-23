import { Controller, Get } from '@nestjs/common';
import { ApiTags } from '@nestjs/swagger';
import { Public } from '../../common/guards/owner-scope.guard';

@ApiTags('health')
@Controller('health')
export class HealthController {
  @Public()
  @Get()
  health() {
    return { status: 'up', timestamp: new Date().toISOString() };
  }
}