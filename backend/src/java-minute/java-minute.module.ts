import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { JavaMinuteController } from './java-minute.controller';
import { JavaMinuteService } from './java-minute.service';

@Module({
  imports: [XpModule],
  controllers: [JavaMinuteController],
  providers: [JavaMinuteService],
  exports: [JavaMinuteService],
})
export class JavaMinuteModule {}
