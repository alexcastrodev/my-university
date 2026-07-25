import { Module } from '@nestjs/common';
import { JavaMinuteController } from './java-minute.controller';
import { JavaMinuteService } from './java-minute.service';

@Module({
  controllers: [JavaMinuteController],
  providers: [JavaMinuteService],
  exports: [JavaMinuteService],
})
export class JavaMinuteModule {}
