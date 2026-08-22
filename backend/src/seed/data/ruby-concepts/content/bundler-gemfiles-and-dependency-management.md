---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

`gem install` alone can't answer "which exact version of every transitive
dependency does this app run on production, and can I reproduce that on my
laptop and in CI?" — that's Bundler's entire job. Every Rails app, and most
non-trivial gems, are built around a `Gemfile` and a `Gemfile.lock`, and the
difference between them is the difference between "what we're willing to
run" and "what we're actually running." Treating the lock file as clutter, or
not understanding what `bundle exec` actually changes about a process, is
where experienced developers from other ecosystems (npm's `package-lock.json`
looks similar but the mental model isn't identical) end up debugging "works on
my machine" bugs that the tool already solved.

## Use Cases

- Pinning exact dependency versions — including transitive ones — so a
  deploy runs the same code that passed CI, not "whatever satisfied the
  version constraints today."
- Running a gem's own executable (`rspec`, `rubocop`, `rails`) against the
  versions locked for *this* project, not whatever happens to be the newest
  version installed globally on the machine.
- Isolating dependencies by environment — not loading `pry`/`factory_bot` in
  production, not loading the production-only `pg` driver in a CI job that
  uses SQLite.
- Developing a gem locally against another local gem or an unreleased Git
  branch, without publishing anything, via `path:`/`git:` sources.
- Packaging and publishing your own gem: turning a `lib/` directory into
  something `gem install` or a `Gemfile` line can pull down.

## Deep Dive

### The Gemfile is real Ruby, evaluated top to bottom

```ruby
# Gemfile
source "https://rubygems.org"
ruby "3.3.0"

gem "rails", "~> 7.2.0"
gem "pg", ">= 1.5"

group :development, :test do
  gem "rspec-rails"
  gem "pry"
end

group :test do
  gem "capybara"
end

gem "my_internal_lib", git: "git@github.com:acme/my_internal_lib.git", branch: "main"
gem "local_tool", path: "../local_tool"
```

Nothing here is a special config format — `group do ... end` is a method call
taking a block, `gem "x", "~> 1.0"` is a method call with a version
constraint string. That's why `bundler/inline` can embed an entire Gemfile
inside a single standalone script (`require "bundler/inline"; gemfile do ...
end`) — it's just Ruby code being evaluated in a different context, no
separate parser involved.

Version operators, from loosest to strictest: `>=`, `<=`, `>`, `<`, `=`
(exact), and the one worth memorizing because it's everywhere, `~>` — the
"pessimistic" or "twiddle-wakka" constraint. `~> 1.5.2` allows `1.5.x` patch
releases but not `1.6.0`; `~> 1.5` (one fewer segment) allows any `1.x` minor
release but not `2.0.0`. It encodes "trust patch/minor releases not to break
me, per semver, but never auto-adopt a major version."

### `bundle install` resolves once; `Gemfile.lock` is the actual truth

`bundle install` reads every `gem` line, resolves a dependency graph that
satisfies all of them simultaneously (including transitive dependencies
declared by those gems), and writes the exact resolved version of *every* gem
in the tree — direct and transitive — to `Gemfile.lock`. That lock file, not
the `Gemfile`, is what gets committed and what every subsequent `bundle
install` on any machine reproduces exactly, as long as the lock file exists.
`bundle update` re-resolves, but only within the constraints already in the
`Gemfile` — `bundle update rails` re-resolves `rails` and whatever depends on
it, without touching unrelated gems. Deleting `Gemfile.lock` and running
`bundle install` forces a full re-resolution from scratch, which is a
different operation from `bundle update` and can produce a different result
if new releases were published in the meantime.

The practical rule: `Gemfile.lock` belongs in version control for an
application (you want every developer and every deploy on identical
versions). For a *library* gem, the convention flips — the `.gemspec`
declares loose constraints and the lock file is typically not committed,
because a library has to work across a range of versions its consumers might
have locked, not one exact version.

### `bundle exec`: what it actually changes about a process

Installing multiple versions of the same gem is normal — `require` alone
picks whichever is newest on the load path, which is not necessarily the one
this project's `Gemfile.lock` resolved to. `bundle exec some_command` runs
`some_command` with `$LOAD_PATH` (and `Gem.loaded_specs`) constrained to
exactly the versions in `Gemfile.lock`, before the command's own code ever
runs. That's why `rspec` run bare can silently pick up a different `rspec`
version than the one the project locked, while `bundle exec rspec` cannot.

Inside a Ruby program (rather than a shell command) the equivalent is
`require "bundler/setup"` at the top of the entry point — it does the same
load-path pinning, in-process. `bundle binstubs some_gem` generates a wrapper
script in `bin/` that already calls `Bundler.setup` internally, so
`bin/rspec` behaves like `bundle exec rspec` without needing the prefix every
time — the mechanism Rails' `bin/rails` relies on.

### Grouping and environment isolation

```ruby
group :test do
  gem "capybara"
end
```

`Bundler.setup(:default, :production)` (roughly what a production boot does)
loads only the gems in those groups — `capybara` never gets required in a
production process, even though it's listed in the same `Gemfile`. The env
vars `BUNDLE_WITH`/`BUNDLE_WITHOUT` control this at `bundle install` time
too — a CI job or a production image can skip installing a group entirely
(`bundle install --without development test`), not merely skip requiring it,
which is what actually keeps a native-extension-heavy testing gem out of a
slim production image.

### Alternative sources, and developing against unreleased code

```ruby
gem "my_internal_lib", github: "acme/my_internal_lib"   # shorthand for git:
gem "my_internal_lib", git: "...", ref: "abc123"         # pin an exact commit
gem "local_tool", path: "../local_tool"
```

`git:`/`github:` sources are re-fetched on `bundle update`, same as a
registry gem with a loosened constraint — the code isn't frozen until the
lock file pins a specific revision. `path:` is different in kind: it points
at a real local directory, and edits there are picked up on the *next* run
with no `bundle update` needed at all, because there is no fetch step —
Bundler just requires the code in place. That distinction matters when
developing two gems in tandem: `path:` gives instant feedback, `git:` (even
pinned to a branch) still requires re-fetching to see a new commit.

### Shipping a gem: the shape RubyGems and Bundler both expect

`bundle gem my_gem` scaffolds the conventional layout:

```
my_gem/
  lib/my_gem.rb          # top-level require_relative fan-out
  lib/my_gem/client.rb   # MyGem::Client — one class per file
  lib/my_gem/version.rb
  exe/my_gem             # CLI entry point, no .rb extension
  my_gem.gemspec         # metadata + dependencies
  spec/                  # or test/, depending on --test flag
```

The file path mirrors the constant namespace — `MyGem::Client` lives at
`lib/my_gem/client.rb` — which is also exactly what autoloaders like
Zeitwerk (the one Rails uses) require in order to `require` a constant just
by referencing it, no explicit `require` line needed.

The `.gemspec` is, again, plain Ruby:

```ruby
Gem::Specification.new do |spec|
  spec.name     = "my_gem"
  spec.version  = MyGem::VERSION
  spec.authors  = ["Acme Corp"]
  spec.summary  = "A short summary"
  spec.files    = Dir["lib/**/*.rb"]
  spec.add_dependency "faraday", "~> 2.0"
  spec.add_development_dependency "rspec", "~> 3.13"
end
```

`gem build my_gem.gemspec` packages a `.gem` file locally (useful to sanity
check before publishing, or to install with `gem install ./my_gem-1.0.0.gem`
without touching rubygems.org at all); `gem push my_gem-1.0.0.gem` publishes
it. Once published, `gem yank` can pull a bad release, though anyone who
already resolved and locked that version keeps running it until they
re-resolve.

### Everyday `gem` commands worth knowing outside of Bundler

`gem list` shows what's installed; `gem which some_gem` prints the path to
the loaded file, the fastest way to answer "which copy of this am I actually
running"; `gem open some_gem` opens the installed source in `$EDITOR` —
genuinely useful for reading (or temporarily patching, for local debugging)
a dependency's real implementation instead of guessing from documentation;
`gem pristine some_gem` restores an installed gem to its original files if a
local edit or an incomplete native-extension rebuild left it broken.

## Trade-offs

- **`Gemfile.lock` in git is reproducibility, not bureaucracy** — the
  temptation to `.gitignore` it because "it just causes merge conflicts"
  throws away the one artifact that guarantees CI, every developer's machine,
  and production are running identical dependency versions. Resolve the
  conflict; don't remove the file.
- **`~>` trades safety for staying current automatically** — a tight `~>
  1.5.2` needs manual bumps for every minor release (safest, most manual); a
  loose `~> 1.5` auto-adopts minor releases on the next `bundle update`
  (least manual, trusts the gem's semver discipline). Pick per dependency
  based on how much you trust its maintainers' versioning.
- **`path:` gives instant local iteration but ships nothing** — great for
  developing two gems together, useless (and actively wrong) to leave in a
  `Gemfile` that gets deployed, since the path won't exist on another
  machine. `git:` pinned to a ref is the deployable equivalent when a
  registry release isn't ready yet.
- **Committing `Gemfile.lock` for an application vs. omitting it for a
  library gem is the opposite convention for a reason** — an app wants one
  exact, reproducible dependency set; a library has to remain installable
  alongside whatever *its* consumers already locked, so pinning transitive
  versions in the library itself would fight every app that depends on it.
- **`bundle exec` (or a binstub) is not optional ceremony** — skipping it
  works fine until two projects on the same machine have locked different
  versions of the same gem, at which point bare `rspec`/`rails` silently
  picks up whichever version `require` finds first, and the failure looks
  unrelated to versioning at all.

## Documentation Links

- [Bundler — official documentation](https://bundler.io/docs.html) — doc
- [Gemfile — man page (bundler.io)](https://bundler.io/man/gemfile.5.html) — doc
- [RubyGems Guides — Make Your Own Gem](https://guides.rubygems.org/make-your-own-gem/) — doc
- [RubyGems Guides — Specification Reference](https://guides.rubygems.org/specification-reference/) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby Gems](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
