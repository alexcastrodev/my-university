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
  @Get('*')
  async serveMarkdown(@Param('0') filePath: string): Promise<LessonContent> {
    const safePath = filePath.replace(/\.\./g, '');
    const absPath = join(__dirname, '../seed/data', safePath);
    try {
      const raw = await readFile(absPath, 'utf-8');
      return parseFrontmatter(raw);
    } catch {
      throw new NotFoundException();
    }
  }
}
