---
version: 1.0
updatedAt: 2026-08-18
---
## Objective

Almost every Ruby program touches a regular expression, and almost every Ruby
program uses about four of the language's regex features. The rest of the
surface — `%r{}` literals, `match?` versus `=~`, the `/x` extended syntax,
named groups that become local variables, `gsub` with a Hash, `Regexp.union`
for dynamic patterns — is what turns an unreadable one-liner into something a
reviewer can check. And underneath all of it sits a security property most
developers never think about: a regex is a *program*, it can take exponential
time on a hostile input, and Ruby ships a real control for that
(`Regexp.timeout=`, since 3.2) precisely because ReDoS is a live class of
production outage, not a textbook curiosity.

## Use Cases

- Matching URLs, paths, or anything else full of `/` characters without a wall
  of `\/` escapes, using `%r{...}`.
- Testing "does this string look like X?" in a hot loop or a validation guard,
  where `match?` avoids allocating a `MatchData` and avoids writing to `$~`.
- Writing a pattern long enough to deserve comments — a date, a phone number,
  a log line — with `/x` so it can be read vertically instead of as one dense
  ribbon.
- Pulling several fields out of one string with named groups and reading them
  as `md[:year]` rather than counting parentheses to find `$3`.
- Building a pattern at runtime from configuration or user input with
  `Regexp.new` / `Regexp.union` / `Regexp.escape`.
- Rewriting text where the replacement has to be *computed* (templating,
  redaction, unit conversion) — the block form of `sub`/`gsub`.
- Accepting a search pattern from an end user, or matching untrusted input
  against a complicated pattern, and needing a hard guarantee that one request
  cannot pin a CPU core forever.

## Deep Dive

### Two literals, and the case for `%r{}`

`/pattern/` is the everyday literal. `%r{pattern}` is the same thing with a
different delimiter, and its whole reason to exist is that `/` inside the
pattern stops needing an escape:

```ruby
/https?:\/\/[^\/]+\/users\/\d+/     # leaning-toothpick syndrome
%r{https?://[^/]+/users/\d+}        # same pattern, readable
```

`%r` accepts any bracket pair (`%r{}`, `%r[]`, `%r()`, `%r!!`), and takes the
same trailing options as `/.../`. When the pattern comes from a variable at
runtime, use the constructors instead:

```ruby
Regexp.new("hello", Regexp::IGNORECASE | Regexp::EXTENDED)  # options combine with |
Regexp.escape("a.b*c")            # => "a\\.b\\*c" — treat user text as literal
Regexp.union("GET", "POST", "PUT") # => /GET|POST|PUT/
Regexp.union("a.b", /c+/).source   # => "a\\.b|(?-mix:c+)"
```

`Regexp.union` is the safe way to build "match any of these": String arguments
are escaped automatically, Regexp arguments are embedded as-is. The one
restriction worth remembering is that **capture groups inside a union have
undefined numbering** — the groups from every alternative are concatenated, so
which index holds your value depends on which branch matched:

```ruby
u = Regexp.union(/(\d+)/, /(\w+)/)
u.match("abc").captures   # => [nil, "abc"]
```

If you need captures, build the alternation yourself instead of unioning.

### `match?` is the modern boolean test

Ruby has four ways to ask whether a pattern matches, and they differ in what
they return *and* in whether they mutate hidden global state:

| Form | Returns | Populates `$~`, `$1`, `$&`? |
| --- | --- | --- |
| `re.match?(str)` | `true` / `false` | no |
| `re.match(str)` | `MatchData` or `nil` | yes |
| `re =~ str` | index or `nil` | yes |
| `re === str` | `true` / `false` | yes (used by `case`/`when`) |

```ruby
"hello".match?(/l(l)o/)   # => true
$~                        # => nil — nothing was touched

md = "hello".match(/l(l)o/)
md[0]         # => "llo"
md[1]         # => "l"
md.pre_match  # => "he"
md.post_match # => ""
```

Prefer `match?` when you only want a yes/no: it skips building the `MatchData`
and skips the bookkeeping for `$~`, so it is measurably faster in validation
code. When you *do* need the captures, use `match` and work with the returned
`MatchData` object — not the implicit globals. `$~`, `$1`, `$&`, and
`Regexp.last_match` are frame- and thread-local, which sounds safe until a
helper method you call in between quietly re-matches something and your `$1`
means something else. `=~` and `match` are not deprecated, but reading their
results out of global variables is a habit worth dropping.

### Options: `i`, `m`, `x`, `o`

```ruby
/ruby/i          # case-insensitive
/<.*>/m          # multiline: "." also matches "\n"
/\A\d+\z/x       # extended: whitespace and # comments in the pattern are ignored
/val=#{x}/o      # interpolate #{} exactly once, on first evaluation
```

`/m` in Ruby means only "`.` matches newline" — Ruby's `^`/`$` are *always*
line anchors, unlike Perl or JavaScript. Use `\A` and `\z` when you mean
"start/end of the whole string"; `/\A\d+\z/` and `/^\d+$/` are different
checks, and the second one happily accepts `"1\nrm -rf /"`.

`/x` is the option that makes long patterns reviewable:

```ruby
PHONE = /
  \A
  (?<area>\d{3})   # area code
  -
  (?<num>\d{4})    # local number
  \z
/x

PHONE.match("555-1234")&.named_captures
# => {"area" => "555", "num" => "1234"}
```

Under `/x` a literal space must be written `\ ` or `[ ]`, and a literal `#`
must be escaped.

`/o` is a footgun dressed as an optimization — it freezes the interpolation
after the first evaluation:

```ruby
def build(x) = /val=#{x}/o
build("a").source   # => "val=a"
build("b").source   # => "val=a"   <-- still the first one
```

Only use it when the interpolated value is genuinely constant for the life of
the process, and even then the win is small.

### Character classes and quantifiers

The abbreviations, each with an uppercase negated twin:

| Class | Matches | Negation |
| --- | --- | --- |
| `\d` | decimal digit | `\D` |
| `\h` | hex digit (`0-9a-fA-F`) | `\H` |
| `\s` | whitespace | `\S` |
| `\w` | word character (`[a-zA-Z0-9_]`) | `\W` |
| `\R` | generic linebreak (`\n`, `\r\n`, `\r`, Unicode) | — |
| `\X` | one full Unicode grapheme cluster | — |

`\R` and `\X` are the ones people forget and then need. `\R` matches a line
break regardless of platform, so `"a\r\nb".scan(/\R/)` yields one element, not
two. `\X` matches a whole user-perceived character, including combining marks:

```ruby
s = "e\u0301"       # "é" written as e + combining acute accent
s.length             # => 2  — two codepoints
s.scan(/./).size     # => 2
s.scan(/\X/).size    # => 1  — one grapheme
```

Quantifiers (`*`, `+`, `{m,n}`) are **greedy**: they consume as much as
possible and give characters back only when the rest of the pattern fails. A
trailing `?` makes them lazy — consume the minimum:

```ruby
"<a><b>"[/<.*>/]    # => "<a><b>"   greedy
"<a><b>"[/<.*?>/]   # => "<a>"      lazy
```

The trap that catches everyone at least once: `*` and `{0,n}` allow zero
occurrences, so a pattern built only from them **always matches**, at position
zero, with an empty string:

```ruby
"xyz" =~ /a*/          # => 0    (not nil!)
"xyz"[/a*/]            # => ""
"xyz".gsub(/a*/, "-")  # => "-x-y-z-"
```

If a validation reads `raise unless input =~ /\A\d*\z/`, it accepts the empty
string. Use `+` when you mean "at least one".

### Alternation binds last

`|` has the lowest precedence of any regex operator — lower than concatenation.
So this pattern is *not* asking about two kinds of sky:

```ruby
/red ball|angry sky/
```

It means `(red ball)|(angry sky)`. Both of these match, and `"red sky"` does
not:

```ruby
"red ball"  =~ /red ball|angry sky/    # => 0
"angry sky" =~ /red ball|angry sky/    # => 0
"red sky"   =~ /red ball|angry sky/    # => nil
"red sky"   =~ /red (ball|sky)/        # => 0
```

Always parenthesize an alternation that sits inside a larger pattern. Use a
non-capturing group `(?:...)` when you only want the scoping and not a capture.

### Named groups, and the `=~` local-variable trick

Numbered captures stop being readable at about three groups. Named groups fix
that, and they work three ways:

```ruby
md = "2026-08-18".match(/(?<year>\d{4})-(?<month>\d{2})/)
md[:year]          # => "2026"
md.named_captures  # => {"year" => "2026", "month" => "08"}
```

Inside the pattern, `\k<name>` back-references a named group — this is how you
find a duplicated word:

```ruby
"the the cat"[/\b(?<w>\w+)\s+\k<w>\b/]   # => "the the"
```

And there is one piece of genuine Ruby magic: when a regex **literal** is on
the left-hand side of `=~`, its named groups are assigned to local variables:

```ruby
if /\A(?<year>\d{4})-(?<month>\d{2})-(?<day>\d{2})\z/ =~ "2026-08-18"
  [year, month, day]   # => ["2026", "08", "18"]
end
```

This only works with a literal on the left. `re = /(?<year>\d{4})/; re =~ s`
creates nothing, and `"2026" =~ /(?<year>\d{4})/` (string on the left) creates
nothing either. It is a neat trick, but it conjures locals out of a pattern —
in shared code, `md = str.match(...)` followed by `md[:year]` is easier to
follow.

### Substitution: the Hash form and the block form

`gsub` accepts a Hash as its replacement, looking up each match as a key:

```ruby
map = Hash.new("?").merge("cat" => "gato", "dog" => "cachorro")
"cat and dog and bird".gsub(/\w+/, map)
# => "gato ? cachorro ? ?"
```

Setting a `default` on the Hash (here via `Hash.new("?")`) is what keeps
unmapped matches from becoming empty strings — a clean way to write a
translation or redaction table without a block.

When the replacement has to be computed, pass a block. The match is yielded as
a String:

```ruby
"price: 10 and 20".gsub(/\d+/) { |m| (m.to_i * 2).to_s }
# => "price: 20 and 40"
```

The block form is also the *safe* form. In a replacement **string**, `\0`/`\&`
mean "the whole match", `\1`..`\9` mean numbered groups, `` \` `` and `\'` mean
pre- and post-match — so any of those sequences appearing in your data is
interpreted rather than inserted, and getting a literal backslash through
requires counting escapes across both the Ruby string literal and the
substitution pass:

```ruby
"hello".sub(/(l+)/, '[\1]')   # => "he[ll]o"
"price".sub(/p/, '\&\&')      # => "pprice"   — \& expanded twice
"a-b".gsub(/-/, '\\\\')       # => "a\\b"     — four backslashes for one
"a-b".gsub(/-/) { "\\" }      # => "a\\b"     — block form, no double pass
```

Note that the double-quoted form is worse still, because Ruby's own escaping
happens first. If your replacement text is dynamic, use the block.

### ReDoS: why a regex can hang, and what Ruby does about it

Ruby's regex engine (Onigmo) is a backtracking engine. When a pattern can match
the same text in more than one way, a failure forces it to back up and try the
next split. Nest two quantifiers and the number of splits grows exponentially
with the input length. The textbook case is `/(a+)+b/` against a long run of
`a`s with no `b`: the outer `+` can divide 30 `a`s among its repetitions in
2^29 ways, and every one of them has to be tried before the engine can say
"no". Thirty characters, a billion attempts. That is ReDoS — a denial of
service where the payload is a short, innocuous-looking string.

Ruby has two defenses, and it is worth knowing which one covers what.

**1. Linear-time matching by memoization (Ruby 3.2+).** Ruby 3.2 added a
match cache that remembers "this position, this state, already failed", which
collapses the exponential search to linear time for most patterns. The classic
example is genuinely defused on a modern Ruby:

```ruby
# Ruby 3.4 — returns nil essentially instantly, at any length
/(a+)+b/ =~ ("a" * 1_000_000)
```

**2. `Regexp.timeout=` (Ruby 3.2+).** The optimization has holes: it is skipped
for patterns using back-references or subexpression calls (`\g<name>`), and for
inputs large enough that the cache itself would be too expensive. Those
patterns still backtrack exponentially:

```ruby
# subexpression call — NOT memoized, still exponential on Ruby 3.4
re = /\A(?<x>a|a)\g<x>*c/
re =~ ("a" * 22)   # ~0.1s
re =~ ("a" * 26)   # ~1.6s     — 4 more characters, 16x the time
re =~ ("a" * 40)   # minutes
```

So the belt-and-suspenders control is a wall-clock limit. Set it globally,
once, at boot — the default is `nil`, meaning no limit, so this is opt-in:

```ruby
Regexp.timeout = 1.0            # seconds, applies process-wide

begin
  /\A(?<x>a|a)\g<x>*c/ =~ ("a" * 40)
rescue Regexp::TimeoutError => e
  # => "regexp match timeout"
  logger.warn("regex timeout: #{e.message}")
end
```

`Regexp::TimeoutError < RegexpError < StandardError`, so a plain `rescue =>` in
a request handler catches it and you return a 400 instead of holding a worker
hostage.

A per-pattern timeout overrides the global one, which matters for the one
pattern you know is expensive — and for patterns you did not write:

```ruby
# a search box that lets users type a regex
user_re = Regexp.new(params[:q], Regexp::IGNORECASE, timeout: 0.1)
user_re.timeout   # => 0.1
Regexp.timeout    # => unchanged
```

Passing `timeout: nil` explicitly on a literal-derived Regexp means "no limit,
ignore the global" — the opposite of what you usually want. And note that the
timeout does not apply to `Regexp.new` itself, only to matching.

The rule of thumb: set a global `Regexp.timeout` in every long-running Ruby
process, keep it generous (0.5–2s) so it only fires on pathology, and treat any
`Regexp::TimeoutError` in the logs as a bug report about a pattern, not as
noise. If you accept patterns from users, add a tight per-Regexp timeout on
top.

## Trade-offs

- **`%r{}` reads better but `/.../` is what people expect** — reach for `%r`
  when the pattern contains slashes (URLs, paths) and stay with `/.../`
  otherwise; switching delimiters for a pattern with no slashes in it just adds
  a second thing to parse.
- **`match?` is faster and side-effect-free, but gives you nothing to inspect**
  — if you find yourself calling `match?` and then `match` on the same string to
  get the captures, you have paid for two matches; call `match` once and check
  the result for `nil`.
- **The `=~` named-locals trick is elegant and invisible** — variables appear
  with no assignment in sight, it silently does nothing if the regex is in a
  variable, and it only works one way round. Great in a script, questionable in
  code others maintain.
- **`/x` makes long patterns reviewable at the cost of new escaping rules** —
  spaces and `#` stop being literal, which is a fresh way to break a pattern
  that worked. Worth it above roughly two lines of pattern, rarely worth it
  below.
- **Replacement strings are terse; replacement blocks are predictable** — the
  string form is fine for a fixed `'\1-\2'` rewrite, but every backslash
  sequence is a chance for data to be interpreted as syntax. Anything dynamic
  belongs in a block.
- **Ruby's linear-time matching removes most ReDoS risk but not all of it** —
  it does not cover back-references or `\g<>` subexpression calls, and it costs
  memory proportional to pattern size times input size, so it disengages on very
  large inputs. Treating "Ruby 3.2 fixed ReDoS" as complete is exactly the
  assumption that leaves a hole.
- **`Regexp.timeout` converts a hang into an exception, which is a strictly
  better failure but still a failure** — it is a safety net, not a fix. It also
  adds a timing check to every match, and a limit set too low will fire on a
  legitimately large input under load, so pick the value with your slowest real
  workload in mind.

## Documentation Links

- [Regexp — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Regexp.html) — doc
- [MatchData — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/MatchData.html) — doc
- [Regexp.timeout= — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/Regexp.html#method-c-timeout-3D) — doc
- [String#gsub and #sub — Ruby Core docs](https://docs.ruby-lang.org/en/3.3/String.html#method-i-gsub) — doc
- [Ruby 3.2.0 release notes — ReDoS mitigations](https://www.ruby-lang.org/en/news/2022/12/25/ruby-3-2-0-released/) — doc
- [Programming Ruby 3.3 (Pickaxe) — Regular Expressions](https://pragprog.com/titles/ruby5/programming-ruby-3-3-5th-edition/) — doc
