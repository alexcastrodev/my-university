---
version: 1.0
updatedAt: 2026-10-18
title: "Test Doubles em .NET: Fakes, Stubs e NSubstitute"
summary: Fake escrito à mão ou substituto do NSubstitute, o que um substituto não configurado devolve, o que não dá para substituir, e como Received, Arg.Any e valores default deixam um teste verde que não prova nada.
---
## Objective

Um test double substitui uma dependência com que o código testado conversa: um repositório, um
enviador de e-mail, um gateway de SMS. A teoria (stubs respondem, mocks verificam, fakes funcionam) é a
mesma em qualquer linguagem e já está nos concepts Java sobre test doubles e fragilidade de mocks. Este
concept é o lado .NET: quando um fake escrito à mão é a ferramenta melhor, como o NSubstitute cria stubs
e confere chamadas, o que ele devolve quando você não configurou nada, o que ele não consegue substituir,
e como cada um desses detalhes pode dar um teste verde que não prova nada. O objetivo é uma suíte em que
cada double existe por um motivo e cada asserção fala de algo que o usuário do código perceberia.

## Use Cases

- Testar um serviço que conversa com portas de e-mail e SMS sem enviar mensagem nem abrir socket.
- Escrever um fake pequeno em memória para uma porta cujo estado os testes leem depois (um log, um
  repositório).
- Fazer stub de um gateway que responde "aceito" ou "recusado" e conferir o fallback que o serviço toma.
- Simular uma falha (uma `Task` com falha) para provar que o serviço não deixa nada pela metade.
- Ler uma suíte existente que usa Moq e traduzi-la para NSubstitute, ou o contrário.

## Deep Dive

### Fake escrito à mão ou substituto?

Um fake é uma implementação que funciona da porta, em geral poucas linhas sobre uma coleção. Os testes o
preenchem antes do passo de ação e leem o estado dele depois:

```csharp
internal sealed class InMemoryNotificationLog : INotificationLog
{
    private readonly HashSet<string> _keys = [];

    public IReadOnlyCollection<string> Keys => _keys;

    public Task<bool> ContainsAsync(string key, CancellationToken ct) => Task.FromResult(_keys.Contains(key));

    public Task AddAsync(string key, CancellationToken ct)
    {
        _keys.Add(key);
        return Task.CompletedTask;
    }
}
```

Use um fake quando a dependência tem estado que importa para o teste ("foi registrado?", "está
guardado?"). Use um substituto de biblioteca quando o teste só precisa de uma resposta ("o gateway
aceitou") ou precisa conferir que uma mensagem saiu do sistema por uma porta (um e-mail para o endereço
certo). O lab usa os dois na mesma classe de teste: o log é um fake, o diretório e os dois enviadores
são substitutos do NSubstitute.

```xml
<PackageReference Include="MSTest" Version="4.5.1" />
<PackageReference Include="NSubstitute" Version="6.2.0" />
<PackageReference Include="NSubstitute.Analyzers.CSharp" Version="1.0.17" PrivateAssets="all" />
```

O NSubstitute 6 (julho de 2026) tem como alvo .NET 8 e .NET Standard 2.0 e removeu APIs obsoletas
antigas. O pacote de analyzers é opcional, e a própria documentação do NSubstitute o recomenda.

### Substitute.For, Returns e argument matchers

`Substitute.For<T>()` cria o substituto. Chamar um membro dele e depois `.Returns(...)` configura a
resposta para aqueles argumentos. Os substitutos ficam em campos de instância, e o MSTest cria uma nova
instância da classe de teste por teste, então nenhum teste enxerga o setup de outro:

```csharp
private readonly ICustomerDirectory _directory = Substitute.For<ICustomerDirectory>();

private void Known(Contact contact) =>
    _directory.FindAsync(Shipment.CustomerId, Arg.Any<CancellationToken>()).Returns(contact);
```

`FindAsync` devolve `Task<Contact?>`, e `Returns(contact)` embrulha o valor numa task concluída para
você. O mesmo vale para `ValueTask<T>`. Outras formas, conferidas com o NSubstitute 6.2.0:

```csharp
repo.Count().Returns(1, 2, 3);                              // uma sequência; o último valor se repete
repo.Find(Arg.Is<int>(id => id < 0)).Returns((Customer?)null);
repo.Find(Arg.Any<int>()).Returns(call => new Customer($"id{call.Arg<int>()}@example.com"));
repo.Exists(0).ReturnsForAnyArgs(false);                    // os argumentos desta chamada são ignorados
```

Quando dois setups casam com a mesma chamada, vale o último configurado. O matcher que você escolhe
decide o que o stub esconde: o `Known` do lab responde só para `Shipment.CustomerId`. Com
`Arg.Any<Guid>()` ele também responderia quando o serviço buscasse o id do pedido por engano, e a suíte
continuaria verde (veja a tabela de mutação abaixo).

### O que um substituto devolve quando você não configurou nada

Um substituto nunca lança exceção numa chamada não configurada. Ele devolve um valor, e alguns desses
valores parecem respostas de verdade. Observado com o NSubstitute 6.2.0:

| O membro devolve | O substituto não configurado devolve |
| --- | --- |
| `int`, `bool`, `DateTimeOffset` | `default` (0, `false`, `0001-01-01`) |
| `string`, arrays | `""`, um array vazio |
| uma interface (`IWidget`, `IEnumerable<int>`) | outro substituto (recursivo), o mesmo para os mesmos argumentos |
| uma classe como `List<int>`, um record | `null` |
| `Task` | uma task concluída |
| `Task<T>`, `ValueTask<T>` | uma task concluída com a regra acima para `T` (`Task<bool>` dá `false`) |

A última linha é a armadilha. `ISmsSender.SendAsync` devolve `Task<bool>`. Se o teste esquece o setup,
o gateway "recusa", o serviço cai para o e-mail, e este teste continua passando:

```csharp
// Quebrado: passa, e o cliente recebeu um e-mail em vez de um SMS.
Known(Ana(Channel.Sms));
var outcome = await NotifyAsync();
await _sms.Received(1).SendAsync("+15550100", Arg.Any<string>(), Arg.Any<CancellationToken>());
```

A correção é configurar aquilo de que o teste depende e conferir o resultado:

```csharp
Known(Ana(Channel.Sms));
_sms.SendAsync("+15550100", Arg.Any<string>(), Arg.Any<CancellationToken>()).Returns(true);

var outcome = await NotifyAsync();

Assert.AreEqual(NotificationOutcome.SentBySms, outcome);
await _email.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default);
```

Às vezes o default é exatamente o certo. Um cliente desconhecido é um diretório que devolve `null`,
então esse teste não configura nada e diz isso num comentário.

### Received e DidNotReceive conferem chamadas, não resultados

`Received(n)` confere que uma chamada com argumentos compatíveis aconteceu `n` vezes; `DidNotReceive()`,
que não aconteceu. Uma falha lança `ReceivedCallsException` e lista as chamadas que aconteceram:

```text
Expected to receive exactly 1 call matching:
	Send("z@x", "hi")
Actually received no matching calls.
Received 3 non-matching calls (non-matching arguments indicated with '*' characters):
	Send(*"a@x"*, "hi")
	Send(*"b@x"*, "hi")
	Send(*"boom"*, *""*)
```

Conferir a chamada é o certo para uma mensagem que sai do sistema: um e-mail para `ana@example.com` com
o número do pedido no assunto é o comportamento observável. Sozinho, é fraco para uma decisão. No lab,
um teste de cliente que pediu opt-out e só confere `DidNotReceive` passa quando o stub foi configurado
para outro id de cliente, porque aí o serviço responde `UnknownCustomer` e também não envia nada.
Confira primeiro o resultado que dá nome ao motivo, depois as chamadas:

```csharp
Known(Ana(optedOut: true));

var outcome = await NotifyAsync();

Assert.AreEqual(NotificationOutcome.OptedOut, outcome);
await _email.DidNotReceiveWithAnyArgs().SendAsync(default!, default!, default!, default);
```

Verificar toda chamada interna (`Received` no diretório, no log, numa ordem) amarra o teste à
implementação: um refactor inofensivo o deixa vermelho. Os concepts Java sobre comportamento observável
e sobre boas práticas de mocking explicam por quê; na prática, verifique as chamadas que cruzam a
fronteira do sistema e leia estado no resto.

### Falhas, callbacks e membros void

Uma task com falha simula uma dependência fora do ar. Uma sequência de tasks deixa um único teste
falhar primeiro e ter sucesso na nova tentativa:

```csharp
_email.SendAsync("ana@example.com", Arg.Any<string>(), Arg.Any<string>(), Arg.Any<CancellationToken>())
    .Returns(Task.FromException(new EmailDeliveryException("smtp down")), Task.CompletedTask);

await Assert.ThrowsExactlyAsync<EmailDeliveryException>(NotifyAsync);
Assert.IsEmpty(_log.Keys);
```

`ThrowsAsync` (em `NSubstitute.ExceptionExtensions`) faz o mesmo para uma chamada. O `Throws` simples
num membro que devolve `Task` lança no momento da chamada, antes de existir qualquer task; isso difere
de um método async de verdade sempre que quem chama não faz o await na hora (com `Task.WhenAll`, por
exemplo). O analyzer aponta isso como NS5003. Para membros `void`, que não aceitam `Returns`, use
`When..Do`:

```csharp
repo.When(x => x.Send(Arg.Any<string>(), Arg.Any<string>())).Do(call => sent.Add(call.ArgAt<string>(0)));
repo.When(x => x.Send("boom", Arg.Any<string>())).Throw(new InvalidOperationException("smtp"));
```

### O que não dá para substituir

O NSubstitute (via Castle DynamicProxy) cria em tempo de execução uma classe que implementa a interface
ou deriva da classe. Isso tem consequências:

- **Interfaces** são sempre seguras.
- **Classes sealed** não podem ser derivadas: `Substitute.For<HttpSmsSender>(...)` lança
  `TypeLoadException` ("the parent type is sealed").
- **Membros não virtuais** de uma classe rodam o código real, e o NSubstitute não enxerga a chamada.
  Pior, configurar um deles não falha. Nesta execução, o `Returns` se prendeu à última chamada que o
  substituto enxergou:

```csharp
var c = Substitute.For<Concrete>();
c.Virtual();                 // interceptado, devolve 0
c.NonVirtual().Returns(1);   // o código real roda; nenhuma exceção
// c.NonVirtual() continua devolvendo 42, e c.Virtual() agora devolve 1
c.Received().NonVirtual();   // passa sem conferir nada
```

- **Membros estáticos** (`DateTime.UtcNow`, `File.ReadAllText`) não estão em instância nenhuma, então
  não há o que substituir.

O analyzer acusa os dois primeiros erros em tempo de build (NS1000 no setup, NS1001 no `Received`). A
consequência de design é a lição de verdade: dependa de uma interface sua (`ISmsSender`), deixe o
adapter sealed (`HttpSmsSender`) atrás dela e teste o adapter separadamente. O lab o testa com um
`HttpMessageHandler` escrito à mão, porque `HttpMessageHandler.SendAsync` é `protected`. O tempo é a
dependência estática mais conhecida, e o próximo concept a troca por `TimeProvider`.

### NSubstitute e Moq lado a lado

O Moq é a outra biblioteca comum, então código existente costuma usá-lo. Estas equivalências foram
compiladas e executadas com o NSubstitute 6.2.0 e o Moq 4.21.0:

| Tarefa | NSubstitute | Moq |
| --- | --- | --- |
| criar | `var r = Substitute.For<IRepo>();` | `var m = new Mock<IRepo>(); var r = m.Object;` |
| stub de um valor | `r.Exists(5).Returns(true);` | `m.Setup(x => x.Exists(5)).Returns(true);` |
| argumento qualquer / com condição | `Arg.Any<int>()`, `Arg.Is<int>(id => id < 0)` | `It.IsAny<int>()`, `It.Is<int>(id => id < 0)` |
| valor async | `r.CountAsync().Returns(5);` | `m.Setup(x => x.CountAsync()).ReturnsAsync(5);` |
| falha async | `r.Save().ThrowsAsync(ex);` | `m.Setup(x => x.Save()).ThrowsAsync(ex);` |
| sequência | `r.Count().Returns(1, 2);` | `m.SetupSequence(x => x.Count()).Returns(1).Returns(2);` |
| callback | `r.When(x => x.Send(...)).Do(...)` | `m.Setup(x => x.Send(...)).Callback<string, string>(...)` |
| verificar | `r.Received(1).Send("a", Arg.Any<string>());` | `m.Verify(x => x.Send("a", It.IsAny<string>()), Times.Once());` |
| verificar que não houve | `r.DidNotReceive().Send(...)` | `m.Verify(x => x.Send(...), Times.Never());` |
| `string` não configurada | `""` | `null` |
| interface não configurada | um substituto recursivo | `null` |
| verificação que falha | `ReceivedCallsException` | `MockException` |

O Moq 4.20.0 (agosto de 2023) adicionou o SponsorLink, que usava um hash SHA256 do e-mail do
desenvolvedor para conferir patrocínio. A versão 4.20.2, um dia depois, o removeu; as release notes
citam uma falha de restore no macOS e as preocupações de privacidade levantadas sobre o hash. O
episódio ainda aparece quando um time escolhe a biblioteca. As duas são mantidas hoje (o Moq 4.21.0 e o
NSubstitute 6.2.0 saíram em 2026).

Com xUnit ou NUnit nada muda: substitutos são objetos comuns, e o xUnit também cria uma nova instância
da classe de teste por teste, então os mesmos campos funcionam lá.

### Os testes protegem as regras?

Quebre o código de produção de propósito, uma mudança por vez, e veja o que fica vermelho. Estes são os
resultados da solução do lab (11 testes):

| Mudança no código de produção | Testes que falham |
| --- | --- |
| O diretório é consultado com o id do pedido | 7 testes do serviço |
| Todo SMS conta como entregue | o teste de fallback |
| A checagem de opt-out é removida | o teste de opt-out |
| O registro no log é feito antes da entrega | o teste da nova tentativa e o de "não dá para alcançar" |
| O log nunca é consultado | o teste de "só uma vez" |
| O adapter HTTP ignora o status code | o teste do adapter "recusado" |

E as versões fracas dos testes, rodadas do mesmo jeito: `Known` com `Arg.Any<Guid>()` deixa a primeira
mutação passar (11 de 11 verdes), o teste de SMS sem `.Returns(true)` passa enquanto o cliente recebe um
e-mail, e um teste de opt-out que só confere `DidNotReceive` com um stub para o id errado passa quando a
checagem de opt-out some.

## Trade-offs

- **Fakes custam código; substitutos custam atenção.** Um fake cresce com a interface e pode se afastar
  da implementação real. Um substituto é uma linha, mas os defaults dele respondem em silêncio e os
  matchers decidem o que o teste consegue ver. Use fakes para portas com estado, substitutos para
  respostas e chamadas que saem.
- **Verificar chamadas acopla o teste à implementação.** Verifique mensagens que saem do sistema;
  confira resultados e estado no resto. Uma suíte cheia de `Received` em colaboradores internos quebra
  a cada refactor.
- **`ReturnsForAnyArgs` e `Arg.Any` são práticos e cegos.** Prefira o argumento exato quando ele faz
  parte da regra (o id do cliente, o destinatário).
  ```csharp
  _directory.FindAsync(Arg.Any<Guid>(), Arg.Any<CancellationToken>()).Returns(contact); // responde também para o id errado
  ```
- **Os limites da biblioteca empurram o design.** Tipos sealed, membros estáticos e métodos não
  virtuais não podem ser substituídos. Em geral é um bom empurrão (dependa de uma interface sua), mas
  também significa que adapters precisam de testes próprios contra um transporte com stub ou uma
  dependência real.
- **O analyzer é um seguro barato.** NS1000, NS1001 e NS5003 pegam usos errados que, sem ele, viram
  testes verdes que não conferem nada.
- **NSubstitute ou Moq é escolha do time.** Os conceitos são os mesmos, a sintaxe muda, e os defaults
  mudam (`""` e substitutos recursivos contra `null`). Não misture os dois no mesmo projeto.

## Lab

Um serviço que avisa os clientes de que o pedido foi despachado já está implementado, com portas para o
diretório de clientes, e-mail, SMS e um log. Sua tarefa é escrever os testes MSTest, com um fake
escrito à mão para o log e NSubstitute para o resto, e descobrir onde um test double faz um teste
passar pelo motivo errado.

**O que você vai praticar**

- Escrever um fake em memória à mão e ler o estado dele nas asserções.
- Configurar stubs do NSubstitute com argumentos exatos, sequências e tasks com falha.
- Conferir primeiro o resultado e depois as chamadas, com `Received` e `DidNotReceive`.
- Testar um adapter HTTP sealed com um `HttpMessageHandler` escrito à mão (opcional).

**Pré-requisitos:** o concept e o lab de MSTest Fundamentals, `async`/`await` básico, .NET 10 SDK.

**Como funciona:** cada método de teste já está declarado com uma dica e falha com `TODO-NN: write this test` até você escrevê-lo. Três dicas pedem para escrever primeiro a versão fraca e vê-la passar. Os TODOs opcionais cobrem o adapter, um teste de aprendizado sobre classes sealed e uma checagem de mutação.

## Documentation Links

- [NSubstitute: Getting started](https://nsubstitute.github.io/help/getting-started/) (doc)
- [NSubstitute: Creating a substitute](https://nsubstitute.github.io/help/creating-a-substitute/) (doc)
- [NSubstitute: Auto and recursive mocks](https://nsubstitute.github.io/help/auto-and-recursive-mocks/) (doc)
- [NSubstitute: Throwing exceptions](https://nsubstitute.github.io/help/throwing-exceptions/) (doc)
- [NSubstitute: Callbacks, void calls and When..Do](https://nsubstitute.github.io/help/callbacks/) (doc)
- [NSubstitute 6.0.0 release notes](https://github.com/nsubstitute/NSubstitute/releases/tag/v6.0.0) (doc)
- [NSubstitute.Analyzers rules](https://github.com/nsubstitute/NSubstitute.Analyzers/tree/master/documentation/rules) (doc)
- [Moq 4.20.2 release notes (SponsorLink removed)](https://github.com/devlooped/moq/releases/tag/v4.20.2) (doc)
- [MSTest assertions, Microsoft Learn](https://learn.microsoft.com/en-us/dotnet/core/testing/unit-testing-mstest-writing-tests-assertions) (doc)
