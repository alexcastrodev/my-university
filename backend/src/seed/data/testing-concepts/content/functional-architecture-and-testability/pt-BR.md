---
version: 1.0
updatedAt: 2026-08-13
title: "Arquitetura Funcional: Separando Decisões de Efeitos Colaterais para Testabilidade"
summary: "Aprenda o padrão functional-core/imperative-shell para tirar decisões de negócio de código carregado de efeitos colaterais, tornando a lógica de decisão trivialmente testável por saída com zero mocks, e entenda os custos reais: um shell que ainda precisa de testes de integração, overhead de alocação por imutabilidade em caminhos quentes, e lógica de domínio que nem sempre pode ser separada de forma limpa."
---
## Objective

Aprenda o padrão functional-core/imperative-shell (núcleo funcional/casca imperativa): reestruturar o código de modo que toda a tomada de decisão viva em funções puras, livres de efeitos colaterais, e uma casca externa fina não faça nada além de coletar entradas e executar as decisões, e entenda exatamente onde isso compensa em testabilidade baseada em saída e onde genuinamente não compensa.

## Use Cases

- Uma classe mistura hoje "decidir o que deve acontecer" com "fazer acontecer" (escrever em um banco de dados, chamar uma API, enviar um e-mail), e todo teste precisa de um mock só para verificar uma decisão que não tem nada a ver com I/O.
- Decidir como reestruturar um pedaço de lógica de negócio para que a maior parte dele possa ser coberta por testes rápidos, sem mocks, baseados em saída, deixando apenas uma fatia fina para os testes de integração.
- Reconhecer, antes de investir na reestruturação, que um pedaço específico de lógica precisa ler estado mutável *no meio da decisão* e não vai se separar de forma limpa em um núcleo puro sem trabalho de design extra.

## Deep Dive

### O padrão functional-core/imperative-shell

O conceito irmão sobre teste baseado em saída já cobre o que torna um método testável dessa forma: nenhuma entrada oculta, nenhuma saída oculta, a mesma entrada sempre produz a mesma saída. A pergunta que este conceito responde é como colocar *mais* de uma base de código nesse formato quando a operação subjacente obviamente precisa tocar um efeito colateral em algum lugar.

A resposta não é eliminar o efeito colateral (toda aplicação real precisa atualizar um banco de dados ou chamar algum sistema externo eventualmente). É parar de deixar a *decisão* sobre o que fazer e a *execução* dessa decisão morarem no mesmo método. Divida-os:

- **Núcleo funcional (functional core)**: uma função pura (ou um pequeno grupo delas) que recebe valores simples como entrada e retorna um valor simples descrevendo o que deve acontecer. Não realiza I/O algum por conta própria.
- **Casca imperativa (imperative shell)**: uma camada externa fina que coleta o que quer que o núcleo precise, chama o núcleo e então executa o efeito colateral que o núcleo decidiu. Não contém decisões de negócio próprias, apenas encanamento.

Aqui está um método que mistura as duas responsabilidades, da forma como código real costuma começar. Ele decide se uma fatura vencida precisa de um lembrete por e-mail, e envia esse e-mail no mesmo fôlego:

```java
public class InvoiceReminderService {

    private final EmailClient emailClient;

    public InvoiceReminderService(EmailClient emailClient) {
        this.emailClient = emailClient;
    }

    public void remindIfOverdue(Invoice invoice, LocalDate today) {
        long daysOverdue = ChronoUnit.DAYS.between(invoice.dueDate(), today);

        if (daysOverdue > 0 && daysOverdue % 7 == 0) {
            String subject = "Invoice %s is %d days overdue".formatted(invoice.id(), daysOverdue);
            String body = "Please pay %s as soon as possible.".formatted(invoice.amount());
            emailClient.send(invoice.customerEmail(), subject, body);   // side effect
        }
    }
}
```

Para testar isso unitariamente hoje é preciso um mock de `EmailClient` e uma chamada `verify()`, mesmo que a coisa que realmente vale a pena testar (esta fatura está no prazo de um lembrete, e o que ele deveria dizer) não tenha nada a ver com o envio de e-mail. Extrair a decisão para seu próprio método puro, e fazê-lo retornar uma instrução em vez de executá-la, transforma isso em uma função matemática:

```java
public record Reminder(String to, String subject, String body) {}

public final class InvoiceReminderPolicy {

    public Optional<Reminder> decide(Invoice invoice, LocalDate today) {
        long daysOverdue = ChronoUnit.DAYS.between(invoice.dueDate(), today);

        if (daysOverdue <= 0 || daysOverdue % 7 != 0) {
            return Optional.empty();
        }

        String subject = "Invoice %s is %d days overdue".formatted(invoice.id(), daysOverdue);
        String body = "Please pay %s as soon as possible.".formatted(invoice.amount());
        return Optional.of(new Reminder(invoice.customerEmail(), subject, body));
    }
}
```

A casca encolhe para quase nada; não sobra nenhum `if`, nenhuma aritmética, nenhuma regra de negócio nela:

```java
public final class InvoiceReminderService {

    private final InvoiceReminderPolicy policy = new InvoiceReminderPolicy();
    private final EmailClient emailClient;

    public InvoiceReminderService(EmailClient emailClient) {
        this.emailClient = emailClient;
    }

    public void remindIfOverdue(Invoice invoice, LocalDate today) {
        policy.decide(invoice, today)
              .ifPresent(reminder -> emailClient.send(reminder.to(), reminder.subject(), reminder.body()));
    }
}
```

O próprio exemplo trabalhado por Khorikov segue o mesmo formato em uma escala maior: um `AuditManager` que ao mesmo tempo decidia o que escrever em um arquivo de log *e* escrevia, refatorado em um núcleo funcional `AuditManager` que retorna uma instrução `FileUpdate`, e uma casca mutável `Persister` cujo único trabalho é ler o conteúdo de um diretório para a memória e aplicar o `FileUpdate` recebido. Mesma reestruturação, mesma razão para fazê-la: a casca (`Persister`) acaba sendo "trivial... sem ramificação... toda a complexidade reside" no núcleo.

### Por que o núcleo não precisa de mock algum e a casca quase não precisa de testes unitários

`InvoiceReminderPolicy.decide` agora é uma função matemática: alimente-a com um `Invoice` e uma `LocalDate`, afirme sobre o `Optional<Reminder>` que ela retorna. Nenhum `EmailClient`, nenhum mock, nenhum `verify()`:

```java
@Test
void reminderIsSentOnTheSeventhDayOverdue() {
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    Optional<Reminder> reminder = new InvoiceReminderPolicy()
        .decide(invoice, LocalDate.of(2026, 8, 8));   // exactly 7 days overdue

    assertEquals(
        Optional.of(new Reminder("buyer@example.com",
                                  "Invoice INV-42 is 7 days overdue",
                                  "Please pay 250.00 as soon as possible.")),
        reminder);
}

@Test
void noReminderOnAnOrdinaryOverdueDay() {
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    Optional<Reminder> reminder = new InvoiceReminderPolicy()
        .decide(invoice, LocalDate.of(2026, 8, 3));   // 2 days overdue, not a multiple of 7

    assertEquals(Optional.empty(), reminder);
}
```

Este é o estilo de mais alta qualidade que o conceito irmão descreve: nenhum acoplamento a *como* a decisão foi tomada, apenas ao *que* ela produziu, então o teste sobrevive a qualquer refatoração interna de `decide()` e roda em microssegundos. `Reminder` ser um `record` importa aqui também: records ganham `equals()`/`hashCode()` de graça, então a asserção compara por valor em vez de por referência, o que é o que torna possível um único `assertEquals` sobre a instrução inteira.

A casca, enquanto isso, agora é tão simples que um teste unitário nela estaria em grande parte reproduzindo o teste de `Optional.ifPresent`. O que ela realmente precisa ter verificado é que está corretamente ligada a um `EmailClient` *real*, e esse é um trabalho para um punhado de testes de integração, não uma pilha crescente de testes unitários:

```java
@Test
void reminderServiceActuallyDeliversTheEmail(FakeEmailClient fakeClient) {
    InvoiceReminderService service = new InvoiceReminderService(fakeClient);
    Invoice invoice = new Invoice("INV-42", LocalDate.of(2026, 8, 1),
                                   new BigDecimal("250.00"), "buyer@example.com");

    service.remindIfOverdue(invoice, LocalDate.of(2026, 8, 8));

    assertEquals(1, fakeClient.sentMessages().size());
}
```

Um ou dois desses cobrem a ligação; a análise exaustiva de casos (quais dias disparam um lembrete, o que a mensagem diz) permanece inteiramente nos testes baseados em saída do núcleo, onde é mais barato verificar.

### Os limites honestos da arquitetura funcional

Arquitetura funcional é uma troca genuína, não um upgrade grátis, e Khorikov é explícito de que ela vem com três custos reais.

**A casca ainda precisa de algum teste.** Separar decisões de ações não faz as ações desaparecerem; apenas as concentra na fronteira, e essa fronteira ainda precisa ser verificada contra a dependência real com a qual conversa. O `InvoiceReminderService` acima ainda precisa do teste de integração mostrado; a arquitetura funcional reduz quanto desse fardo de teste recai sobre testes unitários, não o reduz a zero.

**Objetos imutáveis têm um custo de alocação.** Retornar um novo `Reminder` (ou, no exemplo de log de auditoria do livro, um novo `FileUpdate`) em vez de mutar algo no lugar significa que um objeto extra é criado a cada chamada. Para uma comparação de `LocalDate` rodando uma vez por fatura, isso é irrelevante. Em um caminho quente (um motor de precificação reavaliando milhares de itens de linha por segundo, digamos), a pressão acumulada de alocação e coleta de lixo por construir constantemente novas instâncias imutáveis em vez de mutar as existentes é um custo real e mensurável, não teórico.

**Algumas decisões genuinamente precisam ler estado mutável no meio do cálculo, e isso quebra a pureza.** Suponha que a política de lembrete precisasse verificar o status atual de ticket de suporte do cliente antes de decidir se envia algo, e esse status vive em um banco de dados:

```java
// This is no longer a mathematical function: TicketRepository is a hidden,
// mutable, out-of-process input that isn't expressed as a plain value.
public Optional<Reminder> decide(Invoice invoice, LocalDate today, TicketRepository tickets) {
    ...
}
```

Passar um repositório para o núcleo reintroduz exatamente a entrada oculta que o núcleo foi construído para evitar, e abre mão do teste baseado em saída para esse método. As duas saídas custam algo: buscar o status do ticket antecipadamente na casca antes de chamar o núcleo (mantém o núcleo puro, mas agora consulta o banco de dados a cada fatura, mesmo nas que nunca iam precisar de um lembrete), ou adicionar um método puro barato de pré-verificação que a casca chama primeiro para decidir *se* a busca cara sequer é necessária (mantém a consulta condicional, mas move uma fatia de tomada de decisão, a chamada "essa verificação é necessária", para fora do núcleo e para dentro da casca). Nenhuma das duas restaura a pureza total; qual escolher é uma decisão de julgamento genuína sobre onde aquele domínio traça a linha, não um problema resolvido. Nem todo domínio vale a pena forçar nesse formato: o próprio conselho de Khorikov é aplicar arquitetura funcional onde a lógica é complexa e importante o suficiente para a reestruturação se pagar, e pular onde o código é simples o bastante para que um design tradicional nunca fosse causar problema.

## Trade-offs

- **Um núcleo puro compra testes baseados em saída com zero mocks, mas só para a parte da lógica que permanece pura**: no momento em que uma decisão precisa de um colaborador (um banco de dados, uma leitura de relógio no meio do cálculo) em vez de um valor simples, esse método sai do núcleo funcional, e o benefício de pureza para de se aplicar especificamente a ele, não à classe inteira.
- **A casca encolhe drasticamente, mas não desaparece**: ainda precisa de cobertura no nível de integração para provar que está ligada corretamente à dependência real; a arquitetura funcional muda *que tipo* de teste a casca precisa, não se ela precisa de um:

  ```java
  // still worth having, even though the shell has no business logic left:
  @Test
  void serviceDeliversThroughTheRealEmailClientConfiguration() { /* integration test */ }
  ```
- **Imutabilidade custa alocações, e esse custo é invisível até deixar de ser**: um `Reminder` ou `FileUpdate` criado por chamada é de graça até o método estar em um caminho quente, ponto em que o churn extra de objetos aparece em pausas de GC ou números de throughput; a correção é medir o caminho real, não evitar imutabilidade em toda parte de forma preventiva.
- **Busca antecipada vs. verificação condicional é uma bifurcação real sem resposta universalmente correta**: puxar uma leitura de banco de dados para a casca para manter o núcleo puro significa consultar incondicionalmente, mesmo para entradas que nunca precisaram do dado; empurrar uma pré-verificação barata para o núcleo para decidir se consulta ou não mantém a consulta condicional, mas vaza um fragmento de tomada de decisão de volta para a casca. Khorikov oferece as duas, não escolhe nenhuma como sempre correta, e essa é a resposta honesta.
- **Aplique isso estrategicamente, não como padrão**: o custo inicial é uma base de código maior e mais espalhada (uma classe de política mais uma classe de casca mais um tipo de valor, onde um único método misto costumava bastar); esse custo vale a pena para lógica complexa ou crítica de negócio o suficiente para precisar de cobertura de teste pesada, e não vale a pena para uma classe simples e de baixo risco que de qualquer forma nunca acumularia muitos testes.

## Documentation Links

- Vladimir Khorikov, "Unit Testing Principles, Practices, and Patterns" (Manning, 2020), Capítulo 6 "Styles of Unit Testing", Seções 6.3-6.5 "Understanding functional architecture" / "Transitioning to functional architecture and output-based testing" / "Understanding the drawbacks of functional architecture", pp. 128-149 (book)
- [Javadoc: java.util.Optional](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Optional.html) (doc)
