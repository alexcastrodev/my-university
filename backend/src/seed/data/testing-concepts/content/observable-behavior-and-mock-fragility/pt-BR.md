---
version: 1.0
updatedAt: 2026-08-13
title: "Comportamento Observável vs. Detalhes de Implementação: Por que Mocks Deixam os Testes Frágeis"
summary: "Um mock (comando de saída) e um stub (consulta de entrada) respondem a perguntas diferentes, e afirmar sobre interações com um stub é um erro clássico de overspecification. O princípio mais profundo: mocking em si não causa testes frágeis, mockar uma interação que é um detalhe de implementação (intra-sistema, sem objetivo de cliente por trás) em vez de comportamento observável (uma chamada que cruza a fronteira da aplicação e permanece visível fora dela) causa. A correção não é evitar mocks, é mockar apenas em verdadeiras fronteiras do sistema."
---
## Objective

Entender a definição precisa de Khorikov para um mock (distinto de um stub) e o mecanismo exato, não uma suspeita vaga, pelo qual mocks criam testes frágeis: não é o ato de mockar em si que quebra a resistência à refatoração, é mockar uma interação que na verdade é um detalhe de implementação, e não o comportamento observável do sistema.

## Use Cases

- Revisar um teste que chama `verify()` em um double sobre o qual o teste também usou `when()`, e conseguir nomear precisamente por que isso é um anti-padrão (verificar um stub), em vez de só "parece errado".
- Decidir se uma nova asserção `Mockito.verify(...)` pertence a um teste unitário checando uma única pergunta: essa interação cruza a fronteira da aplicação e permanece visível para algo fora dela?
- Explicar por que uma suíte de testes construída no estilo London (mockar todo colaborador) tende a ser muito mais frágil do que uma construída no estilo clássico, em termos de *quais* interações cada estilo tende a mockar, não apenas "London usa mais mocks".

## Deep Dive

### Mock vs. stub, com precisão: comandos e consultas

Um mock e um stub são ambos test doubles, mas existem para responder perguntas diferentes. A distinção acompanha o princípio de **separação comando-consulta (CQS)**: todo método é ou um *comando* (produz um efeito colateral, não retorna nada) ou uma *consulta* (retorna dados, não tem efeito colateral).

- Um **stub** emula uma consulta: uma interação de entrada, uma chamada que o SUT faz para obter dados de que precisa.
- Um **mock** emula e permite examinar um comando: uma interação de saída, uma chamada que o SUT faz que tem um efeito colateral visível fora do SUT.

```java
// Query, incoming interaction: stubbed. The SUT is asking for data.
Database stubDatabase = mock(Database.class);
when(stubDatabase.getNumberOfUsers()).thenReturn(10);

// Command, outgoing interaction: mocked. The SUT is causing a side effect.
verify(mockEmailGateway).sendGreetingsEmail("user@example.com");
```

As duas linhas usam a mesma API do Mockito (veja `test-doubles-stubs-and-mocking` para a mecânica de `when()`/`verify()`); a ferramenta não se importa com qual papel um double está desempenhando. O ponto do livro é uma regra de design que a ferramenta não vai impor por você: **nunca afirme sobre interações com um stub.** Uma chamada do SUT para um stub não faz parte do resultado final que o SUT produz; é o meio pelo qual o SUT obtém entrada, para então calcular o resultado de fato. Verificar essa chamada de qualquer forma é um erro clássico, às vezes chamado de overspecification:

```java
@Test
void creatingAReport() {
    Database stub = mock(Database.class);
    when(stub.getNumberOfUsers()).thenReturn(10);
    ReportController sut = new ReportController(stub);

    Report report = sut.createReport();

    assertEquals(10, report.getNumberOfUsers());   // verifies the actual outcome, keep this
    verify(stub).getNumberOfUsers();                // anti-pattern: asserting an interaction with a stub
}
```

A segunda asserção não compra nada: `getNumberOfUsers()` nunca fez parte do que `createReport()` promete a quem o chama. É um passo intermediário a caminho do resultado real, que a primeira asserção já cobre. A linha `verify(stub)...` só existe para quebrar o teste na próxima vez que `ReportController` obtiver sua contagem de usuários de qualquer outro lugar, mesmo que o relatório em si continue correto.

### Comportamento observável vs. detalhe de implementação: a linha divisória de fato

O conceito irmão `four-pillars-of-a-good-unit-test` nomeia "acoplamento a detalhes de implementação em vez de comportamento observável" como a causa raiz de falsos positivos em termos gerais. Aqui está o teste preciso que Khorikov dá para distinguir os dois: um pedaço de código só é parte do **comportamento observável** de um sistema se expõe uma operação ou um estado que ajuda *o cliente* (quem quer que esteja chamando esse código) a atingir um dos objetivos do próprio cliente. Tudo o mais, por mais público que seja, é um detalhe de implementação.

Aplicado a uma aplicação inteira, isso divide toda colaboração em dois tipos:

- **Comunicação intra-sistema**: chamadas entre classes dentro da sua aplicação. São detalhes de implementação: o cliente que originalmente disparou a chamada (um chamador externo, uma UI) nunca pediu por aquela colaboração interna específica, só pelo resultado.
- **Comunicação inter-sistemas**: chamadas que cruzam a fronteira da aplicação para outro sistema. Estas *são* comportamento observável: um sistema externo está esperando aquela chamada e depende dela continuar acontecendo da mesma forma.

Um fluxo de compra torna a divisão concreta. `CustomerController` orquestra um objeto de domínio (`Customer`, apoiado por um `Store`) e um colaborador fora de processo (`EmailGateway`, um proxy para um serviço SMTP):

```java
public class CustomerController {
    private final EmailGateway emailGateway;

    public boolean purchase(Customer customer, Store store, Product product, int quantity) {
        boolean isSuccess = customer.purchase(store, product, quantity);
        if (isSuccess) {
            emailGateway.sendReceipt(customer.getEmail(), product.getName(), quantity);
        }
        return isSuccess;
    }
}
```

`customer.purchase(store, ...)` internamente chama `store.removeInventory(...)`, mas nenhum cliente de `CustomerController` jamais pediu para "chamar `removeInventory` no store". Eles pediram uma compra; `isSuccess` e o recibo são as únicas coisas que conseguem observar. Compare um teste frágil que mocka a chamada intra-sistema com um sólido que mocka a chamada inter-sistemas:

```java
// Fragile: mocks an implementation detail
@Test
void purchaseSucceedsWhenEnoughInventory() {
    Store storeMock = mock(Store.class);
    when(storeMock.hasEnoughInventory(Product.SHAMPOO, 5)).thenReturn(true);
    Customer customer = new Customer();

    boolean success = customer.purchase(storeMock, Product.SHAMPOO, 5);

    assertTrue(success);
    verify(storeMock).removeInventory(Product.SHAMPOO, 5); // no client of Customer asked for this call
}

// Sound: mocks the true system boundary
@Test
void successfulPurchaseSendsReceipt() {
    EmailGateway mockGateway = mock(EmailGateway.class);
    CustomerController sut = new CustomerController(mockGateway);

    boolean isSuccess = sut.purchase(customer, store, product, 5);

    assertTrue(isSuccess);
    verify(mockGateway).sendReceipt("customer@example.com", "Shampoo", 5); // an SMTP server is watching for this
}
```

Renomear `removeInventory` para `decrementStock`, ou fazer `Customer` reservar estoque através de uma sequência de chamadas totalmente diferente, não muda nada que um chamador de `CustomerController` consiga observar; ainda assim o primeiro teste quebra. O segundo teste só quebra se a aplicação de fato parar de enviar o recibo, que é exatamente o tipo de mudança que um teste deveria capturar.

### A cadeia causal do mock à fragilidade, e a regra de fronteira

Juntando as duas seções, chega-se à versão precisa (não folclórica) de "mocks causam testes frágeis":

> Mockar uma dependência não torna, por si só, um teste frágil. Um teste se torna frágil quando mocka uma interação que é um **detalhe de implementação**, em vez de **comportamento observável**, porque essa interação não tem conexão com nenhum objetivo real de cliente, então afirmar sobre ela (via `verify()`) acopla o teste a um "como" que é livre para mudar.

A regra operacional do livro segue diretamente: **só mocke comunicações que cruzam a fronteira da aplicação e cujos efeitos colaterais são observáveis por algo fora do seu sistema.** Uma chamada em processo entre duas de suas próprias classes nunca se qualifica, não importa quão mockável a interface do colaborador pareça. Este é o mesmo princípio que o conceito irmão `managed-vs-unmanaged-dependencies` aplica um nível acima, especificamente a dependências fora de processo: uma dependência não gerenciada (SMTP, um barramento de mensagens) é mockada porque a interação é comportamento observável; uma dependência gerenciada (seu próprio banco de dados) não é, porque falar com ela é um detalhe de implementação. A regra aqui é a forma geral da qual essa decisão é um caso particular.

Isso também explica, com precisão, por que as escolas London e clássica de teste unitário (veja o conceito irmão `test-doubles-stubs-and-mocking` para a mecânica de criação de double que as duas escolas usam) diferem em quão frágeis suas suítes de teste costumam ser. Testes no estilo London mockam toda dependência, exceto as imutáveis, incluindo colaboradores em processo como o `Store` acima, então rotineiramente mockam detalhes de implementação e pagam por isso em falsos positivos. Testes no estilo clássico reservam doubles majoritariamente para dependências genuinamente compartilhadas entre testes, o que na prática significa fronteiras fora de processo, bem mais perto de onde mockar é de fato seguro.

## Trade-offs

- **Verificar um stub não compra proteção nenhuma e garante um futuro falso positivo**: a chamada nunca fez parte do resultado final, então a asserção só pode falhar quando uma refatoração legítima muda *como* o dado foi buscado, nunca quando o comportamento real quebra:

  ```java
  verify(stubDatabase).getNumberOfUsers(); // will break on a harmless refactor, catches nothing
  ```
- **Mockar um colaborador intra-sistema é estritamente pior do que afirmar sobre o resultado que você já tem**: no exemplo `storeMock` acima, `assertTrue(success)` já prova que a compra se comportou corretamente; o `verify(storeMock).removeInventory(...)` adicionado só cria uma segunda forma, mais frágil, do mesmo teste falhar.
- **O teste de fronteira é "isso cruza a aplicação E permanece observável fora dela", não "essa dependência é externa"**: uma dependência fora de processo que só a sua própria aplicação jamais acessa (um banco de dados privado) ainda é um detalhe de implementação e ainda não deveria ser verificada por mock; inversamente, uma fachada em processo que é o literal último salto antes do formato de fio de um sistema externo vale a pena mockar. A localização tecnológica (em processo vs. fora de processo) não é o fator decisivo; a observabilidade por um cliente externo é.
- **Suítes no estilo London são estruturalmente mais expostas a esse modo de falha do que suítes no estilo clássico**: não porque London mocka "mais", mas porque não distingue comunicação intra-sistema de inter-sistemas ao decidir o que mockar, então uma fração maior de seus mocks acaba alvejando detalhes de implementação por padrão.
- **"Mocke só na fronteira" é uma restrição de design, não apenas uma dica de teste**: uma classe cujos colaboradores não podem ser distinguidos como "internos" vs. "cruzam para outro sistema" (por exemplo, um objeto de domínio que segura diretamente uma referência a um `EmailGateway` ao lado de colaboradores de domínio simples) torna essa regra difícil de aplicar de forma consistente; manter chamadas inter-sistemas concentradas em uma camada de serviços de aplicação (em vez de espalhadas por classes de domínio) é o que torna "mocke só a fronteira" uma regra realmente seguível.

## Documentation Links

- Vladimir Khorikov, *Unit Testing Principles, Practices, and Patterns* (Manning, 2020), Capítulo 5 "Mocks and Test Fragility", seções 5.1-5.4, pp. 92-118 (book)
- [Mockito API: classe `Mockito`](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) (doc)
- [JUnit 5 User Guide](https://docs.junit.org/current/user-guide/) (doc)
