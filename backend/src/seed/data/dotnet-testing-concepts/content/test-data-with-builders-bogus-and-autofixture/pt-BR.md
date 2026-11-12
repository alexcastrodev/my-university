---
version: 1.0
updatedAt: 2026-11-12
title: "Dados de teste com Builders, Bogus e AutoFixture"
summary: Monte dados de teste de três jeitos com MSTest 4 (Test Data Builder à mão, Bogus com seed fixa e AutoFixture com AutoNSubstitute) e saiba quando cada um esconde a intenção do teste.
---
## Objective

Todo teste precisa de dados, e o jeito de montá-los decide o que o teste diz.
Uma chamada de construtor longa enterra o único valor que importa; dado
aleatório sem seed torna a falha impossível de reproduzir; dado totalmente
anônimo esconde de qual entrada a asserção depende. O objetivo é montar dados
de teste de três jeitos, com MSTest 4: um Test Data Builder escrito à mão,
Bogus com seed fixa e AutoFixture com AutoNSubstitute, e saber quando cada um
deixa a intenção do teste mais clara e quando a deixa mais vaga.

## Use Cases

- Escrever um teste de regra que nomeia só o fato de que a regra depende (um
  cliente premium, um pedido de exatamente 500) e deixa o resto num padrão válido.
- Gerar algumas centenas de pedidos realistas para checar uma propriedade ("o
  desconto é sempre uma de quatro taxas") de um jeito que dá para repetir quando falha.
- Criar um serviço com cinco dependências no construtor em uma linha, com toda
  interface já virando substituto, quando o teste só se importa com uma delas.
- Popular o banco de um teste de integração com nomes e e-mails plausíveis.

## Deep Dive

### Um Test Data Builder diz só o que importa

A regra testada: clientes premium têm 10%, pedidos de 500 ou mais têm mais 5%, e
os dois se somam. Sem builder, todo teste repete o grafo inteiro:

```csharp
var order = new Order(Guid.NewGuid(),
    new Customer(Guid.NewGuid(), "Ana", "ana@example.com", IsPremium: true),
    [new OrderLine("SKU-1", 1, 50m)]);
```

De quais desses valores o teste depende? Só lendo a regra para saber. Um builder
tem um padrão válido e um método por fato que o teste quer declarar:

```csharp
public sealed class OrderBuilder
{
    private bool _premium;
    private List<OrderLine> _lines = [new("SKU-1", 1, 10m)];

    public OrderBuilder Premium() { _premium = true; return this; }
    public OrderBuilder Worth(decimal total) => WithLines(new OrderLine("SKU-1", 1, total));
    public OrderBuilder WithLines(params OrderLine[] lines) { _lines = [.. lines]; return this; }

    public Order Build() => new(
        new Guid("00000000-0000-0000-0000-000000000001"),
        new Customer(new Guid("00000000-0000-0000-0000-0000000000c1"), "Ana", "ana@example.com", _premium),
        _lines);
}
```

```csharp
var order = new OrderBuilder().Premium().Worth(500m).Build();
Assert.AreEqual(0.15m, DiscountPolicy.RateFor(order));
```

O teste agora se lê como a regra. Dois detalhes tornam o builder confiável. Os
padrões são valores fixos: um `Guid` literal, não `Guid.NewGuid()`, e nenhum
relógio, então um teste que falha falha do mesmo jeito sempre. E o número do
teste é escolhido para a regra: `Worth(500m)` fica exatamente no limite, enquanto
`Worth(600m)` ainda passaria se a checagem de produção fosse `> 500`.

Um Object Mother (`Orders.Premium()`, `Orders.Bulk()`) é a mesma ideia com objetos
prontos e nomeados. Começa bem e termina como um catálogo de quase-duplicatas
("PremiumBulkOrderWithTwoLines"). Prefira o builder quando os testes precisam de
variações, e deixe um Object Mother só para poucas fixtures estáveis e com sentido.

### Bogus: dados realistas que você consegue repetir

O Bogus gera nomes, e-mails, endereços e números. Em teste unitário, o risco é a
aleatoriedade: se o dado muda a cada execução, uma falha no CI é um dado que você
nunca mais vai ver. `UseSeed` resolve o problema:

```csharp
using Bogus;

public static Faker<Customer> Customers(int seed = 1234) =>
    new Faker<Customer>("en")
        .UseSeed(seed)
        .CustomInstantiator(f => new Customer(f.Random.Guid(), f.Name.FullName(), f.Internet.Email(), f.Random.Bool()));
```

Com a mesma seed, dois fakers produzem listas iguais, um teste que vale escrever
uma vez, porque o resto da suíte depende disso:

```csharp
CollectionAssert.AreEqual(Fakes.Customers(7).Generate(5), Fakes.Customers(7).Generate(5));
CollectionAssert.AreNotEqual(Fakes.Customers(7).Generate(5), Fakes.Customers(8).Generate(5));
```

Um faker com seed é determinístico, não significativo: dá cobertura ampla do espaço
de entrada, não um motivo. Serve para checagens no estilo de propriedade sobre muitos
objetos. Prove que os dados gerados cobrem os dois ramos antes de confiar na
asserção, senão "os 200 pedidos dão uma taxa válida" pode ser 200 pedidos pequenos
de clientes comuns:

```csharp
var orders = Fakes.Orders(42).Generate(200);
Assert.IsTrue(orders.Any(o => o.Customer.IsPremium) && orders.Any(o => !o.Customer.IsPremium));
Assert.IsTrue(orders.Any(o => o.Total >= DiscountPolicy.BulkThreshold) && orders.Any(o => o.Total < DiscountPolicy.BulkThreshold));

decimal[] allowed = [0m, 0.05m, 0.10m, 0.15m];
foreach (var order in orders) CollectionAssert.Contains(allowed, DiscountPolicy.RateFor(order));
```

Não recalcule a regra no teste (`expected = premium ? 0.1 : 0 ...`): isso é uma
cópia do código de produção, e passa quando os dois erram do mesmo jeito. O Bogus
também serve para popular um banco de desenvolvimento ou de integração. A versão
atual é a 35.6.5.

### AutoFixture e AutoNSubstitute: valores anônimos, dublês automáticos

O AutoFixture cria qualquer grafo de objetos com valores arbitrários, e a
`AutoNSubstituteCustomization` transforma toda interface que encontra num
substituto do NSubstitute. Um serviço com duas dependências de interface vira uma linha:

```csharp
using AutoFixture;
using AutoFixture.AutoNSubstitute;

var fixture = new Fixture().Customize(new AutoNSubstituteCustomization());
var repository = fixture.Freeze<IOrderRepository>();   // a instância que o serviço recebe
var email = fixture.Freeze<IEmailSender>();
var order = fixture.Create<Order>();
var sut = fixture.Create<OrderService>();

await sut.PlaceAsync(order, ct);

await repository.Received(1).SaveAsync(order, ct);
await email.Received(1).SendAsync(order.Customer.Email, Arg.Any<string>(), ct);
```

`Freeze` é a chamada-chave: sem ela a fixture entregaria um substituto ao serviço
e outro a você. Aqui o pedido é anônimo de propósito, porque nada no teste depende
dos valores dele. É o AutoFixture no melhor uso: o teste declara "qualquer pedido",
e quem lê sabe que não importa.

Deixa de ser claro quando a asserção depende de um valor. O AutoFixture escolhe
strings, números e booleanos por você, então um teste do desconto com um pedido
totalmente anônimo confere um resultado que depende de dados que ele nunca
escreveu. Fixe exatamente os fatos que a expectativa precisa, com uma expressão
`with` no record, e deixe o resto anônimo:

```csharp
var order = fixture.Create<Order>() with
{
    Customer = fixture.Create<Customer>() with { IsPremium = true },
    Lines = [new OrderLine("SKU-1", 1, 100m)],
};

Assert.AreEqual(90m, await sut.PlaceAsync(order, ct));
```

A mesma fixture define `Lines = []` no teste que rejeita um pedido sem linhas: um
valor fixado, justamente o assunto do teste.

Sobre versão: a linha estável no NuGet é AutoFixture 4.18.1 e
`AutoFixture.AutoNSubstitute` 4.18.1 (o lab roda os dois em net10.0). A versão
5.0.0-rc.1 existe mas é release candidate, então ensine e use a 4.x. Restaurar a
4.18.1 com NSubstitute 6.2.0 imprime o aviso NU1608 (o pacote declara NSubstitute
abaixo de 6.0.0); mesmo assim os testes do lab rodam bem com a 6.2.0.

### Quando cada um esconde a intenção

- **Builder:** não esconde nada, mas esconde os padrões. Mantenha-os pequenos e fixos,
  e nomeie os métodos por fatos do domínio (`Premium()`), não por campos (`WithIsPremium(true)`).
- **Bogus:** esconde o valor de que a falha depende. Quando um teste com seed falha,
  imprima a seed e o objeto culpado na mensagem, ou transforme o caso num teste de
  builder com aquele dado exato.
- **AutoFixture:** esconde o que a asserção precisa. Se você não sabe dizer de qual
  valor anônimo o resultado depende, o teste não está pronto: fixe-o.

Uma regra útil: quem lê deve conseguir dizer, só pelo teste, qual entrada torna a
asserção verdadeira. Seja qual for a ferramenta, os valores que importam aparecem no
teste e todo o resto pode ser entediante.

## Trade-offs

- **Builders são código que você mantém.** Cada conceito do domínio ganha um builder, e
  uma mudança de construtor mexe num builder em vez de em 200 testes. Esse é o ponto, e
  o custo: não crie um para um tipo usado em dois testes.
- **Determinismo versus cobertura.** Seed fixa dá uma execução repetível, mas com as
  mesmas entradas sempre. Rodar a seed rotativa a cada execução acha mais bugs e torna as
  falhas mais difíceis de reproduzir, a menos que a seed seja registrada. Use seed fixa na
  suíte normal e uma rotativa num job noturno que a imprime.
- **Dado realista não é dado representativo.** Os nomes do Bogus parecem reais e não
  dizem nada sobre os casos de borda (um nome de 255 caracteres, uma lista vazia). Os
  casos de borda continuam escritos à mão.
- **O AutoFixture acopla os testes à construção.** Um novo parâmetro obrigatório no
  construtor é criado automaticamente, então os testes continuam compilando, o que é bom,
  e também significa que um teste pode passar a depender, em silêncio, de um valor que
  ninguém escolheu. Um teste de regra que fica totalmente anônimo é um cheiro.
- **O AutoFixture 5 ainda não é estável.** Fixar na 4.18.1 é seguro hoje; planeje uma
  migração quando a 5.x sair.
- **Dado anônimo não substitui um limite.** `fixture.Create<int>()` nunca vai cair
  exatamente em 500. Limites são escolhidos, não gerados.

## Lab

A loja já está implementada: uma `DiscountPolicy` e um `OrderService` que salva um pedido e envia e-mail ao cliente. Sua tarefa é montar os dados de teste de três jeitos e ver o que cada um diz sobre o teste.

**O que você vai praticar**

- Um Test Data Builder com padrões fixos e um teste de limite em exatamente 500.
- Um faker do Bogus com seed, um teste de determinismo e uma checagem de propriedade sobre pedidos gerados.
- AutoFixture com `AutoNSubstituteCustomization`, `Freeze` e expressões `with` que fixam só o que importa.

**Pré-requisitos:** o concept Test Doubles com NSubstitute, o básico de MSTest, .NET 10 SDK.

**Como funciona:** o código de produção está pronto; todo método de teste falha com `TODO-NN: write this test` até você escrevê-lo, e `OrderBuilder` e `Fakes` são stubs para você implementar.

## Documentation Links

- [Bogus on GitHub](https://github.com/bchavez/Bogus) (doc)
- [AutoFixture on GitHub](https://github.com/AutoFixture/AutoFixture) (doc)
- [AutoFixture.AutoNSubstitute on NuGet](https://www.nuget.org/packages/AutoFixture.AutoNSubstitute) (doc)
- [Bogus on NuGet](https://www.nuget.org/packages/Bogus) (doc)
- [NSubstitute documentation](https://nsubstitute.github.io/help/getting-started/) (doc)
