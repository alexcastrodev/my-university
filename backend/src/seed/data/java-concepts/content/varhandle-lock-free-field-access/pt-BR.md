---
version: 1.0
updatedAt: 2026-08-21
title: "VarHandle: Acesso Lock-Free a Campos Comuns"
summary: O VarHandle (JEP 193) permite que um programa aplique acesso com força atômica e volatile a um campo comum ou elemento de array, na força de ordenação de memória escolhida, sem envolvê-lo em uma classe como AtomicInteger.
---
## Objective

`VarHandle` (JEP 193, adicionado no Java 9) dá a um programa acesso atômico e volatile a uma variável *comum* — um campo de instância, um campo estático, ou um elemento de array — sem envolver essa variável em uma classe como `AtomicInteger`. O campo continua sendo um `int`, `long` ou referência de objeto comum; o que muda é que leituras e escritas nele podem passar por um `VarHandle` em vez dos operadores `.`/`=`, na força de ordenação de memória que o ponto de chamada escolher. O conceito irmão `java-memory-model-and-happens-before` define formalmente a relação happens-before e a regra da variável volatile — este conceito trata da API que permite ao código invocar essas mesmas garantias, mais duas forças intermediárias que a palavra-chave `volatile` da linguagem não consegue expressar sozinha. `method-handles-and-runtime-class-generation` cobre `MethodHandle`, uma API *diferente* para invocar métodos e construtores; `VarHandle` é sua irmã para variáveis, compartilhando a mesma infraestrutura `java.lang.invoke.MethodHandles.Lookup` para verificação de acesso.

## Use Cases

- Tornar um único campo quente incrementável atomicamente (um contador de requisições, um gerador de sequência) sem pagar por um objeto `AtomicInteger` e a indireção extra de ler através dele.
- Escrever código de infraestrutura — um cache, um pool de conexões, uma fila lock-free — que precisa de `compareAndSet` em um campo que precisa continuar sendo um tipo comum por motivos de serialização, inlining do JIT, ou layout de memória.
- Escolher uma ordenação mais fraca que `volatile` (`acquire`/`release` ou `opaque`) em um campo lido com muito mais frequência do que é escrito, onde a semântica volatile completa custa mais garantia de visibilidade do que o algoritmo de fato precisa.
- Retrofitar acesso atômico em um campo de uma classe que não é sua para transformar em um campo `AtomicInteger` — o `VarHandle` é externo à declaração do campo.
- Entender como as próprias classes de `java.util.concurrent` do JDK migraram de `sun.misc.Unsafe` para `VarHandle` como o primitivo de baixo nível suportado.

## Deep Dive

### O que o `VarHandle` substitui: um objeto wrapper por variável

Antes do `VarHandle`, acesso atômico a um campo comum significava ou `synchronized`, ou trocar o *tipo* do campo para `AtomicInteger`/`AtomicLong`/`AtomicReference` — o que muda todo ponto de leitura (`counter.get()` em vez de `counter`) e adiciona um objeto e uma indireção por variável:

```java
class RequestCounter {
    private final AtomicInteger count = new AtomicInteger();

    void recordRequest() {
        count.incrementAndGet();
    }
}
```

Um `VarHandle` visa o próprio campo em vez de substituí-lo, então o campo continua sendo um `int` comum — legível diretamente, exatamente tão rápido quanto qualquer outro acesso a campo — e a operação atômica só é invocada onde de fato é necessária:

```java
import java.lang.invoke.MethodHandles;
import java.lang.invoke.VarHandle;

class RequestCounter {
    private int count;   // still an ordinary int field

    private static final VarHandle COUNT;
    static {
        try {
            COUNT = MethodHandles.lookup()
                    .findVarHandle(RequestCounter.class, "count", int.class);
        } catch (ReflectiveOperationException e) {
            throw new ExceptionInInitializerError(e);
        }
    }

    void recordRequest() {
        COUNT.getAndAdd(this, 1);
    }

    int currentCount() {
        return count;   // ordinary field read still works
    }
}
```

### Obtendo um handle: `findVarHandle` e acesso via lookup

`MethodHandles.Lookup.findVarHandle` resolve um `VarHandle` para um campo nomeado, dados sua classe declarante e tipo declarado — o mesmo objeto `Lookup` usado para resolução de `MethodHandle` em `method-handles-and-runtime-class-generation`, e obedece à mesma regra de acesso: o `Lookup` precisa ter sido criado com visibilidade sobre aquele campo. Um `Lookup` obtido chamando `MethodHandles.lookup()` *dentro* de `RequestCounter` consegue ver `count` porque ele é privado, mas está na mesma classe; um `Lookup` de fora não consegue:

```java
class Vault {
    private int code = 42;
}

// From inside Vault itself, a plain lookup sees the private field:
VarHandle vh = MethodHandles.lookup()
        .findVarHandle(Vault.class, "code", int.class);   // works — called from Vault

// From an unrelated class, the same call fails:
MethodHandles.lookup().findVarHandle(Vault.class, "code", int.class);
// java.lang.IllegalAccessException: field Vault.code is not accessible from class Outsider
```

Alcançar um campo privado de fora da sua classe requer `MethodHandles.privateLookupIn` primeiro — a mesma ponte documentada para `MethodHandle` — que só funciona se o módulo do alvo abrir o pacote para o módulo do chamador. `findVarHandle` lança `NoSuchFieldException` ou `IllegalAccessException` (checked) no momento do lookup, então resolver o handle uma única vez em um `static final VarHandle` (como acima) é tanto a forma idiomática quanto a única sensata de tratar essa exceção.

### Acesso simples: `get`/`set` se comportam como acesso a campo comum

`VarHandle.get`/`.set` não carregam **nenhuma** garantia de ordenação além do que uma leitura/escrita de campo comum já tem — nenhuma aresta happens-before é criada, e o compilador/JIT/CPU continuam livres para reordenar ou fazer cache do acesso exatamente como descrito para campos não sincronizados em `java-memory-model-and-happens-before`:

```java
int v = (int) COUNT.get(this);     // equivalent to: int v = this.count;
COUNT.set(this, 7);                // equivalent to: this.count = 7;
```

Esses modos existem principalmente por simetria e para casos em que um campo precisa ser acessado reflexivamente através de um handle (um serializador genérico, por exemplo), mas nenhuma ordenação é necessária — eles não trazem nenhum ganho sobre `this.count` quando uma referência direta ao campo está disponível.

### `getVolatile`/`setVolatile`: a regra da variável volatile, sob demanda

`getVolatile` e `setVolatile` dão ao campo exatamente a semântica que um modificador `volatile` daria — a regra da variável volatile do JMM, da JLS §17.4.5, se aplica: uma escrita `setVolatile` acontece-antes de toda leitura `getVolatile` posterior daquela mesma variável, sem declarar o campo `volatile` no código-fonte:

```java
private boolean ready;   // not declared volatile

private static final VarHandle READY;
static {
    try {
        READY = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "ready", boolean.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

void publish() {
    // ordinary writes here happen-before the volatile write below, by program order + transitivity
    READY.setVolatile(this, true);
}

void consume() {
    if ((boolean) READY.getVolatile(this)) {
        // guaranteed to see everything publish() wrote before setVolatile
    }
}
```

Esse é o truque útil que uma palavra-chave `volatile` sozinha não consegue oferecer: o campo pode ser *comum* na maior parte do tempo (acesso rápido e não ordenado via `.ready`) e *volatile* só nos pontos de chamada específicos que precisam da ordenação, escolhida por acesso em vez de por declaração.

### `getAcquire`/`setRelease`: ordenado, mas mais fraco que volatile

Acquire/release é uma força estritamente entre simples e volatile. Uma escrita `setRelease` tem a garantia de acontecer-antes de uma leitura `getAcquire` posterior da *mesma* variável — o suficiente para publicar dados com segurança através daquele único campo, o mesmo formato de publicar/consumir do exemplo volatile acima — mas, ao contrário de `setVolatile`/`getVolatile`, acquire/release não participa da ordem total que o JMM dá coletivamente a *todos* os acessos volatile. Na prática isso torna essa opção mais barata em hardware com ordenação de memória mais fraca, ao custo de uma garantia que a maioria dos pontos de chamada nunca precisou de fato:

```java
void publish() {
    // writes before this happen-before a getAcquire read that observes `true`
    READY.setRelease(this, true);
}

void consume() {
    if ((boolean) READY.getAcquire(this)) {
        // sees everything written before setRelease — same publish guarantee, weaker global ordering
    }
}
```

### `getOpaque`/`setOpaque`: ordenação só por variável

Opaque é ainda mais fraco: garante apenas que acessos àquela *única* variável não sejam reordenados entre si (uma propriedade às vezes chamada de coerência) — não estabelece nenhuma aresta happens-before com nenhuma *outra* variável. Onde os exemplos de volatile e acquire/release acima deixam um leitor observar com segurança escritas não relacionadas que aconteceram antes no escritor, opaque não dá nada disso:

```java
private static final VarHandle SEQUENCE;
static {
    try {
        SEQUENCE = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "sequence", long.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

void bumpSequence() {
    long next = (long) SEQUENCE.getOpaque(this) + 1;
    SEQUENCE.setOpaque(this, next);   // ordered relative to other accesses of `sequence` only
}
```

Opaque é o modo a usar quando um valor só precisa ser internamente consistente consigo mesmo (um contador observado monotonicamente, um carimbo de geração) e nada mais depende de ordenação em relação a ele.

### Operações compostas atômicas em um campo comum

`compareAndSet`, `getAndAdd` e `getAndSet` realizam o mesmo read-modify-write atômico que `AtomicInteger` oferece — mas diretamente sobre o campo `int` comum, através do handle:

```java
private int count;

private static final VarHandle COUNT;
static {
    try {
        COUNT = MethodHandles.lookup()
                .findVarHandle(RequestCounter.class, "count", int.class);
    } catch (ReflectiveOperationException e) {
        throw new ExceptionInInitializerError(e);
    }
}

boolean tryResetIfExhausted(int limit) {
    return COUNT.compareAndSet(this, limit, 0);   // atomic: only resets if count == limit
}

int nextSequenceValue() {
    return (int) COUNT.getAndAdd(this, 1);         // atomic increment, returns the pre-increment value
}

int replaceCount(int newValue) {
    return (int) COUNT.getAndSet(this, newValue);  // atomic swap, returns the previous value
}
```

`count` aqui nunca é envolvido — `this.count` continua sendo uma leitura direta e legal em qualquer outro lugar da classe; a atomicidade é uma propriedade da chamada específica através de `COUNT`, não do tipo declarado do campo.

### Elementos de array: `arrayElementVarHandle`

O mesmo mecanismo se estende a elementos de array, que é onde `AtomicInteger`/`AtomicLong` não têm equivalente direto, exceto por `AtomicIntegerArray`/`AtomicLongArray` — `MethodHandles.arrayElementVarHandle` produz um handle cujos métodos de acesso recebem o array mais um índice:

```java
VarHandle intArrayHandle = MethodHandles.arrayElementVarHandle(int[].class);

int[] slots = new int[16];
intArrayHandle.setVolatile(slots, 3, 42);
int v = (int) intArrayHandle.getVolatile(slots, 3);

boolean claimed = intArrayHandle.compareAndSet(slots, 3, 42, 0);   // atomic CAS on slots[3]
```

Um único handle serve todo índice de todo `int[]` — ele não é por array nem por slot, motivo pelo qual pode ser resolvido uma vez só e reutilizado em todo array daquele tipo de componente.

## Trade-offs

- **`VarHandle` evita o objeto wrapper, mas é uma API de nível mais baixo e mais verbosa que `AtomicInteger`/`AtomicLong`** — obter um handle exige um `Lookup`, um nome de campo, um tipo, e uma chamada que lança exceção checada, contra `new AtomicInteger()`. É a infraestrutura primitiva com a qual código de baixo nível (boa parte do próprio `java.util.concurrent`, que o JDK reescreveu de `sun.misc.Unsafe` para `VarHandle`) é construída, não a primeira ferramenta a buscar em código de aplicação comum, onde `AtomicInteger` já fica claro.
- **Escolher o modo de acesso errado é um bug de corretude silencioso, não um erro de compilação.** `get`/`set`, `getOpaque`/`setOpaque`, `getAcquire`/`setRelease` e `getVolatile`/`setVolatile` compilam de forma idêntica; escolher `get` onde `getVolatile` era necessário produz código que roda corretamente em teste e falha sob agendamento concorrente real, exatamente como a armadilha do double-checked locking sem `volatile` em `java-memory-model-and-happens-before`.
- **Incompatibilidades de assinatura aparecem em runtime, não em tempo de compilação**, porque os acessores de `VarHandle` são polimórficos por assinatura, como `MethodHandle.invoke`:
  ```java
  boolean b = COUNT.compareAndSet(this, "5", 10);
  // WrongMethodTypeException: expected (RequestCounter,int,int)boolean
  //   but found (RequestCounter,String,int)boolean
  ```
- **`findVarHandle` obedece à mesma barreira de acesso de módulo que os lookups de `MethodHandle`** — resolver um handle para um campo em uma classe cujo pacote não está aberto ao módulo do chamador lança `IllegalAccessException` (ou `InaccessibleObjectException` pelo caminho reflexivo), com a mesma correção via `--add-opens` vivendo fora do código-fonte em vez de dentro dele.
- **Um `VarHandle` é resolvido uma vez e reutilizado, não recriado a cada chamada** — resolvê-lo dentro de um método quente em vez de fazer cache dele como um campo `static final` paga o custo do lookup em toda invocação, a mesma armadilha de performance que `method-handles-and-runtime-class-generation` documenta para `MethodHandle`.

## Documentation Links

- [VarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/VarHandle.html) — doc
- [MethodHandles.Lookup.findVarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.Lookup.html#findVarHandle(java.lang.Class,java.lang.String,java.lang.Class)) — doc
- [MethodHandles.arrayElementVarHandle — java.lang.invoke API (Java SE 25)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/invoke/MethodHandles.html#arrayElementVarHandle(java.lang.Class)) — doc
- [JEP 193: Variable Handles](https://openjdk.org/jeps/193) — doc
