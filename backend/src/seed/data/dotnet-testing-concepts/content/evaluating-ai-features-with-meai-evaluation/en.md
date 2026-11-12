---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

A unit test says "for this input, this output". An AI feature does not give the same output twice, and "correct" is
a judgement: is the answer relevant, does it stick to the policy it was given, does it read well? Checking that with
`Assert.AreEqual` on the text is wrong in both directions: it fails on a harmless rewording and passes on a fluent
lie. `Microsoft.Extensions.AI.Evaluation` is the Microsoft library that turns those judgements into test code: an
`IEvaluator` scores an answer, a language model can be the judge, responses are cached so a test run is repeatable,
and the results become a report. The goal: evaluate an answer with relevance, coherence and groundedness evaluators
using a local Ollama as the judge, add a deterministic evaluator that needs no model, record the responses once and
replay them offline in a plain MSTest 4 run, produce the report, write assertions with thresholds that survive
non-determinism, and know what the judging costs.
Versions measured: `Microsoft.Extensions.AI.Evaluation`, `.Quality` and `.Reporting` 11.0.0 (the stable line, published
2026-11-10), `Microsoft.Extensions.AI.Abstractions` 11.0.0, `OllamaSharp` 5.5.0, `MSTest` 4.5.3, Ollama with
`qwen3:4b-instruct` as the assistant and as the judge, on the .NET 10.0.100 SDK and the `net10.0` target.

## Use Cases

- A feature that calls a model (a support assistant, a summary, a classifier) and needs a gate in the pull request
  that is more than "it returned something".
- Changing the prompt, the model or the retrieval of a RAG feature and wanting to know if answers got better or worse
  before it ships.
- A test suite that must run offline and the same way on every machine, even though the thing under test is a model.
- Reviewing quality over time: the same scenarios, one report per run.

## Deep Dive

### One answer, three scores

The lab has a `ReturnsAssistant` that answers questions about a returns policy through an `IChatClient`, with the
policy in the system prompt and the rule "if the policy does not say, answer exactly `I don't know, please contact
support.`". To evaluate it, a `ReportingConfiguration` ties together the evaluators, the model that judges and where
results and cache live, and a `ScenarioRun` is one question evaluated:

```csharp
IChatClient ollama = new OllamaApiClient(new Uri("http://localhost:11434"), "qwen3:4b-instruct");

var configuration = new ReportingConfiguration(
    [new RelevanceEvaluator(), new CoherenceEvaluator(), new GroundednessEvaluator()],
    new DiskBasedResultStore("eval-results"),
    new ChatConfiguration(ollama),                    // the judge
    new DiskBasedResponseCacheProvider("eval-cache", TimeSpan.FromDays(3650)),
    executionName: "lab");

await using var run = await configuration.CreateScenarioRunAsync("refund-window");
var assistant = new ReturnsAssistant(run.ChatConfiguration!.ChatClient);   // goes through the cache
var response = await assistant.AskAsync("How long do I have to return a jacket?");

var result = await run.EvaluateAsync(
    new ChatMessage(ChatRole.User, "How long do I have to return a jacket?"), response,
    [new GroundednessEvaluatorContext(ReturnsAssistant.Policy)]);   // the ground truth for groundedness
```

`EvaluateAsync` is an extension in `Microsoft.Extensions.AI.Evaluation.Reporting`. The answer was "You have 30 days from
delivery to return an unused jacket for a full refund." and the result holds one metric per evaluator:

```text
Relevance     4  Good         "The response directly and accurately answers the query with a clear time frame ..."
Groundedness  5  Exceptional  "The response correctly and fully answers the query using only information from the context ..."
Coherence     4  Good         "... a clear, logical, and complete statement, making the message easy to understand ..."
```

Each is a `NumericMetric` on a 1 to 5 scale, read with `result.Get<NumericMetric>(RelevanceEvaluator.RelevanceMetricName)`,
with a `Reason` written by the judge and an `Interpretation` (rating and a `Failed` flag). The metric also carries
`Diagnostics`: the judge's step-by-step reasoning arrives as `Informational` diagnostics, and a problem the evaluator
cannot recover from (a verdict it cannot parse, for example) is meant to arrive as an `Error` one. I did not see an
`Error` in the recorded runs, but the lab asserts there is none, because a test that only reads `Value` can read a
null and pass.

`Quality` has more than these three: Fluency, Completeness, Equivalence, Retrieval, IntentResolution, TaskAdherence,
ToolCallAccuracy and RelevanceTruthAndCompleteness are in the 11.0.0 package. I ran only the first three. The ones
that compare against a reference or the retrieved chunks take an `EvaluationContext` like the groundedness one.

### The judge is a model, and it can be wrong

The same Ollama model judged eight answers. The recorded run:

| Scenario | Relevance | Groundedness | Coherence |
| --- | --- | --- | --- |
| refund-window | 4 | 5 | 4 |
| refund-time | 4 | 5 | 4 |
| shipping-defective | 2 | 3 | 3 |
| shipping-regular | 4 | 5 | 5 |
| sale-items | 4 | 5 | 4 |
| pitched-tent | 4 | 5 | 4 |
| gift-card | 4 | 5 | 3 |
| unknown (a correct refusal) | 1 | 1 | 3 |

Two rows teach more than the rest. `shipping-defective` is a real model answer: "The customer pays for return shipping
if the item arrived broken. Wait, correction: Returns policy states that return shipping is free for defective items.
Therefore, Brightside Outdoor pays ...". The fact is in there, a keyword check is green, and the judge scored it 2 for
relevance. And `unknown` is the *right* answer, and the judge scored it 1 and 1: a refusal says nothing about the
question and nothing from the context, which is what those two metrics penalise. Quality scores must not gate a
refusal.

The judge also lets things through. For a hand-written "You have 60 days to return a jacket, and return shipping is
always free." the 4B judge said groundedness 3 and relevance 4: it noticed, less loudly than a person. For "Our tents
are made of ripstop nylon and weigh 2 kg." it said 1 and 1. A judge is only as good as the model behind it, and a
small local one is a cheap first filter, not an oracle.

### Evaluators that need no model

Everything in the `Quality` package uses the model. The deterministic ones are somewhere else:

- `Microsoft.Extensions.AI.Evaluation.NLP` has `BLEUEvaluator`, `GLEUEvaluator` and `F1Evaluator`: text similarity
  to one or more reference answers, by n-grams, with no model and no cost. The package is still preview
  (`11.0.0-preview.1.26560.3` at the time of writing), so pin it and expect changes. Measured against the reference
  "You can return an unused item within 30 days of delivery for a full refund.":

```text
same:       BLEU=1.000  GLEU=1.000  F1=1.000
paraphrase: BLEU=0.352  GLEU=0.431  F1=0.750   "You have 30 days from delivery to return an unused jacket ..."
one-word:   BLEU=0.815  GLEU=0.828  F1=0.938   the reference with "30" changed to "60"
wrong:      BLEU=0.023  GLEU=0.086  F1=0.312   "You have 60 days to return a jacket, and return shipping is always free."
off-topic:  BLEU=0.017  GLEU=0.034  F1=0.143
```

  The correct paraphrase scores 0.35 BLEU, and the reference with one number changed (a wrong answer) scores 0.82,
  rated `Exceptional`. Overlap with a reference measures words, not truth, so use it where you have a stable
  reference (translation, extraction) and not for open answers, and never alone.
- Your own `IEvaluator`: one method and a list of metric names. The lab's evaluator checks that the answer contains a
  fact, written as a regular expression, and reports a `BooleanMetric`:

```csharp
public sealed class ExpectedFactEvaluator : IEvaluator
{
    public IReadOnlyCollection<string> EvaluationMetricNames => ["Expected fact"];

    public ValueTask<EvaluationResult> EvaluateAsync(IEnumerable<ChatMessage> messages, ChatResponse modelResponse,
        ChatConfiguration? chatConfiguration = null, IEnumerable<EvaluationContext>? additionalContext = null,
        CancellationToken cancellationToken = default)
    {
        var expected = additionalContext!.OfType<ExpectedFactContext>().First();
        var found = Regex.IsMatch(modelResponse.Text, expected.Pattern, RegexOptions.IgnoreCase);
        var metric = new BooleanMetric("Expected fact", found);
        metric.Interpretation = new EvaluationMetricInterpretation(
            found ? EvaluationRating.Good : EvaluationRating.Unacceptable, failed: !found);
        return ValueTask.FromResult(new EvaluationResult(metric));
    }
}
```

  It appears in the same result and in the same report as the judged metrics. It made no model call in the run
  (the 8 scenarios made 4 turns each: the answer and three judge calls). It also has a blind spot, the
  self-contradicting answer above, which is why the two kinds are used together: the fact check is cheap and strict
  about what it knows, the judge is wide and soft.

### The cache makes the run repeatable

`DiskBasedResponseCacheProvider` stores each model request and response on disk, under `eval-cache/<scenario>/<iteration>/<hash>/`.
The `ChatClient` of a `ScenarioRun` is a caching client in front of the model: the assistant's call and every
judge call go through it. Run once with Ollama and the cache holds 32 entries (8 scenarios, 4 calls each). Run again
with a client that cannot call anything and every request is a hit:

```csharp
public sealed class ReplayOnlyChatClient : IChatClient   // GetResponseAsync throws "Cache miss ..."
{
    public object? GetService(Type serviceType, object? serviceKey = null) =>
        serviceType == typeof(ChatClientMetadata)
            ? new ChatClientMetadata("ollama", new Uri("http://localhost:11434"), "qwen3:4b-instruct") : null;
    // ...
}
```

The suite of 24 tests then ran in 179 ms with Ollama stopped, and the stored result of each scenario shows
`CacheHit: true` on all four turns. Four things about the key I checked, because each one is a way for a green
build to turn red for no reason:

- The key is a hash of the whole request. Changing one word of the system prompt (`three sentences` to `two`) made
  every request a miss; restoring it made them hits again.
- The model id that the client reports through `ChatClientMetadata` is part of the key. The replay client above must
  report the same one as the recorded client, or nothing hits.
- Entries expire. Without a time to live, `entry.json` showed an `expiration` 14 days after the `creation`; a cache
  committed to the repository and read a month later is empty. The lab passes `TimeSpan.FromDays(3650)`.
- The text of the request is the key, so line endings should count (I did not test a CRLF checkout). A raw string
  literal takes the line endings of the source file, so the lab normalises the policy text with `ReplaceLineEndings("\n")`.

The tokens of the recording are kept in the cache, so a replayed result still reports what the call cost, with
`Latency` zero. The rule that follows: the cache is a fixture. Commit it, treat re-recording as a deliberate act
(delete the folder, run with Ollama, review the diff of scores), and let the pull-request build only replay.

### The report

The `ReportingConfiguration` writes every run to the result store as a JSON file. Two ways to read them as a report:

```csharp
var results = new List<ScenarioRunResult>();
await foreach (var r in configuration.ResultStore.ReadResultsAsync(executionName: "report")) results.Add(r);
await new HtmlReportWriter("report.html").WriteReportAsync(results);
```

```bash
dotnet tool install Microsoft.Extensions.AI.Evaluation.Console --version 11.0.0
dotnet aieval report -p eval-results -o report.html          # -f json for JSON; -n limits the executions
```

Both worked. The report for the eight scenarios is one self-contained HTML file of about 1 MB; it has the answers,
each metric with its reason and the judge's diagnostics (I found the reasoning text inside it). The tool also has `clean-results` and `clean-cache` (deletes expired entries). `aieval` sends anonymous usage
data unless `DOTNET_AIEVAL_TELEMETRY_OPTOUT=1`. The same package family has `Microsoft.Extensions.AI.Evaluation.Reporting.Azure`
to keep cache and results in an Azure Storage container; not used here.

### Thresholds, because the same answer is not the same score

Three sources of variation, each measured:

- **The judge on an identical request.** Five calls for each of four answers (good, wrong, off-topic, refusal), both
  groundedness and relevance: the same score 5 of 5 times. With a temperature of 0 the judge is repeatable for the
  same request, so for the judge the cache is about cost and working offline more than about stability.
- **The assistant.** The broken-item question at temperature 0.8: 2 different answers in 6 runs, judged relevance 3 or
  4. The jacket question: 1 distinct answer in 6, relevance 4 each time. The lab pins `Temperature = 0` and a seed, and
  records anyway: a pinned seed is a promise of the provider, not of the next model version.
- **The model or the prompt.** The real source. Swap either, and the scores move.

So a gate says "at least", never "equals", and it is written for the set, not for each score. The library already
has one opinion: in the recorded run the interpretation marked 4 and 5 as passing and 3 ("average") as `Failed`. The
lab's gate on eight scenarios is: for each answerable scenario, no `Error` diagnostic and a non-null score; for every
fact check, true; on the set, average relevance at least 3.5, average groundedness at least 4.0, and at most one
answer with relevance below 3. With the recorded numbers (relevance 4, 4, 2, 4, 4, 4, 4: average 3.71) that is green.
"Every score at least 4" is red because of `shipping-defective`, and a gate that is red for a known reason is a gate
the team learns to ignore. A refusal is checked as text: `Assert.AreEqual(ReturnsAssistant.Unknown, answer)`.

Then the test of the test. A gate that no answer can fail is worth nothing, so the lab feeds the evaluators two
hand-written bad answers and asserts the scores fall: the wrong number fails the fact check and gets groundedness
below 4; the off-topic one gets relevance at most 2. Those assertions are the ones to revisit when the judge model
changes.

### What it costs

For the eight scenarios the stored results add up to 29,489 input tokens and 6,977 output tokens in 32 model turns,
about 3.7k in and 0.9k out per scenario, for answers of 20 to 50 words. The judge reads the policy and the answer
and reasons aloud, three times; the answer is 1 of the 4 calls. Money: zero on a local Ollama, and
recording the set took about 90 s on a laptop. Against a hosted model, multiply those token counts by the price of
that model (not measured here) and by the number of scenarios and runs. The levers, in order: replay from the cache
in every pull request and record only when the prompt, the model or the scenarios change; keep the model-judged set
small and put volume into the deterministic evaluators; run the large model-judged sweep on a schedule rather than
per commit.

### What stays in the documentation

`Microsoft.Extensions.AI.Evaluation.Safety` (`ProtectedMaterialEvaluator`, `ContentHarmEvaluator` and the rest) is
still `-preview` (`11.0.0-preview.1.26560.3`) and, per the Microsoft Learn page, uses the Microsoft Foundry
Evaluation service instead of your own model. It needs an Azure resource, so none of it was run here. The
`Quality` evaluators beyond relevance, coherence and groundedness, `Reporting.Azure`, and online evaluation
(publishing scores to telemetry) are documented but also not run. For the retrieval half of a RAG feature see the
regression set in the RAG concept of the `dotnet-ai-concepts` track (hit rates and answer facts by hand); the
evaluators here are the judged half of the same idea.

## Trade-offs

- **A small local judge is cheap and soft.** It gave 3 and 4 to an answer with the wrong number, and 1 to a correct
  refusal. It is a first filter. For a gate you trust, pair it with deterministic checks and, for what matters, a
  stronger judge and a human look at the report.
- **Thresholds hide small regressions.** An average of 3.7 absorbs one bad answer, by design. Keep the count of weak
  answers and the deterministic checks strict, and read the report when a score moves.
- **The cache freezes the problem you recorded.** A green replay proves the tests and thresholds are consistent with
  the recording, not that today's model behaves. Re-record on purpose, and schedule a live run.
- **The cache key is brittle on purpose.** A word of prompt, the model id, a library update that changes the
  evaluators' own prompts, and the line endings all miss. Pin the package versions and expect a re-record when you
  bump them.
- **LLM-as-judge is biased.** It rewards fluent text, penalises refusals, and its scale (1 to 5) is coarse: the 4 to 5
  step is a judgement call. Do not compare scores across judge models.
- **Safety evaluators are outside the free path.** They need Azure, and they are preview.

## Lab

`ReturnsAssistant` and a cache recorded with a local Ollama are already in the repository. Your job is to write the tests that gate the feature: thresholds, the deterministic check beside the judge, known-bad answers, and the cache and report checks. The tests pass without Ollama; the README shows how to record again.

**What you will practice**

- Reading `NumericMetric`, `BooleanMetric`, interpretations and diagnostics from an `EvaluationResult`.
- Writing assertions with thresholds, a gate on the whole set, and a deterministic check for a refusal.
- Proving the gate can fail with hand-written bad answers.
- Checking that a replay never calls the model, that every turn is a cache hit, and that tokens and report are produced.

**Prerequisites:** MSTest 4 Fundamentals: Lifecycle and TestContext, Microsoft.Extensions.AI: IChatClient and the Middleware Pipeline, .NET 10 SDK.

**How it works:** the production code and the support classes (`EvalSupport`, `ReplayOnlyChatClient`, `ExpectedFactEvaluator`, `EvalRunner`) are ready. Twelve test methods (24 tests) fail with `TODO-NN` until you write them, and the solution passes 24 of 24 in about 180 ms with no model.

## Documentation Links

- [The Microsoft.Extensions.AI.Evaluation libraries, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/libraries) (doc)
- [Evaluate a model's response, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/evaluate-ai-response) (doc)
- [Tutorial: evaluate a response with response caching and reporting, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/tutorials/evaluate-with-reporting) (doc)
- [Safety evaluations, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/ai/evaluation/evaluate-safety) (doc)
- [Microsoft.Extensions.AI.Evaluation 11.0.0 on NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Evaluation/11.0.0) (doc)
- [Microsoft.Extensions.AI.Evaluation.Console 11.0.0 on NuGet](https://www.nuget.org/packages/Microsoft.Extensions.AI.Evaluation.Console/11.0.0) (doc)
