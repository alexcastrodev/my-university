---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Most Ruby that runs in production isn't a web request handler — it's a data
migration script, a deploy task, a one-off report, a Rake job. That code
leans on a different part of the language than application code does:
command-line flags that turn Ruby into a `sed`/`awk` replacement, `ARGV`
parsing, `ENV`, and `Rake`, the task runner Bundler, RSpec, and Rails' own
`bin/rails` are all built on top of. An experienced developer who's spent
their career inside a framework's request cycle can still be unfamiliar with
this half of Ruby — the half that shows up the moment you need to write a
throwaway script or a deploy task instead of a controller action.

## Use Cases

- Writing a one-off data-fixing script as a `ruby -e` one-liner instead of a
  full file, or using `-n`/`-p`/`-a` to process a file line-by-line the way
  `sed`/`awk` would.
- Building a small CLI tool with real `--flag value` parsing, `--help`
  generation, and no dependency beyond the standard library, via
  `OptionParser`.
- Reading and extending a project's `Rakefile` — understanding task
  dependencies, `desc`, and why `rake -T` is the first command to run in an
  unfamiliar repo.
- Debugging why a script reads an environment variable correctly in one
  shell but not after a subprocess call, by understanding `ENV`'s actual
  scoping rules.
- Using `irb` as a real exploration tool — reloading a file you're actively
  editing, or opening a scoped subsession against one object — instead of
  restarting a REPL for every change.

## Deep Dive

### Ruby as a command-line calculator and text filter

`ruby -e 'puts 2 ** 10'` runs a line directly from the shell — no file
needed, useful for quick arithmetic or a fast sanity check of a method's
behavior. Four flags turn Ruby into a `sed`/`awk`-style line processor:
`-n` wraps the given code in an implicit `while gets; ...; end` (runs once
per input line, does nothing with the result unless the code itself prints);
`-p` does the same but also `print`s the line automatically after running
the code, mirroring `sed`; `-a` auto-splits each line on whitespace into the
array `$F` (`-F` sets a custom delimiter, mirroring `awk`'s `-F`). The flags
stack: `ruby -nae '...'` is `-n -a -e '...'` combined. `$_` is the magic
variable holding the last line read by `gets`, which is what `-n`/`-p`
implicitly operate on.

```bash
# print the second whitespace-separated field of every line
ruby -ane 'puts $F[1]' access.log

# in-place edit: replace "foo" with "bar" in every .rb file, keeping a .bak
ruby -i.bak -pe '$_.gsub!("foo", "bar")' *.rb
```

`-i[.ext]` (in-place editing, an idiom inherited from Perl) rewrites the file
being processed instead of printing to stdout, optionally keeping a backup
with the given extension. A script meant to be run directly rather than via
`ruby script.rb` wants the portable shebang `#!/usr/bin/env ruby` plus
`chmod +x`.

### `ARGV`, `ARGF`, and `$0`

`ARGV` is the array of command-line arguments — unlike C, it does **not**
include the program name, which lives separately in `$0` (alias
`$PROGRAM_NAME`). `ARGF` is the more specialized tool: it treats every file
named in `ARGV` as **one concatenated logical stream**, transparently
opening the next file when the current one is exhausted — exactly the
behavior `cat`/`grep` give you when you pass them multiple files, without
writing the file-iteration loop yourself:

```ruby
ARGF.each_line { |line| puts line if line.include?("ERROR") }
# ruby this_script.rb app.log app.log.1 app.log.2
# processes all three files as a single stream, in argument order
```

### `OptionParser`: real flag parsing without a gem

For anything past a couple of positional arguments, hand-parsing `ARGV` gets
error-prone fast. `OptionParser` (stdlib, `require "optparse"`) handles
`--long-option VALUE` parsing, short-flag aliases, type coercion, and
`--help` generation:

```ruby
require "optparse"

options = { verbose: false, limit: 100 }

OptionParser.new do |parser|
  parser.banner = "Usage: report.rb [options]"

  parser.on("-v", "--verbose", "Run verbosely") { options[:verbose] = true }
  parser.on("-l", "--limit N", Integer, "Max records") { |n| options[:limit] = n }
end.parse!

# ARGV now holds only the leftover positional arguments, flags removed
```

`parse!` mutates `ARGV` in place, stripping recognized flags and leaving
positional arguments behind — the `!` is doing real work here, not just
convention. `--help` is generated automatically from the `banner` and the
descriptions passed to `on`. For a CLI with git-style subcommands
(`mytool deploy --env production`), `OptionParser` alone gets unwieldy
quickly — **Thor** is the de facto third-party choice once a tool outgrows
flat flags, giving each subcommand its own class method and option set.

### `ENV` and `$LOAD_PATH`: two things that look like plain data and aren't

`ENV` behaves like a `Hash` — `ENV["DATABASE_URL"]`, `ENV.fetch("KEY",
default)` — but it isn't one; it's a live view onto the process's actual
environment. The scoping rule that trips people up: a change to `ENV` inside
a Ruby process affects **that process and any child process it spawns
afterward**, but it never propagates back to the parent shell that launched
it — the same rule as `export` in any Unix shell, but easy to forget when
`ENV` looks like ordinary mutable state.

`$LOAD_PATH` (alias `$:`) is the array of directories `require` searches.
Manipulating it directly to load a neighboring file was the old idiom;
`require_relative` (path relative to the current file, resolved at parse
time) is the correct modern replacement for loading a sibling file and
should be preferred in essentially all new code — reaching for
`$LOAD_PATH` manipulation today is usually a sign of code that predates
`require_relative` or a script layout that's fighting its own directory
structure.

### Rake: the task runner nearly everything else is built on

A `Rakefile` is ordinary Ruby. `task :name do ... end` defines a task;
`desc "..."` immediately above a task attaches a description that shows up
in `rake -T` (`--tasks`) — the first command worth running in any repo with
a `Rakefile` you haven't seen before, since it lists every available task
with its description in one pass.

```ruby
desc "Run the full test suite"
task test: [:lint, :spec] do
  puts "All checks passed"
end

desc "Run RuboCop"
task :lint do
  sh "bundle exec rubocop"
end

desc "Run RSpec"
task :spec do
  sh "bundle exec rspec"
end

task default: :test
```

Dependencies between tasks are declared as a hash (`task combined:
[:t1, :t2]`) — Rake runs the dependencies first, each exactly once even if
multiple tasks depend on the same prerequisite. A task literally named
`default` is what runs when `rake` is invoked with no arguments at all,
which is why `rake` alone often just works in a well-set-up project.
`CLEAN` and `CLOBBER` are special arrays (from `rake/clean`) that
auto-generate `clean`/`clobber` tasks for deleting generated files —
`CLEAN` for regeneratable build artifacts, `CLOBBER` for things that are
more expensive to regenerate (and typically includes everything in `CLEAN`
as well).

### `irb`: a REPL meant to stay open while you edit

Modern `irb` (3.1+) has autocomplete, syntax coloring, and automatic
multi-line indentation. `_` always holds the value of the last evaluated
expression, useful for capturing a result you forgot to assign
(`result = _`). History persists across sessions once configured in
`~/.irbrc` (`IRB.conf[:SAVE_HISTORY] = 1000`), which is also the place to
define personal helpers that load into every session — a `time { block }`
wrapper around `Benchmark`, for instance, or a diagnostic method reopening
`Object`.

The detail worth knowing deliberately: `load("file.rb")`, unlike `require`,
re-executes the file every time it's called, even if it was already loaded —
which is exactly what makes it useful for iterating inside a long-running
`irb` session against a file you're actively editing, something `require`
structurally can't do since it's a no-op on a second call for the same path.
`irb` also supports nested sub-sessions: typing `irb` again inside an
existing session opens a new one with its own independent namespace
(`jobs` lists open sessions, `fg n` switches between them); `irb "wombat"`
opens a sub-session where `self` is `"wombat"`, a fast way to explore an
object's real behavior interactively without wrapping it in a script first.

### Documenting Ruby: RDoc and YARD, briefly

**RDoc** ships with Ruby and documents Ruby's own standard library — it
extracts the comment block immediately preceding a class, module, or method
definition, with no required markup: plain aligned paragraphs, `_italic_`,
`*bold*`, `+monospace+`, and `label:: description` lists are all it needs.
`#--`/`#++` bracket a region RDoc should skip entirely — useful for an
internal note or TODO living next to public documentation without leaking
into it. `rdoc --ri` generates the format `ri ClassName#method` and irb's
inline doc lookup both read from directly.

**YARD** is the third-party superset most gem authors reach for instead,
using structured `@`-tags rather than RDoc's freeform prose:
`@param name [Type] description`, `@return [Type] description`, `@raise`,
`@example`, `@deprecated`. `yard doc .` generates richer HTML than RDoc's
default output, and `yri` is YARD's own equivalent of `ri`, scoped to the
current project rather than Ruby's core classes.

## Trade-offs

- **`-n`/`-p`/`-a` one-liners are fast to write and hard to read back** —
  perfect for a genuinely disposable, run-once command; a script anyone will
  read again in a month deserves a real file with named variables, even if
  it's five lines longer.
- **`OptionParser` covers flat flag parsing well and stops there** — reaching
  for Thor (or an equivalent) the moment a tool needs subcommands avoids
  hand-rolling dispatch logic `OptionParser` was never designed for.
- **Rake's implicit `default` task is convenient until it's surprising** — a
  `Rakefile` inherited from someone else where `rake` alone triggers a slow
  or destructive task (a full data rebuild, a deploy) is a common "wait, what
  did I just run" moment; `rake -T` before the first `rake` in an unfamiliar
  repo is the cheap insurance against it.
- **`ENV` mutation is process-scoped in a way that surprises people coming
  from shells that source files into the current shell** — a Ruby process
  setting `ENV["X"] = "y"` will never affect the terminal that launched it,
  only itself and its children; anyone expecting otherwise is thinking of
  shell `source`, not `export`.
- **RDoc's zero-markup convenience trades off against YARD's structure** —
  RDoc is enough for a small script or internal tool; a published gem with a
  non-trivial public API benefits enough from YARD's typed `@param`/`@return`
  tags that most gem authors adopt it despite the extra dependency and
  syntax to learn.

## Documentation Links

- [ruby(1) — command-line options man page](https://docs.ruby-lang.org/en/3.3/man/ruby.1.html) — doc
- [OptionParser — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/OptionParser.html) — doc
- [Rake — GitHub (ruby/rake)](https://github.com/ruby/rake) — doc
- [IRB — Ruby stdlib docs](https://docs.ruby-lang.org/en/3.3/IRB.html) — doc
- [YARD — getting started guide](https://rubydoc.info/gems/yard/file/docs/GettingStarted.md) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby from the Command Line](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
