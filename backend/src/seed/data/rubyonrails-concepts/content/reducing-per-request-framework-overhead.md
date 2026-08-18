---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

"Rails is slow" is usually asserted, rarely measured. When the author of *The
Complete Guide to Rails Performance* actually measured it with `wrk` against a
"Hello World" response, the numbers were: bare Rack ~5ms/req, Sinatra and Cuba
~9-14ms, Rails ~33ms. So Rails' own framework overhead is roughly **28ms per
request** over bare Rack — a real number, but one that has to be read against
the budget it lives in. A typical full page load is around 700ms end to end, so
those 28ms are about 4% of what the user actually perceives. Chasing them for
*latency* is almost always the wrong optimization. Chasing them for **$/request**
— raw infrastructure cost on a high-traffic API where 28ms per request multiplies
into instances you have to pay for — can be entirely rational. This concept is
about knowing which situation you're in, and what the actual levers are if you're
in the second one.

## Use Cases

- Running a high-throughput JSON API where request time is dominated by framework
  overhead rather than by database or external-service I/O, and instance count
  (not user-perceived latency) is the thing you're trying to reduce.
- Answering "should we rewrite this service in Sinatra/Roda?" with a measurement
  instead of folklore — the answer is frequently "no, strip the Rails app instead."
- Auditing what a Rails app is actually loading and running per request:
  `bin/rails middleware` to see the real Rack stack, and `config/application.rb`
  to see which frameworks were pulled in by a reflexive `require "rails/all"`.
- Cutting memory footprint on a container with a hard memory ceiling, where the
  ~10MB of Sprockets in an API-only app is per-worker waste multiplied by every
  worker on every instance.
- Deciding whether a specific hot endpoint (a health check, a tracking pixel, a
  high-volume webhook receiver) justifies dropping out of `ActionController::Base`
  entirely.

## Deep Dive

### Load only the frameworks you use

The generated `config/application.rb` reaches for `rails/all`, which requires
every Rails framework whether the app uses it or not:

```ruby
# config/application.rb — the default
require "rails/all"
```

Approximate footprints of what that pulls in: Sprockets ~10MB, ActiveRecord
~3.5MB, ActionMailer ~0.5MB, ActiveJob ~0.5MB. An API-only service that never
renders an asset is paying for Sprockets in every worker process on every
instance. Cherry-picking is a one-line-per-framework change:

```ruby
# config/application.rb — only what this app actually uses
require "rails"

require "active_model/railtie"
require "active_job/railtie"
require "active_record/railtie"
require "action_controller/railtie"
# deliberately NOT required:
#   require "sprockets/railtie"        # no asset pipeline
#   require "action_mailer/railtie"    # no outbound mail
#   require "action_view/railtie"      # JSON only, no templates
#   require "action_cable/engine"      # no websockets
#   require "active_storage/engine"    # no file attachments

module Api
  class Application < Rails::Application
    config.load_defaults 7.1
    config.api_only = true
  end
end
```

This mostly buys **boot time and memory**, not per-request time — but memory per
worker is exactly what decides how many workers fit on an instance, which is the
$/request lever.

### `ActionController::Metal` for hot endpoints

`ActionController::Base` is `ActionController::Metal` plus a long list of
included modules — `ForceSSL`, `HttpAuthentication`, `ImplicitRender`,
`RequestForgeryProtection`, `Cookies`, `Flash`, `Rendering`, and more. Each one
adds callbacks and method-lookup work to every action. For an endpoint that
returns a fixed string thousands of times per second, you can skip nearly all of
it:

```ruby
class HealthController < ActionController::Metal
  def show
    self.status = 200
    self.headers["Content-Type"] = "application/json"
    self.response_body = '{"status":"ok"}'
  end
end
```

```ruby
# config/routes.rb
Rails.application.routes.draw do
  get "/health", to: "health#show"
end
```

What you give up is real, not free:

- **No view rendering.** There is no `render` — you assign `response_body`
  yourself. No templates, no partials, no `render json:`.
- **No implicit render.** An action that falls off the end without setting
  `response_body` returns an empty body, not a template.
- **No CSRF protection.** `protect_from_forgery` doesn't exist here. Safe for a
  read-only or token-authenticated endpoint; dangerous for anything a browser
  session can POST to.
- **No cookies, session, or flash.** `cookies` and `session` raise
  `NoMethodError` unless you include the modules back.
- **No `params` parsing beyond what you add**, no strong parameters, no
  `before_action` filter chain.

You can selectively re-include what you need, which is the honest middle ground:

```ruby
class TrackingController < ActionController::Metal
  include ActionController::Head          # gives you head :ok
  include AbstractController::Callbacks   # gives you before_action
  include ActionController::StrongParameters

  before_action :verify_token

  def create
    RecordEventJob.perform_later(event_params.to_h)
    head :accepted
  end

  private

  def event_params
    ActionController::Parameters.new(request.POST).permit(:name, :user_id)
  end

  def verify_token
    head :unauthorized unless request.headers["X-Token"] == ENV["INGEST_TOKEN"]
  end
end
```

Every module you add back returns some of the overhead you removed. `Metal` is
worth it for a handful of genuinely hot, genuinely simple endpoints — not as a
default base class for the whole app.

### Logging

Logging is synchronous I/O on the request path. In production, writing an
`INFO`-level line per request (plus a line per SQL query) to a disk file is
measurable overhead, and it's overhead you may already be duplicating into an
APM or log aggregator:

```ruby
# config/environments/production.rb
config.log_level = :error

# Log to STDOUT (container-friendly, no disk write, let the platform collect it)
config.logger = ActiveSupport::Logger.new($stdout)
config.logger.formatter = config.log_formatter
config.log_tags = [:request_id]
```

Raising the level to `:error` means you stop paying for per-request and per-query
log lines, at the cost of losing them for debugging. `:warn` is a common
compromise. Logging to STDOUT rather than a file removes disk I/O from the
request path and hands buffering to the platform.

### Remove Rack middleware you don't use

Every middleware in the stack is a `call(env)` on the way in and on the way out
for **every single request**. Look at the actual stack before deciding anything:

```
$ bin/rails middleware
use ActionDispatch::HostAuthorization
use Rack::Sendfile
use ActionDispatch::Static
use ActionDispatch::Executor
use Rack::Runtime
use Rack::MethodOverride
use ActionDispatch::RequestId
use ActionDispatch::RemoteIp
use ActionDispatch::Cookies
use ActionDispatch::Session::CookieStore
use ActionDispatch::Flash
run Api::Application.routes
```

Then delete them **one at a time**, running your test suite after each one:

```ruby
# config/application.rb
config.middleware.delete Rack::Sendfile
config.middleware.delete Rack::MethodOverride
config.middleware.delete ActionDispatch::Flash
config.middleware.delete ActionDispatch::Session::CookieStore
config.middleware.delete ActionDispatch::Cookies
config.middleware.delete ActionDispatch::RemoteIp
```

Common candidates for an API-only app, and why:

- **`Rack::Sendfile`** — only useful when a front-end server (nginx, Apache)
  handles `X-Sendfile`/`X-Accel-Redirect` for you. Useless if you never serve
  files through the app.
- **`ActionDispatch::Cookies`, `Session::CookieStore`, `Flash`** — a
  token-authenticated API has no session and no flash messages. Note the
  ordering dependency: `Flash` and `Session` both sit on top of `Cookies`, so
  delete them in that order or the stack breaks.
- **`Rack::MethodOverride`** — only exists so HTML forms can fake `PUT`/`DELETE`
  via a `_method` param. A JSON client sends the real verb.
- **`ActionDispatch::RemoteIp`** — does the work of walking
  `X-Forwarded-For` to find the "real" client IP. If there's no trusted proxy in
  front of the app, or you don't use `request.remote_ip` at all, it's pure cost.
  If you *do* have a proxy and *do* care about client IPs (rate limiting, abuse
  detection, geo), keep it — removing it silently degrades every one of those.

### The counter-intuitive result

Applying these levers to a Rails app, the author's own experiment ended with a
"lean Rails" build that was **25% faster than stock Sinatra**. That's worth
stating plainly, because it inverts the usual assumption: Rails' overhead is
mostly the cost of features that are loaded by default, not of Rails' core
request dispatch. Once you stop loading what you don't use, the framework isn't
the bottleneck — and a micro-framework rewrite, which costs you the entire Rails
ecosystem, would have made the app *slower* than the Rails app you already had.

## Trade-offs

- **The 28ms is real but rarely the problem.** Against a ~700ms full page load,
  eliminating all of Rails' framework overhead is a ~4% improvement that no user
  will perceive. If the actual goal is user-perceived latency, that same
  engineering time spent on caching, N+1 queries, or front-end asset delivery
  will return an order of magnitude more. Only pursue this when the metric you
  own is $/request or instances-per-throughput.
- **`ActionController::Metal` trades framework guarantees for speed.** Losing
  CSRF protection and session handling is a security posture change, not a
  performance tweak. A `Metal` controller that later grows a browser-facing POST
  action is a vulnerability waiting to happen — and the framework won't warn you,
  because you opted out of the module that would have.
  ```ruby
  class UnsafeController < ActionController::Metal
    # No protect_from_forgery here — and no error telling you it's missing.
    def update; end
  end
  ```
- **Deleted middleware fails at runtime, not at boot.** `config.middleware.delete
  ActionDispatch::Cookies` boots fine; the failure shows up the first time some
  gem, engine, or forgotten code path touches `cookies`. This is why you delete
  one at a time with a test suite between each, and why the risk scales with how
  many third-party engines you mount.
- **Cherry-picking railties makes upgrades noisier.** `rails/all` absorbs new
  frameworks automatically across major versions; an explicit require list means
  every Rails upgrade is a decision about whether to add the new railtie. That's
  arguably a feature (nothing loads without you knowing), but it is ongoing work
  that `rails/all` didn't ask of you.
- **Raising `log_level` to `:error` trades observability for I/O.** The first
  production incident where you wish you had the request log will cost more than
  the milliseconds saved. If you have an APM already capturing request traces,
  the duplication argument holds; if you don't, `:error` leaves you debugging
  blind.

## Documentation Links

- [Rails on Rack — Rails Guides](https://guides.rubyonrails.org/rails_on_rack.html) — doc
- [Configuring Rails Applications — Rails Guides](https://guides.rubyonrails.org/configuring.html) — doc
- [The Complete Guide to Rails Performance — Reducing Framework Overhead](https://pragprog.com/titles/nragilperf/the-complete-guide-to-rails-performance/) — doc
