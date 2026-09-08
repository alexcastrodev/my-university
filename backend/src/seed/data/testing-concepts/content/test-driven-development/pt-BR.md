---
version: 1.0
updatedAt: 2026-08-06
title: "Desenvolvimento Orientado a Testes"
summary: "O ciclo red-green-refactor: escreva primeiro um teste que falha, adicione o menor código para passá-lo, então refatore com segurança, conduzindo o design com JUnit 5, do JUnit in Action, Third Edition, Cap. 20."
---
## Objective

O `test-driven development` (TDD) inverte a ordem usual de trabalho: em vez de `[código, teste]`, você trabalha `[teste, código, refatoração]`, repetindo em um ciclo curto. Você escreve um teste que **falha** e expressa o que o código deveria fazer, escreve a **menor** quantidade de código que o faz passar, então **refatora** para melhorar a estrutura enquanto o teste mantém você seguro. Atribuído a Kent Beck, o TDD busca "código limpo que funciona": o teste conduz o design, se torna o primeiro cliente da API, e serve também como documentação viva.

## Use Cases

- Adicionar uma funcionalidade nova escrevendo primeiro um teste que a especifica, de modo que o código escrito seja conduzido por um objetivo concreto e verificável.
- Cobrir código existente/legado com testes de caracterização antes de alterá-lo, para que uma refatoração não consiga quebrar comportamento silenciosamente.
- Projetar uma API do ponto de vista de quem a chama: escrever o teste primeiro força você a usar o método antes de implementá-lo.
- Construir uma rede de segurança contra regressões, para que uma refatoração posterior (ou uma correção de bug) não consiga reintroduzir um defeito sem um teste vermelho.
- Produzir documentação executável: os testes descrevem, em código, exatamente o que cada unidade deve fazer.

## Deep Dive

### O ciclo red-green-refactor

O TDD é um loop de três passos curtos:

```
1. RED       — escreva um teste para um comportamento que ainda não existe; rode-o; veja-o falhar.
2. GREEN     — escreva o código mínimo para passar aquele teste; rode-o; veja-o passar.
3. REFACTOR  — melhore a estrutura do código sem mudar comportamento; os testes continuam verdes.
```

O teste que falha vem *primeiro*: ele prova que o teste consegue falhar (para que um sucesso posterior seja significativo) e fixa o requisito antes de qualquer implementação existir.

### Red: escreva primeiro o teste que falha

Para as regras de gerenciamento de voo (qualquer passageiro pode entrar em um voo econômico), o teste é escrito antes de `EconomyFlight` se comportar corretamente:

```java
@Test
void testEconomyFlightRegularPassenger() {
    Flight economyFlight = new EconomyFlight("1");
    Passenger passenger = new Passenger("Mike", false); // not VIP

    assertEquals("1", economyFlight.getId());
    assertTrue(economyFlight.addPassenger(passenger));   // fails: not implemented yet
    assertEquals(1, economyFlight.getPassengersSet().size());
    assertTrue(economyFlight.removePassenger(passenger));
}
```

### Green: o menor código que passa

Implemente apenas o suficiente para deixar o teste verde, sem comportamento extra especulativo:

```java
public boolean addPassenger(Passenger passenger) {
    return passengersSet.add(passenger);   // minimal: economy accepts anyone
}
```

### Refactor: melhore a estrutura, mantenha os testes verdes

Uma vez que os testes passam, reestruture com segurança. O livro começa com uma única classe `Flight` que decide com base em uma string `flightType`, depois refatora para polimorfismo, um `Flight` abstrato com subclasses `EconomyFlight`/`BusinessFlight`, rodando os testes depois de cada passo para confirmar que o comportamento não mudou:

```java
// before: decisions driven by a type flag
public boolean addPassenger(Passenger p) {
    if (flightType.equals("Economy")) { return passengers.add(p); }
    else if (flightType.equals("Business")) { if (p.isVip()) return passengers.add(p); return false; }
    throw new RuntimeException("Unknown type");
}

// after: each subclass owns its rule; no type flag, no branching
public class BusinessFlight extends Flight {
    @Override public boolean addPassenger(Passenger p) {
        return p.isVip() && passengers.add(p);
    }
}
```

Como os testes já existem e continuam verdes, a refatoração é segura; essa segurança é exatamente o que torna possível refatorar de forma agressiva.

## Trade-offs

- **Disciplina e tempo inicial vs. menos defeitos e documentação viva**: escrever o teste primeiro parece mais lento por funcionalidade, e o ganho (bugs capturados cedo, uma rede de segurança que habilita refatoração, documentação executável) é real mas adiado, então o TDD é uma venda difícil sob pressão de curto prazo.
- **Testes podem se acoplar demais à implementação**: um teste que afirma sobre passos internos, em vez de comportamento observável, quebra a cada refatoração, derrotando o propósito; testes de TDD deveriam afirmar *o quê* a unidade faz, não *como*:

```java
assertTrue(economyFlight.addPassenger(passenger)); // behavior, survives refactoring
// vs. asserting an internal call/order, brittle, breaks when internals change
```

- **O TDD só cobre a base da pirâmide**: ele conduz o design no nível unitário, mas não substitui testes de integração, sistema ou aceitação; testes unitários verdes não dizem nada sobre se os componentes funcionam juntos (veja o conceito da pirâmide de testes).
- **Encaixe pobre para trabalho exploratório/spike**: quando você ainda não sabe o design ou a API, escrever testes primeiro pode travar uma forma que você vai descartar; spikes costumam funcionar melhor sendo feitos primeiro pelo código, e reabordados com TDD depois que a direção estiver clara.

## Documentation Links

- [Test-Driven Development: Martin Fowler](https://martinfowler.com/bliki/TestDrivenDevelopment.html) (doc)
- [JUnit 5 User Guide: Escrevendo Testes](https://docs.junit.org/current/user-guide/#writing-tests) (doc)
- [JUnit in Action, 3rd Ed., Cap. 20, "Test-driven development with JUnit 5," pp. 405-436 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
