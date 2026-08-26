---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Zeitwerk is not an implementation detail you can ignore once the app boots — it
is a *contract* you write code against every day, and violating it is a runtime
crash, not a style nit. A file at `app/services/api/user_sync.rb` that defines
`class UserSync` instead of `Api::UserSync` doesn't fail at boot in development;
it fails the first time something references the constant, with a
`Zeitwerk::NameError`, potentially in production after a deploy that "worked"
because the code path wasn't eager-loaded until the first request hit it. As an
app grows past a few hundred models and services, that same contract becomes the
thing that either makes modularization free (namespaces map directly to
directories, no manual `require`) or the thing engineers fight when two teams'
directories collide on the same acronym. This concept is about knowing the
actual rules Zeitwerk enforces, the concrete ways they break at scale, and the
two real tools — Rails Engines and Packwerk — for drawing boundaries once
"everything is one big `app/` namespace" stops working.

## Use Cases

- Debugging a `Zeitwerk::NameError` in CI or on deploy that never showed up in
  local development because the failing file was never autoloaded until eager
  loading ran.
- Deciding what to do when a legitimate class name is an acronym (`API`, `VAT`,
  `HTML`) and Zeitwerk's default camelization produces the wrong constant.
- Running `bin/rails zeitwerk:check` as a CI gate before a deploy, instead of
  discovering a naming violation the first time production eager-loads the app.
- Choosing between a full Rails Engine, a Packwerk package, or "just add another
  directory under `app/`" when a team wants to carve out a bounded module of an
  existing monolith.
- Diagnosing why boot time keeps growing release over release, and whether the
  fix is a code-organization problem (too much to eager-load) or an
  architecture problem (too much coupled into one deploy unit).
- Reviewing a PR that adds a new top-level namespace and deciding whether it
  belongs in `app/`, in a new Packwerk package, or in an extracted engine.

## Deep Dive

### Zeitwerk's core contract

Zeitwerk replaced Rails' "classic" autoloader in Rails 6, and the rule it
enforces is simple to state and easy to violate: **file paths mirror constant
paths**. A directory is a namespace, a file is a constant, and nesting one
inside the other means nesting the module inside the class:

```
app/models/user.rb                  -> User
app/models/billing/invoice.rb       -> Billing::Invoice
app/services/api/user_sync.rb       -> Api::UserSync
```

There is no `require`, no `require_dependency`, no `require_relative` for your
own app code under an autoload path — Zeitwerk resolves the constant to a file
path on first reference and loads it. Any `require_dependency` call still in an
old codebase is a leftover from the classic autoloader; it's a no-op safety net
under Zeitwerk at best and a source of confusing double-loading at worst.

Rails registers two separate Zeitwerk loader instances, not one:

- **`Rails.autoloaders.main`** manages `app/*` and any custom autoload paths —
  the code that gets unloaded and reloaded between requests in development
  (`config.enable_reloading`), and eager-loaded up front in production
  (`config.eager_load = true`, on by default in `production`, off by default
  in `development`, and enabled in `test` when `CI` is set).
- **`Rails.autoloaders.once`** manages autoload-once paths — code that should
  load a single time and never be unloaded across reloads, because reloading it
  would leave stale references (framework decorations, some initializer-time
  extensions). `lib` is a common example when it's added to autoload paths.

When the contract is violated — the file doesn't define the constant Zeitwerk
expected — the failure is a `Zeitwerk::NameError`, a subclass of `NameError`,
with a message in the shape:

```
Zeitwerk::NameError: expected file
/app/services/api/user_sync.rb to define constant Api::UserSync, but didn't
```

The critical operational detail: this only fires when the file is *loaded*.
In development with lazy autoloading, a broken file that nothing references
yet will sit there silently. The first time it bites is often in CI or
production, whichever eager-loads first — which is exactly why `eager_load`
in CI and the `zeitwerk:check` task (below) exist: to force the failure
early, on a machine that isn't serving real traffic.

### Common Zeitwerk gotchas at scale

**Acronym and inflection collisions.** Zeitwerk's default inflector uses
`String#camelize`, so `api_controller.rb` becomes `ApiController` — probably
fine — but a bare `api.rb` becomes `Api`, not `API`. If the codebase's actual
convention is `API`, that mismatch is a `Zeitwerk::NameError` waiting for the
first reference. The fix is an explicit inflection override, conventionally
collected in one initializer:

```ruby
# config/initializers/inflections.rb
ActiveSupport::Inflector.inflections(:en) do |inflect|
  inflect.acronym "API"
  inflect.acronym "HTML"
  inflect.acronym "VAT"
end
```

This changes `ActiveSupport`'s `camelize`/`underscore` globally, which is
usually what you want since Zeitwerk's default inflector delegates to it. For
inflection rules scoped to a single loader instead of all of `ActiveSupport`,
override the loader directly:

```ruby
Rails.autoloaders.each do |autoloader|
  autoloader.inflector.inflect("html_parser" => "HTMLParser")
end
```

The overrides are matched against exact file/directory basenames (without
extension), not applied as a general regex — `api_client.rb` needs its own
entry if `api.rb` doesn't cover it.

**Naming collisions between STI subclasses and directories.** A classic trap:
`Vehicle` uses single-table inheritance with `Car` and `Truck` as subclasses
living directly in `app/models/`. Someone later adds a `Car` *namespace* for
an unrelated concept — `app/models/car/rental_agreement.rb` defining
`Car::RentalAgreement` — and now `Car` is expected to be both a class (the STI
subclass) and a module (the namespace directory). Zeitwerk raises on this the
moment both are referenced, because a single constant can't be both. The real
fix is to rename one side (rare for a public STI class name) or move the STI
class into its own explicit-namespace file so the ambiguity is resolved
before Zeitwerk ever has to guess.

**`zeitwerk:check` is the tool that catches these before deploy**, not code
review. Run it locally or, better, wire it into CI:

```
$ bin/rails zeitwerk:check
Hold on, I am eager loading the application.
All is good!
```

On failure it aborts with the underlying `Zeitwerk::NameError` message. It can
also report directories that exist under an autoload path but won't be
eager-loaded unless added to `config.eager_load_paths` — worth reading, since
those directories are exactly the ones that can hide a broken file until
someone unlucky references it in production.

### Rails Engines for hard module boundaries

An Engine is a Rails app nested inside a Rails app — the mechanism Rails
itself uses to be a Rails app (`Rails::Application < Rails::Engine`). Generate
one with `rails plugin new blorgh --full` for a basic engine, or
`--mountable` for a namespace-isolated one. The file that defines it:

```ruby
# lib/blorgh/engine.rb
module Blorgh
  class Engine < ::Rails::Engine
    isolate_namespace Blorgh
  end
end
```

`isolate_namespace` is what makes a mountable engine a real boundary rather
than just "code that happens to live in a gem": it namespaces the engine's
controllers, models, table names (`blorgh_articles`), views, route helpers,
and params key, so the engine can't accidentally collide with the host app's
constants even though both are autoloaded by the same Zeitwerk process. A
non-mountable (`--full`) engine skips that isolation and shares the host
app's namespace directly — closer to a plain gem that hooks into Rails'
initialization than to a bounded module.

What a full engine extraction buys:

- **Its own routes**, drawn separately and mounted explicitly:
  ```ruby
  # config/routes.rb (host app)
  Rails.application.routes.draw do
    mount Blorgh::Engine, at: "/blog"
  end
  ```
- **Its own migrations**, copied into the host app on demand rather than
  auto-run: `bin/rails blorgh:install:migrations`.
- **Its own asset pipeline**, namespaced under `app/assets/.../blorgh/`.
- A namespace that **can be gem-ified and versioned independently** — pulled
  out of the monolith's repo entirely, given its own CHANGELOG and semver, and
  pinned by version in the host app's `Gemfile`.

What it costs is real, not incidental: an engine is a second application with
its own `test/dummy` app to boot for its test suite, its own gemspec and
dependency graph, and its own `lib/engine_name/engine.rb` initialization
concerns to get right. Extracting an engine out of code that already lives in
`app/` and freely references the host app's models is genuine surgery — every
cross-boundary reference has to become an explicit dependency, exactly the
kind of coupling that made the extraction worth doing in the first place, and
exactly the kind of work Packwerk (next) exists to do more cheaply.

### Packwerk for lighter-weight boundaries

Packwerk, from Shopify, enforces module boundaries as a **static lint**,
without requiring engine-style extraction. Each package is a directory with a
`package.yml`:

```yaml
# components/orders/package.yml
enforce_dependencies: true
enforce_privacy: true
dependencies:
  - components/platform
  - components/shipping
```

`enforce_dependencies: true` means any reference to a constant defined in a
package not listed under `dependencies` is a **dependency violation**.
`enforce_privacy: true` means anything the package defines outside its
`app/public/` directory (configurable via `public_path`) is treated as
private — a reference to it from another package is a **privacy violation**,
even if it's a declared dependency. Violations are found by static analysis
of constant references, checked with:

```
$ bin/packwerk check
```

CI runs this the same way it runs RuboCop. Existing violations at adoption
time — Packwerk is explicitly built to be dropped onto a monolith that
already breaks its own proposed rules — get recorded per package in
`package_todo.yml` rather than blocking the build immediately, so the
boundary can be introduced incrementally and violations paid down over time
instead of requiring a big-bang fix.

The trade-off against engines is the whole point of Packwerk: adopting it on
an existing monolith costs a `package.yml` file and a CI step, not a
directory restructure or a second test-suite boot. But the boundary it draws
is exactly as strong as CI enforcement and nothing more. A Packwerk package
is not a Zeitwerk namespace and not `isolate_namespace` — Ruby's own constant
lookup doesn't know packages exist, so nothing stops code at runtime from
calling `Orders::LineItem` from inside `components/marketing` the way an
Engine's namespacing would prevent. If `bin/packwerk check` isn't wired into
CI, or someone merges past a red check, the "boundary" is a comment, not a
constraint.

### When to actually modularize

None of the above is worth doing preemptively. Concrete signals worth citing
in an architecture discussion, rather than "the app feels big":

- **Boot time growing roughly linearly with app size.** Every class Zeitwerk
  eager-loads in production is a class instantiated into memory before the
  first request is served; an app that takes 45 seconds to boot because it
  eager-loads 6,000 classes is paying that cost on every deploy and every
  autoscaled instance start.
- **Deploy risk from unrelated teams' changes.** If a payments team's PR can
  break the marketing team's code because both live in the same `app/models`
  namespace with no declared boundary, that's a Packwerk-shaped problem before
  it's an Engine-shaped one.
- **CI test-suite runtime becoming the bottleneck on every PR**, because the
  whole suite loads the whole app regardless of which 200 lines changed —
  this is the strongest signal for an actual Engine extraction, since only a
  real boundary lets a subset of the test suite run in isolation.

Note the terminology collision: Zeitwerk's "eager loading" (load every class
at boot) and ActiveRecord's "eager loading" (`includes`/`preload` to avoid
N+1 queries) are unrelated mechanisms that happen to share a name — growing
boot time from too many autoloaded classes is not fixed by anything discussed
in query-loading strategy, and vice versa.

## Trade-offs

- **The Zeitwerk contract has no escape hatch for "just this one file."**
  Unlike the classic autoloader, which tolerated `require`-based workarounds,
  Zeitwerk either resolves a constant to the exact expected path or raises.
  The one legitimate exception — a file that genuinely shouldn't be
  autoloaded — is `Rails.autoloaders.main.ignore(...)`, which is itself
  another thing to track and justify in review.
- **`zeitwerk:check` only checks what gets eager-loaded.** A directory that
  exists but isn't on an eager-load path can hide a broken file indefinitely;
  the task warns about this but doesn't fail on it by default. Treat that
  warning as a checklist, not noise.
  ```
  WARNING: The following directories will only be checked if you configure
  them to be eager loaded: app/uncommon_path
  ```
- **Inflection overrides are global and easy to under-scope.** Adding
  `inflect.acronym "API"` to `ActiveSupport::Inflector.inflections` changes
  `"api".camelize` everywhere in the app, including string manipulation that
  has nothing to do with autoloading — a display label built with
  `.camelize` upstream of Zeitwerk now reads `API` too, which is sometimes
  desired and sometimes a silent behavior change nobody reviewed as such.
- **An Engine is real infrastructure, not a `mkdir`.** Its own dummy test app,
  its own boot sequence, its own gemspec — an engine that's extracted
  prematurely from a monolith with tangled cross-references costs weeks of
  untangling for a boundary that Packwerk could have enforced in an
  afternoon. Reach for an engine when you actually need process-independent
  versioning or genuine runtime isolation, not as the default modularization
  move.
- **Packwerk's boundary is advisory unless CI actually blocks on it.** This is
  the trade that makes Packwerk cheap: it's also the trade that makes it
  fragile. A developer under deadline pressure who reaches across a
  `package.yml` boundary gets a red CI check, not a `NameError` — and a red
  check that gets merged past (or a `package_todo.yml` line quietly extended
  instead of fixed) is a boundary that exists on paper only.
  ```ruby
  # inside components/marketing — enforce_privacy: true is set,
  # this constant lives in components/orders/app/models (not app/public)
  Orders::LineItem.where(status: "pending") # violation, but boots and runs fine
  ```
- **Neither tool tells you *what* the boundary should be.** Packwerk and
  Engines both enforce a boundary once you've drawn it; deciding where the
  seam actually belongs — which models, services, and jobs form a cohesive
  package — is a design judgment neither tool makes for you, and drawing it
  in the wrong place just moves the coupling problem to the packages
  themselves.

## Documentation Links

- [Zeitwerk README — fxn/zeitwerk](https://github.com/fxn/zeitwerk) — doc
- [Autoloading and Reloading Constants — Rails Guides](https://guides.rubyonrails.org/autoloading_and_reloading_constants.html) — doc
- [Engines — Rails Guides](https://guides.rubyonrails.org/engines.html) — doc
- [Packwerk README and USAGE — Shopify/packwerk](https://github.com/Shopify/packwerk) — doc
