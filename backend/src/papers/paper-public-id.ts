import { Inject, Injectable, NotFoundException } from '@nestjs/common';
import { DataSource } from 'typeorm';
import { Paper } from './paper.entity';
import { isPaperSlug, isUuid, PaperRef } from './paper-ref';
import { PapersCatalogService } from './papers-catalog.service';

/**
 * Turns the id a route names into the paper it means. A public paper is named by its slug and a private one
 * (#203) by its UUIDv7, so the two never collide. Malformed, unknown and someone else's ids are the same 404,
 * so a caller learns nothing by trying.
 *
 * It is a service the handlers call, not a route pipe: a pipe would run after the global ValidationPipe.
 */
@Injectable()
export class PaperIds {
  constructor(
    @Inject(DataSource) private readonly dataSource: DataSource,
    @Inject(PapersCatalogService) private readonly catalog: PapersCatalogService,
  ) {}

  /** A public paper. A private one is the same 404 as an id that does not exist. */
  resolve(id: string): PaperRef {
    if (!isPaperSlug(id) || !this.catalog.has(id)) throw new NotFoundException();
    return { kind: 'public', slug: id };
  }

  /** What a reader may reach: a public paper, or one of their own private papers. Anyone else's is a 404. */
  async resolveFor(userId: number, id: string): Promise<PaperRef> {
    if (!isUuid(id)) return this.resolve(id);
    const paper = await this.dataSource.getRepository(Paper).findOne({
      where: { publicId: id.toLowerCase(), ownerId: userId },
      select: { id: true, publicId: true },
    });
    if (!paper) throw new NotFoundException();
    return { kind: 'private', id: paper.id, publicId: paper.publicId };
  }
}
