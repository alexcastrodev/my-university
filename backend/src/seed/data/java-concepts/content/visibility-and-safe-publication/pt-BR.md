---
version: 1.0
updatedAt: 2026-08-13
title: Visibilidade e Publicação Segura Entre Threads
summary: Explica por que leituras não sincronizadas entre threads podem ver valores obsoletos ou corrompidos, o que volatile de fato garante, e como publicar um objeto para outra thread com segurança.
---
## Objective

Em uma única thread, uma escrita seguida de uma leitura da mesma variável sempre vê essa escrita — não há nada a considerar. Entre threads, essa garantia desaparece a menos que exista uma aresta *happens-before* entre a escrita e a leitura: sem uma, o compilador, o JIT e a CPU estão todos livres para reordenar, fazer cache ou atrasar operações de memória, então uma thread leitora pode ver um valor obsoleto, um valor de 64 bits corrompido pela metade (torn), ou um objeto meio construído, indefinidamente ou para sempre. Este conceito cobre o problema de visibilidade em si, o que `volatile` de fato garante (visibilidade e ordenação, não atomicidade), como publicar um objeto para outra thread com segurança, e a garantia especial que o Java Memory Model (JLS Capítulo 17) dá a campos `final`.

## Use Cases

- Diagnosticar uma thread em segundo plano que gira para sempre, ou lê um valor que "deveria" ter mudado, quando o campo que ela verifica é um `boolean`/`int`/referência comum (não `volatile`, não protegido por lock).
- Decidir se um campo compartilhado só precisa de `volatile` (um único escritor, sem atualização composta, sem invariante entre campos) ou de fato precisa de um `Lock`/bloco `synchronized`.
- Revisar código que inicia uma thread, registra um listener, ou passa uma referência a outro objeto de dentro de um construtor — reconhecendo isso como um bug de escape de `this` mesmo quando "por acaso funciona" em testes.
- Escolher como publicar um objeto recém-construído para outras threads: um inicializador estático, um campo `volatile`, um campo `final`, ou um campo devidamente protegido por lock — e saber que atribuição simples a um campo público não é nenhuma dessas opções.
- Explicar por que uma classe imutável com todos os campos `final` não precisa de nenhuma sincronização para ser lida com segurança por outras threads, uma vez que uma referência a ela esteja visível.

## Deep Dive

### O problema de visibilidade: sem happens-before, sem garantia

```java
public class NoVisibility {
    private static boolean ready;
    private static int number;

    private static class ReaderThread extends Thread {
        @Override
        public void run() {
            while (!ready) {
                Thread.yield();
            }
            System.out.println(number);
        }
    }

    public static void main(String[] args) {
        new ReaderThread().start();
        number = 42;
        ready = true;
    }
}
```

Isso parece que deveria obrigatoriamente imprimir `42`. Pode em vez disso imprimir `0`, ou nunca terminar. Nem `ready` nem `number` são `volatile`, `synchronized`, ou de qualquer outra forma ordenados contra a thread leitora, então não existe aresta happens-before entre as escritas da thread principal e as leituras da thread leitora (JLS §17.4.5). Sem uma:

- A thread leitora pode nunca observar `ready` se tornar `true` — a escrita pode ficar em um cache de CPU ou em uma posição reordenada por CPU/compilador que a execução dessa thread nunca tem motivo para invalidar, então o laço gira para sempre.
- Mesmo que ela veja `ready == true`, a JVM tem permissão de tornar essa escrita visível *antes* da escrita em `number` se tornar visível, porque reordenar de um jeito que não é observável pela própria execução da thread escritora é legal — então a leitora pode imprimir `0`.

Isso não é um bug do JIT; é o modelo de memória fazendo exatamente o que está especificado a fazer, para que compiladores e CPUs possam cachear e reordenar operações por performance na ausência (padrão) de sincronização. A correção é sempre a mesma: estabelecer uma aresta happens-before — um lock, um campo `volatile`, ou uma das outras construções que a JLS §17.4.5 lista — entre a escrita e a leitura.

### `volatile`: visibilidade e ordenação, não atomicidade

Declarar um campo `volatile` garante que uma leitura dele sempre vê a escrita mais recente feita por qualquer thread, e impede que o compilador/runtime reordene outras operações de memória ao redor do acesso volatile. Isso **não** torna operações compostas sobre esse campo atômicas:

```java
class Counter {
    volatile int counter = 0;

    void increment() {
        counter++; // read, add 1, write — three steps, not one
    }
}
```

`counter++` é um read-modify-write: ler `counter`, calcular `counter + 1`, escrever de volta. `volatile` garante que cada leitura e escrita individual é visível imediatamente, mas não faz nada para impedir que duas threads leiam o mesmo valor, ambas calculem o mesmo valor incrementado, e ambas escrevam de volta — um incremento se perde silenciosamente. Execute chamadas concorrentes a `increment()` o suficiente e o valor final de `counter` será menor que o número de chamadas feitas.

`volatile` é a ferramenta certa só quando tudo isto vale: escritas ao campo não dependem do seu valor atual (ou só uma thread jamais o escreve), o campo não participa de um invariante com outro estado, e nenhum outro motivo exige lock enquanto ele é acessado. Uma flag pura de status/conclusão — o campo `ready` acima, tornado `volatile` — é o caso didático. Para um contador que várias threads incrementam, use `java.util.concurrent.atomic.AtomicInteger` (coberto no conceito irmão de utilitários de concorrência) ou um lock.

### Publicação segura vs. deixar uma referência escapar

*Publicar* um objeto significa deliberadamente torná-lo alcançável por outro código — armazená-lo em um campo que outra thread pode ler, retorná-lo, passá-lo para outro objeto. Fazer isso com segurança significa que a referência **e** o estado totalmente inicializado do objeto se tornam visíveis para a outra thread juntos. Atribuição simples a um campo não garante isso:

```java
// Unsafe publication — compiles, runs, and can still hand another
// thread a reference to a partially-constructed Holder.
public Holder holder;

public void initialize() {
    holder = new Holder(42);
}
```

Sem uma aresta happens-before entre essa escrita e a leitura de `holder` por outra thread, essa thread pode ver uma referência obsoleta (`null`), ou — mais surpreendentemente — uma referência atualizada a um `Holder` cujos campos ainda têm seus valores padrão, porque a construção do objeto e a escrita do campo podem ser observadas fora de ordem.

Formas reconhecidas pela JLS de publicar um objeto com segurança:

- Atribuí-lo a partir de um **inicializador estático** (`public static Holder holder = new Holder(42);`) — o travamento de inicialização de classe da JVM (JLS §12.4.2) torna isso seguro automaticamente.
- Armazená-lo em um campo **`volatile`** ou um `AtomicReference`.
- Armazená-lo em um campo **`final`** de um objeto devidamente construído.
- Armazená-lo em um campo que é **protegido por um lock** toda vez que é lido ou escrito.

O outro lado do mesmo problema é deixar `this` escapar *durante a construção*, antes que qualquer uma das opções acima tenha tido chance de se aplicar:

```java
// this escapes before the constructor finishes — don't do this.
public class ThisEscape {
    public ThisEscape(EventSource source) {
        source.registerListener(event -> doSomething(event)); // captures `this`
    }
}
```

A instância envolvente da lambda é `this`, e `registerListener` pode entregar essa referência a outra thread antes do construtor de `ThisEscape` retornar — mesmo que a chamada seja a última instrução do construtor. A correção é manter construção e registro em duas etapas, de modo que nada fora do construtor consiga ver o objeto até que ele esteja finalizado:

```java
public class SafeListener {
    private final EventListener listener;

    private SafeListener() {
        listener = event -> doSomething(event);
    }

    public static SafeListener newInstance(EventSource source) {
        SafeListener safe = new SafeListener();
        source.registerListener(safe.listener); // registered only after construction returns
        return safe;
    }
}
```

Um construtor privado mais um método fábrica estático aplica a mesma correção a qualquer padrão de "iniciar uma thread no construtor" ou "registrar um callback no construtor": construa o objeto completamente primeiro, publique-o depois.

### A garantia especial dos campos `final`

Campos `final` recebem uma garantia que o resto do modelo de memória não dá de graça: contanto que um objeto seja *devidamente construído* (sua referência `this` não escapou durante a construção), qualquer thread que obtenha uma referência a ele — por qualquer meio, seguro ou não — tem a garantia de ver os valores para os quais seus campos `final` foram inicializados (JLS §17.5, "initialization safety"). Nenhum `volatile`, nenhum lock, nenhuma aresta happens-before é necessária para essa garantia específica.

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    }
    // getters omitted
}
```

Entregue uma referência a `Point` a outra thread por qualquer canal — mesmo um publicado de forma insegura — e essa thread tem a garantia de ver os valores de `x`/`y` definidos no construtor, não `0`/`0`. É exatamente isso que torna um objeto imutável devidamente construído seguro para leitura por threads sem sincronização: com todo campo `final` (e nenhum campo referenciando um objeto mutável cujo *próprio* estado ainda possa mudar), não sobra nada que precise de uma aresta happens-before para ser observado corretamente. O conceito irmão `immutability-and-defensive-copying` cobre imutabilidade do ângulo de corretude de API — protegendo invariantes e evitando mutação externa; este é o mesmo rigor de campos `final` visto do ângulo de thread-safety — por que ele permite que threads dispensem sincronização por completo.

A garantia é mais estreita do que parece: ela cobre o valor do próprio campo `final`, não o estado de qualquer objeto mutável para o qual esse campo aponte. Um campo `final Set<String>` garante que toda thread veja a mesma referência de `Set` corretamente inicializada — não diz nada sobre se a mutação concorrente do conteúdo desse `Set` é segura.

## Trade-offs

- **Uma leitura obsoleta não é o único modo de falha — a reordenação também é.** Mesmo depois que `ready` finalmente se torna visível, `number` pode não estar, porque escritas feitas em ordem de programa não têm garantia de se tornarem visíveis nessa mesma ordem sem uma aresta happens-before.
  ```java
  // main thread:
  number = 42;
  ready = true; // reader could observe ready==true, number==0
  ```
- **`volatile` é barato, mas estreito.** Ele elimina a necessidade de bloquear por visibilidade, mas só cobre a visibilidade e ordenação de um único campo — recorra a um `Lock`/bloco `synchronized` (ou uma classe atômica) no momento em que dois campos precisarem mudar juntos como uma unidade, ou o próximo valor de um campo depender do seu valor atual sob escritores concorrentes.
- **`this` escapando de um construtor é fácil de passar despercebido em revisão.** Iniciar uma thread, registrar um listener, ou chamar um método de instância sobrescrevível de dentro de um construtor todos vazam `this` antes do objeto estar pronto — nada disso falha na compilação, e pode passar em todo teste que por acaso não corre contra as instruções restantes do construtor.
- **A garantia de campos `final` só alcança até a profundidade do próprio campo.** Marcar um campo `final` é suficiente para que o valor do próprio campo fique seguramente visível sem sincronização; isso não faz nada pelo estado interno de um objeto mutável para o qual esse campo aponta — esse objeto ainda precisa de sua própria política de sincronização se outras threads o mutarem.
- **Confinamento de thread contorna a visibilidade por completo, ao custo de não compartilhar.** Manter um objeto alcançável só por uma thread (uma variável local, ou um `ThreadLocal`) não precisa de nenhuma sincronização — mas só funciona enquanto nada publicar essa referência em outro lugar, e nada na linguagem impõe essa fronteira por você.

## Documentation Links

- [Chapter 17. Threads and Locks — Java Language Specification (JLS SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html) — doc
- [JLS §17.4 Memory Model](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4) — doc
- [JLS §17.5 final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
- [JLS §17.7 Non-Atomic Treatment of double and long](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.7) — doc
- [volatile — Java Language Keywords (Java SE tutorials)](https://docs.oracle.com/javase/tutorial/java/javaOO/variables.html) — doc
- [AtomicReference — java.util.concurrent.atomic](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/atomic/AtomicReference.html) — doc
