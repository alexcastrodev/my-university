---
version: 1.0
updatedAt: 2026-08-06
title: "A Estratégia da Pirâmide de Testes"
summary: "Como distribuir testes entre níveis: muitos testes unitários rápidos na base, cada vez menos testes de integração/sistema/aceitação em direção ao topo, o que testar em cada nível, e qual ferramenta se encaixa em cada um, do JUnit in Action, Third Edition, Cap. 22."
---
## Objective

A `pirâmide de testes` é uma estratégia sobre *quantos* testes de cada tipo escrever. Os testes de software formam uma hierarquia: unitário na base, depois integração, depois sistema, depois aceitação no topo, e o formato de pirâmide prescreve suas proporções: **muitos** testes unitários rápidos e baratos na base, e progressivamente **menos** testes lentos e caros em direção ao topo. O objetivo é capturar a maioria dos defeitos no nível mais barato, ainda verificando, com um punhado de testes de nível mais alto, que o sistema inteiro funciona. Cada nível mapeia para uma ferramenta: JUnit 5 + Mockito para unidades, JUnit 5 (frequentemente com Spring) para integração, Selenium para sistema/UI, Cucumber para aceitação.

## Use Cases

- Decidir a mistura de testes para um projeto: escrever a maioria no nível unitário e só alguns testes de ponta a ponta, em vez do inverso.
- Diagnosticar uma suíte de testes lenta e instável (geralmente uma pirâmide invertida, testes demais de UI/E2E, poucos demais no nível unitário).
- Escolher o nível certo para uma dada verificação: regra de negócio → unidade; interação de componente → integração; jornada de usuário → aceitação.
- Estruturar os testes de uma base de código nova para que o loop de feedback rápido (unidades) continue rápido e a suíte lenta (E2E) continue pequena.
- Decidir *o que* testar no nível unitário: lógica de negócio, entradas ruins, limites, invariantes e regressões.

## Deep Dive

### Os quatro níveis, de baixo para cima

Do mais barato/numeroso ao mais caro/escasso (os próprios níveis são definidos no conceito "Princípios de Teste de Software"):

```
        ▲  Aceitação     — satisfaz o usuário final? (cenários Cucumber)
       ▲▲  Sistema       — sistema inteiro vs. spec, sem conhecimento de código (Selenium/UI)
      ▲▲▲  Integração    — unidades verificadas, combinadas e testadas juntas (JUnit 5 + Spring)
     ▲▲▲▲  Unidade       — cada classe/método isoladamente (JUnit 5 + Mockito)
```

Testes de nível baixo são detalhados e rápidos; testes de nível alto são abstratos, mais próximos do usuário, e mais lentos. A pirâmide diz: empurre o teste para *baixo*: prefira um teste unitário a um de integração, e um de integração a um de ponta a ponta, sempre que um nível puder dar a mesma confiança.

### O que testar (a checklist do nível unitário)

Na base, o livro enumera o que merece um teste. Um único value object mostra vários de uma vez:

```java
@Test
void rejectsNegativeSeatCount() {                 // bad input value
    assertThrows(RuntimeException.class, () -> new Flight("AA1", -5));
}

@Test
void acceptsBoundaryValues() {                     // boundary conditions
    assertEquals(0, new Flight("AA1", 0).getPassengers().size()); // min: empty flight
}

@Test
void identifierCannotChangeToInvalid() {           // invariant
    Passenger p = new Passenger("900-45-6789", "Mike", "US");
    assertThrows(RuntimeException.class, () -> p.setIdentifier("bad"));
}
```

A checklist: **lógica de negócio**, **valores de entrada ruins**, **condições de limite** (mín/máx/vazio/cheio), **condições inesperadas**, **invariantes** (valores que não devem mudar), e **regressões** (um teste por bug corrigido para que não volte).

### Mapeando ferramentas aos níveis

A pirâmide é construída com as ferramentas do livro todo, cada uma no seu nível:

```
Unidade       JUnit 5 + Mockito      — isola uma classe, mocka seus colaboradores
Integração    JUnit 5 (+ Spring)     — carrega colaboradores reais juntos (@SpringBootTest, DB)
Sistema       Selenium WebDriver     — controla a UI rodando de ponta a ponta
Aceitação     Cucumber (Gherkin)     — verifica cenários de negócio na linguagem das partes interessadas
```

Uma suíte saudável roda a base larga de unidades a cada mudança (segundos), e o topo estreito (Selenium/Cucumber) com menos frequência (minutos); o formato mantém o feedback rápido de fato rápido.

## Trade-offs

- **Inverter a pirâmide (o "cone de sorvete") arruína o feedback**: muitos testes lentos de UI/E2E sobre uma base fina de unidades dá uma suíte lenta, frágil e instável, porque toda mudança pequena reexecuta testes caros e dependentes de ambiente:

```
  ▼▼▼▼  many E2E/UI   ← slow, flaky, expensive
   ▼▼   some integration
    ▼   few unit      ← anti-pattern: push tests DOWN instead
```

- **Testes unitários são rápidos, mas cegos para integração**: uma classe pode passar em todo teste unitário e ainda falhar quando conectada aos seus colaboradores reais (SQL errado, bean mal configurado), que é exatamente o que os (menos numerosos) testes de integração existem para capturar.
- **Testes de ponta a ponta dão mais confiança e mais dor**: eles exercitam o sistema real como um usuário faria, mas são lentos, precisam de um ambiente completo, e falham por razões que não são de código (tempo, rede, dados de teste), então você quer poucos deles, mirando jornadas críticas.
- **As proporções são heurísticas, não leis**: "quantos" depende do sistema (uma aplicação carregada de UI precisa de mais testes de sistema do que uma biblioteca pura); a pirâmide é um viés a favor de testes baratos, não uma proporção fixa a impor mecanicamente.

## Documentation Links

- [A Pirâmide de Testes Prática: Martin Fowler / Ham Vocke](https://martinfowler.com/articles/practical-test-pyramid.html) (doc)
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) (doc)
- [JUnit in Action, 3rd Ed., Cap. 22, "Implementing a test pyramid strategy with JUnit 5," pp. 471-491 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
