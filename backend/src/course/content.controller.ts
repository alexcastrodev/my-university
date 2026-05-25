import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';

@Controller('content')
export class ContentController {
  @Get(':courseSlug/:filename')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async serveMarkdown(
    @Param('courseSlug') courseSlug: string,
    @Param('filename') filename: string,
    @Res() reply: any,
  ) {
    const safeCourse = courseSlug.replace(/\.\./g, '');
    const safeFile = filename.replace(/\.\./g, '');
    const filePath = join(__dirname, '../seed/data', safeCourse, 'content', safeFile);
    try {
      const content = await readFile(filePath, 'utf-8');
      reply.type('text/plain; charset=utf-8').send(content);
    } catch {
      throw new NotFoundException();
    }
  }
}
