import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { BooksService } from '../books/books.service';
import { UserXpEntry } from './user-xp.entity';
import { ProfileController, XpController } from './xp.controller';
import { XpService } from './xp.service';

@Module({
  imports: [TypeOrmModule.forFeature([UserXpEntry])],
  controllers: [XpController, ProfileController],
  providers: [XpService, BooksService],
  exports: [XpService],
})
export class XpModule {}
