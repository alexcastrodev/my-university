---
version: 1.0
updatedAt: 2026-10-15
title: "JSON: Converters, Contratos Customizados e Exportação de Schema"
summary: JsonConverter<T> e JsonConverterFactory, nulos e precedência de registro, contract customization com modifiers, o que o JsonSchemaExporter descreve e o que ele não enxerga quando há converter customizado.
---
## Objective

Atributos e opções cobrem a maioria dos formatos JSON. Quando não cobrem, o
System.Text.Json oferece três ferramentas em escala: um `JsonConverter<T>` que
escreve e lê um tipo à mão, a customização de contrato, que edita os metadados
que o serializador construiu para um tipo (sem ser dono do tipo), e o
`JsonSchemaExporter`, que transforma esse mesmo contrato em um documento JSON
Schema. Este conceito cobre quando cada uma serve, as regras que mordem (tratamento
de null, precedência de registro, um reader que consome o número errado de tokens)
e o que o exportador de schema diz sobre um tipo, incluindo o que ele não consegue
saber quando há um converter customizado. O básico de opções está no conceito de
serialização e opções.

## Use Cases

- Escrever um value object (`Money`, `EmailAddress`) como uma string JSON em vez de
  um objeto.
- Esconder toda propriedade cujo nome começa com `Internal` de um modelo que você
  não pode anotar.
- Usar um tipo que não é string como chave de dicionário.
- Publicar um JSON Schema de um tipo de request ou de configuração, para docs,
  validação ou ferramentas.

## Deep Dive

### Um converter para um tipo

Derive de `JsonConverter<T>` e sobrescreva `Read` e `Write`. Todos os resultados
abaixo são do .NET 10.0.0 (SDK 10.0.100), macOS.

```csharp
class MoneyConverter : JsonConverter<Money>
{
    public override Money Read(ref Utf8JsonReader r, Type t, JsonSerializerOptions o)
    {
        var parts = r.GetString()!.Split(' ');           // "12.5 EUR"
        return new Money(decimal.Parse(parts[0], CultureInfo.InvariantCulture), parts[1]);
    }
    public override void Write(Utf8JsonWriter w, Money m, JsonSerializerOptions o)
        => w.WriteStringValue(string.Create(CultureInfo.InvariantCulture, $"{m.Amount} {m.Currency}"));
}
// {"Id":"A-1","Total":"12.5 EUR","Lines":["1 USD"]}
```

O converter valeu para `Total` e para cada elemento do array `Money[]`, já que o
serializador escolhe um converter por tipo. Lançar `JsonException` em `Read` dá ao
chamador um erro de serialização normal com o caminho (`Bad money 'oops'`). Passe
`CultureInfo.InvariantCulture` nos dois lados: o `ToString` padrão na minha máquina
imprimiu `12,5`.

O registro tem uma precedência fixa, segundo a documentação: `[JsonConverter]` numa
propriedade vence, depois um converter em `options.Converters`, depois
`[JsonConverter]` no tipo. Se vários converters customizados para um tipo estão na
coleção, vale o primeiro cujo `CanConvert` devolve true. Conferi a regra do meio: um
record `Temp` com `[JsonConverter(typeof(TempConverter))]` no tipo foi escrito como
`"from options"` quando outro converter para ele estava em `Converters`. Um
`[JsonConverter(typeof(Lower))]` na propriedade venceu o converter das opções no
mesmo tipo string (`"lower:a"` contra `"B"` no vizinho).

### Null pula o seu converter, a não ser que você peça

Por padrão um converter não é chamado para `null` em tipos de referência (a
documentação manda sobrescrever `HandleNull` para mudar isso). Com um converter que
não sobrescrevia, `{"Value":null}` foi escrito e lido de volta como `null` sem
`Read` nem `Write` rodarem. Com `HandleNull => true`, uma string nula foi escrita
como o `"(none)"` que meu converter escolheu, e `Read` recebeu um token `Null` e
devolveu `<null>`. Então decida: se um null deve virar um sentinela, opte por isso e
confira `TokenType` em `Read`; senão, deixe como está. Repare que o converter de
propriedade do teste anterior não definia `HandleNull`, e o null dele continuou
`null`.

### O reader deve consumir exatamente um valor

Um converter que retorna sem consumir o valor inteiro quebra o parse. Meu `Read`
chamava `r.Read()` uma vez quando o valor era um objeto aninhado, e o serializador
lançou `JsonException: The converter 'Bad' read too much or not enough` com o
caminho `$.V`. Para um objeto, o converter deve parar no `EndObject`; para um valor
como string, no próprio token. Quando você delega ao serializador, use
`JsonSerializer.Deserialize<T>(ref reader, options)`, que avança corretamente.

### Factories para tipos genéricos

Um converter para `Wrapper<T>` não pode ser uma classe só, porque o código muda por
`T`. `JsonConverterFactory` responde `CanConvert` para o genérico aberto e constrói
o converter fechado sob demanda:

```csharp
public override bool CanConvert(Type t) => t.IsGenericType && t.GetGenericTypeDefinition() == typeof(Wrapper<>);
public override JsonConverter CreateConverter(Type t, JsonSerializerOptions o)
    => (JsonConverter)Activator.CreateInstance(typeof(Inner<>).MakeGenericType(t.GetGenericArguments()[0]))!;
// Wrapper<int>(5) -> 5     Wrapper<string>("s") -> "s"
```

A documentação diz que esse padrão de factory é obrigatório para genéricos abertos
no .NET 10 e anteriores, e que o .NET 11 deixa `[JsonConverter]` receber um
converter genérico aberto diretamente. Só executei no .NET 10. Note que `Activator`
e `MakeGenericType` são reflexão, então sob Native AOT os tipos fechados precisam
ser conhecidos em tempo de compilação.

Para chaves de dicionário, `Dictionary<Point, int>` lançou `NotSupportedException`
("The type 'Point' is not a supported dictionary key"). Sobrescrever
`ReadAsPropertyName` e `WriteAsPropertyName` num `JsonConverter<Point>` resolveu:
escreveu `{"1,2":5}` e leu a chave de volta como `Point { X = 1, Y = 2 }`.

### Contract customization: edite os metadados, não o tipo

A partir do .NET 7 (segundo a documentação) o serializador constrói um
`JsonTypeInfo` por tipo, e um resolver pode alterá-lo antes do uso. Com o
`DefaultJsonTypeInfoResolver` você adiciona modifiers, que são callbacks
`Action<JsonTypeInfo>` executados em ordem:

```csharp
var resolver = new DefaultJsonTypeInfoResolver();
resolver.Modifiers.Add(ti =>
{
    if (ti.Kind != JsonTypeInfoKind.Object) return;
    foreach (var p in ti.Properties.ToList())
        if (p.Name.StartsWith("Internal", StringComparison.Ordinal)) ti.Properties.Remove(p);
});
// Customer("ana","secret",3) -> {"Name":"ana","Visits":3,"display":"ANA"}
```

Na minha execução o mesmo modifier também adicionou uma propriedade calculada
`display` com `ti.CreateJsonPropertyInfo(typeof(string), "display")` e um delegate
`Get`. Outras alavancas verificadas: `JsonPropertyInfo.ShouldSerialize` (um `Visits`
igual a 0 foi omitido e 2 foi escrito), `Set` para desserialização e
`JsonTypeInfo.NumberHandling`. Confira o `Kind` primeiro: segundo a documentação,
`Object` permite mais; tipos com converter customizado reportam `None` e não têm o
que editar. Como o modifier trabalha com nomes e tipos, uma regra cobre todos os
modelos, inclusive os de outro assembly.

O contrato congela no primeiro uso. Depois de uma chamada de serialização numa
instância de options, atribuir `TypeInfoResolver` lançou `InvalidOperationException`
("read-only or has already been used"), e adicionar a `resolver.Modifiers` depois
também lançou. Construa o resolver por completo e só então crie as options.

### JsonSchemaExporter

O `JsonSchemaExporter` (introduzido no .NET 9, segundo a documentação) descreve o
contrato que o serializador usaria. `options.GetJsonSchemaAsNode(typeof(Order))`
devolveu, para um record com `int Id`, `string? Note`, `decimal Total`, um enum e
uma `List<string>`: integer, string anulável, number, `"integer"` para o enum, um
array de strings anuláveis e `"format": "date-time"` para o `DateTime`. A lista
`required` trouxe todo parâmetro de construtor sem valor padrão, anulável ou não.

O schema acompanha as suas opções, e esse é o ponto:

- Com `JsonSerializerDefaults.Web` as chaves viraram `id`, `note` e assim por
  diante, e `id` virou `["string","integer"]` com um `pattern`, porque os padrões
  Web aceitam ler números a partir de strings.
- Adicionar `JsonStringEnumConverter` mudou o enum para `{"enum":["New","Shipped"]}`.
- A raiz era `["object","null"]` e os itens de `Tags` eram anuláveis; ligar
  `TreatNullObliviousAsNonNullable = true` fez a raiz virar `"object"` e os itens
  `"string"`, enquanto `Note` continuou anulável por estar anotado.
- `TransformSchemaNode` roda em todo nó. Ler `DescriptionAttribute` de
  `context.PropertyInfo.AttributeProvider` colocou `"description": "Order key"` em
  `id`.

Duas armadilhas. Uma instância nova de options sem resolver lançou
`InvalidOperationException` ("must specify a TypeInfoResolver setting before being
marked as read-only"), então defina `TypeInfoResolver` (por exemplo
`new DefaultJsonTypeInfoResolver()`) ou use um contexto de source generation. E um
converter customizado esconde a forma: para o `Invoice` com meu `MoneyConverter`, o
schema disse `"Total": true` (qualquer coisa) e `"Lines": {"type":"array"}` sem
`items`. O exportador não enxerga dentro de código, então dê a esses tipos um schema
em `TransformSchemaNode`.

## Trade-offs

- **Um converter é controle total com responsabilidade total.** Nulos, erros e
  posição do cursor são seus.
  ```csharp
  throw new JsonException($"Bad money '{s}'"); // dá ao chamador um caminho, não um crash
  ```
- **Converters escondem o tipo das ferramentas.** O exportador de schema reportou
  `true` para `Money`; um modifier que edita propriedades também não toca nele.
- **Modifiers de contrato escalam melhor que atributos** para regras transversais
  (esconder `Internal*`), mas rodam por tipo no primeiro uso e exigem checar `Kind`.
- **Options congeladas significam que a ordem importa.** Monte resolver e modifiers
  primeiro; mudá-los depois da primeira chamada lança exceção.
- **Um schema descreve o contrato do serializador, não regras de negócio.** Ele tem
  tipos, nulabilidade e `required`; não sabe que `Total` deve ser positivo a menos
  que você acrescente isso num transform.
- **Reflexão em factories custa AOT.** `MakeGenericType` exige os tipos fechados
  conhecidos antecipadamente; prefira o caminho com source generation em apps AOT.

## Documentation Links

- [How to write custom converters for JSON serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/converters-how-to) (doc)
- [Custom serialization and deserialization contracts, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/custom-contracts) (doc)
- [JSON schema exporter, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/system-text-json/extract-schema) (doc)
- [JsonSchemaExporter Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.schema.jsonschemaexporter) (doc)
- [DefaultJsonTypeInfoResolver Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.text.json.serialization.metadata.defaultjsontypeinforesolver) (doc)
