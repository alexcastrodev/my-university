import { Controller } from '@nestjs/common';
import { MinuteControllerBase } from '../shared/minute-controller.base';
import { XpService } from '../xp/xp.service';
import { JavaMinuteService } from './java-minute.service';

@Controller('java-minute')
export class JavaMinuteController extends MinuteControllerBase {
  constructor(service: JavaMinuteService, xp: XpService) {
    super(service, xp, '');
  }
}
