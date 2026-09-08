---
version: 1.0
updatedAt: 2026-08-06
title: "BDD com Cucumber"
summary: "Escrevendo especificações de comportamento em Gherkin legível pelo negócio (Given/When/Then) e ligando-as a step definitions Java com Cucumber, com a configuração atual io.cucumber + JUnit 5 Platform substituindo o info.cukes/@RunWith(Cucumber.class) obsoleto do livro, do JUnit in Action, Third Edition, Cap. 21."
---
## Objective

`Behavior-driven development` (BDD), criado por Dan North, estende o TDD escrevendo a especificação em linguagem legível pelo negócio em vez de código de teste. `Cucumber` é a ferramenta de BDD mais comum na JVM: os cenários são escritos em `Gherkin` (passos `Given`/`When`/`Then` em inglês simples) dentro de arquivos `.feature` que as partes interessadas conseguem ler, e cada passo é ligado a um método Java de `step definition` (`@Given`/`@When`/`@Then`). O Cucumber executa a feature, roda os passos correspondentes e reporta o sucesso ou falha de cada cenário, transformando critérios de aceitação em especificações vivas e executáveis.

## Use Cases

- Capturar critérios de aceitação como cenários que partes interessadas não técnicas (product owners, testers) conseguem ler e até ajudar a escrever.
- Transformar a estrutura `Given`/`When`/`Then` já usada para rotular testes unitários em especificações executáveis de primeira classe.
- Manter os requisitos permanentemente sincronizados com o código, já que um cenário desatualizado quebra o build.
- Conduzir o desenvolvimento de uma feature de cima para baixo a partir do comportamento de negócio, complementando os testes unitários TDD de baixo para cima.
- Fornecer uma linguagem compartilhada e onipresente entre negócio e engenharia, de modo que os testes de aceitação se tornem um instrumento de comunicação.

## Deep Dive

### O arquivo de feature em Gherkin

Os cenários vivem em um arquivo `.feature` em `src/test/resources`. Cada passo começa com uma palavra-chave; o texto é inglês simples:

```gherkin
Feature: Passengers Policy
  The company follows a policy of adding and removing passengers,
  depending on the passenger type and the flight type

  Scenario: Economy flight, regular passenger
    Given there is an economy flight
    When we have a regular passenger
    Then you can add and remove him from an economy flight
    And you cannot add a regular passenger to an economy flight more than once
```

### Ligando os passos ao código Java

Cada passo em Gherkin é casado com um método de step definition anotado com `@Given`/`@When`/`@Then`. O método contém as asserções JUnit de fato:

```java
public class PassengerPolicy {
    private Flight economyFlight;
    private Passenger regularPassenger;

    @Given("there is an economy flight")
    public void thereIsAnEconomyFlight() {
        economyFlight = new EconomyFlight("1");
    }

    @When("we have a regular passenger")
    public void weHaveARegularPassenger() {
        regularPassenger = new Passenger("Mike", false);
    }

    @Then("you can add and remove him from an economy flight")
    public void youCanAddAndRemoveHimFromAnEconomyFlight() {
        assertTrue(economyFlight.addPassenger(regularPassenger));
        assertTrue(economyFlight.removePassenger(regularPassenger));
    }
}
```

O Cucumber casa cada linha do Gherkin com o texto da anotação, injeta os parâmetros capturados e executa os passos em ordem para cada cenário.

### Livro vs. hoje: este capítulo tem o ferramental mais desatualizado do livro

> O capítulo de BDD (2020) usa uma versão **há muito obsoleta** do Cucumber, de modo que quase nada da configuração dele compila hoje. Três mudanças concretas:

> **1. `info.cukes` para `io.cucumber`.** O livro depende de `info.cukes:cucumber-java:1.2.5`. Esse groupId foi abandonado há anos; o Cucumber moderno (7.x) é `io.cucumber`, e os imports das step definitions mudaram de `cucumber.api.java.en.*` para `io.cucumber.java.en.*`:

```xml
<!-- book (dead) -->            <!-- today -->
<groupId>info.cukes</groupId>   <groupId>io.cucumber</groupId>
<artifactId>cucumber-java</artifactId>  <!-- + cucumber-junit-platform-engine -->
```

> **2. `@RunWith(Cucumber.class)` para a JUnit 5 Platform.** O livro afirma literalmente que "não existe extensão Cucumber para JUnit 5 no momento em que este texto foi escrito" e usa o runner do JUnit 4. Isso deixou de ser verdade: `cucumber-junit-platform-engine` mais `junit-platform-suite` executam features nativamente no JUnit 5:

```java
// book (JUnit 4)                          // today (JUnit 5 Platform Suite)
@RunWith(Cucumber.class)                    @Suite
@CucumberOptions(features="classpath:features")   @IncludeEngines("cucumber")
public class CucumberTest { }               @SelectClasspathResource("features")
                                            public class RunCucumberTest { }
```

> **3. Regex ancorada para Cucumber Expressions.** O livro escreve os padrões de passo como regex ancorada (`@Given("^there is an economy flight$")`). O Cucumber moderno usa Cucumber Expressions por padrão, então a string simples (`@Given("there is an economy flight")`) já é suficiente, com placeholders tipados como `{int}`/`{string}` quando é preciso capturar valores.

> **JBehave (Cap. 21.3) é uma alternativa de nicho.** O livro também cobre o JBehave como uma segunda ferramenta de BDD; hoje o Cucumber domina o espaço de BDD na JVM, então vale saber que o JBehave existe, mas raramente é a escolha padrão para um projeto novo.

## Trade-offs

- **Uma camada de especificação legível custa uma indireção extra**: cada cenário precisa de texto de feature *e* código de ligação, e uma incompatibilidade de digitação entre a linha do Gherkin e a string do `@Given` gera um "undefined step" em vez de uma falha clara:

```java
@Given("there is an economy flight")     // step text
// feature says "Given there is a economy flight" → undefined step, scenario skipped
```

- **O BDD só compensa quando não desenvolvedores realmente leem os cenários**: se apenas os engenheiros escrevem e leem os arquivos de feature, o Gherkin é puro overhead sobre testes JUnit simples; o valor está na linguagem compartilhada com as partes interessadas, não na sintaxe.
- **A reutilização de passos pode criar acoplamento oculto**: compartilhar step definitions entre features mantém o código enxuto (DRY), mas significa que o estado/setup de um passo pode vazar entre cenários, dificultando a localização de falhas.
- **Os arquivos de feature são mais um artefato a manter atualizado**: por serem executáveis, não podem apodrecer silenciosamente, mas um conjunto grande de cenários é manutenção real, e especificar demais um comportamento trivial em Gherkin é mais lento de alterar do que um teste unitário.

## Documentation Links

- [Cucumber: documentação oficial](https://cucumber.io/docs/cucumber/) (doc)
- [Gherkin reference: documentação do Cucumber](https://cucumber.io/docs/gherkin/reference/) (doc)
- [`cucumber-junit-platform-engine` (integração com JUnit 5): GitHub](https://github.com/cucumber/cucumber-jvm/blob/main/cucumber-junit-platform-engine/README.md) (doc)
- [JUnit in Action, 3rd Ed., Cap. 21, "Behavior-driven development with JUnit 5," pp. 437-470 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
