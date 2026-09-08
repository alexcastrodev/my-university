---
version: 1.0
updatedAt: 2026-08-13
title: "Boas Práticas de Mocking: Só em Testes de Integração, Spies e Tipos que Você Possui"
summary: "Regras concretas, às vezes contra-intuitivas, para usar mocks bem, além da distinção mock-vs-stub: mocks pertencem só a testes de integração, nunca a testes unitários de lógica de domínio pura; spies escritos à mão costumam vencer o verify() de um mock genérico; asserções precisam checar a contagem de chamadas, não só a ocorrência; e você só deveria mockar tipos que sua própria base de código define."
---
## Objective

Ir além de "mocke só na fronteira do sistema" (o conceito irmão `observable-behavior-and-mock-fragility`) até as regras operacionais que Khorikov dá para usar mocks *bem* uma vez que você já está nessa fronteira: mocks pertencem a testes de integração, nunca a testes unitários que exercitam lógica pura de domínio; um spy de teste escrito à mão costuma vencer o `verify()` de um mock genérico; uma chamada `verify()` precisa checar *quantas* vezes um método foi chamado, não só que aconteceu; e você só deveria mockar um tipo que sua própria base de código define.

## Use Cases

- Revisar um teste unitário em uma classe de domínio/lógica de negócio que precisa de um mock só para compilar, e reconhecer isso como um mau cheiro de design na classe sob teste, não como um motivo para recorrer ao Mockito.
- Escolher entre o `verify()` de um mock genérico e um spy escrito à mão quando um colaborador mockado é verificado da mesma forma em muitos testes.
- Detectar um `verify(mock, atLeastOnce())` em revisão de código e reconhecer que ele permite silenciosamente uma chamada duplicada (cobrança em dobro, e-mail em dobro) que uma asserção mais rigorosa capturaria.
- Decidir entre mockar diretamente uma classe de um SDK de terceiros ou introduzir primeiro uma interface adaptadora fina, antes que um upgrade de biblioteca force a questão.

## Deep Dive

### Mocks pertencem a testes de integração, não a testes unitários

A regra precisa: **use mocks apenas ao testar a camada que fala com dependências não gerenciadas, nunca ao testar o modelo de domínio.** Mocking é para colaboradores fora de processo (veja `managed-vs-unmanaged-dependencies` e `observable-behavior-and-mock-fragility` para o que se qualifica); classes de domínio/lógica de negócio não deveriam tocar essas dependências diretamente de forma alguma. Então um teste sobre o modelo de domínio é, por definição, um teste unitário sem mock nenhum, e um teste que exercita a camada de orquestração que fala com uma dependência não gerenciada real (ou um mock representando uma) é um teste de integração.

Isso se conecta diretamente à divisão functional-core/imperative-shell coberta em `functional-architecture-and-testability`: uma classe que precisa de um mock só para ser testada unitariamente costuma ser sinal de que ela mistura uma *decisão* (lógica de negócio) com um *efeito colateral* (I/O), não um sinal de que o teste precisa de um mock. A correção quase nunca é "adicionar um mock"; é separar as duas responsabilidades para que a parte de tomada de decisão não sobre nada para mockar.

Um contraste mínimo torna a regra concreta. Uma classe de política que decide se um lembrete de fatura está vencido não precisa de nenhum test double; é lógica de domínio pura:

```java
public final class OverdueInvoicePolicy {

    public boolean needsReminder(Invoice invoice, LocalDate today) {
        long daysOverdue = ChronoUnit.DAYS.between(invoice.dueDate(), today);
        return daysOverdue > 0 && daysOverdue % 7 == 0;
    }
}

@Test
void reminderIsDueOnTheSeventhDayOverdue() {
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1));

    boolean dueToday = new OverdueInvoicePolicy()
        .needsReminder(invoice, LocalDate.of(2026, 8, 8));   // exactly 7 days overdue

    assertTrue(dueToday);   // pure function in, value out, no mock anywhere
}
```

O controller que de fato envia o lembrete fala com uma dependência não gerenciada, então *seu* teste é um teste de integração, e mockar esse único colaborador é legítimo:

```java
@Test
void controllerSendsReminderWhenPolicySaysItsDue() {
    SmsGateway mockGateway = mock(SmsGateway.class);
    ReminderController sut = new ReminderController(new OverdueInvoicePolicy(), mockGateway);

    sut.sendReminderIfDue(invoice, LocalDate.of(2026, 8, 8));

    verify(mockGateway, times(1)).send("+15551234567", "Invoice INV-42 is overdue");
}
```

Nada aqui contradiz o folclore de "um mock por teste" que alguns times repetem; Khorikov chama isso de equívoco. Uma unidade de comportamento pode legitimamente precisar de várias dependências não gerenciadas (um barramento de mensagens *e* um logger, digamos), e o número de mocks que um teste de integração precisa é simplesmente quantos colaboradores não gerenciados aquela operação de fato toca, não um teto a impor por si só.

### Spies de teste: uma alternativa feita sob medida a um mock genérico

Um **spy** é um test double que faz o mesmo trabalho de um mock (registra com o que foi chamado, para que um teste possa afirmar sobre a interação), mas é escrito à mão em vez de gerado por um framework de mocking. Khorikov chama spies de "mocks escritos à mão": funcionalmente a mesma categoria de double, só que construída manualmente para um colaborador específico em vez de genericamente para qualquer interface.

O ganho é legibilidade. As chamadas `verify()` de um mock genérico se repetem, argumento por argumento, em todo teste que se importa com a interação; um spy pode expor um método de asserção fluente e feito sob medida que se lê como uma frase e é reutilizado em todo lugar em que aquele colaborador é verificado:

```java
public interface SmsGateway {
    void send(String phoneNumber, String message);
}

// Hand-written spy: test code, not production code
public class SmsGatewaySpy implements SmsGateway {
    private final List<String> sentMessages = new ArrayList<>();

    @Override
    public void send(String phoneNumber, String message) {
        sentMessages.add(phoneNumber + ":" + message);
    }

    public SmsGatewaySpy shouldHaveSentExactly(int count) {
        assertEquals(count, sentMessages.size());
        return this;
    }

    public SmsGatewaySpy withMessageTo(String phoneNumber, String message) {
        assertTrue(sentMessages.contains(phoneNumber + ":" + message));
        return this;
    }
}
```

```java
@Test
void controllerSendsExactlyOneReminderSms() {
    SmsGatewaySpy smsSpy = new SmsGatewaySpy();
    ReminderController sut = new ReminderController(new OverdueInvoicePolicy(), smsSpy);

    sut.sendReminderIfDue(invoice, LocalDate.of(2026, 8, 8));

    smsSpy.shouldHaveSentExactly(1)
          .withMessageTo("+15551234567", "Invoice INV-42 is overdue");
}
```

`shouldHaveSentExactly(1).withMessageTo(...)` encadeia algo próximo de inglês simples, e as duas verificações vivem em um único lugar, em vez de serem redigitadas em cada teste. A ressalva do próprio Khorikov também se aplica aqui: um spy vale a pena escrever para colaboradores que a base de código verifica repetida e precisamente (o tipo de tipo discutido em "só mockar tipos que você possui", abaixo); para uma interação avulsa checada em um único teste, um `verify()` simples é menos cerimônia e perfeitamente aceitável.

### Verificando contagem de chamadas, não só a ocorrência

O `verify(mock).method(...)` do Mockito já assume por padrão exatamente uma chamada correspondente; é um atalho para `verify(mock, times(1)).method(...)`, e falha se a chamada aconteceu zero vezes *ou* duas ou mais vezes. Isso é mais rígido do que o `Verify()` simples que os próprios exemplos (Moq/C#) de Khorikov usam, onde a forma sem qualificador só checa "pelo menos uma vez" e precisa de um `Times.Once` explícito para se tornar exata. A lição ainda se transfere, só que em um ponto diferente da API Java: o erro a se observar é uma verificação Mockito que foi *afrouxada* desse padrão rígido, tipicamente com `atLeastOnce()` ou `atLeast(1)`. Essas leem quase de forma idêntica a um `verify()` puro, mas reabrem exatamente a brecha contra a qual o livro alerta; uma chamada duplicada que o teste deveria ter capturado passa despercebida:

```java
// Under-specified: passes even if send() fires twice, a duplicate SMS goes undetected
verify(mockGateway, atLeastOnce()).send("+15551234567", "Invoice INV-42 is overdue");

// Correctly specified: fails the moment the reminder is sent more than once
verify(mockGateway, times(1)).send("+15551234567", "Invoice INV-42 is overdue");
```

A outra metade dessa regra no livro é checar a *ausência* de chamadas inesperadas, não só a presença da esperada; um teste que só afirma que a mensagem certa saiu ainda pode não perceber uma segunda chamada, não relacionada, passando despercebida. O equivalente Mockito do `VerifyNoOtherCalls()` do livro é `verifyNoMoreInteractions()`:

```java
verify(mockGateway, times(1)).send("+15551234567", "Invoice INV-42 is overdue");
verifyNoMoreInteractions(mockGateway);   // fails if send() (or anything else) was called again
```

`SmsGatewaySpy.shouldHaveSentExactly(1)` da seção anterior já dá as duas garantias em uma única chamada; ele checa a contagem total registrada, então não pode passar nem quando falta um envio, nem quando há um duplicado.

### Só mocke tipos que você possui

A última regra: nunca entregue a um framework de mocking a classe ou interface de uma biblioteca de terceiros diretamente. Escreva um adaptador fino próprio ao redor dela e mocke o adaptador em vez disso:

```java
// Third-party SDK type, its shape isn't yours to control
class StripeClient {
    ChargeResult charge(String customerId, long amountCents, String currencyCode) { /* ... */ }
}

// Your own type, the one your tests actually mock
public interface PaymentGateway {
    void charge(CustomerId customerId, Money amount);
}

public class StripePaymentGateway implements PaymentGateway {
    private final StripeClient stripeClient;

    public StripePaymentGateway(StripeClient stripeClient) {
        this.stripeClient = stripeClient;
    }

    @Override
    public void charge(CustomerId customerId, Money amount) {
        stripeClient.charge(customerId.value(), amount.cents(), amount.currencyCode());
    }
}
```

```java
@Test
void checkoutChargesTheCustomerExactlyOnce() {
    PaymentGateway mockGateway = mock(PaymentGateway.class);
    CheckoutController sut = new CheckoutController(mockGateway);

    sut.checkout(order);

    verify(mockGateway, times(1)).charge(order.customerId(), order.total());
}
```

O modo de falha específico que isso evita: se `StripeClient` for mockado diretamente, um upgrade do SDK da Stripe que renomeia `charge(...)` para `createCharge(...)`, reordena seus parâmetros ou o divide em duas chamadas quebra todo teste que mockou `StripeClient`, mesmo que nada da lógica própria de `CheckoutController` esteja errado. Com o adaptador no lugar, esse mesmo upgrade só toca a implementação de `StripePaymentGateway` (e o punhado de testes de integração que a exercitam contra o SDK real); todo teste que mocka `PaymentGateway` continua compilando e passando intocado, porque `PaymentGateway` é uma forma que sua própria base de código controla. O adaptador também permite expressar a dependência nos termos do seu próprio domínio (`CustomerId`, `Money`) em vez dos tipos primitivos brutos da biblioteca, o mesmo papel que wrappers no estilo `IBus`/`IMessageBus` cumprem em `observable-behavior-and-mock-fragility`.

## Trade-offs

- **Um teste unitário que precisa de um mock é um mau cheiro de design, não uma lacuna de teste a corrigir**: recorrer ao Mockito dentro de um teste do modelo de domínio costuma ser tratar um sintoma; a correção real é separar a decisão do efeito colateral (veja `functional-architecture-and-testability`), depois do que o teste de domínio não precisa de double nenhum.
- **"Um mock por teste" é folclore, não uma regra de Khorikov**: o número de mocks que um teste de integração precisa é igual ao número de dependências não gerenciadas que a operação sob teste de fato toca; limitar mocks por teste artificialmente não torna o teste melhor e pode empurrar você a testar menos do que uma unidade de comportamento completa em uma única passada.
- **Um spy custa tempo de autoria antecipado para economizar boilerplate de verificação repetido depois**: vale a pena para um colaborador verificado precisamente em muitos testes; para uma única interação avulsa, uma chamada `verify()` simples é mais barata e igualmente correta.
- **`atLeastOnce()`/`atLeast(n)` parece um padrão seguro, mas é estritamente mais fraco que o padrão implícito do próprio Mockito**: `verify(mock)` sozinho já impõe exatamente uma chamada; trocar por `atLeastOnce()` por uma sensação de "só por segurança" na verdade afrouxa a checagem e deixa passar uma chamada duplicada:

  ```java
  verify(mockGateway, atLeastOnce()).send(phone, message);  // duplicate sends pass silently
  verify(mockGateway, times(1)).send(phone, message);       // duplicate sends fail the test
  ```
- **Checar as chamadas esperadas sem `verifyNoMoreInteractions()` (ou uma checagem equivalente baseada em contagem) só prova metade do contrato**: uma dependência não gerenciada precisa tanto de "a chamada esperada aconteceu" quanto de "nenhuma chamada inesperada também aconteceu"; um teste que só afirma o primeiro ainda pode não perceber uma segunda chamada acidental ao mesmo método, ou a um método diferente, do mock.
- **Mockar um tipo de terceiros diretamente economiza escrever um adaptador, até a biblioteca mudar**: o adaptador é código extra por um benefício que só aparece no próximo upgrade de versão major, momento em que é a diferença entre atualizar uma classe ou correr atrás de falhas pela suíte de testes inteira.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 9 "Mocking Best Practices", Seções 9.1-9.2, pp. 217-228 (book)
- [Mockito API: classe `Mockito`](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/Mockito.html) (doc)
- [Mockito API: modo de verificação `Times`](https://javadoc.io/doc/org.mockito/mockito-core/latest/org/mockito/verification/Times.html) (doc)
