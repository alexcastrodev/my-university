---
version: 1.0
updatedAt: 2026-08-17
title: "Estruturando e Nomeando Testes Unitários: AAA e Nomes em Inglês Simples"
summary: "As regras reais do padrão AAA além de \"use três seções\": nunca escreva múltiplas seções de act ou um if dentro de um teste, trate uma seção de act com mais de uma linha como um mau cheiro no código de produção e não um problema do teste, e rejeite a nomenclatura rígida MethodUnderTest_Scenario_Result em favor de nomes de teste em inglês simples."
---
## Objective

O padrão AAA (arrange, act, assert) dá a todo teste um formato uniforme e previsível, mas o capítulo de Khorikov vai muito além de "use três seções": um teste com mais de uma seção de act está testando mais de um comportamento e deveria ser dividido; uma seção de act com mais de uma linha costuma significar que a API do SUT está vazando uma lacuna de encapsulamento, não que o teste esteja fazendo algo errado; e a convenção rígida de nomenclatura `MethodUnderTest_Scenario_ExpectedResult`, que muitos times adotam, é ativamente contraproducente: ela otimiza para descrever código em vez de descrever comportamento.

## Use Cases

- Revisar um teste com múltiplos blocos de act/assert e reconhecê-lo como um teste de integração vestido de teste unitário (ou um sinal de que o teste unitário precisa ser dividido).
- Detectar uma seção de act de duas linhas em revisão de código e tratá-la como uma pista de que a classe de produção precisa de um único método que garanta os dois resultados acontecendo juntos, não como uma pista de que o teste precisa de um comentário.
- Renomear uma suíte de testes, abandonando nomes no estilo `methodName_scenario_result` em favor de descrições em inglês simples que um especialista de domínio conseguiria ler.
- Decidir se uma seção de arrange que está crescendo deveria virar um método de fábrica privado dentro da classe de teste ou continuar inline.

## Deep Dive

### O padrão AAA e sua única exceção real

```java
@Test
void sumOfTwoNumbers() {
    // Arrange
    double first = 10;
    double second = 20;
    Calculator sut = new Calculator();

    // Act
    double result = sut.sum(first, second);

    // Assert
    assertThat(result).isEqualTo(30);
}
```

Given-When-Then é o mesmo padrão com nomes diferentes (Given = arrange, When = act, Then = assert); escolha-o quando o público incluir não programadores, já que se lê de forma mais natural para eles; não há diferença estrutural. Comece pelo arrange no trabalho do dia a dia, mas ao praticar TDD, tudo bem (até preferível) escrever a seção de assert primeiro, já que escrever a expectativa é o que força você a pensar no comportamento antes de implementá-lo.

**Nunca escreva mais de um grupo de arrange/act/assert em um único teste unitário.** Um teste com uma segunda seção de act está verificando duas unidades de comportamento, o que o torna um teste de integração por definição (veja o conceito irmão `classical-vs-london-schools` para o que separa os dois). Divida-o em dois testes. A única exceção: uma suíte de teste de integração *lenta* pode deliberadamente encadear múltiplos grupos de act/assert para amortizar um setup caro, mas só quando um passo de act também serve como o arrange do próximo, e só como uma troca de desempenho para testes que já são lentos, nunca para testes unitários comuns.

**Nunca escreva um `if` dentro de um teste, nem em testes unitários nem de integração, sem exceções.** Ramificação em um teste é o mesmo sinal de uma segunda seção de act: o teste verifica mais de um cenário, mas, diferente de múltiplos blocos AAA, não há troca de desempenho que a justifique aqui. Divida em testes separados em vez disso.

### Uma seção de act com múltiplas linhas é um mau cheiro no código de produção, não no teste

```java
// One-line act — a well-encapsulated API:
boolean success = customer.purchase(store, Product.SHAMPOO, 5);

// Two-line act — a leaking API:
boolean success = customer.purchase(store, Product.SHAMPOO, 5);
store.removeInventory(success, Product.SHAMPOO, 5);
```

A versão de duas linhas não é um erro de escrita de teste; o teste ainda verifica a mesma unidade de comportamento. O problema é que `Customer` exige que quem o chama lembre de uma segunda chamada para manter o estoque do store consistente com a compra. Esquecer essa segunda chamada produz uma **violação de invariante**: um recibo sem a redução de estoque correspondente. A correção pertence a `Customer.purchase()`, não ao teste: dobre a atualização de estoque dentro de um único método, para que os dois resultados nunca possam acontecer de forma independente. Essa diretriz se aplica com mais força a lógica de negócio/domínio; código utilitário ou de infraestrutura é mais frequentemente e legitimamente multi-passo.

### Dimensionando as outras duas seções

A seção de arrange normalmente é a maior, podendo chegar a ser tão grande quanto act e assert somados. Além disso, extraia-a para métodos de fábrica privados na classe de teste (veja o conceito irmão `reusing-test-fixtures-and-parameterized-tests`). A seção de assert pode legitimamente conter várias asserções relacionadas; "uma asserção por teste" é folclore remanescente de confundir *unidade de código* com *unidade de comportamento* (veja `classical-vs-london-schools`); um único comportamento pode ter múltiplos resultados observáveis, e é correto checar todos eles em um único teste. Fique atento, em vez disso, a uma seção de assert que continua crescendo porque está afirmando campo por campo sobre um objeto retornado; isso costuma ser sinal de que o objeto está sem um `equals()` adequado, o que permitiria que uma única asserção substituísse várias.

A maioria dos testes unitários não precisa de nenhuma fase de teardown, porque nunca tocam uma dependência fora de processo e, portanto, não deixam nada para limpar; teardown é território de teste de integração (veja o conceito irmão `database-testing-lifecycle-and-scope`).

### Nomeando o SUT e separando as seções visualmente

Nomeie o sistema sob teste `sut` em todo teste, independentemente do nome real de sua classe; com vários colaboradores em jogo, um nome consistente para "a coisa sendo testada" remove qualquer ambiguidade sobre quem é quem.

```java
Calculator sut = new Calculator();
double result = sut.sum(first, second);
```

Separe as três seções ou com comentários `// Arrange` / `// Act` / `// Assert` ou com uma única linha em branco entre cada uma. A separação por linha em branco é o padrão melhor para testes curtos que seguem o AAA de forma limpa, sem agrupamento interno necessário; mantenha os comentários para testes maiores (típicos de testes de integração), onde a própria seção de arrange precisa de linhas em branco internas para agrupar sub-passos, já que linhas em branco sozinhas ficariam ambíguas nesse caso.

### Nomeando um teste unitário: rejeite a convenção rígida

```java
// Rigid convention — optimizes for describing code, not behavior:
void isDeliveryValid_invalidDate_returnsFalse() { ... }

// Plain English — optimizes for describing behavior:
void deliveryWithAPastDateIsInvalid() { ... }
```

`[MethodUnderTest]_[Scenario]_[ExpectedResult]` é uma das convenções de nomenclatura de teste mais comuns e, segundo Khorikov, uma das menos úteis; ela incentiva nomear o teste segundo o *caminho de código*, e o nome do método repetido mais a fraseologia mecânica `Returns...` se lê como ruído para quem ainda não está fundo na implementação. Três diretrizes concretas em vez disso:

1. **Não siga uma política rígida de nomenclatura.** Um comportamento complexo raramente se encaixa em um template fixo; permita frases completas.
2. **Escreva o nome como se estivesse explicando o cenário a um especialista de domínio**, não a um colega programador.
3. **Deixe o nome do método do SUT fora do nome do teste.** Você está testando *comportamento* da aplicação, não uma assinatura específica de método; renomear `isDeliveryValid` para `isDeliveryCorrect` não deveria forçar todo nome de teste a mudar também. (Exceção: código utilitário puro sem significado de negócio, onde usar o nome do método é aceitável.)

Exemplo trabalhado, reescrevendo `isDeliveryValid_invalidDate_returnsFalse` passo a passo: `deliveryWithInvalidDateShouldBeConsideredInvalid` (inglês simples, mas "considered" e "should be" são enchimento) para `deliveryWithPastDateIsInvalid` (específico sobre o que "inválido" significa, "is" substitui o desejoso "should be", já que um teste afirma um fato, não uma esperança) para `deliveryWithAPastDateIsInvalid` (o artigo se lê de forma mais natural). Cada passo remove ruído sem perder precisão.

## Trade-offs

- **Abandonar comentários de AAA em favor de linhas em branco só funciona enquanto a seção de arrange permanece plana**: uma seção de arrange grande, que precisa de agrupamento interno próprio, perde essa estrutura assim que o comentário externo `// Arrange` desaparece; mantenha os comentários exatamente nesse caso, em vez de aplicar "sempre remover" como uma regra geral.
- **A exceção de múltiplas seções AAA para testes de integração lentos é uma troca deliberada de desempenho, não um template para reutilizar em testes unitários**: aplicá-la ali só esconde que um teste unitário está cobrindo mais de um comportamento.
- **Nomes de teste em inglês simples são mais difíceis de manter curtos e gramaticalmente limpos do que um nome guiado por template**: a convenção mecânica é fácil de gerar no piloto automático; escrever "como se estivesse explicando a um especialista de domínio" exige uma passada de edição genuína, como mostra o exemplo de renomeação em cinco iterações.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 3 "The anatomy of a unit test", Seções 3.1, 3.4, pp. 41-48, 54-58 (book)
- [JUnit 5 User Guide: Escrevendo Testes](https://junit.org/junit5/docs/current/user-guide/#writing-tests) (doc)
- [AssertJ: asserções fluentes para Java](https://assertj.github.io/doc/) (doc)
