import {
  Controller,
  Get,
  Header,
  HttpCode,
  Param,
  ParseIntPipe,
  Post,
} from '@nestjs/common';
import { CurrentUserId } from '../auth/session';
import { NotificationService } from './notification.service';

/** Under /api/discussions for the same reason as the rest: per-viewer, never cached. */
@Controller('discussions/notifications')
export class NotificationController {
  constructor(private service: NotificationService) {}

  @Get()
  @Header('Cache-Control', 'no-store')
  list(@CurrentUserId() userId: number) {
    return this.service.list(userId);
  }

  @Get('unread')
  @Header('Cache-Control', 'no-store')
  async unread(@CurrentUserId() userId: number) {
    return { unread: await this.service.unreadCount(userId) };
  }

  @Post('read')
  @HttpCode(204)
  readAll(@CurrentUserId() userId: number) {
    return this.service.markRead(userId);
  }

  @Post(':id/read')
  @HttpCode(204)
  readOne(
    @CurrentUserId() userId: number,
    @Param('id', ParseIntPipe) id: number,
  ) {
    return this.service.markRead(userId, id);
  }
}
