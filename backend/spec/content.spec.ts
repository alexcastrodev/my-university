import { describe, it, expect, beforeEach } from 'vitest';
import { NotFoundException } from '@nestjs/common';
import { ContentController } from '../src/course/content.controller';

// These are UNIT tests against the controller class directly. We do NOT go
// through HTTP on purpose: in the deployed stack nginx serves /api/content/
// straight from disk and shadows this Nest controller (see nginx.conf), so an
// HTTP test would exercise nginx, not this code. Instead we instantiate the
// controller and pass a fake Fastify `reply`.

// Minimal stand-in for the Fastify reply used by serveMarkdown(). `type()`
// returns `this` so the `.type(...).send(...)` chain works, and `send()`
// records what was served so the test can assert on it.
function makeReply() {
  const reply: { body: unknown; contentType: string | null; type: (c: string) => typeof reply; send: (c: unknown) => void } = {
    body: undefined,
    contentType: null,
    type(c: string) {
      this.contentType = c;
      return this;
    },
    send(c: unknown) {
      this.body = c;
    },
  };
  return reply;
}

describe('ContentController.serveMarkdown (unit)', () => {
  let controller: ContentController;

  beforeEach(() => {
    controller = new ContentController();
  });

  describe('rejects path-traversal / invalid input', () => {
    it('rejects encoded traversal in courseSlug + filename', async () => {
      await expect(
        controller.serveMarkdown('..', '..%2f..%2fetc%2fpasswd', makeReply()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects relative traversal in filename', async () => {
      await expect(
        controller.serveMarkdown('java-21', '../../etc/passwd', makeReply()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects collapsing-dot traversal in courseSlug', async () => {
      await expect(
        controller.serveMarkdown('....//....//etc', 'passwd', makeReply()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a non-.md filename', async () => {
      await expect(
        controller.serveMarkdown('java-21', 'passwd', makeReply()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });

    it('rejects a filename containing a path separator', async () => {
      await expect(
        controller.serveMarkdown('java-21', 'content/secret.md', makeReply()),
      ).rejects.toBeInstanceOf(NotFoundException);
    });
  });

  describe('serves a valid existing file', () => {
    // The controller resolves files relative to its own __dirname:
    //   join(__dirname, '../seed/data', course, 'content', file)
    // Under vitest, __dirname is backend/src/course, so this points at the
    // real seed file backend/src/seed/data/java-21/content/<file>.md.
    it('returns markdown for a real seed file as text/plain', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '1-1-learning-about-the-environment.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(typeof reply.body).toBe('string');
      expect((reply.body as string).length).toBeGreaterThan(0);
    });
  });
});
