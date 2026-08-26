---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Rack is the standard interface between a Ruby web server and a Ruby web
framework. It decouples the two sides: the server only has to know how to build
a request hash and consume a response, and the framework only has to know how to
answer one method. A "Rack app" is any object that responds to `call(env)` and
returns a three-element array `[status, headers, body]`. That is the whole
contract — and it is why Rails, Sinatra, Roda, and Hanami can all run on Puma,
and why a middleware written for one of them usually works in the others.

## Use Cases

- Writing cross-cutting request logic — timing, request IDs, authentication,
  rate limiting, health-check short circuits — as middleware instead of as a
  framework-specific `before_action` or filter.
- Reusing a middleware you wrote for a Rails app inside a small Sinatra or Roda
  service, without rewriting it.
- Mounting several apps in one process (`map "/admin" { run AdminApp }`), or
  putting a tiny Rack lambda in front of a full framework for a fast path.
- Debugging "where did this header come from?" in a Rails app by reading the
  middleware stack (`bin/rails middleware`) rather than searching controllers.
- Testing a web layer without booting a server, by calling the app object
  directly with a hand-built `env` hash.

## Deep Dive

### The contract is one method

```ruby
class HelloApp
  def call(env)
    body = ["Hello from #{env["PATH_INFO"]}\n"]
    [200, { "content-type" => "text/plain" }, body]
  end
end
```

- `env` is a plain Hash with CGI-style keys (`REQUEST_METHOD`, `PATH_INFO`,
  `QUERY_STRING`, `SERVER_NAME`, `HTTP_*` for request headers) plus Rack-specific
  ones (`rack.input` for the request body stream, `rack.errors`, `rack.url_scheme`).
  It is a mutable hash, which is how middleware passes data down the stack.
- `status` is an Integer (>= 100), not a string.
- `headers` is a hash-like object. In **Rack 3 the keys must be lowercase**
  (`"content-type"`, not `"Content-Type"`), and a value may be an Array when a
  header legitimately repeats (several `set-cookie` values, for example).
- `body` must respond to `each`, yielding String chunks. An Array of strings is
  the simplest valid body; anything with an `each` works, which is how file
  bodies and enumerator-backed responses are done. Rack 3 also allows a
  *streaming* body: an object responding to `call(stream)` that writes to the
  stream itself, for SSE and long-lived responses.

Because the contract is just "responds to `call`", a lambda is a valid Rack app:

```ruby
app = ->(env) { [200, { "content-type" => "text/plain" }, ["ok\n"]] }
app.call({}) # => [200, {"content-type"=>"text/plain"}, ["ok\n"]]
```

### `config.ru`: `run` mounts, `use` stacks

A `config.ru` file is ordinary Ruby evaluated in the context of
`Rack::Builder`, which gives it three main verbs:

```ruby
# config.ru
require_relative "request_timer"

use Rack::CommonLogger   # outermost
use RequestTimer         # then this
run HelloApp.new         # finally the app itself
```

- `run` sets the **final** app — the innermost layer, called last.
- `use` pushes a middleware **around** everything declared after it, so the
  first `use` is the outermost wrapper. A request travels down the stack and the
  response travels back up through the same layers in reverse.
- `map "/prefix" do ... end` mounts a nested builder under a path prefix.

### Writing a middleware

A middleware is just a Rack app that was handed the *next* Rack app at
construction time:

```ruby
class RequestTimer
  def initialize(app)
    @app = app
  end

  def call(env)
    started = Process.clock_gettime(Process::CLOCK_MONOTONIC)
    status, headers, body = @app.call(env)
    elapsed = Process.clock_gettime(Process::CLOCK_MONOTONIC) - started

    headers["x-runtime"] = format("%.6f", elapsed)
    env["app.runtime"] = elapsed   # available to outer middleware on the way back
    [status, headers, body]
  end
end
```

Everything before `@app.call(env)` transforms the *request*; everything after it
transforms the *response*. That is the entire mental model.

Note the subtlety: this measures time until the headers come back, not until the
body is fully written to the socket. A lazy body (a file, an enumerator, a
streaming response) is iterated by the server *after* your middleware has
already returned. Rack's own `Rack::Runtime` has exactly this characteristic.

A middleware can also decide not to call the next app at all — that is how
authentication, maintenance modes, and health checks short-circuit:

```ruby
class HealthCheck
  def initialize(app, path: "/up")
    @app = app
    @path = path
  end

  def call(env)
    return [200, { "content-type" => "text/plain" }, ["ok\n"]] if env["PATH_INFO"] == @path

    @app.call(env)
  end
end
```

`use HealthCheck, path: "/healthz"` passes the extra arguments straight through
to `initialize`, after the app.

### Every framework is a Rack app underneath

- **Rails**: `Rails.application` responds to `call(env)`. Most of what feels
  like "Rails" at the edges — static file serving, `Rack::Runtime`, the session
  and cookie layers, `ActionDispatch::ShowExceptions` — is middleware you can
  list with `bin/rails middleware` and insert into with
  `config.middleware.use`/`insert_before`.
- **Sinatra** is a framework built directly on Rack, trading Rails' structure
  for route blocks:

  ```ruby
  require "sinatra"

  get "/hello/:name" do
    "Hello, #{params["name"]}!"
  end
  ```

  The block's return value becomes the response body; Sinatra assembles the
  `[status, headers, body]` triple for you. Roda and Hanami make different
  routing choices over the same interface.

Because they all terminate in the same three-element array, a middleware only
depends on Rack — not on the framework — which is precisely why it is portable.

### Where the app server fits

Below Rack sits the application server (Puma, Unicorn, Passenger). Its job is to
speak HTTP, build the `env` hash, call your Rack app, and write the response
back. Rack is the seam that lets you swap that server without touching
application code; the servers differ in their process/thread/I-O models, which
is a separate decision covered in the application-server concept.

## Trade-offs

- **Middleware is portable, but it works below the framework's abstractions** —
  inside `call(env)` you have a raw hash, not parsed params, a current user, or
  a controller instance. `Rack::Request.new(env)` gives you a friendlier reader,
  but anything framework-specific has to be re-derived or read out of `env` keys
  the framework happens to set. Logic that needs the framework's context belongs
  in the framework, not in middleware.
- **Every layer taxes every request** — the stack is called in order for all
  traffic, including assets and health checks. A middleware that parses a body
  or hits a store on each request is doing so for requests that will never use
  the result; guard early and return fast.
- **Response bodies are lazy, so "after the call" is not "after the response"** —
  middleware that logs, times, or cleans up resources after `@app.call(env)`
  runs before a streaming or file body has been sent. Rack's `body.close`
  contract (and `Rack::BodyProxy`) exists for work that must happen once the
  body is genuinely finished.
- **Rack 3 broke assumptions from Rack 2** — header keys became lowercase,
  multi-value headers became Arrays instead of newline-joined strings, and the
  `rackup` command plus the `Rack::Handler` namespace moved into a separate
  `rackup` gem. Middleware that writes `headers["Content-Type"]` or splits on
  `"\n"` is Rack-2 code. `Rack::Lint` in development catches most of these
  violations early.
- **`use` order is real coupling** — a middleware that must see the session, or
  must run before the response is compressed, has a required position in the
  stack. That ordering is easy to break silently when a layer is inserted
  elsewhere, and it is not expressed anywhere except the order of lines in
  `config.ru` or the Rails initializer.

## Documentation Links

- [Rack — GitHub (README and SPEC)](https://github.com/rack/rack) — doc
- [Rack API documentation — RubyDoc.info](https://www.rubydoc.info/github/rack/rack) — doc
- [Rails on Rack — Ruby on Rails Guides](https://guides.rubyonrails.org/rails_on_rack.html) — doc
- [Sinatra — Intro and README](https://sinatrarb.com/intro.html) — doc
- [Programming Ruby 3.3 (Pickaxe) — Ruby and the Web: Rack](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
