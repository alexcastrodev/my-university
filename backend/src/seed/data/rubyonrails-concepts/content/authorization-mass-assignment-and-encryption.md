---
version: 1.0
updatedAt: 2026-08-21
---
## Objective

Three separate security decisions get conflated into "add auth" on most Rails
projects: *who can do this* (authorization), *what fields can they set*
(mass assignment), and *what's actually readable if the database leaks*
(encryption at rest). Each has a well-known Rails answer, and each has a
well-known way to get it wrong that ships clean, passes review, and only
shows up when someone forges a param you didn't expect, dumps a Postgres
table, or reads a support ticket that pastes a raw SQL query with a
plaintext SSN in it. This concept is about the concrete API decisions —
Pundit vs CanCanCan, `permit` vs `permit!`, deterministic vs
non-deterministic encryption — not "add authorization to your app," which
every Rails app already claims to have.

## Use Cases

- Choosing between Pundit and CanCanCan for a new app, or deciding whether
  an existing CanCanCan `Ability` class has outgrown its format and needs to
  become policy objects.
- Reviewing a PR that adds `accepts_nested_attributes_for` to a model and
  catching that the corresponding strong-params call silently reopens a
  mass-assignment hole on the association.
- Deciding whether a column (SSN, bank account number, email) needs
  `encrypts`, and if so, whether it needs to stay queryable — which
  determines deterministic vs non-deterministic and whether you need a
  blind index.
- Auditing `config/initializers/session_store.rb` and
  `config/application.rb` for `cookies_serializer` before a security review,
  because `:marshal` on an app whose `secret_key_base` has ever leaked (a
  committed `.env`, a Heroku config dump, a Sentry breadcrumb) is a directly
  exploitable deserialization path, not a theoretical one.
- Explaining to a security auditor exactly what `permit!` on a controller
  action means in terms of blast radius, instead of "it's fine, we validate
  in the model."

## Deep Dive

### Pundit vs CanCanCan

Both solve "does this user get to do this," but they put the boilerplate in
different places. Same model, both styles:

**Pundit** — one policy class per model, called explicitly at every action:

```ruby
# app/policies/post_policy.rb
class PostPolicy < ApplicationPolicy
  def update?
    user.admin? || (post.user == user && !post.published?)
  end

  class Scope < ApplicationPolicy::Scope
    def resolve
      user.admin? ? scope.all : scope.where(published: true)
    end
  end
end
```

```ruby
class PostsController < ApplicationController
  def index
    @posts = policy_scope(Post)
  end

  def update
    @post = Post.find(params[:id])
    authorize @post
    @post.update(post_params)
  end
end

class ApplicationController < ActionController::Base
  after_action :verify_authorized, except: :index
  after_action :verify_policy_scoped, only: :index
end
```

`authorize @post` infers the policy class (`PostPolicy`) and the action
(`update?` from the controller action name) and raises
`Pundit::NotAuthorizedError` on failure. `policy_scope(Post)` delegates to
the policy's nested `Scope` class. `verify_authorized` /
`verify_policy_scoped` are development-time guards that fail loudly if you
add an action and forget to call `authorize` — Pundit gives you no implicit
enforcement, so it gives you a way to catch yourself forgetting.

**CanCanCan** — one `Ability` class per user, checked implicitly by a
controller macro:

```ruby
# app/models/ability.rb
class Ability
  include CanCan::Ability

  def initialize(user)
    can :read, Post, published: true
    return if user.nil?
    can :update, Post, user: user
    can :manage, Post if user.admin?
  end
end
```

```ruby
class PostsController < ApplicationController
  load_and_authorize_resource

  def update
    # @post already loaded via Post.find(params[:id]) AND authorized —
    # a CanCan::AccessDenied is raised before this line runs if it fails.
    @post.update(post_params)
  end

  def index
    # @posts is already scoped to Post.accessible_by(current_ability)
  end
end
```

`load_and_authorize_resource` infers the model from the controller name,
loads the record, and calls `authorize!` on it automatically — there's no
explicit call in the action body at all. `accessible_by(current_ability)`
does for `index` what `policy_scope` does explicitly in Pundit, but again
implicitly, wired in by the macro.

**Where each breaks down.** CanCanCan's single `Ability` class is genuinely
nice for simple, uniform rules — but every additional role or exception
becomes another line of `can`/`cannot` with a hash of conditions, and that
file becomes a single point of merge conflicts and a place where rule
*interaction* (does a later `cannot` override an earlier `can`? — yes, but
you have to know that) gets hard to audit past a few dozen rules. Pundit's
one-class-per-model avoids that concentration, but you pay per-model
boilerplate (`initialize`, `attr_reader`, a `Scope` class) for every model
that needs authorization, even trivial ones, and "does this controller
action check authorization" is only as reliable as `verify_authorized`
catching the omission in every environment that runs it (typically not
production). Neither library authorizes anything for you if you don't call
into it — CanCanCan's implicit hook just means the call site is a
controller macro instead of a method call in the action body.

### Strong parameters: past the `permit`/`require` basics

`permit!` and nested attributes are where strong parameters actually fail
in practice, past the introductory `params.require(:post).permit(:title)`
example.

**`permit!` disables filtering entirely.** It doesn't grant additional
permissions carefully — it marks the whole params hash (and, recursively,
every nested hash inside it) as permitted, with no allowlist at all:

```ruby
# Never do this with user-supplied params:
def update
  @post.update(params.require(:post).permit!)
end
```

If `Post` ever gains a new attribute — `admin_notes`, `featured`,
`user_id` — this action lets any caller set it the moment the migration
runs, with zero code change and zero review flag on the controller. It is
the mass-assignment hole strong parameters exists to close, reopened with
one method call. Legitimate uses are narrow: trusted, non-user-facing
params you constructed yourself (e.g. re-permitting a hash you built in a
Rake task), never request params.

**`accepts_nested_attributes_for` is a real mass-assignment vector.** This
is the pattern behind several real Rails mass-assignment CVEs from before
strong parameters existed by default, and it's still just as exploitable
today if the nested permit list is too generous:

```ruby
class Book < ApplicationRecord
  has_many :chapters
  accepts_nested_attributes_for :chapters
end
```

```ruby
# Looks reasonable, is not:
def book_params
  params.require(:book).permit(:title, chapters_attributes: [:title, :id, :book_id])
end
```

Permitting `:book_id` inside `chapters_attributes` lets a request reparent
an *existing* chapter (referenced by `:id`) onto a different book the
current user doesn't own, just by submitting someone else's chapter ID with
a different `book_id`. The fix is to permit only what the client should
control (`:id`, `:title`, `:_destroy`) and never a foreign key that
establishes ownership — ownership assignment belongs in the controller
(`current_user.books.find(...)`), not in the params whitelist. Current Rails
guides show the nested-array shorthand as:

```ruby
params.expect(book: [:title, chapters_attributes: [[:title, :id]]])
```

**Missing-required vs missing-permitted are different failures.**
`params.require(:post)` raises `ActionController::ParameterMissing` if the
key is absent, `nil`, blank, or an empty hash — Rails' default exception
handling turns that into a **400 Bad Request**, not a 500. It's a client
error by design, because a required top-level param missing means the
request itself is malformed. A permitted-but-absent key behaves completely
differently: `permit(:title, :subtitle)` on a hash with no `:subtitle`
simply omits it from the result — no exception, `post_params[:subtitle]` is
`nil`, and `update` just doesn't touch that column. Confusing the two —
expecting a 500 for a missing optional field, or not expecting a 400 for a
missing required one — is a common source of "why did this request fail in
staging but not locally" when a client drops an optional field.

### ActiveRecord::Encryption

Rails 7 ships attribute-level encryption at rest without an external gem:

```ruby
class Author < ApplicationRecord
  encrypts :email, deterministic: true
  encrypts :notes  # non-deterministic (default)
end
```

**Deterministic vs non-deterministic is a queryability-vs-leakage
trade-off, not a strength trade-off.** Non-deterministic encryption (the
default) produces different ciphertext for the same plaintext every time —
`Author.where(email: "x")` cannot match anything, because there is no stable
ciphertext to compare against. Deterministic encryption (`deterministic:
true`) always produces the same ciphertext for the same plaintext, which
makes `Author.find_by(email: "tolkien@example.com")` work again — but it
also means two rows with the same encrypted value are visibly the same to
anyone with database access, even without the key: an attacker (or a
curious DBA) can tell which rows share an email, count how many users share
a value, or correlate it against ciphertext seen elsewhere, without
decrypting anything. That's the leak deterministic mode accepts in exchange
for `WHERE`.

**Blind indexes are how you query a deterministic column without exposing
that column directly to comparison at all** — in practice, this is what
`deterministic: true` combined with Rails' own encrypted-attribute equality
support already gives you for simple lookups; for cross-referencing schemes
or matching against externally-hashed values, the pattern is to maintain a
separate indexed column holding a keyed hash of the plaintext and query
that column instead of the encrypted one, so the encrypted column itself
never appears in a `WHERE` clause.

**Key management** comes from three keys, generated with `bin/rails
db:encryption:init` and stored under `active_record_encryption` in Rails
credentials:

```yaml
active_record_encryption:
  primary_key: <random>
  deterministic_key: <random>
  key_derivation_salt: <random>
```

`primary_key` derives the key used for non-deterministic encryption,
`deterministic_key` for deterministic encryption, and `key_derivation_salt`
is used in deriving both. Losing these means losing every encrypted value
in the database, irrecoverably — they belong in the same tier of secret as
`secret_key_base`, not in a repo, and ideally rotated through
`config.active_record.encryption.primary_key` accepting an array so old and
new keys both decrypt during rotation.

**What breaks on an already-indexed or unique column.** A database-level
unique index or `validates :email, uniqueness: true` on a column you then
encrypt with `encrypts :email` (non-deterministic) breaks immediately: the
database is now comparing ciphertext that's different on every write, so a
unique index enforces nothing (every value looks unique) and a Rails
`uniqueness: true` validation queries `WHERE email = ?` with plaintext but
compares against columns that never equal each other. The column has to be
`deterministic: true` for either the database index or the Rails validation
to mean anything again — and switching an existing column from
non-deterministic to deterministic (or changing `key_derivation_salt`)
requires re-encrypting every existing row, since the stored ciphertext for
old rows won't match new deterministic ciphertext for the same value.

### Session and cookie hardening

**The encrypted cookie store's 4 kB limit is a hard cap, not a soft
warning.** `ActionDispatch::Session::CookieStore` is the Rails default and
stores the entire session, encrypted, in the cookie itself — no server-side
session table. Cookies are capped at 4 kB by the HTTP spec/browsers, and
Rails doesn't chunk or compress around that: push a `session[:cart_items]`
array past the limit and the write silently fails or truncates depending on
what wrote it, which surfaces as intermittently missing session data in
production with no exception raised at the point of assignment. The fix is
either keeping the session genuinely small (IDs, not objects) or switching
`config.session_store` to a server-side store (`:cache_store`, a database
store) for apps that need to hold more per-user state.

**`SameSite` and `secure` are separate protections with separate
defaults.** Rails cookies default to `same_site: :lax` — sent on top-level
navigation but withheld from cross-site subrequests (a cross-origin `<img>`
or fetch), which blocks a class of CSRF-adjacent attacks at the cookie
layer. The `secure` flag (cookie only sent over HTTPS) defaults to `false`
at the `ActionDispatch::Cookies` level, so it depends on
`config.force_ssl`/environment config actually setting it — an app that
serves both HTTP and HTTPS in some environment (a staging box without TLS
termination configured correctly) can silently ship session cookies over
plaintext if nothing sets `secure: true` explicitly for that environment.
(The request-forgery-token side of session security — the CSRF meta tag and
why it defeats HTTP caching — is covered in
[Resource Hints, HTTP/2, and the CSRF Cache Problem](resource-hints-http2-and-the-csrf-cache-problem).)

**`cookies_serializer` is where a config default becomes a real
vulnerability class.** `config.action_dispatch.cookies_serializer` controls
how `ActionDispatch::Cookies`/session values are serialized; `:json` is the
default for new Rails apps (since Rails 4.1, which switched away from
`:marshal` specifically for this reason). `:marshal` deserializes with
`Marshal.load`, which — unlike JSON — can be made to instantiate arbitrary
Ruby objects from the serialized payload. If an attacker ever obtains
`secret_key_base` (a leaked `.env`, a committed credentials file, a config
dump from a misconfigured deploy platform), they can forge a validly-signed
session cookie containing a crafted Marshal payload; documented
Marshal-deserialization gadget chains in Ruby/Rails have been used in the
past to turn that into remote code execution, which is the actual reason
`:json` became the default rather than an arbitrary hardening choice. An
app that still sets `cookies_serializer = :marshal` (inherited from a
pre-4.1 upgrade, or set deliberately for a type `:json` can't round-trip)
should treat `secret_key_base` compromise as an RCE, not just a
session-forgery risk, and prioritize migrating off `:marshal` accordingly.

## Trade-offs

- **Neither Pundit nor CanCanCan protects an action you forget to
  authorize.** Pundit's `verify_authorized` only fails loudly if it's wired
  into `ApplicationController` and actually runs in the environment that
  matters; CanCanCan's `load_and_authorize_resource` protects only the
  actions it's declared on — a hand-rolled custom action in the same
  controller gets none of it for free:
  ```ruby
  class PostsController < ApplicationController
    load_and_authorize_resource  # covers index/show/create/update/destroy

    def publish  # custom action — NOT covered, no authorization check at all
      @post.update!(published: true)
    end
  end
  ```
- **`permit!` and an over-permissive nested-attributes list look identical
  in a diff** — both are one line, both pass tests that only exercise the
  happy path, and neither fails until someone sends a param your test suite
  never tried. Review strong-params changes for what they *don't* filter,
  not just what they do.
- **Deterministic encryption is a real information leak, not just "slightly
  weaker."** Anyone with row-level database access — a support engineer
  running a manual query, a compromised read replica credential — can see
  which encrypted rows share a value, without ever having the encryption
  key. That's frequently an acceptable trade for `WHERE email = ?`, but it
  should be a deliberate choice per column, not the default reached for
  because non-deterministic broke a query.
- **Rotating `active_record_encryption` keys is not free** — every existing
  row stays encrypted under the old key until re-encrypted, and Rails only
  tries multiple keys on *decrypt*; new writes always use the newest key.
  A key believed compromised still requires an explicit re-encryption pass
  over historical data, not just a config change, before you can consider
  the old value fully rotated out.
- **`cookies_serializer = :marshal` is a config line, not a feature flag** —
  it reads like an implementation detail until `secret_key_base` leaks, at
  which point it's the difference between a session-forgery incident and a
  remote-code-execution incident. If it's set for legacy reasons, confirm
  what's actually stored in the session before assuming a straight switch
  to `:json` is safe — anything that isn't JSON-representable (a custom
  object, a Symbol-keyed structure relied on elsewhere) will round-trip
  differently or fail silently after the switch.

## Documentation Links

- [Pundit — GitHub](https://github.com/varvet/pundit) — doc
- [CanCanCan — GitHub](https://github.com/CanCanCommunity/cancancan) — doc
- [Action Controller Overview — Strong Parameters, Session — Rails Guides](https://guides.rubyonrails.org/action_controller_overview.html) — doc
- [Active Record Encryption — Rails Guides](https://guides.rubyonrails.org/active_record_encryption.html) — doc
- [Security — Rails Guides](https://guides.rubyonrails.org/security.html) — doc
- [ActionController::Parameters — Rails API](https://api.rubyonrails.org/classes/ActionController/Parameters.html) — doc
- [ActionDispatch::Cookies — Rails API](https://api.rubyonrails.org/classes/ActionDispatch/Cookies.html) — doc
