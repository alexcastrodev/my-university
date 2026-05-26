import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { readFile } from 'fs/promises';
import { join } from 'path';

interface LessonContent {
  content: string;
  version: string | null;
  updatedAt: string | null;
}

function parseFrontmatter(raw: string): LessonContent {
  const match = raw.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n([\s\S]*)$/);
  if (!match) return { content: raw, version: null, updatedAt: null };

  const fm = match[1];
  const content = match[2];
  const version = fm.match(/^version:\s*(.+)$/m)?.[1]?.trim() ?? null;
  const updatedAt = fm.match(/^updatedAt:\s*(.+)$/m)?.[1]?.trim() ?? null;
  return { content, version, updatedAt };
}

@Controller('content')
export class ContentController {
  @Get(':courseSlug/:filename')
  async serveMarkdown(
    @Param('courseSlug') courseSlug: string,
    @Param('filename') filename: string,
  ): Promise<LessonContent> {
    const safeCourse = courseSlug.replace(/\.\./g, '');
    const safeFile = filename.replace(/\.\./g, '');
    const filePath = join(__dirname, '../seed/data', safeCourse, 'content', safeFile);
    try {
      const raw = await readFile(filePath, 'utf-8');
      return parseFrontmatter(raw);
    } catch {
      throw new NotFoundException();
    }
  }
}
