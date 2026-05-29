import { Controller, Get, NotFoundException, Param, Res } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { basename, join } from 'path';

// Allowlists: reject anything that isn't a single, safe path segment.
// A course slug may only contain letters, digits, hyphen and underscore.
// A filename must additionally allow dots but must end in `.md`.
const COURSE_SLUG_RE = /^[a-zA-Z0-9_-]+$/;
const FILENAME_RE = /^[a-zA-Z0-9_.-]+\.md$/;

@Controller('content')
export class ContentController {
  @Get(':courseSlug/:filename')
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  async serveMarkdown(
    @Param('courseSlug') courseSlug: string,
    @Param('filename') filename: string,
    @Res() reply: any,
  ) {
    // Collapse to a single path segment first (defends against separators /
    // traversal sequences), then enforce strict allowlists. basename() of an
    // already-clean segment is a no-op, so a valid request is unaffected.
    const safeCourse = basename(courseSlug);
    const safeFile = basename(filename);
    if (
      safeCourse !== courseSlug ||
      safeFile !== filename ||
      !COURSE_SLUG_RE.test(safeCourse) ||
      !FILENAME_RE.test(safeFile)
    ) {
      // Throw the same 404 as a missing file so we don't leak which inputs
      // are merely invalid versus genuinely absent.
      throw new NotFoundException();
    }
    const filePath = join(__dirname, '../seed/data', safeCourse, 'content', safeFile);
    try {
      const content = await readFile(filePath, 'utf-8');
      reply.type('text/plain; charset=utf-8').send(content);
    } catch {
      throw new NotFoundException();
    }
  }
}
