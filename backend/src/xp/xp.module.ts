import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserXpEntry } from './user-xp.entity';
import { XpController } from './xp.controller';
import { XpService } from './xp.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserXpEntry])],
  controllers: [XpController],
  providers: [XpService],
  exports: [XpService],
})
export class XpModule {}
