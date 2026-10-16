---
version: 1.0
updatedAt: 2026-10-16
title: "JSON Patch e Atualizações Parciais"
summary: PUT versus PATCH, as operações do RFC 6902 aplicadas a objetos C# com o novo pacote baseado em System.Text.Json do .NET 10, por que a falha no meio do patch não desfaz nada, um endpoint PATCH seguro com DTO e validação, as ameaças que o framework não trata e merge patch como alternativa.
---
## Objective

`PUT` substitui o recurso inteiro; uma atualização parcial precisa de `PATCH` e
de um formato que diga o que muda. JSON Patch (RFC 6902) é esse formato: uma
lista ordenada de operações (`add`, `remove`, `replace`, `move`, `copy`,
`test`) endereçadas por caminhos JSON Pointer. O ASP.NET Core 10 traz uma
implementação nova, construída sobre System.Text.Json, no pacote
`Microsoft.AspNetCore.JsonPatch.SystemTextJson`. O objetivo aqui é aplicar
patches com segurança: saber o que cada operação faz com um objeto C#, o que
acontece quando uma operação falha no meio, e quais campos o cliente nunca pode
alcançar. Todas as saídas abaixo vieram do SDK do .NET 10 (10.0.100) com o
pacote na versão 10.0.0.

## Use Cases

- Um cliente mobile mudando um campo de um perfil grande sem mandar, nem
  conhecer, o resto dele.
- Acrescentar a uma lista (`/tags/-`) ou inserir numa posição sem substituir o
  array inteiro.
- Checagem otimista dentro da requisição: "troque o status só se ele ainda for
  `pending`", com uma operação `test`.
- Migrar uma API antiga do `JsonPatchDocument` baseado em Newtonsoft para o de
  System.Text.Json.

## Deep Dive

### PUT, PATCH e os dois formatos de patch

`PUT` é idempotente e carrega a representação completa, então um campo omitido
significa "volte ao padrão" (veja o conceito de semântica REST). `PATCH`
carrega uma descrição das mudanças e, em geral, não é idempotente: um `add` em
`/tags/-` duas vezes acrescenta duas vezes. Dois media types são comuns:

- **JSON Patch**, `application/json-patch+json`: operações explícitas, suporta
  arrays, move e pré-condições.
- **JSON Merge Patch** (RFC 7396), `application/merge-patch+json`: um documento
  parcial em que `null` significa "apague". Mais simples para o cliente, mas não
  endereça itens de array, e o ASP.NET Core não tem suporte nativo a ele.

### Aplicando um patch a um objeto

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

Três detalhes nessa saída. `remove` numa propriedade não consegue apagá-la de
uma classe C#, então `Age` voltou ao padrão, `0`. `-` significa "fim do array",
e um índice insere antes daquela posição. E os caminhos funcionam em minúsculas
só porque o documento foi desserializado com os padrões web
(`PropertyNameCaseInsensitive`); com `JsonSerializerOptions` padrão, o mesmo
`/name` falhou com "The target location specified by path segment 'name' was
not found." O builder tipado evita o chute:
`new JsonPatchDocument<Profile>().Replace(x => x.Name, "Bia")` gerou o caminho
`/Name`.

O `PublishAot=false` está ali porque file-based apps usam Native AOT por
padrão, e a primeira execução falhou com "Reflection-based serialization has
been disabled". O `ApplyTo` e o converter do patch dependem de reflection sobre
o seu modelo, então leve isso em conta se a API precisa ser trimmed ou
compilada com AOT.

### A falha não é atômica

O patch abaixo muda o email, depois testa o nome, depois muda a idade. O teste
falha. O resultado depende de como o `ApplyTo` é chamado:

```csharp
// [ replace /email, test /name == "Bob" (fails), replace /age 99 ]
var errors = new List<string>();
bad.ApplyTo(p, e => errors.Add($"{e.Operation.op} {e.Operation.path}: {e.ErrorMessage}"));
// test /name: The current value 'Ana Lima' at path 'name' is not equal to the test value 'Bob'.
// {"name":"Ana Lima","email":"new@x.io","age":99,...}
```

Com callback de erro, a operação que falhou é reportada e **as operações
seguintes continuam rodando**: a idade virou 99 depois do teste falhar. Sem
callback, o `ApplyTo` lançou `JsonPatchException` no teste, e a troca de email
feita antes dele ficou no objeto. A doc diz com todas as letras: o alvo é
modificado no lugar, e descartar as mudanças é responsabilidade de quem chama.
O próprio método PATCH (RFC 5789) exige que o servidor aplique o conjunto
inteiro de mudanças de forma atômica, e o RFC 6902 diz que uma operação que
falha faz o patch inteiro não ser considerado bem-sucedido, então a atomicidade
fica por conta do servidor, normalmente aplicando o patch numa cópia.

### Um endpoint PATCH seguro

O tipo do parâmetro pesa tanto na segurança quanto o tratamento de erro.
Aplique o patch num DTO que só tem os campos que o cliente pode mudar, valide,
e copie para a entidade só quando tudo deu certo:

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

`User` também tem `IsAdmin`, que o `UserPatch` não tem. Requisições contra o
app rodando:

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

Vale guardar o 415: fazer binding de um `JsonPatchDocument<T>` faz o endpoint
aceitar só `application/json-patch+json`, e o roteamento recusou
`application/json` puro antes do handler rodar. Os dois patches que começavam
com `replace /name "Bia"` e falharam não deixaram rastro, porque mudaram a
cópia. Se o parâmetro fosse `JsonPatchDocument<User>`, a requisição de
`isAdmin` teria funcionado.

### As ameaças que o framework não trata

A doc afirma que JSON Patch tem riscos inerentes e que a implementação não
tenta mitigá-los. Os que ela lista:

- **Amplificação de memória**: `copy` repetido de uma subárvore grande. Limite
  quantidade e tipo de operações antes de chamar `ApplyTo`, como o endpoint
  faz.
- **Subversão de regra de negócio**: operações em IDs, flags ou campos
  calculados. Aplique o patch num DTO só com propriedades seguras, ou valide as
  invariantes depois de aplicar.
- **Falta de autorização**: endpoints PATCH precisam da mesma autenticação e
  autorização de qualquer escrita.

Ela também cita custo algorítmico: inserir no índice 0 de uma lista grande
desloca todos os elementos, a cada operação.

### Merge patch e o problema do null

Fazer binding de um merge patch para um DTO com propriedades anuláveis perde
informação, porque "campo ausente" e "campo igual a null" viram `null` do
mesmo jeito:

```text
{}               dto.Email=null  sent=False kind=Undefined
{"email":null}   dto.Email=null  sent=True kind=Null
```

Só lendo o `JsonElement` cru (`TryGetProperty`) dá para distinguir os dois. Se
escolher merge patch, leia o corpo como `JsonDocument` ou `JsonNode`, ou
modele cada campo como "talvez presente"; não confie em propriedades anuláveis
do DTO.

### Migrando do pacote Newtonsoft

Os tipos novos ficam em `Microsoft.AspNetCore.JsonPatch.SystemTextJson`.
Segundo a página "What's new", ele é mais rápido e aloca menos, mas não é um
substituto direto: não suporta tipos dinâmicos como `ExpandoObject`. Ele também
segue as convenções do System.Text.Json (sensibilidade a maiúsculas, tratamento
de números), então caminhos que funcionavam com os padrões case-insensitive do
Newtonsoft podem passar a falhar. Teste os clientes existentes contra o pacote
novo antes de trocar.

## Trade-offs

- **JSON Patch versus merge patch.** JSON Patch é explícito e lida com arrays e
  pré-condições; merge patch é o que a maioria dos fronts acha natural, mas
  exige parsing manual no ASP.NET Core e não alcança itens de array.
- **PATCH versus PUT.** PATCH economiza banda e evita sobrescrever campos que
  ninguém tocou, ao custo de mais código no servidor, de operações não
  idempotentes e de uma atomicidade que você mesmo implementa.
- **Patch na entidade versus num DTO.** Aplicar na entidade é menos código e
  expõe todas as propriedades, inclusive as que nunca deveriam mudar.
  ```csharp
  JsonPatchDocument<UserPatch>   // not JsonPatchDocument<User>
  ```
- **`test` versus ETags.** Uma operação `test` é uma pré-condição dentro do
  corpo; `If-Match` com ETag é a versão no nível do HTTP e serve para qualquer
  método. Nos dois casos o servidor precisa recusar quando não bate.
- **Reflection.** O pacote é baseado em reflection, o que conflita com metas de
  trimming e Native AOT para a API.

## Documentation Links

- [JsonPatch in ASP.NET Core web API, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/web-api/jsonpatch) (doc)
- [What's new in ASP.NET Core 10, Microsoft Learn](https://learn.microsoft.com/en-us/aspnet/core/release-notes/aspnetcore-10.0) (doc)
- [JsonPatchDocument<TModel> class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/microsoft.aspnetcore.jsonpatch.systemtextjson.jsonpatchdocument-1) (doc)
- [RFC 6902: JavaScript Object Notation (JSON) Patch, IETF](https://datatracker.ietf.org/doc/html/rfc6902) (doc)
- [RFC 7396: JSON Merge Patch, IETF](https://datatracker.ietf.org/doc/html/rfc7396) (doc)
