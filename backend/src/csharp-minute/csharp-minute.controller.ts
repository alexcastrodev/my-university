import { Controller } from '@nestjs/common';
import { MinuteControllerBase } from '../shared/minute-controller.base';
import { XpService } from '../xp/xp.service';
import { CSharpMinuteService } from './csharp-minute.service';

@Controller('csharp-minute')
export class CSharpMinuteController extends MinuteControllerBase {
  constructor(service: CSharpMinuteService, xp: XpService) {
    super(service, xp, 'csharp');
  }
}
