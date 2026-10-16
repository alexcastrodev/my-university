import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { UserXpEntry } from './user-xp.entity';
import { ProfileController, XpController } from './xp.controller';
import { XpService } from './xp.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserXpEntry])],
  controllers: [XpController, ProfileController],
  providers: [XpService],
  exports: [XpService],
})
export class XpModule {}
