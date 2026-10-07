import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { CSharpMinuteController } from './csharp-minute.controller';
import { CSharpMinuteService } from './csharp-minute.service';

@Module({
  imports: [XpModule],
  controllers: [CSharpMinuteController],
  providers: [CSharpMinuteService],
  exports: [CSharpMinuteService],
})
export class CSharpMinuteModule {}
