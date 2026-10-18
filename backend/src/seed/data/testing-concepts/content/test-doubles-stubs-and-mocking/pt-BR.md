---
version: 1.0
updatedAt: 2026-08-06
title: "Test Doubles: Stubs e Mocking"
summary: "Stubs vs. mocks como duas estratégias para falsificar um colaborador, e como criar e verificar mocks com Mockito, do JUnit in Action, Third Edition, Cap. 7-8."
---
## Objective

Um `test double` é um objeto simulado que substitui um colaborador real (um serviço externo, um banco de dados, ou um componente interno lento, difícil de configurar, ou ainda não construído), para que um teste possa exercitar o objeto sob teste isoladamente e continuar rápido e determinístico. O livro distingue duas estratégias: um `stub` tem comportamento fixo e predeterminado, escrito fora do teste (bom para testes de granulação grossa/estilo integração contra um subsistema inteiro); um `mock` tem suas expectativas definidas por teste e consegue verificar como foi chamado (bom para testes unitários de granulação fina). O `Mockito` é a forma mais comum de criar mocks na JVM.

## Use Cases

- Substituir um subsistema externo inteiro (um servidor HTTP, um sistema de arquivos, um banco de dados) por um **stub** quando o objetivo é um teste de granulação grossa/estilo integração e o ambiente real não pode ser levantado em CI.
- Substituir um único colaborador por um **mock** quando o objetivo é um teste unitário de granulação fina que precisa de uma mensagem de falha precisa, apontando exatamente o que deu errado.
- Testar um componente contra uma dependência que ainda não existe, mockando a interface que ela eventualmente implementará.
- Verificar que um service sob teste chama um colaborador com os argumentos certos, sem afirmar nada sobre o comportamento interno do próprio colaborador.
- Distinguir, ao escrever um teste, se o objetivo é "minha classe se comporta corretamente dada a resposta deste colaborador" (teste unitário com um mock) vs. "essas duas classes reais funcionam corretamente juntas" (teste de integração, sem double algum).

## Deep Dive

### Stubs vs. mocks

Ambos falsificam uma dependência, mas o livro traça uma linha nítida entre eles: um **stub** é escrito fora do teste, com comportamento fixo (o mesmo valor de retorno fixo, não importa qual teste o use, nem quantas vezes). Um **mock** não tem comportamento até que o teste defina expectativas sobre ele, bem antes de exercitar o código:

```
Stub pattern:  initialize stub  → execute test → verify assertions
Mock pattern:  initialize mock  → set expectations → execute test → verify assertions
```

```java
// Stub: fixed behavior, written once, reused unmodified everywhere
class StubAccountManager implements AccountManager {
    public Account findAccountForUser(String id) {
        return new Account(id, 100); // always the same, regardless of the test
    }
}
```

```java
// Mock: behavior set per test, right before use
Mockito.when(mockAccountManager.findAccountForUser("1")).thenReturn(sender);
```

O livro recomenda stubs para teste de granulação grossa (substituindo um sistema externo inteiro, como um servidor HTTP ou banco de dados) e mocks para teste unitário de granulação fina que precisa de controle preciso por teste e de uma mensagem de falha que aponte para a expectativa exata que quebrou.

### Declarando um mock com Mockito

`@Mock` (com `@ExtendWith(MockitoExtension.class)`) cria um objeto mock do tipo dado antes de o teste rodar; `Mockito.when(...).thenReturn(...)` escreve o roteiro do seu comportamento:

```java
@ExtendWith(MockitoExtension.class)
class AccountServiceTest {
    @Mock
    private AccountManager mockAccountManager;

    @Test
    void transferMovesBalanceBetweenAccounts() {
        Account sender = new Account("1", 200);
        Account beneficiary = new Account("2", 100);
        Mockito.when(mockAccountManager.findAccountForUser("1")).thenReturn(sender);
        Mockito.when(mockAccountManager.findAccountForUser("2")).thenReturn(beneficiary);

        AccountService service = new AccountService();
        service.setAccountManager(mockAccountManager);
        service.transfer("1", "2", 50);

        assertEquals(150, sender.getBalance());
        assertEquals(150, beneficiary.getBalance());
    }
}
```

`@ExtendWith(MockitoExtension.class)` é o ponto de registro do modelo de extensão do JUnit 5; ele processa o campo `@Mock` antes de o corpo do teste rodar, então `mockAccountManager` já é um mock funcional no momento em que o teste é executado.

### Múltiplas chamadas stubadas e strictness

Por padrão, o stubbing estrito do Mockito espera que todo `when(...)` seja usado pelo teste; declarar duas expectativas para o *mesmo* método com argumentos diferentes (como acima, `"1"` e `"2"`) é aceitável, mas um stub não utilizado ou um stub que nunca é correspondido gera um aviso/erro de strictness. `Mockito.lenient()` isenta um stub específico dessa checagem:

```java
Mockito.lenient()
    .when(mockAccountManager.findAccountForUser("1"))
    .thenReturn(sender);
```

Isso costuma ser necessário quando um `@BeforeEach` compartilhado configura stubs que nem todo teste na classe de fato exercita.

### Verificando interações

Além de roteirizar valores de retorno, o Mockito consegue afirmar que um método do double foi de fato chamado, e com quais argumentos; útil quando o colaborador não tem um valor de retorno para afirmar (por exemplo, um enviador de notificações):

```java
@Test
void transferNotifiesBothAccounts() {
    service.transfer("1", "2", 50);

    Mockito.verify(mockNotifier).notify("1", "Sent 50");
    Mockito.verify(mockNotifier).notify("2", "Received 50");
}
```

## Trade-offs

- **Stubs dão mais confiança, mocks dão mais precisão**: um teste baseado em stub exercita o objeto real sob teste contra algo próximo de um subsistema real, mas uma asserção quebrada de stub costuma só dizer "saída errada", enquanto a falha de `verify()` de um mock aponta para a chamada esperada exata que não aconteceu.
- **Mockar esconde bugs reais de integração**: um teste unitário construído inteiramente ao redor de mocks prova que a unidade sob teste chama seus colaboradores da forma como o teste espera, não que o colaborador real de fato se comporta assim; essa lacuna é exatamente o que os testes de integração (ou um teste de granulação grossa baseado em stub) existem para fechar.
- **O stubbing estrito captura mocks não utilizados, ao custo de cerimônia extra**: um `when(...)` desnecessário que o teste nunca dispara reprova o teste sob stubbing estrito, o que é um sinal real de deriva de teste, mas significa que código de setup compartilhado precisa de `lenient()` onde nem todo teste usa todo stub:

```java
Mockito.when(mockAccountManager.findAccountForUser("3")).thenReturn(unused);
// UnnecessaryStubbingException if no test method actually calls findAccountForUser("3")
```

- **Verificar interações acopla o teste ao *como*, não só ao *quê***: `Mockito.verify(...)` prende o teste a um método específico sendo chamado de uma forma específica, então uma refatoração que atinge o mesmo resultado visível externamente por uma sequência de chamadas diferente pode quebrar testes que nunca estiveram errados sobre comportamento.
- **Um double precisa de uma interface (ou método sobrescrevível) para se anexar**: o Mockito consegue mockar classes concretas, mas um design com chamadas `new SomeDependency()` fixadas dentro da classe sob teste não dá ao Mockito nada para substituir sem refatoração adicional (por exemplo, injeção por construtor/setter); um stub escrito à mão tem o mesmo requisito.
- **Stubs escritos à mão são difíceis de manter**: a própria ressalva do livro: um stub precisa reimplementar, de forma simplificada, a mesma lógica do que substitui, o que fica mais difícil de manter correto conforme o comportamento do sistema real evolui; cada situação nova tipicamente precisa da sua própria estratégia de stubbing, em vez de uma reutilizável.

## Lab

Neste lab você recebe o `CheckoutService` **pronto e funcionando**. Seu trabalho é testá-lo com os dois tipos de test double que o artigo distingue: um **stub** escrito à mão, com comportamento fixo, e **mocks do Mockito**, com comportamento roteirizado a cada teste. A ideia central é sentir a diferença: o stub é escrito uma vez e serve a qualquer teste que precise de um gateway que sempre aprova, e o mock é ajustado por cenário e permite verificar interações.

**O cenário**

O `CheckoutService` cobra um cliente por um `PaymentGateway` e o avisa por um `ReceiptSender`. Os dois entram pelo construtor, e é isso que permite trocá-los por doubles em vez de chamar um processador de pagamento de verdade.

- `CheckoutService.checkout(customerId, amountCents)`: lança `IllegalArgumentException` se o valor não for positivo, cobra pelo gateway, e se for recusado envia "Payment declined" e lança `IllegalStateException`. Se for aprovado, envia o recibo e devolve o id da transação.
- `PaymentGateway.charge` devolve um `PaymentResult(approved, transactionId)`. `ReceiptSender.send(customerId, message)` tem um único método abstrato.
- `StubPaymentGateway` (em `src/test/java`): o stub, ainda por implementar.
- `CheckoutServiceTest`: já tem `mockGateway` e `mockReceiptSender` declarados com `@Mock` e `MockitoExtension`.

**O que você vai fazer, passo a passo**

1. **Escrever o stub (TODO-00).** Em `StubPaymentGateway.charge`, aprove sempre devolvendo um `PaymentResult` com `transactionId` "TXN-STUB", seja qual for o cliente ou o valor.
2. **Teste de granularidade grossa com o stub (TODO-01).** Monte um `CheckoutService` com `new StubPaymentGateway()` e um `ReceiptSender` que não faz nada (uma lambda `(customerId, message) -> {}`). Confira que `checkout("cust-1", 500)` devolve "TXN-STUB". Sem Mockito.
3. **Roteirizar uma aprovação (TODO-02).** Com `when(...).thenReturn(...)`, faça `mockGateway.charge("cust-1", 500)` devolver um resultado aprovado com id "TXN-1", chame `checkout` e confira que devolve "TXN-1".
4. **Roteirizar uma recusa (TODO-03).** Faça o gateway devolver `approved = false`, confira que `checkout` lança `IllegalStateException` e use `Mockito.verify(...)` para provar que `mockReceiptSender.send` foi chamado com o id do cliente e a mensagem exata "Payment declined".
5. **Provar que a validação vem primeiro (TODO-04).** Confira que `checkout("cust-1", 0)` lança `IllegalArgumentException` e use `Mockito.verifyNoInteractions(mockGateway, mockReceiptSender)` para provar que nenhum colaborador foi tocado.

**Como saber que terminou**

`mvn test` fica todo verde. Você consegue explicar quando um stub basta e quando um mock é a ferramenta certa, e por que o teste do passo 5 precisa verificar a ausência de interações em vez de olhar o retorno.

**Desafios opcionais**

- **TODO-05:** escreva um teste que verifica os argumentos exatos com que `mockGateway.charge(...)` foi chamado, ou seja, a entrada do colaborador e não só a saída de `checkout()`.

**Pré-requisitos:** fundamentos de JUnit 5 (`@Test`, `assertThrows`) e ler `CheckoutService`, `PaymentGateway`, `ReceiptSender` e `PaymentResult` em `src/main/java` antes de escrever qualquer teste.

**Como rodar:** clone o repositório, entre em `testing-concepts/test-doubles-stubs-and-mocking` e rode `mvn test` (ou, da raiz, `mvn -pl testing-concepts/test-doubles-stubs-and-mocking test`). O stub lança `UnsupportedOperationException` e os testes começam com `fail("TODO-NN: not implemented yet")`, então os testes vermelhos mostram o que falta.

## Documentation Links

- [Mockito: site oficial](https://site.mockito.org) (doc)
- [Mockito API: classe `Mockito`](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) (doc)
- [JUnit in Action, 3rd Ed., Cap. 7, "Coarse-grained testing with stubs," pp. 123-137 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
- [JUnit in Action, 3rd Ed., Cap. 8, "Testing with mock objects" (Mockito, pp. 166-169), pp. 138-170 (Manning)](https://www.manning.com/books/junit-in-action-third-edition) (doc)
