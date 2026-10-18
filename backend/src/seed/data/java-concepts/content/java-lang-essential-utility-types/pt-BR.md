---
version: 1.0
updatedAt: 2026-08-05
title: "Essenciais do java.lang: Comparable, AutoCloseable, StackWalker, ProcessBuilder"
summary: O contrato de ordenação natural de Comparable<T> e sua recomendação de consistência com equals, as regras de idempotência de AutoCloseable vs. Closeable, o StackWalker como o substituto moderno e preguiçoso para inspeção de stack trace, e ProcessBuilder/Process/ProcessHandle para lançar e gerenciar processos do sistema operacional.
---
## Objective

`java.lang` reúne um punhado de contratos pequenos e de propósito único que não
pertencem a coleções, strings ou números, mas que sustentam silenciosamente o
código do dia a dia: `Comparable` dá a um tipo sua única ordenação natural,
`AutoCloseable` é o contrato que torna o try-with-resources possível,
`StackWalker` é a forma moderna, baseada em stream, de inspecionar a call
stack atual, e `ProcessBuilder` é como um programa Java lança e controla
outro processo do sistema operacional. Eles não compartilham uma relação de
herança — cada um está aqui porque é uma ferramenta pequena que aparece
constantemente, não porque formam uma única API.

## Use Cases

- Dar a uma classe uma ordem de classificação padrão que `Collections.sort()`,
  `TreeSet` e `TreeMap` usam automaticamente quando nenhum comparador é
  fornecido.
- Escrever um wrapper de recurso personalizado (um handle nativo, uma conexão
  pooled) que precisa se encaixar no try-with-resources em vez de um
  `finally { close(); }` manual.
- Construir uma utilidade de logging, debugging ou framework que precisa saber
  qual classe chamou um método, sem pagar o preço de um stack trace completo
  antecipadamente.
- Lançar uma ferramenta externa (um compilador, um script de shell, outra JVM)
  de dentro de um programa Java, alimentando-a com entrada, capturando sua
  saída e reagindo quando ela termina.

## Deep Dive

### Comparable e o contrato do compareTo

`Comparable<T>` declara exatamente um método:

```java
public interface Comparable<T> {
    int compareTo(T other);
}
```

`compareTo()` retorna um número negativo se o objeto que chama é "menor que"
`other`, zero se são iguais, e um número positivo se é "maior que" — a
magnitude exata não importa, só o sinal. Essa é a *ordenação natural* do tipo:
`Byte`, `Character`, `Double`, `Integer`, `Long`, `String` e `Enum` implementam
ela, e é o que `TreeSet`, `TreeMap` e `Collections.sort()` usam por padrão
quando nenhum `Comparator` é dado.

```java
class Version implements Comparable<Version> {
    final int major;
    Version(int major) { this.major = major; }

    @Override
    public int compareTo(Version other) {
        return Integer.compare(this.major, other.major);
    }
}
```

`Comparable` fica embutido no tipo — uma classe ganha exatamente uma ordenação
desse jeito. `Comparator<T>` vive fora do tipo e pode definir qualquer número
de ordenações para a mesma classe sem tocá-la; veja
[Comparators e Algoritmos de Coleção](/java-concepts/comparators-and-collection-algorithms)
para `Comparator.comparing()`, `thenComparing()` e os algoritmos de
`Collections` construídos sobre os dois.

### AutoCloseable vs. Closeable

`AutoCloseable` é o que faz o try-with-resources funcionar. Ele declara um
método:

```java
public interface AutoCloseable {
    void close() throws Exception;
}
```

Qualquer objeto cuja classe implementa `AutoCloseable` pode aparecer em um
statement try-with-resources; `close()` é chamado automaticamente quando o
bloco termina, com sucesso ou falha:

```java
try (var resource = acquireResource()) {
    resource.use();
} // close() called here, no matter how the block exits
```

`java.io.Closeable` estende `AutoCloseable` e o restringe de duas formas: seu
`close()` declara apenas `throws IOException` em vez do amplo `Exception`, e é
documentado como *idempotente* — chamá-lo mais de uma vez não pode ter efeito
adicional. `AutoCloseable.close()` não carrega essa garantia; o Javadoc diz
explicitamente que chamadas repetidas "podem ter algum efeito colateral
visível", embora ainda incentive os implementadores a torná-lo idempotente de
qualquer forma.

### StackWalker: inspecionando a call stack

Adicionado no Java 9, `StackWalker` substituiu o padrão antigo de chamar
`Thread.currentThread().getStackTrace()` (ou `new Throwable().getStackTrace()`)
para inspecionar a call stack, e as checagens caller-sensitive baseadas em
`SecurityManager` que costumavam proteger esse tipo de introspecção. Em vez de
materializar avidamente um array com todo frame, `StackWalker` transmite
frames de forma preguiçosa, deixando o chamador parar cedo sem pagar pelo
resto da stack:

```java
StackWalker walker = StackWalker.getInstance();

List<StackWalker.StackFrame> topThree =
    walker.walk(frames -> frames.limit(3).toList());
```

`walk()` recebe uma `Function<Stream<StackFrame>, T>` — o stream só é válido
durante aquela chamada e fecha quando `walk()` retorna. Cada `StackFrame`
expõe `getClassName()` e `getMethodName()` por padrão; frames de reflection e
internos da VM ficam ocultos a menos que `Option.SHOW_REFLECT_FRAMES` ou
`Option.SHOW_HIDDEN_FRAMES` sejam solicitados no momento da construção:

```java
StackWalker deepWalker = StackWalker.getInstance(
    Set.of(StackWalker.Option.RETAIN_CLASS_REFERENCE));

Class<?> caller = deepWalker.getCallerClass();
```

`getCallerClass()` é uma conveniência para a pergunta comum "quem me chamou",
mas precisa que `Option.RETAIN_CLASS_REFERENCE` seja fornecida de antemão —
solicitá-la a partir de um `getInstance()` simples lança
`UnsupportedOperationException` em vez de retroativamente adicionar a opção.

### ProcessBuilder: lançando e controlando processos externos

`ProcessBuilder` configura e inicia outro processo do sistema operacional:

```java
ProcessBuilder pb = new ProcessBuilder("grep", "-r", "TODO", ".");
pb.directory(new File("/projects/app"));
pb.redirectErrorStream(true);              // merge stderr into stdout
pb.redirectOutput(ProcessBuilder.Redirect.appendTo(new File("grep.log")));

Process process = pb.start();
```

`command()` e `directory()` leem/mudam o programa e os argumentos e o
diretório de trabalho antes de `start()`; `environment()` retorna um
`Map<String, String>` mutável, inicializado a partir do ambiente do processo
atual, que só afeta o filho sendo iniciado. `redirectInput()`/
`redirectOutput()`/`redirectError()` (mais o atalho `inheritIO()`, que conecta
os três ao próprio console do pai) substituem o antigo padrão de drenar
manualmente `Process.getInputStream()`/`getErrorStream()` em threads
separadas.

Uma vez iniciado, o `Process` retornado expõe `pid()` para o id nativo do
processo e `onExit()` para um `CompletableFuture<Process>` que completa quando
o filho termina — permitindo que um programa reaja sem bloquear em
`waitFor()`:

```java
process.onExit()
       .thenApply(p -> p.exitValue() == 0)
       .thenAccept(success -> System.out.println("Clean exit: " + success));
```

`isAlive()`, `destroy()` (solicita término gracioso — depende da implementação
*se* consegue, não o quão forçado é) e `destroyForcibly()` (término forçado)
completam o controle de ciclo de vida; desde o Java 9, `toHandle()` converte
um `Process` em um `ProcessHandle` para informações (como
`Info.totalCpuDuration()`) além do que o próprio `Process` expõe.

## Trade-offs

- **Um tipo ganha exatamente uma ordenação natural** — uma segunda ordenação,
  situacional, precisa de um `Comparator`, não de uma flag enfiada dentro do
  `compareTo()` (veja o conceito de Comparators para encadear e construir
  comparadores sem tocar na classe).
- **`return a - b` dentro de `compareTo()` é um bug esperando para acontecer,
  não um atalho** — a subtração pode estourar silenciosamente e inverter o
  sinal para valores extremos.
  ```java
  public int compareTo(Bucket other) {
      return this.hash - other.hash;      // wraps for extreme int values
  }
  // fix: return Integer.compare(this.hash, other.hash);
  ```
- **`AutoCloseable.close()` lança o amplo `Exception`; `Closeable.close()`
  só `IOException`** — código escrito genericamente contra `AutoCloseable`
  precisa capturar ou declarar `Exception`, perdendo o tipo mais estreito que
  chamadores específicos de I/O obtêm de `Closeable`.
- **`AutoCloseable.close()` não é obrigado a ser idempotente, ao contrário de
  `Closeable.close()`** — chamá-lo uma segunda vez ainda pode ter um efeito
  colateral visível a menos que o implementador se proteja especificamente
  contra isso; o try-with-resources só chama `close()` uma vez por recurso,
  mas código de limpeza manual que chama `close()` de mais de um lugar não
  pode assumir que a segunda chamada é um no-op.
- **`getCallerClass()` precisa de `Option.RETAIN_CLASS_REFERENCE` fornecida
  no momento do `getInstance()`** — não pode ser solicitada depois do fato.
  ```java
  StackWalker w = StackWalker.getInstance();
  w.getCallerClass();   // UnsupportedOperationException
  ```
- **`ProcessBuilder.environment()` só edita o ambiente do filho**, não o da
  JVM atual — mutar o map retornado não tem efeito em `System.getenv()` no
  programa em execução, só em processos iniciados a partir daquele
  `ProcessBuilder` depois.
- **Um subprocesso não lido pode causar deadlock no pai** — se o filho
  escreve saída suficiente para encher o buffer do pipe do SO e nada drena
  `getInputStream()`/`getErrorStream()`, o filho bloqueia na escrita e o pai
  bloqueia em `waitFor()`, com nenhum dos dois lados progredindo;
  `redirectErrorStream(true)`, `inheritIO()`, ou consumir os streams em uma
  thread separada evita isso.

## Lab

Neste lab você recebe três classes pequenas com os métodos vazios e deve completá-las para que dois contratos de `java.lang` funcionem de verdade: `Comparable`, que dá a um tipo uma ordem natural, e `AutoCloseable`, que o torna utilizável em try-with-resources. A ideia central é ver que implementar a interface não basta: o contrato (sinal do `compareTo`, `close()` idempotente) é o que faz o resto da plataforma, como `sort` e `try`, funcionar com o seu tipo.

**O cenário**

Valores monetários precisam ser ordenados e conexões de um pool precisam ser fechadas com segurança. O concept cobre também `StackWalker` e `ProcessBuilder`, mas este lab foca nos dois pedaços mais fáceis de testar.

- `Money.java`: guarda uma moeda (`currency`) e um valor em centavos (`amountCents`) e declara `Comparable<Money>`. `equals`, `hashCode` e `toString` já estão prontos.
- `PooledConnection.java`: declara `AutoCloseable`, tem um `id` e um estado de fechada ou não.
- `ConnectionUtils.java`: junta os dois, ordenando listas de `Money` e (no desafio) usando uma conexão com garantia de fechamento.

**O que você vai fazer, passo a passo**

1. **Dar ordem natural ao dinheiro (TODO-00).** Em `Money.compareTo()`, compare apenas por `amountCents`, ignorando a moeda neste exercício. Devolva negativo, zero ou positivo como o `Comparable` exige. A dica é `Long.compare(a, b)`, que evita o risco de overflow de uma subtração.
2. **Implementar o estado da conexão (TODO-01 e TODO-02).** `isClosed()` devolve se a conexão já foi fechada. `close()` marca como fechada e precisa ser seguro chamar duas vezes, sem lançar exceção. Isso importa porque o try-with-resources e o código do chamador podem acabar fechando o mesmo recurso.
3. **Ordenar sem mutar (TODO-03).** Em `ConnectionUtils.sortedByAmount()`, devolva uma lista NOVA com os mesmos objetos `Money` em ordem crescente pela ordem natural, sem alterar a lista recebida.

**Como saber que terminou**

`mvn test` fica todo verde. Você deve conseguir explicar por que `compareTo` e `equals` aqui são diferentes (um ignora a moeda, o outro não) e por que fechar duas vezes não pode falhar.

**Desafios opcionais**

- **TODO-04:** implemente `ConnectionUtils.openAndUse()` com try-with-resources: pegue a conexão do `Supplier`, passe ao `Consumer` e garanta que ela seja fechada mesmo se a ação lançar.

**Pré-requisitos:** sintaxe básica de Java e familiaridade com generics.

**Como rodar:** clone o repositório, entre em `java-concepts/java-lang-essential-utility-types` e rode `mvn test` (ou, da raiz, `mvn -pl java-concepts/java-lang-essential-utility-types test`). Os métodos pendentes lançam `UnsupportedOperationException("Not implemented yet.")` e trazem um comentário `TODO-NN`, então os testes vermelhos mostram o que falta.

## Documentation Links

- [Comparable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Comparable.html) — doc
- [AutoCloseable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/AutoCloseable.html) — doc
- [Closeable — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/Closeable.html) — doc
- [StackWalker — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/StackWalker.html) — doc
- [ProcessBuilder — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ProcessBuilder.html) — doc
- [Process — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Process.html) — doc
