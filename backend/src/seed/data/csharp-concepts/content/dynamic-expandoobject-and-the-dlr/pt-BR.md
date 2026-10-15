---
version: 1.0
updatedAt: 2026-10-15
title: "dynamic, ExpandoObject e o DLR"
summary: O que dynamic é em tempo de compilação e de execução, como o DLR faz cache por call site, o que ExpandoObject e DynamicObject fazem, quanto custa e por que JsonNode ou um modelo tipado quase sempre vence em código novo.
---
## Objective

`dynamic` desliga o compilador para toda expressão que ele toca: busca de
membro, resolução de overload e operadores são decididos em tempo de execução,
e um erro de digitação vira exceção em vez de erro de build. A engrenagem por
trás é o dynamic language runtime (DLR), e as duas classes que você mais
encontra são `ExpandoObject` (um saco onde se adicionam membros) e
`DynamicObject` (classe base para comportamento dinâmico próprio). Este
conceito explica o que `dynamic` é em tempo de compilação e de execução, como o
cache do DLR funciona, o que as duas classes fazem, quanto custa, e por que
`JsonNode` ou um modelo tipado é quase sempre a melhor escolha em código novo.

## Use Cases

- Chamar uma API COM (automação do Office) sem um cast em cada `object`.
- Ler um objeto cuja forma só se conhece em tempo de execução, como um payload
  pouco estruturado num script ou num helper de teste.
- Construir um wrapper fluente com sintaxe de membro (`config.Database.Port`)
  sobre um dicionário usando `DynamicObject`.
- Reconhecer a `RuntimeBinderException` num log e saber de onde ela vem.

## Deep Dive

### O que `dynamic` é

`dynamic` é um tipo estático, mas uma expressão desse tipo ignora a checagem
estática: o compilador assume que ela suporta qualquer operação. O compilador
empacota o que cada comando quer fazer com o valor, e o runtime examina essa
informação quando o comando executa. Observado no .NET 10:

```csharp
dynamic d = 5;
Console.WriteLine(d + 1);                 // 6
Console.WriteLine(((object)d).GetType()); // System.Int32
d = "text";
Console.WriteLine(d.Length);              // 4
try { Console.WriteLine(d.Missing); }
catch (RuntimeBinderException e) { Console.WriteLine(e.Message); }
// 'string' does not contain a definition for 'Missing'
```

A mesma variável guardou um `int` e depois uma `string`, e cada busca de membro
usou o tipo de execução. Em tempo de execução `dynamic` é só `object`:
`typeof(List<dynamic>) == typeof(List<object>)` imprimiu `True`, e o tipo
apareceu como `List<Object>`. O resultado da maioria das operações dinâmicas é
também `dynamic`; conversões de `dynamic` para outro tipo e chamadas de
construtor com argumento dinâmico não são (`var x = new Foo(d)` é um `Foo`).

### A resolução de overload vai para o run time

Se algum argumento, ou o receptor, é `dynamic`, a resolução de overload acontece
em tempo de execução usando os tipos de execução. Com overloads para `int`,
`string` e `object`:

```csharp
object o = "s"; dynamic dy = "s";
Console.WriteLine($"{Who(o)} {Who(dy)}");   // object string
```

A variável estática escolheu `object` e a dinâmica escolheu `string`. Passar um
argumento `dynamic` a um método sem overload compatível compila e depois falha
em tempo de execução. Esse é o risco inteiro: ferramentas de refactoring, o
compilador e a análise de nullability não enxergam esses pontos de chamada.

### O DLR e os call sites

O DLR fornece a infraestrutura de `dynamic` no C# (e de linguagens como
IronPython). Cada lugar onde você aplica uma operação a um valor dinâmico
(`a + b`, `a.b()`) é um call site. A primeira execução pede a um binder que
construa as regras da operação, expressas como expression trees, e o DLR guarda
em cache as características dos operandos (normalmente os tipos) para que a
execução seguinte com os mesmos tipos pule o trabalho de binding.

Uma medição grosseira numa máquina (Release, 5 milhões de chamadas de
`GetHashCode()` num `int`; os números variam com hardware e runtime, então só a
ordem de grandeza importa):

| Chamada | Tempo |
|---|---|
| `int` estático | 6 ms |
| `dynamic` | 38 ms |
| `MethodInfo.Invoke` | 43 ms |

`dynamic` ficou perto de reflexão com cache e várias vezes mais lento que uma
chamada direta. A primeira chamada em cada site também paga o custo de binding,
então um site raramente executado nunca amortiza isso.

### ExpandoObject

`ExpandoObject` permite adicionar e remover membros em tempo de execução. Ele
implementa `IDictionary<string, object>`, então dá para enumerar os membros e,
como o C# não tem sintaxe para apagar um membro, remover um pelo cast para o
dicionário. Também implementa `INotifyPropertyChanged`. Membros podem ser
delegates e ser invocados como métodos:

```csharp
dynamic ex = new ExpandoObject();
ex.Name = "Ana";
ex.Age = 30;
ex.Greet = (Func<string>)(() => "hi " + ex.Name);
Console.WriteLine($"{ex.Name} {ex.Age} {ex.Greet()}");   // Ana 30 hi Ana
var dict = (IDictionary<string, object?>)ex;
Console.WriteLine(string.Join(",", dict.Keys));           // Name,Age,Greet
dict.Remove("Age");
try { Console.WriteLine(ex.Age); }
catch (RuntimeBinderException e) { Console.WriteLine(e.Message); }
// 'System.Dynamic.ExpandoObject' does not contain a definition for 'Age'
```

A lambda é convertida para um tipo delegate, como no exemplo da documentação.
Serialização também pede cuidado: `JsonSerializer.Serialize(ex)` com o delegate
`Greet` ainda dentro lançou `NotSupportedException` (delegates não são
suportados), enquanto o mesmo objeto só com `Name` e `Age` produziu
`{"Name":"Ana","Age":31}`.

### DynamicObject

Herde de `DynamicObject` quando quiser decidir o que um acesso a membro
significa. Sobrescreva os métodos `Try...` de que precisa e retorne `true`
quando tratou a operação (`false` produz uma `RuntimeBinderException`):

```csharp
class Bag : DynamicObject
{
    readonly Dictionary<string, object?> _d = new();
    public override bool TrySetMember(SetMemberBinder b, object? v) { _d[b.Name] = v; return true; }
    public override bool TryGetMember(GetMemberBinder b, out object? r) => _d.TryGetValue(b.Name, out r);
    public override bool TryInvokeMember(InvokeMemberBinder b, object?[]? a, out object? r) { r = "called " + b.Name; return true; }
    public override bool TryGetIndex(GetIndexBinder b, object[] i, out object? r) { r = "idx " + i[0]; return true; }
}

dynamic bag = new Bag();
bag.Color = "red";
Console.WriteLine(bag.Color);      // red
Console.WriteLine(bag.Whatever()); // called Whatever
Console.WriteLine(bag["k"]);       // idx k
```

Esse é o ponto de extensão por trás de wrappers dinâmicos sobre XML, JSON ou
objetos de script: a biblioteca decide o significado de `obj.Count += 1` e quem
chama ganha sintaxe natural.

### JSON dinâmico e a alternativa

Desserializar para `ExpandoObject` com System.Text.Json não entrega membros de
Expando. No .NET 10 os valores voltam como `JsonElement`, então `jd.a + 1`
lançou `RuntimeBinderException: Operator '+' cannot be applied to operands of
type 'System.Text.Json.JsonElement' and 'int'`. A ferramenta melhor é o DOM:

```csharp
var node = JsonNode.Parse("""{"name":"Ana","tags":["a","b"],"n":{"x":1}}""")!;
Console.WriteLine($"{node["name"]} {node["tags"]![1]} {node["n"]!["x"]!.GetValue<int>()}"); // Ana b 1
Console.WriteLine(node["missing"] is null);   // True
```

`JsonNode` é tipado, navegável, consciente de null (uma chave ausente é `null`,
não exceção) e não precisa do DLR. Para uma forma conhecida, desserialize para
um `record`.

## Trade-offs

- **Despacho dinâmico dá flexibilidade e perde toda checagem em compilação.**
  Um membro com nome errado compila e falha em produção (`d.Missing` acima).
  Mitigação: confine o `dynamic` a um método de fronteira pequeno e converta
  para um valor tipado imediatamente (`int i = d;` aplica a conversão em tempo
  de execução).
- **O cache do DLR deixa chamadas repetidas rápidas o bastante e nunca tão
  rápidas quanto código estático.** Cerca de 6x mais lento que uma chamada
  direta na medição acima, com custo de binding na primeira chamada de cada
  site. Mitigação: não use em loops quentes e prefira generics ou uma interface
  quando o conjunto de operações é conhecido.
- **`ExpandoObject` é um dicionário com sintaxe de membro.** Você ganha
  enumeração e remoção de graça, e um erro de digitação no nome cria ou perde
  um membro em silêncio. Se você está lendo tudo por casts para `IDictionary`,
  use um `Dictionary<string, object?>` direto.
- **`DynamicObject` é poderoso e difícil de descobrir.** Quem chama não vê
  membros no IntelliSense nem assinatura. Use em wrappers de biblioteca onde a
  sintaxe é o produto, não em modelos comuns de aplicação.
- **JSON dinâmico via `dynamic` é uma armadilha.** Valores `JsonElement`
  quebram a aritmética, como mostrado. Use `JsonNode` ou um modelo tipado.

## Documentation Links

- [Using type dynamic, C# advanced topics, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interop/using-type-dynamic) (doc)
- [Dynamic Language Runtime Overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/framework/reflection-and-codedom/dynamic-language-runtime-overview) (doc)
- [ExpandoObject class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.dynamic.expandoobject) (doc)
- [DynamicObject class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.dynamic.dynamicobject) (doc)
- [Use JsonDocument and JsonNode (DOM), Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/use-dom) (doc)
- [How to access Office interop objects by using C# features, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/csharp/advanced-topics/interop/how-to-access-office-interop-objects) (doc)
