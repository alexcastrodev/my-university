import { Module } from '@nestjs/common';
import { XpModule } from '../xp/xp.module';
import { OgImageController } from './og-image.controller';
import { OgImageService } from './og-image.service';

@Module({
  imports: [XpModule],
  controllers: [OgImageController],
  providers: [OgImageService],
})
export class OgImageModule {}
