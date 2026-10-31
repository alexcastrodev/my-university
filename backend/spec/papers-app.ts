import {
  Body,
  Controller,
  Delete,
  Get,
  HttpCode,
  Inject,
  Module,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  ValidationPipe,
} from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import {
  FastifyAdapter,
  NestFastifyApplication,
} from '@nestjs/platform-fastify';
import { TypeOrmModule } from '@nestjs/typeorm';
import type { FastifyReply } from 'fastify';
import { DataSource } from 'typeorm';
import { PaperInputDto } from '../src/papers/paper.dto';
import { Paper } from '../src/papers/paper.entity';
import { PaperAuthor } from '../src/papers/paper-author.entity';
import { PaperKeyword } from '../src/papers/paper-keyword.entity';
import { PaperSource } from '../src/papers/paper-source.entity';
import { PapersService } from '../src/papers/papers.service';

// A throwaway Nest server that exposes PapersService over HTTP, against the real Postgres (the
// tables come from the migration the API runs on boot). It lives in spec/ because no production
// endpoint exposes papers yet: the catalog (#179) and the import (#181) will bring them.

// esbuild (vitest) does not emit decorator metadata, so the DTO type is given to the pipe by hand.
const body = new ValidationPipe({
  transform: true,
  expectedType: PaperInputDto,
});

@Controller('papers')
class PapersHarnessController {
  constructor(
    @Inject(PapersService) private readonly papers: PapersService,
    @Inject(DataSource) private readonly dataSource: DataSource,
  ) {}

  @Post()
  async upsert(
    @Body(body) dto: PaperInputDto,
    @Res({ passthrough: true }) reply: FastifyReply,
    @Query('source') source = 'manual',
    @Query('externalId') externalId?: string,
  ) {
    const result = await this.papers.upsert(dto, { source, externalId });
    reply.status(result.created ? 201 : 200);
    return result;
  }

  @Put(':id')
  correct(
    @Param('id', ParseIntPipe) id: number,
    @Body(body) dto: PaperInputDto,
    @Query('source') source = 'manual',
  ) {
    return this.papers.correct(id, dto, { source });
  }

  @Get(':id')
  get(@Param('id', ParseIntPipe) id: number) {
    return this.papers.get(id);
  }

  /** Test cleanup only: the authors, keywords and sources go with it (ON DELETE CASCADE). */
  @Delete(':id')
  @HttpCode(204)
  async remove(@Param('id', ParseIntPipe) id: number) {
    await this.dataSource.getRepository(Paper).delete(id);
  }
}

export interface PapersApp {
  url: string;
  close: () => Promise<void>;
}

/** Boots the server on a free port against DATABASE_URL. */
export async function startPapersApp(): Promise<PapersApp> {
  @Module({
    imports: [
      TypeOrmModule.forRoot({
        type: 'postgres',
        url:
          process.env.DATABASE_URL ??
          'postgres://postgres@127.0.0.1:5432/ocp_java',
        entities: [Paper, PaperAuthor, PaperKeyword, PaperSource],
        synchronize: false,
      }),
    ],
    controllers: [PapersHarnessController],
    providers: [
      {
        provide: PapersService,
        useFactory: (dataSource: DataSource) => new PapersService(dataSource),
        inject: [DataSource],
      },
    ],
  })
  class PapersHarnessModule {}

  const app = await NestFactory.create<NestFastifyApplication>(
    PapersHarnessModule,
    new FastifyAdapter(),
    { logger: false },
  );
  app.setGlobalPrefix('api');
  await app.listen(0, '127.0.0.1');
  return { url: `${await app.getUrl()}/api`, close: () => app.close() };
}
