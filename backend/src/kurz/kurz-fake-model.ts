import {
  KurzModel,
  KurzModelRequest,
  KurzModelResult,
  KurzUpstreamError,
} from './kurz-model';

const USAGE = { input: 4000, cached: 0, output: 300, thought: 0 };
const RAW = {
  total_input_tokens: 4000,
  total_cached_tokens: 0,
  total_output_tokens: 300,
  total_thought_tokens: 0,
};

const completed = (value: unknown): KurzModelResult => ({
  status: 'completed',
  text: typeof value === 'string' ? value : JSON.stringify(value),
  usage: USAGE,
  raw: RAW,
});

/**
 * A stand-in for the model, for the specs and the end-to-end suite (`KURZ_FAKE_MODEL=1`, refused in production).
 * What it does follows a word in the question, so a test chooses the case with its own text. By default it
 * answers well: one claim that quotes the longest block of the post.
 */
export class FakeKurzModel extends KurzModel {
  available(): boolean {
    return true;
  }

  ask(request: KurzModelRequest): Promise<KurzModelResult> {
    const q = request.question;
    const post = request.sources[0];
    const block = [...post.blocks].sort(
      (a, b) => b.text.length - a.text.length,
    )[0];
    const quote = block ? block.text.slice(0, 80) : '';
    const claim = (
      text: string,
      cite: object = { source: 'S1', p: block?.p ?? 1, quote },
    ) => ({
      kind: 'claim',
      text,
      cites: [cite],
    });
    const has = (word: string) => new RegExp(`\\b${word}\\b`).test(q);

    if (has('SAFETY'))
      return Promise.resolve({ status: 'blocked', code: 'safety' });
    if (has('BOOM')) return Promise.reject(new KurzUpstreamError(500));
    if (has('SLOWPOKE'))
      return Promise.reject(new KurzUpstreamError(null, true));
    if (has('CUTOFF'))
      return Promise.resolve({
        status: 'incomplete',
        text: '{"answerable": tr',
        usage: USAGE,
        raw: RAW,
      });
    if (has('GARBAGE')) return Promise.resolve(completed('this is not json'));
    if (has('OFFTOPIC'))
      return Promise.resolve(
        completed({
          answerable: false,
          blocks: [],
          see: request.sources.slice(1, 2).map((s) => s.id),
          followUps: [],
        }),
      );
    if (has('FORGED'))
      return Promise.resolve(
        completed({
          answerable: true,
          blocks: [
            claim('The post says something it does not say.', {
              source: 'S1',
              p: block?.p ?? 1,
              quote: 'a sentence that the post never wrote at all',
            }),
          ],
          see: [],
          followUps: [],
        }),
      );
    if (has('LINKS'))
      return Promise.resolve(
        completed({
          answerable: true,
          blocks: [
            claim(
              'Read [this](https://evil.example/x) and ![pic](https://evil.example/p.png) or https://evil.example/y now.',
            ),
          ],
          see: [],
          followUps: ['See https://evil.example/z'],
        }),
      );
    return Promise.resolve(
      completed({
        answerable: true,
        blocks: [
          claim('The post explains this in the passage below.'),
          {
            kind: 'question',
            text: 'Can you say it in your own words?',
            cites: [],
          },
        ],
        see: request.sources.slice(1, 2).map((s) => s.id),
        followUps: ['Exemplo com números', 'Testa-me'],
      }),
    );
  }
}
