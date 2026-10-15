---
version: 1.0
updatedAt: 2026-10-15
title: "Remoção do BinaryFormatter e Serialização Segura"
summary: O que o runtime faz desde o .NET 9, por que o formato é inseguro por desenho (CWE-502), o mecanismo mostrado com uma classe inofensiva, alternativas (System.Text.Json, protobuf-net) e como ler payloads antigos com NrbfDecoder.
---
## Objective

`BinaryFormatter` foi, por duas décadas, a resposta padrão do .NET para "salve
este grafo de objetos em bytes", e é o caso clássico de desserialização insegura:
o payload diz quais tipos criar. A partir do .NET 9 o runtime não traz mais uma
implementação funcional. Este conceito explica o que isso significa no código (o
que lança exceção, o que o compilador diz), por que o formato é inseguro por
desenho e não por bug, para onde migrar e como ler payloads antigos uma vez, com
segurança, usando `NrbfDecoder` em vez de ressuscitar o formatter. Também mostra o
mecanismo do problema com uma classe inofensiva, para você reconhecê-lo em outros
serializadores.

## Use Cases

- Atualizar para .NET 9 ou superior um app que usava `BinaryFormatter` em
  arquivos, caches ou na área de transferência.
- Ler uma vez arquivos de save ou estado em cache antigos de um usuário e
  regravá-los em outro formato.
- Revisar um pull request que adiciona um serializador numa fronteira de confiança
  (uma fila, um upload, um cookie).
- Escolher um formato substituto para mensagens internas.

## Deep Dive

### O que o runtime faz agora

O guia de migração diz sem rodeios: a partir do .NET 9 o runtime não inclui mais uma
implementação de `BinaryFormatter`. As APIs continuam presentes, mas sempre lançam
`PlatformNotSupportedException`, independentemente do tipo de projeto, e a antiga
chave de compatibilidade não ajuda mais. Confirmei no .NET 10.0.0 (SDK 10.0.100):

```csharp
var bf = new BinaryFormatter();
bf.Serialize(ms, new Person { Name = "Ana", Age = 3 });
// PlatformNotSupportedException: BinaryFormatter serialization and deserialization
// have been removed. See https://aka.ms/binaryformatter for more information.
```

`Deserialize` lançou a mesma exceção. Antes mesmo de rodar, o compilador barra: o
mesmo arquivo falhou na compilação com `error SYSLIB0011: 'BinaryFormatter' is
obsolete`, um erro e não um aviso neste SDK. A saída de emergência do guia é o pacote
NuGet não suportado `System.Runtime.Serialization.Formatters`, que, segundo o guia,
contém "the functioning implementation of BinaryFormatter, including its
vulnerabilities and risks" (a implementação funcional, com suas vulnerabilidades e
riscos). Com a versão 10.0.0 desse pacote e
`<EnableUnsafeBinaryFormatterSerialization>true</...>` (e `NoWarn` para
`SYSLIB0011`), uma classe `[Serializable]` fez a ida e volta: 159 bytes escritos para
uma pessoa com nome, idade e duas tags, lida de volta intacta. Trate isso como um
paliativo para destravar uma atualização, não como um design: a documentação marca o
pacote como não suportado e recomenda migrar.

### Por que o formato é o problema

O guia de segurança chama o `BinaryFormatter` de perigoso, diz que ele "não pode ser
tornado seguro" ("can't be made secure") e que as aplicações devem parar de usá-lo
"mesmo que acreditem que os dados que processam são confiáveis". A classe de
fraqueza é a CWE-502, desserialização de dados não confiáveis: todo desserializador
que deixa a entrada dizer quais objetos criar é um problema esperando para
acontecer. Veja o que há dentro dos 159 bytes do meu payload, impresso como texto
(resumido):

```
...Version=1.0.0.0, Culture=neutral, PublicKeyToken=null......Person.....Name.Age.Tags....Ana....a......b.
```

O payload carrega o nome do tipo e os nomes dos membros. Ao desserializar, o
formatter carrega esse tipo e preenche seus membros. A documentação diz duas coisas
que impedem "consertar" com configuração: a superfície de ataque de negação de
serviço "cannot be mitigated with a `SerializationBinder` or any other
`BinaryFormatter` configuration switch" (não pode ser mitigada com um
`SerializationBinder` nem com qualquer chave de configuração; eles chamam isso de
by design), e, para as outras categorias de ataque, um binder "might be
insufficient" (pode ser insuficiente). A mesma página diz que `SoapFormatter`,
`LosFormatter`, `NetDataContractSerializer` e `ObjectStateFormatter` fazem
desserialização polimórfica irrestrita e também são perigosos. "Entrada confiável"
é outra armadilha, a que o guia dedica uma seção: um cliente desktop falando com o
seu servidor, um arquivo de save enviado por e-mail entre usuários ou um arquivo
sincronizado na nuvem são todos fronteiras de confiança.

### O mecanismo, com uma classe inofensiva

Dá para ver "o payload escolhe o tipo" sem nenhum exploit. Uma classe cujo setter
só imprime uma linha faz o papel do que um atacante usaria. Entregando ao
Newtonsoft.Json 13.0.4, com alvo `object` e `TypeNameHandling.Auto`, um `$type` que
nomeia essa classe:

```csharp
class Gadget { public string Cmd { set => Console.WriteLine($"setter ran with '{value}'"); get => ""; } }
JsonConvert.DeserializeObject<object>(
    """{"$type":"Gadget, MyAssembly","Cmd":"hello"}""",
    new JsonSerializerSettings { TypeNameHandling = TypeNameHandling.Auto });
// setter ran with 'hello'   (o JSON escolheu o tipo, e o código dele rodou)
```

É o mesmo formato do problema, numa biblioteca que você talvez ainda tenha. O
contraste é o System.Text.Json com hierarquia fechada: com `[JsonDerivedType]`
listando `circle`, `{"$type":"circle","R":2}` produziu um `Circle`, enquanto
`{"$type":"gadget",...}` lançou `JsonException: Read unrecognized type discriminator
id 'gadget'`. Com alvo `object` simples, o resultado foi um `JsonElement` e nada foi
instanciado. A regra vale para qualquer formato: o conjunto de tipos criáveis deve
ser fixado pelo seu código, nunca pelo payload.

### Escolhendo o substituto

O guia recomenda quatro serializadores: System.Text.Json (JSON),
`DataContractSerializer` (XML), MessagePack (binário) e protobuf-net (binário) (só
executei o protobuf-net), e observa que a troca costuma ser viável apenas quando você
controla produtor e consumidor. Escolha pelo uso dos dados:

- Interoperabilidade, configuração, logs, APIs: JSON. O mesmo objeto de 3 campos tinha
  39 bytes de JSON UTF-8, legível, sem schema e tolerante à reordenação.
- Mensagens internas compactas: um formato binário baseado em contrato. Com
  protobuf-net 3.2.52 e `[ProtoContract]`/`[ProtoMember(n)]` no tipo, o objeto ficou
  com 13 bytes, foi lido de volta idêntico, ignorou um campo desconhecido extra e um
  buffer truncado falhou com `EndOfStreamException`. Os números dos campos são o
  contrato, então nunca devem ser reutilizados.
- Não use um serializador que grava nomes de tipo nos dados a menos que você controle
  o conjunto permitido.

Lembre que campos e propriedades são coisas diferentes: minha primeira tentativa de
copiar uma classe `[Serializable]` antiga com campos públicos para JSON produziu
`{}`, porque o System.Text.Json ignora campos por padrão. Mapeie para um DTO com
propriedades ou um record.

### Lendo payloads antigos uma vez com NrbfDecoder

Dados persistidos são a parte difícil, já que lê-los exigia o formatter. A resposta
do guia de migração é o `NrbfDecoder` (introduzido com o .NET 9, no pacote NuGet
`System.Formats.Nrbf`, que também mira frameworks mais antigos). Ele decodifica o
formato binário do .NET Remoting (NRBF) em registros sem desserializar: segundo a
documentação, não carrega tipos, não faz recursão e só instancia primitivos e
arrays. Serve apenas para um conjunto fechado de tipos que você conhece de antemão,
porque as instâncias você mesmo constrói. Com o pacote 10.0.0:

```csharp
if (NrbfDecoder.StartsWithPayloadHeader(stream))               // true para o meu arquivo
{
    ClassRecord rec = NrbfDecoder.DecodeClassRecord(stream);
    if (!rec.TypeNameMatches(typeof(Person))) throw new InvalidDataException();
    var tags = (SZArrayRecord<string>)rec.GetArrayRecord("Tags");
    if (tags.Length > 100) throw new InvalidDataException();   // docs: confira tamanhos antes
    var dto = new PersonDto(rec.GetString("Name")!, rec.GetInt32("Age"), tags.GetArray()!);
    // {"Name":"Ana","Age":3,"Tags":["a","b"]}  -> grave de volta no formato novo
}
```

`TypeNameMatches(typeof(Other))` devolveu `false`, `MemberNames` listou `Name, Age,
Tags`, um payload truncado lançou `EndOfStreamException` e um buffer JSON não foi
reconhecido por `StartsWithPayloadHeader`. O padrão de migração da documentação é
exatamente este: detectar o cabeçalho, decodificar, gravar no novo serializador e
sobrescrever os dados antigos. Eles também avisam que o `NrbfDecoder` não serve para
decidir se uma chamada ao `BinaryFormatter` seria segura, e que o tamanho dos arrays
deve ser conferido antes de `GetArray`, porque o formato permite a um atacante
comprimir enormes arrays de nulos.

## Trade-offs

- **O pacote de compatibilidade restaura a vulnerabilidade junto com o recurso.** Ele
  não é suportado e existe para ganhar tempo.
  ```xml
  <EnableUnsafeBinaryFormatterSerialization>true</EnableUnsafeBinaryFormatterSerialization>
  ```
- **JSON é seguro por construção e maior.** 39 bytes contra 13 do protobuf aqui, e sem
  schema em tempo de compilação, em troca de legibilidade e tolerância.
- **Formatos binários baseados em contrato exigem disciplina.** Reutilizar um número
  de campo ou mudar seu tipo corrompe dados antigos em silêncio.
- **`NrbfDecoder` é uma ferramenta de migração, não um formato de runtime.** Pede um
  conjunto fechado de tipos e mapeamento escrito à mão, que é o ponto: nada é criado
  implicitamente.
- **Nomes de tipo em payloads são o risco, em qualquer serializador.** Uma propriedade
  `$type` com conjunto aberto é a mesma falha do `BinaryFormatter`, com outra sintaxe.
- **"Confiável" é uma afirmação sobre uma fronteira, não uma propriedade dos dados.**
  Arquivos viajam e clientes são comprometidos.

## Documentation Links

- [BinaryFormatter migration guide, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/) (doc)
- [Deserialization risks in use of BinaryFormatter and related types, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-security-guide) (doc)
- [Read BinaryFormatter (NRBF) payloads, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/read-nrbf-payloads) (doc)
- [Using the BinaryFormatter compatibility package, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/binaryformatter-migration-guide/compatibility-package) (doc)
- [CWE-502: Deserialization of Untrusted Data, MITRE](https://cwe.mitre.org/data/definitions/502.html) (doc)
