---
version: 1.0
updatedAt: 2026-10-15
title: "Serialização XML e LINQ to XML"
summary: XmlSerializer e DataContractSerializer (o que incluem e o que pulam em silêncio), surpresas de namespace e encoding, consultas e edição com LINQ to XML, streaming com XmlReader e as configurações do parser que decidem se um XML hostil lê arquivos ou esgota memória.
---
## Objective

XML ainda é o que você encontra em serviços SOAP, formatos do Office, arquivos de
configuração, feeds e muitas integrações legadas. O .NET dá duas portas de entrada:
serializadores que mapeiam objetos para XML (`XmlSerializer`,
`DataContractSerializer`) e o LINQ to XML (`XDocument`, `XElement`), uma API de
consulta e edição para XML que você não quer mapear. Este conceito cobre o que cada
serializador inclui e pula em silêncio, as surpresas de namespace e encoding, como
consultar e modificar com LINQ to XML (incluindo um laço que pula elementos sem
avisar), quando fazer streaming com `XmlReader` e as configurações do parser que
decidem se um documento hostil consegue ler um arquivo local ou esgotar a memória.

## Use Cases

- Ler ou produzir um contrato XML (um feed, um formato de nota, um endpoint da era
  SOAP).
- Extrair alguns valores de um arquivo XML grande sem escrever classes para ele.
- Editar um arquivo de configuração preservando tudo que você não tocou.
- Aceitar um upload de XML vindo de fora da sua fronteira de confiança.

## Deep Dive

### XmlSerializer: forma pública, atributos, padrões

O `XmlSerializer` mapeia propriedades públicas de leitura/escrita e campos públicos
para elementos. Toda a saída abaixo é do .NET 10.0.0 (SDK 10.0.100). Com
`[XmlRoot]`, `[XmlAttribute]`, `[XmlElement]`, `[XmlIgnore]` e
`[XmlArray]`/`[XmlArrayItem]` num `Order`:

```xml
<?xml version="1.0" encoding="utf-16"?>
<order xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema" id="7">
  <customer>Ana &amp; Co</customer>
  <Created>2024-01-02T03:04:05Z</Created>
  <Status>Shipped</Status>
  <lines><line sku="A"><Qty>2</Qty></line><line sku="B"><Qty>1</Qty></line></lines>
</order>
```

(Indentação reduzida.) Coisas fáceis de perder:

- Duas declarações de namespace (`xsi`, `xsd`) são adicionadas por padrão. Passar um
  `XmlSerializerNamespaces` contendo `("", "")` as remove. Escrevendo com um
  `XmlWriter` e `OmitXmlDeclaration = true`, saiu
  `<order id="7"><customer>...</order>`.
- `encoding="utf-16"` aparece porque serializei para um `StringWriter`, cujo
  encoding é UTF-16. A declaração segue o writer, não a sua intenção;
  `XDocument.Save(StringWriter)` fez o mesmo. Escreva num stream com
  `XmlWriterSettings.Encoding` quando o arquivo precisa ser UTF-8.
- Uma string `null` (`Note`) foi simplesmente omitida, a propriedade com
  `[XmlIgnore]` foi omitida e voltou como `''`, e um enum foi escrito pelo nome
  (`Shipped`).
- Só membros públicos: para uma classe com uma propriedade pública, uma interna, uma
  privada e um campo público, a saída trouxe apenas `Field` e `Pub`.
- Um tipo sem construtor sem parâmetros falha quando você constrói o serializador:
  `InvalidOperationException: NoCtor cannot be serialized because it does not have a
  parameterless constructor.` É a falha rápida; não fica adiada para o primeiro
  `Serialize`.
- Polimorfismo precisa ser declarado: uma `List<Animal>` com itens `Cat` e `Dog`
  funcionou depois que listei `[XmlElement("Cat", typeof(Cat)), XmlElement("Dog",
  typeof(Dog))]`.

A leitura é permissiva e barulhenta em lugares diferentes. Para `<Line sku='Z'
extra='1'>` com um elemento `<Bogus>` desconhecido, a desserialização teve sucesso e
descartou os dois em silêncio; o evento `UnknownElement` (e `UnknownAttribute`) é o
gancho se você quiser saber. Um valor ruim, `<Qty>abc</Qty>`, lançou
`InvalidOperationException: There is an error in XML document (1, 31)` com uma
`FormatException` dentro, e uma raiz errada deu `<Other xmlns=''> was not expected`.
Leia sempre a exceção interna e a linha e posição.

### DataContractSerializer: membros por adesão

O `DataContractSerializer` é a alternativa da era WCF com o padrão oposto: só os
membros marcados com `[DataMember]` são escritos, e uma propriedade sem o atributo é
pulada. Para `[DataContract] class Dc { [DataMember] A; [DataMember(Order = 2)] B;
int NotMember }` a saída foi
`<Dc xmlns="http://schemas.datacontract.org/2004/07/" xmlns:i="..."><A>1</A><B>x</B></Dc>`.
Repare no namespace derivado do namespace CLR. O guia de segurança avisa sobre outra
classe, `NetDataContractSerializer`, que faz desserialização polimórfica irrestrita:
não confunda as duas.

### LINQ to XML: consulte sem classes

`XDocument` e `XElement` são uma árvore em memória. A documentação o descreve como a
opção para código novo. O único conceito a aprender são os namespaces: um nome é
`XNamespace + nome local`, e uma consulta sem o namespace não acha nada.

```csharp
XNamespace s = "urn:shop";
var q = doc.Root!.Elements(s + "order").Select(o => new {
    Id = (int)o.Attribute("id")!,
    Customer = (string)o.Element(s + "customer")!,
    Total = o.Elements(s + "line").Sum(x => (int)x.Attribute("qty")! * (decimal)x.Attribute("price")!) });
// order 1 Ana total 22.0     order 2 Bo total 47.5
```

No mesmo documento `doc.Root.Elements("order")` contou 0 porque os elementos estão
em `urn:shop`. Os casts explícitos são a API de leitura: `(string?)` num elemento
ausente é `null`, mas `(int)` num atributo ausente lançou `ArgumentNullException` e
`(int)` no texto `Ana` lançou `FormatException`. Faça cast para `int?` quando o valor
puder faltar. XPath funciona por `System.Xml.XPath`: `XPathSelectElements` com um
`XmlNamespaceManager` ligando um prefixo a `urn:shop` achou o pedido em aberto.

A edição é direta: `SetAttributeValue("status", "shipped")`,
`Add(new XElement(...))`, `Remove()`. A armadilha é remover enquanto enumera. Em
`<r><a/><a/><a/><a/></r>`, `foreach (var a in root.Elements("a")) a.Remove();`
deixou 3 de 4 elementos, porque remover um nó perturba a enumeração preguiçosa.
Materializar antes, `foreach (var a in root.Elements("a").ToList()) a.Remove();`,
deixou 0, e a extensão `root.Elements("a").Remove()` também, já que ela faz a cópia
por você.

### Streaming de arquivos grandes com XmlReader

`XDocument` carrega tudo. Para um arquivo grande, `XmlReader` mais `XNode.ReadFrom`
entrega um `XElement` pequeno por vez:

```csharp
while (!rd.EOF)
    if (rd.NodeType == XmlNodeType.Element && rd.Name == "item") { var el = (XElement)XNode.ReadFrom(rd); /* use el */ }
    else rd.Read();
// [0:0] [1:1] [2:4] [3:9] [4:16]
```

`ReadFrom` deixa o reader depois do elemento, então o ramo `else Read()` não deve
pular o próximo. É o padrão comum, e mantém a memória proporcional a um único item.

### As configurações do parser são uma fronteira de segurança

Um documento XML pode declarar entidades, e uma entidade pode apontar para um
arquivo ou uma URL (XXE), ou expandir de forma exponencial. O que acontece depende
do ponto de entrada. Testei um documento cujo DTD define `&x;` como
`file:///tmp/csf-secret.txt`:

| Ponto de entrada | Resultado |
|---|---|
| `XmlReader.Create` com configurações padrão | `XmlException: For security reasons DTD is prohibited` (o padrão é `DtdProcessing.Prohibit`, segundo a documentação) |
| `XDocument.Parse(string)` e `XmlDocument.LoadXml` | interpretou, entidade ficou vazia (sem resolver, arquivo não lido) |
| `XmlSerializer.Deserialize` | `InvalidOperationException` |
| só `DtdProcessing.Parse` | interpretou, entidade vazia |
| `DtdProcessing.Parse` mais `XmlResolver = new XmlUrlResolver()` | leu o arquivo: `TOP-SECRET-CONTENT` |

Ou seja, a divulgação de arquivo exigiu duas adesões deliberadas no .NET 10. A
expansão de entidades é o outro eixo. Um pequeno documento "billion laughs" (quatro
níveis aninhados de 10 expansões, `10^4` cópias de `lol`) expandiu para 30000
caracteres via `XDocument.Parse` sem reclamação, e a mesma forma com 8 níveis (715
caracteres de entrada, 300 milhões de saída se expandisse) lançou `XmlException: The
input document has exceeded a limit set by MaxCharactersFromEntities` tanto no
`XDocument.Parse` quanto no `XmlDocument.LoadXml`. Num `XmlReaderSettings` novo com
`Parse` a propriedade valia 10000000, embora a documentação dê o padrão como 0,
então defina você mesmo em vez de confiar em qualquer um dos dois. Definir 1000 fez o
documento de 30000 caracteres falhar. O padrão seguro para entrada externa:

```csharp
var s = new XmlReaderSettings { DtdProcessing = DtdProcessing.Prohibit, XmlResolver = null,
                                MaxCharactersInDocument = 10_000_000 };
var doc = XDocument.Load(XmlReader.Create(stream, s));
```

Não medi o efeito de um limite de tamanho de documento. Seja qual for a versão,
mantenha DTDs proibidos a menos que você controle o documento, e nunca passe um
`XmlUrlResolver` para entrada não confiável.

## Trade-offs

- **`XmlSerializer` é convenção sobre contrato.** Tudo que é público entra, o que é
  prático e vaza propriedades novas para o formato na rede.
  ```csharp
  [XmlIgnore] public string Secret { get; set; } = "";   // exclua explicitamente
  ```
- **`DataContractSerializer` é explícito e deriva um namespace.** Padrões mais
  seguros para membros, mais cerimônia, um namespace que você talvez não queira.
- **LINQ to XML é dinâmico e não verificado.** Sem schema em tempo de compilação;
  nós ausentes viram `null` ou exceção conforme o cast.
- **Consultas preguiçosas com mutação geram bugs.** Materialize antes de remover.
- **`XDocument` é limitado pela memória.** Faça streaming de entradas grandes com
  `XmlReader` e processe um elemento por vez.
- **Padrão não é política.** Defina `DtdProcessing`, `XmlResolver` e o limite de
  entidades de forma explícita onde a entrada cruza uma fronteira de confiança.

## Documentation Links

- [XML Processing Options, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/data/xml/xml-processing-options) (doc)
- [XmlSerializer Class, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.serialization.xmlserializer) (doc)
- [Introduction to XML serialization, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/serialization/introducing-xml-serialization) (doc)
- [LINQ to XML overview, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/standard/linq/linq-xml-overview) (doc)
- [XmlReaderSettings.DtdProcessing, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.xmlreadersettings.dtdprocessing) (doc)
- [XmlReaderSettings.MaxCharactersFromEntities, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/api/system.xml.xmlreadersettings.maxcharactersfromentities) (doc)
