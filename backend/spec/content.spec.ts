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

    // Regression coverage for the "Practice" lesson content that used to be a
    // dead `contentPath: null` — see 13-concurrency.json / work.md.
    it('returns markdown for the java-21 concurrency practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '13-7-practice-concurrency.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Concurrency');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 multithreading practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '8-7-practice-multithreading.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Multithreading');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 streams practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '10-5-practice-streams.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Streams');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 collections and generics practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '9-4-practice-collections-and-generics.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Collections and Generics');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 lambdas and functional interfaces practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '8-6-practice-lambdas-and-functional-interfaces.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Lambdas and Functional Interfaces');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 class design practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '6-9-practice-class-design.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Class Design');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 beyond classes practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '7-7-practice-beyond-classes.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Beyond Classes');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 exceptions and localization practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '11-8-practice-exceptions-and-localization.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Exceptions and Localization');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 exception handling practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '4-4-practice-exception-handling.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Exception Handling');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 streams practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '6-7-practice-streams.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Streams');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 oop practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '3-11-practice-oop.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: OOP');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 making decisions practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '3-7-practice-making-decisions.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Making Decisions');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 core apis practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '4-7-practice-core-apis.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Core APIs');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 jdbc practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '15-7-practice-jdbc.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: JDBC');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 io practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '14-8-practice-io.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: I/O');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 collections practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '5-6-practice-collections.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Collections');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 methods practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '5-7-practice-methods.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Methods');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 operators practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '2-7-practice-operators.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Operators');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 building blocks practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '1-10-practice-building-blocks.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Building Blocks');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 modules practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '12-7-practice-modules.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Modules');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-21 java 25 new features practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-21',
        '16-8-practice-java25-new-features.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Java 25 New Features');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 flow control practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '2-6-practice-flow-control.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Flow Control');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 packaging practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '7-9-practice-packaging.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Packaging');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 values practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '1-10-practice-values.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Values');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 io practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '9-4-practice-io.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: I/O');
      expect(reply.body as string).toContain('Exercise 1');
    });

    it('returns markdown for the java-25 localization practice lesson content', async () => {
      const reply = makeReply();
      await controller.serveMarkdown(
        'java-25',
        '10-4-practice-localization.md',
        reply,
      );
      expect(reply.contentType).toBe('text/plain; charset=utf-8');
      expect(reply.body as string).toContain('Practice: Localization');
      expect(reply.body as string).toContain('Exercise 1');
    });
  });
});
