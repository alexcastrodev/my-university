---
version: 1.0
updatedAt: 2026-08-21
title: O Modelo de Memória do Java: Happens-Before e Reordenação
summary: As regras formais de happens-before do Capítulo 17 da JLS que determinam quando uma escrita em uma thread tem visibilidade garantida para uma leitura em outra.
---
## Objective

O Java Memory Model (Capítulo 17 da JLS, "Threads and Locks") é a especificação formal que responde a uma pergunta que a linguagem, de outra forma, deixaria em aberto: dada uma escrita em uma thread e uma leitura da mesma variável em outra, quando essa leitura tem *garantia* de enxergar aquela escrita? O conceito complementar `visibility-and-safe-publication` cobre esse terreno de forma prática — loops de espera que nunca terminam, `volatile`, idiomas de publicação segura, campos `final`. Este conceito é o complemento formal dele: a própria relação de *happens-before*, as regras exatas que a JLS usa para defini-la (§17.4.5), e por que — na ausência delas — o compilador, o JIT e a CPU estão cada um independentemente autorizados a reordenar operações de memória. Toda regra prática do conceito irmão é consequência de uma ou mais dessas regras formais.

## Use Cases

- Rastrear uma cadeia *específica* de happens-before em um trecho de código concorrente durante uma revisão, em vez de simplesmente "tem um lock em algum lugar, então provavelmente está OK".
- Explicar precisamente por que double-checked locking sem `volatile` está quebrado, e por que adicionar `volatile` conserta isso — não apenas que é um anti-padrão conhecido.
- Justificar, com uma citação da spec, por que um `join()` em uma worker thread torna as escritas dessa thread visíveis para a thread que fez o join, sem sincronização extra.
- Entender por que um objeto imutável construído com campos `final` é seguro para leitura entre threads, uma vez que uma referência a ele esteja visível — a garantia que a JLS §17.5 concede, e onde ela para.
- Responder perguntas estilo prova ou entrevista sobre reordenação de instruções ("isso pode imprimir 0?") citando a regra exata que se aplica ou não, em vez de intuição.

## Deep Dive

### Por que o modelo de memória existe: reordenação é legal por padrão

Sem uma restrição de ordenação explícita, a JLS dá ao compilador, ao JIT e à CPU permissão para executar as ações de uma thread em qualquer ordem que não mude o que *aquela thread* observa da sua própria execução — inclusive reordenando instruções que parecem sequenciais no código-fonte:

```java
class Reorder {
    static int x = 0;
    static int y = 0;

    // Thread A
    static void writer() {
        x = 1; // no data dependency between these two writes...
        y = 2; // ...so the compiler/JIT/CPU may make y visible before x
    }

    // Thread B
    static void reader() {
        if (y == 2) {
            System.out.println(x); // may print 0 — not a bug, it's the spec
        }
    }
}
```

`x` e `y` não dependem uma da outra, então nada na semântica single-thread de `writer()` é violado ao escrever `y` antes de `x` se tornar globalmente visível. Essa licença é deliberada — é ela que permite a um compilador manter um valor em um registrador em vez de sempre ir até a memória principal, e que permite a uma CPU fazer pipeline de stores independentes. O Java Memory Model existe para traçar a linha: ele define exatamente quais ordenações *são* garantidas (a relação happens-before), de forma que código que depende de sincronização possa ser raciocinado com precisão, enquanto código que não sincroniza não recebe garantia nenhuma.

### As regras de happens-before (JLS §17.4.5)

*Happens-before* não é "aconteceu antes no relógio de parede" — é uma relação de ordenação específica que a JLS define entre ações, e é a **única** coisa que garante que uma escrita seja visível para uma leitura posterior. A JLS §17.4.5 constrói essa relação a partir de um pequeno conjunto de regras:

- **Program order rule** — dentro de uma única thread, toda ação happens-before qualquer ação posterior na ordem do programa daquela thread.
- **Monitor lock rule** — um unlock de um monitor happens-before todo lock posterior *do mesmo* monitor.
- **Volatile variable rule** — uma escrita em um campo `volatile` happens-before toda leitura posterior *daquele mesmo* campo.
- **Thread start rule** — uma chamada a `Thread.start()` happens-before qualquer ação na thread iniciada.
- **Thread join rule** — toda ação em uma thread happens-before o retorno bem-sucedido de outra thread de um `join()` sobre ela.
- **Transitividade** — se A happens-before B, e B happens-before C, então A happens-before C.

```java
// Monitor lock rule
class Counter {
    private final Object lock = new Object();
    private int value;

    void increment() {
        synchronized (lock) {
            value++; // unlocking here happens-before the next thread's lock below
        }
    }

    int read() {
        synchronized (lock) {
            return value; // guaranteed to see every increment() that already returned
        }
    }
}
```

```java
// Volatile variable rule
class Flag {
    private volatile boolean ready;
    private int data;

    void writer() {
        data = 42;
        ready = true; // this write happens-before any later read of `ready`
    }

    void reader() {
        if (ready) {
            System.out.println(data); // guaranteed to be 42, never 0
        }
    }
}
```

```java
// Thread start and thread join rules
class StartJoin {
    static int data;

    public static void main(String[] args) throws InterruptedException {
        data = 42;
        Thread t = new Thread(() -> System.out.println(data)); // sees 42: start() happens-before it
        t.start();

        Thread writer = new Thread(() -> data = 99);
        writer.start();
        writer.join(); // writer's write to `data` happens-before this join() returns
        System.out.println(data); // guaranteed to be 99
    }
}
```

### Encadeando arestas com transitividade

Nenhuma das regras acima precisa conectar duas threads diretamente — a transitividade permite que arestas de happens-before se encadeiem através de uma ação intermediária, inclusive através de uma thread completamente diferente:

```java
class Chain {
    static int payload;
    static volatile boolean stagePassed;

    // Thread A
    static void produce() {
        payload = 7;          // (1)
        stagePassed = true;   // (2) volatile write: (1) happens-before (2)
    }

    // Thread B
    static void relay() {
        while (!stagePassed) {} // (3) volatile read: (2) happens-before (3)
        // by transitivity, (1) happens-before (3), so B is guaranteed to see payload == 7 here
        System.out.println(payload); // (4)
    }
}
```

(1) happens-before (2) pela regra de variável volatile no lado da escrita, (2) happens-before (3) pela regra de variável volatile no lado da leitura, e (3) happens-before (4) pela ordem do programa — logo, por transitividade, (1) happens-before (4), mesmo que `payload` em si nunca seja sincronizado. Esse é exatamente o mecanismo que faz os idiomas de publicação segura funcionarem: a referência (ou flag) publicada carrega uma aresta de happens-before que arrasta, transitivamente, tudo que foi escrito *antes* dela.

### Double-checked locking: a armadilha clássica de reordenação

Double-checked locking tenta evitar o custo de adquirir um lock a cada chamada verificando um campo duas vezes — uma vez sem lock, outra dentro do lock:

```java
// BROKEN: no happens-before edge for readers that skip the synchronized block
public class Singleton {
    private static Singleton instance;

    public static Singleton getInstance() {
        if (instance == null) {                  // first check, unlocked
            synchronized (Singleton.class) {
                if (instance == null) {           // second check, locked
                    instance = new Singleton();   // construction + field write
                }
            }
        }
        return instance;
    }
}
```

A monitor lock rule só ordena threads que ambas passam pelo mesmo bloco `synchronized`. Uma thread que enxerga `instance != null` na *primeira* verificação, sem lock, nunca adquire o lock, então não recebe nenhuma aresta de happens-before de volta para a escrita ali dentro — ela pode observar uma referência `instance` não nula para um objeto cujo construtor ainda não terminou de escrever seus campos, porque a escrita do campo e as escritas internas do construtor não são ordenadas em relação a esse leitor.

```java
// FIXED: volatile gives every reader — locked or not — a happens-before edge
public class Singleton {
    private static volatile Singleton instance;

    public static Singleton getInstance() {
        if (instance == null) {
            synchronized (Singleton.class) {
                if (instance == null) {
                    instance = new Singleton();   // volatile write happens-after full construction
                }
            }
        }
        return instance;
    }
}
```

Tornar `instance` `volatile` aciona diretamente a volatile variable rule: a escrita em `instance` happens-before *toda* leitura posterior dela, sincronizada ou não, então qualquer thread que observe uma referência não nula na primeira verificação sem lock tem a garantia de ver o objeto totalmente construído. Nada na versão quebrada deixa de compilar ou de rodar — ela simplesmente falha de forma intermitente, num cronograma que a JMM nunca prometeu evitar.

### Semântica de campos `final` (JLS §17.5)

O `visibility-and-safe-publication` cobre o benefício prático dos campos `final`: um objeto imutável, construído corretamente, não precisa de sincronização para ser lido com segurança. A JLS §17.5 é a fonte formal dessa garantia, chamada de *initialization safety*: uma vez que o construtor de um objeto termina sem deixar `this` escapar, todo campo `final` tem garantia de estar visível, corretamente inicializado, para qualquer thread que obtenha posteriormente uma referência a esse objeto — por *qualquer* meio, não apenas um ordenado por happens-before.

```java
public final class Point {
    private final int x;
    private final int y;

    public Point(int x, int y) {
        this.x = x;
        this.y = y;
    } // §17.5 "freezes" x and y here, if `this` never escaped before this point
}
```

"Construído corretamente" é toda a condição, e significa exatamente o que o exemplo `ThisEscape` de `visibility-and-safe-publication` mostra: nada derivado de `this` pode ser entregue a outra thread, outro objeto ou um registro de callback *antes* do construtor retornar.

```java
// Escaping `this` during construction voids the §17.5 guarantee for this object
public class Broken {
    final int value;

    Broken(EventSource source) {
        source.registerListener(this); // `this` escapes before `value` is set
        value = 42;
    }
}
```

Uma thread que recebe `this` por meio desse callback do listener pode executar antes de `value = 42` acontecer, então pode observar `value == 0` — o valor padrão — mesmo `value` sendo declarado `final`. A garantia só vale para objetos construídos corretamente; um `this` que escapa contorna a garantia inteiramente, independentemente dos modificadores do campo.

## Trade-offs

- **Happens-before é uma ordem parcial, não "tudo que veio antes no tempo".** Duas ações sem nenhuma regra conectando-as ficam desordenadas, não importa quantas *outras* arestas de happens-before existam em outros pontos do programa — um par de leitura/escrita não sincronizado sobre um campo compartilhado é uma data race mesmo em um código-base fortemente sincronizado, se nada ordena especificamente aquele par.
- **Cada regra só ordena o que ela nomeia.** A monitor lock rule só ordena threads que passam pelo *mesmo* lock; a volatile rule só ordena acessos àquele *um* campo. Buscar uma garantia mais ampla (por exemplo, ordenar dois campos independentes juntos) exige uma regra que de fato os abranja — um lock compartilhado, ou um único portão `volatile` como no exemplo de transitividade acima — não a suposição de que "alguma sincronização por perto" seja suficiente.
- **A quebra do double-checked locking sem `volatile` é invisível no código-fonte e na maioria das execuções de teste.** O código compila, e em muitas máquinas e configurações de JIT parece funcionar sempre, porque a reordenação que a JMM apenas *permite* não tem garantia de realmente acontecer em uma execução específica:
  ```java
  private static Singleton instance; // missing volatile — compiles fine, races silently
  ```
- **O modelo de memória raciocina sobre uma execução abstrata, não sobre o texto-fonte que um desenvolvedor lê.** Uma reordenação que parece "obviamente impossível" olhando a sequência de instruções na página pode ser inteiramente legal segundo a JLS §17.4, porque a reordenação de compilador, JIT e hardware é autorizada pela *ausência* de uma aresta de happens-before, não descartada pela forma como o código é lido visualmente de cima para baixo.
- **A garantia de campo `final` é anulada por qualquer escape durante a construção, por mais indireto que seja.** Passar `this` para um listener, iniciar uma thread, ou invocar um método sobrescrevível de dentro do construtor — todos vazam a referência antes de o "congelamento" da §17.5 se aplicar, e nenhum deles é um erro de compilação.

## Documentation Links

- [Chapter 17. Threads and Locks — Java Language Specification (JLS SE 25)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html) — doc
- [JLS §17.4.5 Happens-before Order](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.4.5) — doc
- [JLS §17.5 final Field Semantics](https://docs.oracle.com/javase/specs/jls/se25/html/jls-17.html#jls-17.5) — doc
- [Thread — java.lang (Java SE 25 & JDK 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/Thread.html) — doc
