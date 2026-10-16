---
version: 1.0
updatedAt: 2026-10-16
---
## Objective

`PUT` replaces a whole resource; a partial update needs `PATCH` and a format
that says what changes. JSON Patch (RFC 6902) is that format: an ordered list
of operations (`add`, `remove`, `replace`, `move`, `copy`, `test`) addressed
by JSON Pointer paths. ASP.NET Core 10 ships a new implementation built on
System.Text.Json in the `Microsoft.AspNetCore.JsonPatch.SystemTextJson`
package. The goal here is to apply patches safely: know what each operation
does to a C# object, what happens when an operation fails halfway, and which
fields a client must never reach. Every output below comes from the .NET 10 SDK
(10.0.100) with package version 10.0.0.

## Use Cases

- A mobile client changing one field of a large profile without sending, or
  even knowing, the rest of it.
- Appending to a list (`/tags/-`) or inserting at a position without replacing
  the whole array.
- Optimistic checks inside the request: "replace the status only if it is still
  `pending`" with a `test` operation.
- Migrating an older API from the Newtonsoft-based `JsonPatchDocument` to the
  System.Text.Json one.

## Deep Dive

### PUT, PATCH and the two patch formats

`PUT` is idempotent and carries the full representation, so an omitted field
means "set to default" (see the REST semantics concept). `PATCH` carries a
description of changes and is not idempotent in general: `add` to `/tags/-`
twice appends twice. Two media types are common:

- **JSON Patch**, `application/json-patch+json`: explicit operations, supports
  arrays, moves and preconditions.
- **JSON Merge Patch** (RFC 7396), `application/merge-patch+json`: a partial
  document where `null` means "delete". Simpler for clients, but it cannot
  address array items, and ASP.NET Core has no built-in support for it.

### Applying a patch to an object

```csharp
#:package Microsoft.AspNetCore.JsonPatch.SystemTextJson@10.0.0
#:property PublishAot=false
using System.Text.Json;
using Microsoft.AspNetCore.JsonPatch.SystemTextJson;

var web = new JsonSerializerOptions(JsonSerializerDefaults.Web);
var p = new Profile { Name = "Ana", Email = "ana@x.io", Age = 30, Tags = ["a"] };
var ok = JsonSerializer.Deserialize<JsonPatchDocument<Profile>>("""
[
  { "op": "replace", "path": "/name", "value": "Ana Lima" },
  { "op": "remove",  "path": "/age" },
  { "op": "add",     "path": "/tags/-", "value": "b" },
  { "op": "add",     "path": "/tags/0", "value": "first" },
  { "op": "copy",    "from": "/name", "path": "/email" }
]
""", web)!;
ok.ApplyTo(p);
Console.WriteLine(JsonSerializer.Serialize(p, web));
// {"name":"Ana Lima","email":"Ana Lima","age":0,"tags":["first","a","b"]}

class Profile
{
    public string? Name { get; set; }
    public string? Email { get; set; }
    public int Age { get; set; }
    public List<string> Tags { get; set; } = [];
}
```

Three details from that output. `remove` on a property cannot delete it from a
C# class, so `Age` went back to its default, `0`. `-` means "end of the array"
and an index inserts before that position. And the paths are lower case only
because the document was deserialized with the web defaults
(`PropertyNameCaseInsensitive`); with default `JsonSerializerOptions`, the same
`/name` failed with "The target location specified by path segment 'name' was
not found." The typed builder avoids the guessing:
`new JsonPatchDocument<Profile>().Replace(x => x.Name, "Bia")` produced the
path `/Name`.

`PublishAot=false` is there because file-based apps default to Native AOT,
and the first run failed with "Reflection-based serialization has been
disabled". `ApplyTo` and the patch converter rely on reflection over your
model, so plan for that if the API is meant to be trimmed or AOT-compiled.

### Failure is not atomic

The patch below changes the email, then tests the name, then changes the age.
The test fails. What happens depends on how `ApplyTo` is called:

```csharp
// [ replace /email, test /name == "Bob" (fails), replace /age 99 ]
var errors = new List<string>();
bad.ApplyTo(p, e => errors.Add($"{e.Operation.op} {e.Operation.path}: {e.ErrorMessage}"));
// test /name: The current value 'Ana Lima' at path 'name' is not equal to the test value 'Bob'.
// {"name":"Ana Lima","email":"new@x.io","age":99,...}
```

With an error callback, the failing operation is reported and **the remaining
operations still run**: the age became 99 after the test failed. Without a
callback, `ApplyTo` threw `JsonPatchException` at the test, and the email
change made before it stayed on the object. The docs say it plainly: the
target is modified in place, and discarding changes is the caller's job. The
PATCH method itself (RFC 5789) requires the server to apply the whole set of
changes atomically, and RFC 6902 says a failed operation means the patch as a
whole did not succeed, so the server has to provide atomicity itself, usually
by patching a copy.

### A safe PATCH endpoint

The parameter type matters for security as much as the error handling. Patch a
DTO that contains only the fields clients may change, validate it, and copy it
onto the entity only when everything succeeded:

```csharp
app.MapPatch("/users/{id:int}", (int id, JsonPatchDocument<UserPatch> patch) =>
{
    if (!users.TryGetValue(id, out var user)) return Results.NotFound();
    if (patch.Operations.Count > 20 || patch.Operations.Any(o => o.OperationType == OperationType.Copy))
        return Results.BadRequest("too many operations or copy not allowed");

    var dto = new UserPatch { Name = user.Name, Email = user.Email };   // work on a copy
    var errors = new Dictionary<string, string[]>();
    patch.ApplyTo(dto, e => errors[e.Operation.path ?? "patch"] = [e.ErrorMessage]);
    if (errors.Count > 0) return Results.ValidationProblem(errors);

    var results = new List<ValidationResult>();
    if (!Validator.TryValidateObject(dto, new ValidationContext(dto), results, true))
        return Results.ValidationProblem(results.ToDictionary(r => r.MemberNames.First(), r => new[] { r.ErrorMessage! }));

    user.Name = dto.Name!; user.Email = dto.Email!;                       // commit only on success
    return Results.Ok(user);
});

public class UserPatch
{
    [Required, MaxLength(20)] public string? Name { get; set; }
    [Required, EmailAddress] public string? Email { get; set; }
}
```

`User` also has `IsAdmin`, which `UserPatch` does not. Requests against the
running app:

```text
json-patch+json  replace /name "Ana Lima"                 -> 200 {"id":1,"name":"Ana Lima",...}
application/json replace /email                           -> 415
json-patch+json  replace /isAdmin true                    -> 400 "path segment 'isAdmin' was not found"
json-patch+json  replace /name "Bia", /email "not-an-email" -> 400 Email is not a valid e-mail address
json-patch+json  replace /name "Bia", test /email "zzz"   -> 400 test value 'zzz'
json-patch+json  copy /name -> /email                     -> 400 copy not allowed
json-patch+json  {"name":"merge style"}                   -> 400 (body is not an array)
final state: {"id":1,"name":"Ana Lima","email":"ana@x.io","isAdmin":false}
```

The 415 is worth knowing: binding a `JsonPatchDocument<T>` makes the endpoint
accept only `application/json-patch+json`, and routing rejected plain
`application/json` before the handler ran. The two failed patches that started
with `replace /name "Bia"` left no trace, because they changed the copy. Had
the parameter been `JsonPatchDocument<User>`, the `isAdmin` request would have
succeeded.

### The threats the framework does not handle

The docs state that JSON Patch has inherent risks and that the implementation
does not try to mitigate them. The ones they list:

- **Memory amplification**: repeated `copy` of a large subtree. Limit operation
  count and kinds before calling `ApplyTo`, as the endpoint does.
- **Business logic subversion**: operations on IDs, flags or computed fields.
  Patch a DTO with only safe properties, or validate invariants after applying.
- **Missing authorization**: PATCH endpoints need the same authentication and
  authorization as any write.

They also note algorithmic cost: inserting at index 0 of a large list shifts
every element, on every operation.

### Merge patch and the null problem

Binding a merge patch body to a DTO with nullable properties loses information,
because "field absent" and "field set to null" both become `null`:

```text
{}               dto.Email=null  sent=False kind=Undefined
{"email":null}   dto.Email=null  sent=True kind=Null
```

Only reading the raw `JsonElement` (`TryGetProperty`) tells the two apart. If
you choose merge patch, parse the body as a `JsonDocument` or `JsonNode`, or
model each field as "maybe present"; do not rely on nullable DTO properties.

### Migrating from the Newtonsoft package

The new types live in `Microsoft.AspNetCore.JsonPatch.SystemTextJson`. Per the
"What's new" page, it is faster and allocates less, but it is not a drop-in
replacement: it does not support dynamic types such as `ExpandoObject`. It also
follows System.Text.Json conventions (case sensitivity, number handling), so
paths that worked with Newtonsoft's case-insensitive defaults can start
failing. Test existing clients against the new package before switching.

## Trade-offs

- **JSON Patch versus merge patch.** JSON Patch is explicit and handles arrays
  and preconditions; merge patch is what most front ends find natural, but it
  needs manual parsing in ASP.NET Core and cannot touch array items.
- **PATCH versus PUT.** PATCH saves bandwidth and avoids lost updates on
  untouched fields, at the price of more server code, no idempotency for some
  operations, and atomicity you implement yourself.
- **Patch the entity versus a DTO.** Patching the entity is less code and
  exposes every property, including the ones that should never change.
  ```csharp
  JsonPatchDocument<UserPatch>   // not JsonPatchDocument<User>
  ```
- **`test` versus ETags.** A `test` operation is a precondition inside the
  body; `If-Match` with an ETag is the HTTP-level version and works for every
  method. Both need the server to reject on mismatch.
- **Reflection.** The package is reflection-based, which conflicts with
  trimming and Native AOT goals for the API.

## Documentation Links

- [JsonPatch in ASP.NET Core web API, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/jsonpatch) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [JsonPatchDocument<TModel> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.jsonpatch.systemtextjson.jsonpatchdocument-1) (doc)
- [RFC 6902: JavaScript Object Notation (JSON) Patch, IETF](https://datatracker.ietf.org/doc/html/rfc6902) (doc)
- [RFC 7396: JSON Merge Patch, IETF](https://datatracker.ietf.org/doc/html/rfc7396) (doc)
