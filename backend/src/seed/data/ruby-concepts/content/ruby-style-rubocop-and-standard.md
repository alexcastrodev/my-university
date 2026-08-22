---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Ruby's syntax is flexible enough that two files in the same codebase can look
like they were written by different languages — `{}` or `do...end`, explicit
parens or not, two-space or four-space indent — and none of it is a syntax
error. That flexibility is exactly why every team above a handful of
engineers ends up running a linter in CI: not to catch bugs (a few cops do),
but to remove the hundreds of small formatting decisions that would otherwise
turn every pull request into a style debate. RuboCop is the linter that
question comes down to almost everywhere in the Ruby world; Standard is the
answer for teams who'd rather not have that debate about the linter's config
either. Knowing what a "cop" is, what severities mean, and how to adopt
linting on a codebase that's never had it are table-stakes for working on a
real Ruby team, not academic style trivia.

## Use Cases

- Reading a `.rubocop.yml` in an unfamiliar repo and knowing what
  `Layout/`, `Style/`, `Lint/`, and `Metrics/` cop namespaces roughly police,
  before touching a single file.
- Deciding whether a failing CI lint check is safe to autocorrect
  (`rubocop -a`) or needs a human judgment call (`rubocop -A`, unsafe
  autocorrect, or a manual fix).
- Introducing linting on a large legacy codebase without a multi-week
  "fix everything first" project blocking it.
- Disabling a specific cop for one justified line without disabling it
  project-wide, and knowing that magic comment's exact syntax.
- Picking between RuboCop's full configurability and Standard's zero-config
  stance for a new project, based on how much the team actually wants to
  bikeshed formatting.

## Deep Dive

### The conventions a linter exists to stop arguing about

Idiomatic Ruby has settled conventions that predate any linter and that
RuboCop mostly just encodes: two-space indentation, never tabs or four
spaces; `when` inside a `case`, and `rescue`/`ensure` inside a `begin`, are
**not** indented relative to their parent — they're not logically nested
blocks, they're clauses of the same statement; methods after a bare
`private` keyword also stay at the same indentation as the methods above it.
No trailing semicolons. Spaces around binary operators, around `=`, and after
commas — but not inside `[]`/`()`. The exceptions are consistent enough to
memorize as a group: no space around a range (`1..10`), a unary bang
(`!foo`), safe navigation (`&.`), exponentiation (`x**2`), or a Rational
literal (`3/5r`).

Naming follows a fixed pattern: `snake_case` for variables, methods, and file
names; `CamelCase` for classes and modules (with acronyms kept lowercase
internally — `HttpReceiver`, not `HTTPReceiver`); `SCREAMING_SNAKE_CASE` for
constants. Accessors drop the Java-ish `get`/`set` prefixes (`user.name`, not
`user.getName`), predicate methods end in `?` rather than starting with
`is_`, and mutating/dangerous methods end in `!` by convention, not by
enforcement — `sort!` genuinely mutates in place, but nothing stops a
misnamed method that doesn't.

Block delimiter choice has one genuine style split worth knowing rather than
just picking a side: the common rule is `{}` for a single-line block,
`do...end` for a multi-line one — except what's sometimes called the
"Weirich convention" (after Jim Weirich, Rake's author), which keeps `{}`
even for a multi-line block when the block's return value gets chained
(`arr.map { |x| ... }.sort.first`), because `end.sort.first` reads badly.
RuboCop's `Style/BlockDelimiters` cop has a setting for exactly this
distinction, which is why two RuboCop-clean codebases can still disagree
about it.

### RuboCop: cops, severities, and adopting it without a rewrite

RuboCop's rules are called **cops**, organized into namespaces by concern —
`Layout` (whitespace, indentation), `Style` (idiom preference — `{}` vs
`do...end`, string literal quoting), `Lint` (things that are plausibly bugs,
not just taste), `Metrics` (method length, class length, cyclomatic
complexity), and more. Every cop has a configurable severity —
`Info < Refactor < Convention < Warning < Error < Fatal` — controlling how
loudly a violation is reported and whether it fails CI.

Configuration lives in `.rubocop.yml`, itself just YAML enabling, disabling,
and tuning individual cops:

```yaml
AllCops:
  NewCops: enable
  TargetRubyVersion: 3.3

Style/Documentation:
  Enabled: false

Layout/LineLength:
  Max: 120

Metrics/MethodLength:
  Max: 15
  Exclude:
    - 'db/migrate/**/*'
```

`rubocop -a` autocorrects violations RuboCop considers **safe** — changes
that can't alter behavior, like adding a missing space. `rubocop -A` also
applies **unsafe** autocorrects — changes that are usually right but could,
in an unusual case, change behavior (reordering hash keys, converting
`%w[]` arrays) — which is why `-A` output deserves an actual diff review
before committing, and `-a` is the one safe to run unattended in a
pre-commit hook.

Adopting RuboCop on a codebase with years of unlinted history doesn't mean
fixing every existing violation before the linter can be useful.
`rubocop --auto-gen-config` scans the current codebase and generates a
`.rubocop_todo.yml` that suppresses every cop already being violated,
file-by-file — the linter goes green immediately, and the todo file becomes
a visible, shrinkable backlog instead of a blocker. New code is held to the
full standard from day one; old violations get fixed opportunistically (or
via a scheduled cleanup pass) without a stop-the-world rewrite.

A single justified exception doesn't need a config change at all — a magic
comment scopes it to one line or block:

```ruby
# rubocop:disable Metrics/AbcSize
def legacy_report_generator
  # ...gnarly, deliberately-not-refactored-yet method...
end
# rubocop:enable Metrics/AbcSize
```

The disable/enable pair should always be paired and scoped as tightly as
possible — a `disable` with no matching `enable` silences the cop for the
rest of the file, which is a common accidental-scope-creep bug in a large
diff.

### Standard: the same enforcement, zero config debate

`standard` (CLI: `standardrb`) is RuboCop under the hood, with a fixed,
opinionated configuration and deliberately almost no exposed settings. The
pitch, from its author Justin Searls, is explicit: teams spend real time
debating `.rubocop.yml` settings that don't actually matter for
correctness — tabs vs spaces, quote style, trailing comma rules — and
Standard removes that surface area entirely by shipping one answer.
`standardrb --fix` autocorrects, same idea as `rubocop -a`. The trade-off is
symmetrical to the config-freedom RuboCop offers: a team that genuinely wants
`Metrics/MethodLength` set to 30 instead of the default, or wants a cop
Standard doesn't enable, has to accept Standard's answer or go back to
RuboCop directly.

### Parentheses, and the exceptions worth knowing

The house convention across most style guides is to use parentheses on
method calls with arguments — but with specific, memorable exceptions:
`Kernel` methods that read like keywords (`puts`, `p`, `require`), class-body
declarations that read like keywords (`include Comparable`, `private`), and
DSL method calls meant to read as prose (RSpec's `it "does a thing" do`).
Never write empty parentheses on a call with no arguments (`foo()` instead of
`foo`) — with one deliberate exception: `super()` with empty parens means
"call the parent method with **no** arguments," which is a different call
than bare `super` (repasses whatever the current method received). Dropping
the parens there isn't a style violation, it's a behavior change.

## Trade-offs

- **RuboCop's configurability is also its cost** — a team can tune every cop
  to taste, but that tuning is itself a recurring source of PR debate that
  Standard exists specifically to remove. Choose RuboCop when the team has
  genuine, non-bikeshed reasons to deviate from defaults (a `Metrics::` limit
  that doesn't fit a domain-heavy codebase); choose Standard when the answer
  to most config questions would be "whatever, let's just pick one."
- **`-A` (unsafe autocorrect) is a diff to review, not a command to trust
  blindly** — it's usually right, which is precisely what makes the rare
  wrong case dangerous: it slips through review because "it's just the
  linter" gets less scrutiny than a human-authored change.
- **`--auto-gen-config` unblocks adoption but can calcify into permanent debt**
  if the resulting `.rubocop_todo.yml` is never revisited — treat it as a
  backlog with an owner, not a permanent exemption list.
- **A cop's severity is a policy decision, not a fact about the code** —
  teams that set everything to `Error` get a CI that blocks on pure style
  nits; teams that leave real bug-shaped `Lint` cops at `Warning` risk
  merging things RuboCop actually caught correctly. The default severities
  are a reasonable starting point, not something to leave unexamined forever.

## Documentation Links

- [RuboCop — official documentation](https://docs.rubocop.org/rubocop/) — doc
- [RuboCop — cop configuration reference](https://docs.rubocop.org/rubocop/configuration.html) — doc
- [Standard — Ruby Style Guide, guides itself](https://github.com/standardrb/standard) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby Style](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
