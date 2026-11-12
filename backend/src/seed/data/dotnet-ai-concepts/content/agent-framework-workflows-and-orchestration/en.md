---
version: 1.0
updatedAt: 2026-11-12
---
## Objective

An agent answers one request. A workflow in Microsoft Agent Framework is the
layer above: a graph of executors connected by edges, run in supersteps, with
checkpoints that let a new process continue after a crash. Some executors are
plain code, some wrap an agent, and the framework ships four multi-agent shapes
(sequential, concurrent, handoff, group chat) built on that same graph. This
lesson runs all of it: deterministic executors for the graph and the
checkpoints, and `qwen3:4b-instruct` on a local Ollama for the four
orchestrations (3 runs per claim). Versions: `Microsoft.Agents.AI.Workflows`
1.28.0 and `Microsoft.Agents.AI.Workflows.Generators` 1.28.0, both stable on
NuGet (published 2026-11-06, no prerelease suffix), `Microsoft.Agents.AI`
1.28.0, `Microsoft.Extensions.AI` 10.11.0, `OllamaSharp` 5.5.0, Ollama
0.40.13, .NET 10.

## Use Cases

- A pipeline with branches (triage, billing, technical) where a model is one
  step among normal code, and the path is explicit and testable.
- A long job that must survive a crash and continue from the last finished step.
- Several specialist agents (writer then editor, optimist and skeptic in
  parallel, a router that hands a question to the right expert).
- Tests for the orchestration itself, with executors that need no model.

## Deep Dive

### Executors, edges and supersteps

An executor derives from `Executor`, is `partial`, and marks its handlers with
`[MessageHandler]`; a source generator writes the protocol. A workflow is a
`WorkflowBuilder` with a start executor, edges and the executors whose output
reaches the caller:

```csharp
var up = new Upper(); var rev = new Reverse();
var wf = new WorkflowBuilder(up).AddEdge(up, rev).WithOutputFrom(rev).Build();
await using Run run = await InProcessExecution.RunAsync(wf, "hello");
```

```text
WorkflowStartedEvent
step 0 started
invoked Upper with hello
completed Upper -> HELLO
step 0 completed
step 1 started
invoked Reverse with HELLO
OUTPUT OLLEH
completed Reverse ->
step 1 completed
```

Each superstep runs the executors that have a message waiting, and the
messages they send are delivered in the next one. Two traps showed up on the
way. Without the `Microsoft.Agents.AI.Workflows.Generators` package an
executor does not compile (`'Upper' does not implement inherited abstract
member 'Executor.ConfigureProtocol(ProtocolBuilder)'`). And yielding a type the
executor did not declare fails at run time, not at build:

```text
ExecutorFailedEvent: System.InvalidOperationException: Cannot output object of type String. Expecting one of [].
```

The fix is `[YieldsOutput(typeof(string))]` on the class (or `Yield = [...]` on
the handler); `[SendsMessage(typeof(T))]` does the same for
`SendMessageAsync`. A returned value is sent automatically.

### Conditional edges and switch

`AddEdge<T>(source, target, condition)` passes a message only when the
condition is true. `AddSwitch` routes to the first matching case, else a
default:

```csharp
builder.AddSwitch(intake, s => s
    .AddCase<Ticket>(t => t!.Category == "billing", bill)
    .AddCase<Ticket>(t => t!.Category == "technical", tech)
    .WithDefault(other));
```

```text
Billing: Billing handled 'Wrong invoice'
Technical: Technical handled 'Login error 500'
General: General handled 'Say hi'
```

With a single conditional edge and no default, a ticket that matches nothing
is dropped: `'Say hi': events=5 outputs=0 status=Idle`, no error. The same
silence applies to types: an edge from an `int` executor to a handler that
takes a `Ticket` built fine, and the run ended with zero outputs. What
`Build()` does check: an executor no edge reaches
(`unreachable executors: Cube`) and two different instances with the same id
(`an executor with the same ID but different instance is already bound`).

### Fan-out and the barrier

`AddFanOutEdge(source, [square, cube])` sends the same message to both, and
`AddFanInBarrierEdge([square, cube], join)` holds the join until both finished.
The barrier does not hand over a list:

```text
step 1: invoked Square, invoked Cube
step 2: invoked Join, OUTPUT join got 9 | invoked Join, OUTPUT join got 27
```

The join ran once per message, in the same superstep, after both branches. A
join handler for `List<int>` never ran and nothing complained, so the join
counts the messages itself (the lab does this).

### Shared executors and reset

Executors keep instance state, and a `Workflow` built from instances can run
again. A `Counter` executor that adds one on each run answered `1`, `2`, `3`
on three runs of the same workflow. The interface `IResettableExecutor`
(`ResetAsync`) is the cure, with a catch: once one executor in the graph
implements it, every shared instance must, or the second run throws
`Cannot reuse Workflow with shared Executor instances that do not implement
IResettableExecutor.` Zero resettable executors means no error and leaked
state.

### Checkpoints and resume

Pass a `CheckpointManager` and a checkpoint is saved at the end of every
superstep. A loop executor that adds step 1, 2, 3... to a total and sends
itself the next step, with a crash injected at step 5, saves its state in
`OnCheckpointingAsync` and reads it in `OnCheckpointRestoredAsync`:

```csharp
var mgr = CheckpointManager.CreateJson(new FileSystemJsonCheckpointStore(new DirectoryInfo(dir)));
await using StreamingRun run = await InProcessExecution.RunStreamingAsync(workflow, 1, mgr);
```

```text
process 1:  step 1 total 1 ... step 4 total 10   superstep done (4 checkpoints)
            error crash at step 5
process 2:  resuming from 45cdde1e...
            step 5 total 15, step 6 total 21, step 7 total 28, step 8 total 36
            output 36
```

Process 2 is a new .NET process: it built a new workflow and called
`GetLatestCheckpointAsync(sessionId)` and `ResumeStreamingAsync`. Only step 5
onward ran again, and the total continued from 10. The store wrote one JSON
file per checkpoint plus `index.jsonl`; the last file holds the queued message
(`5`) and `"Loop||total": 10`. The step that crashed has no checkpoint, so
make handlers safe to run again. The file store locks its directory: a second
`FileSystemJsonCheckpointStore` on the same folder threw `is already in use by
another process` until the first was disposed.

The rebuilt workflow must keep the same executor ids. With agents, the id
derives from the agent `Name` and `Id`: a Writer rebuilt with another `Id` gave
`InvalidDataException: The specified checkpoint is not compatible with the
workflow associated with this runner.` Give every agent a fixed
`ChatClientAgentOptions.Id`.

### Agents as executors

`AgentWorkflowBuilder` builds the four shapes from `AIAgent`s (the previous
lesson's `AsAIAgent`). Here, `Temperature = 0`, `Seed = 42`, and a stable `Id`
per agent (executor ids look like `Writer_writer`). You send the messages and a
`TurnToken`, then read events:

```csharp
await using StreamingRun run = await InProcessExecution.RunStreamingAsync(wf, new List<ChatMessage> { new(ChatRole.User, input) });
await run.TrySendMessageAsync(new TurnToken(emitEvents: true));
await foreach (WorkflowEvent e in run.WatchStreamAsync()) { /* AgentResponseUpdateEvent, WorkflowOutputEvent */ }
```

### Sequential

`BuildSequential(writer, editor)` feeds each agent the conversation so far:

```text
[Writer_writer] Porto is a vibrant Portuguese city renowned for its historic architecture, scenic riverside views, and world-famous port wine.
[Editor_editor] Porto: history, views, port wine
output: 3 messages (user, Writer, Editor)   model calls=2
```

Same in 3 of 3 runs. Resuming a checkpointed pipeline (3 checkpoints): from the
first, 1 model call ran; from the second, 0 and the output was still delivered.

### Concurrent

`BuildConcurrent([optimist, skeptic])` sends the same input to both and
aggregates the last message of each (a custom aggregator is an optional
argument):

```text
output: 2 messages
  assistant Optimist: It simplifies management and reduces complexity by centralizing operations in one location.
  assistant Skeptic: Risk: Increased vulnerability to regional disruptions, ...
model calls=2
```

The aggregated output was identical in 3 of 3 runs; the streamed updates
arrived Skeptic first in 1 of 3. Never rely on stream order.

### Handoff

A router agent and specialists, with explicit directions:

```csharp
var wf = AgentWorkflowBuilder.CreateHandoffBuilderWith(triage)
    .WithHandoffs(triage, [math, hist]).WithHandoffs([math, hist], triage).Build();
```

```text
user : What is 12 times 12?
assistant Triage:  [call handoff_to_1]
tool Triage:  [result Transferred.]
assistant MathAgent: 144                              model calls=2
```

The handoff is a tool call. Its name is the 1-based index of the target
(`handoff_to_1` for math, `handoff_to_2` for history), not the agent name.
Triage produced no text of its own. Identical in 3 of 3 runs for both questions
(history: `handoff_to_2`, then the answer). `EnableReturnToPrevious`,
`WithAutonomousMode` and `WithTerminationCondition` exist (not run).

### Group chat

A manager picks the next speaker. `RoundRobinGroupChatManager` takes turns
and stops at `MaximumIterationCount`:

```text
[Writer] Stay hydrated, sustainably.
[Critic] The slogan "Stay hydrated, sustainably" is clear and positive, but it slightly oversimplifies ...
[Writer] Drink well, leave less.
[Critic] "Drink well, leave less" is catchy and memorable, but it risks sounding vague ...
output: 5 messages   model calls=4
```

Same in 3 of 3 runs. Subclass `GroupChatManager` to choose speakers and decide
termination yourself.

### Magentic (docs only, experimental)

`MagenticWorkflowBuilder` (namespace `Microsoft.Agents.AI.Workflows.Specialized.Magentic`)
has a manager agent that plans, tracks a progress ledger and picks participants,
with `WithMaxRounds`, `WithMaxStalls`, `WithMaxResets` and plan sign-off that is
on by default in .NET. The docs mark the types experimental
(`#pragma warning disable MAAIW001`) and their sample uses Foundry. I did not run
it; the docs say it is untested outside the original Magentic-One design.

## Trade-offs

- **Explicit graph versus a loop in code.** A workflow gives edges you can test,
  events, supersteps and checkpoints, and costs the traps above: silent drops
  for unmatched conditions and wrong types, a protocol you must declare, reset
  rules for shared executors.
- **Checkpoints are trusted state.** The store is a trust boundary (the docs say
  never load checkpoints from an untrusted source), the crashed step is not saved,
  and rebuilt workflows need the same executor ids.
- **Four shapes, one small model.** Each handoff or group turn is another model
  call with the growing conversation. A 4B model handled these tiny prompts, but
  routing quality with many specialists is not shown here.
- **Docs only, not run here.** Magentic, human-in-the-loop requests,
  declarative workflows (`Microsoft.Agents.AI.Workflows.Declarative.Foundry` is
  1.5.0-rc1 on NuGet) and workflows as agents.

## Documentation Links

- [Workflow concepts, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/) (doc)
- [Executors, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/executors) (doc)
- [Edges, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/concepts/workflows/edges) (doc)
- [Checkpoints and resuming, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/checkpoints) (doc)
- [Workflow orchestrations, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/) (doc)
- [Magentic orchestration, Microsoft Learn](https://learn.microsoft.com/en-us/agent-framework/workflows/orchestrations/magentic) (doc)
