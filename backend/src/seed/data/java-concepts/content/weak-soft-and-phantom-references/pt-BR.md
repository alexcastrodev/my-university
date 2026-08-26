---
version: 1.0
updatedAt: 2026-08-21
title: "Weak, Soft e Phantom References: Tipos de Referência Cientes do GC"
summary: Explica a hierarquia de referências strong/soft/weak/phantom, o polling via ReferenceQueue, e como o Cleaner substitui o Object.finalize() para limpeza determinística de recursos nativos.
---
## Objective

Toda referência de objeto em Java tem uma *força* que diz ao garbage collector o quão agressivamente ele pode reivindicar o objeto referenciado. Uma referência comum (strong) proíbe a coleta por completo — enquanto uma existir, o objeto é inalcançável pela foice do GC. `java.lang.ref` adiciona três níveis mais fracos — soft, weak e phantom — cada um relaxando essa garantia um pouco mais, permitindo que o código observe ou influencie a coleta em vez de apenas impedi-la. Este conceito cobre o que cada nível de fato garante, como `ReferenceQueue` notifica o código quando uma referência foi limpa ou enfileirada, e como `Cleaner` — o substituto moderno de `Object.finalize()` — constrói limpeza determinística de recursos nativos em cima de `PhantomReference`.

## Use Cases

- Construir um cache sensível a memória que retém valores enquanto há heap sobrando, mas permite que a JVM os reivindique em vez de lançar `OutOfMemoryError` — o trabalho de `SoftReference`.
- Indexar um map por um objeto sem que essa própria chave mantenha o objeto vivo — `WeakHashMap`, usado para canonicalizar metadados ou propriedades por objeto que devem desaparecer quando o objeto desaparece.
- Desregistrar listeners/observers automaticamente quando o objeto observado é coletado, em vez de depender de todo chamador chamar `removeListener` corretamente.
- Saber com certeza quando um objeto foi finalizado e sua memória reivindicada, para liberar um recurso nativo associado (um handle de arquivo, um buffer off-heap, um socket) — o trabalho de `PhantomReference` mais `ReferenceQueue`.
- Substituir `Object.finalize()` — descontinuado para remoção desde o Java 18 (JEP 421) — por `java.lang.ref.Cleaner` para limpeza de recursos que não ressuscita objetos nem roda em uma thread imprevisível.

## Deep Dive

### A hierarquia de força das referências

O GC decide o que reivindicar com base na cadeia de referência *mais forte* que alcança um objeto, da mais forte para a mais fraca:

```java
Object strong = new Object();               // strong: never collected while reachable
SoftReference<Object> soft = new SoftReference<>(new Object());   // collected only under memory pressure
WeakReference<Object> weak = new WeakReference<>(new Object());   // collected at the next GC cycle
PhantomReference<Object> phantom =
        new PhantomReference<>(new Object(), new ReferenceQueue<>()); // never reachable via get()
```

- **Strong** (o padrão, atribuição comum de variável/campo): o objeto nunca é elegível para coleta enquanto qualquer referência strong a ele existir.
- **Soft**: o objeto é elegível para coleta, mas a JVM só *deve* limpar referências soft quando precisar da memória — na prática, pouco antes de lançar `OutOfMemoryError`.
- **Weak**: o objeto é elegível para coleta assim que não sobra nenhuma referência strong a ele; `get()` retorna `null` no momento em que o GC decide limpá-la, o que pode acontecer já no próximo ciclo de coleta.
- **Phantom**: `get()` sempre retorna `null` — uma referência phantom nunca deixa o código recuperar o objeto. Ela só existe para ser enfileirada em uma `ReferenceQueue` depois que o objeto já foi finalizado e sua memória reivindicada.

Os três tipos vivem em `java.lang.ref` e estendem a classe abstrata `Reference<T>`.

### WeakReference: limpa assim que não sobra referência strong

```java
Object target = new Object();
WeakReference<Object> ref = new WeakReference<>(target);

System.out.println(ref.get()); // the Object instance — still strongly reachable via `target`

target = null;      // drop the only strong reference
System.gc();         // a *request* to the JVM, never a guarantee it runs or collects this object

System.out.println(ref.get()); // very likely null now, but not contractually guaranteed by this call alone
```

A limpeza acontece *antes* da finalização — uma `WeakReference` nunca atrasa nem observa a finalização de um objeto da forma como uma referência phantom faz; no momento em que `get()` começa a retornar `null`, o referenciado simplesmente já se foi do ponto de vista dessa referência. `System.gc()` é documentado apenas como uma sugestão para a JVM rodar a coleta de lixo; nunca é uma garantia, então depender dela em código de produção (em vez de em uma demonstração de rascunho como esta) é inseguro.

### WeakHashMap: chaves que não se mantêm vivas sozinhas

`WeakHashMap` envolve cada chave em uma `WeakReference`. Assim que nada fora do map detém uma referência strong a uma chave, essa entrada se torna elegível para remoção automática:

```java
Map<Object, String> registry = new WeakHashMap<>();

Object key = new Object();
registry.put(key, "metadata");
System.out.println(registry.size()); // 1

key = null;          // drop the only external strong reference to the key
System.gc();          // suggestion only — not guaranteed to run or to collect the entry immediately

// After the GC reclaims the key, the entry is removed from the map on a
// subsequent access/cleanup pass — size may already reflect it, or may
// still show 1 until the map's internal bookkeeping catches up.
System.out.println(registry.size());
```

Essa é a correção clássica para registros de listener/observer: um `HashMap<Listener, Data>` comum mantém todo listener registrado vivo para sempre, mesmo depois que o chamador que o registrou não tem mais nenhuma outra referência a ele. `WeakHashMap` permite que um listener esquecido desapareça junto com seu registro, em vez de vazar memória pelo resto da vida do processo.

### SoftReference: limpa só sob pressão de memória, garantida antes de OOM

```java
SoftReference<byte[]> cached = new SoftReference<>(new byte[64 * 1024 * 1024]);

byte[] data = cached.get();
if (data == null) {
    // was cleared — the JVM needed the memory; recompute or reload
    data = reload();
    cached = new SoftReference<>(data);
}
```

Ao contrário de `WeakReference`, a JVM não limpa referências soft oportunisticamente no próximo ciclo de coleta — a especificação exige que *todas* as referências soft sejam limpas antes da JVM lançar `OutOfMemoryError` por falta de heap. Isso torna `SoftReference` um bloco de construção razoável para um cache sensível a memória: as entradas sobrevivem enquanto houver heap sobrando, e são reivindicadas automaticamente em vez de a aplicação travar com `OutOfMemoryError` — mas ainda não há garantia sobre exatamente *quando*, dentro dessa janela de pressão, uma determinada entrada é limpa, então não substitui uma política de evicção que precise de temporização previsível (um cache LRU de tamanho fixo, por exemplo).

### PhantomReference: get() sempre null, enfileirada só após a finalização

```java
ReferenceQueue<Resource> queue = new ReferenceQueue<>();
Resource resource = new Resource();
PhantomReference<Resource> phantom = new PhantomReference<>(resource, queue);

System.out.println(phantom.get()); // always null — phantom references never return the referent

resource = null;
System.gc(); // suggestion only

Reference<? extends Resource> enqueued = queue.remove(); // blocks until the JVM enqueues it
System.out.println(enqueued == phantom); // true, once it happens
```

`get()` em uma `PhantomReference` retorna `null` incondicionalmente — não é uma forma de recuperar o objeto, só uma forma de ser avisado, via a fila, de que o objeto já foi finalizado e sua memória reivindicada. É isso que torna referências phantom adequadas para disparar de forma confiável a limpeza de recursos nativos: no momento em que a referência é enfileirada, o objeto Java já está de fato ausente, então não há risco de ressuscitá-lo nem de rodar código de limpeza que compita com código ainda usando o objeto.

### ReferenceQueue: registrando e fazendo polling

Qualquer `Reference` (soft, weak ou phantom) pode ser associada a uma `ReferenceQueue` no momento da construção. A JVM anexa a referência a essa fila quando limpa (soft/weak) ou limparia (phantom) o referenciado:

```java
ReferenceQueue<Object> queue = new ReferenceQueue<>();
WeakReference<Object> ref = new WeakReference<>(new Object(), queue);

// Non-blocking: returns null immediately if nothing has been enqueued yet.
Reference<?> polled = queue.poll();

// Blocking: waits until a reference is enqueued, or the timeout elapses.
Reference<?> removed = queue.remove(5000);
```

`poll()` é a escolha certa dentro de um laço de limpeza periódico (por exemplo, verificar uma vez por ciclo de manutenção sem bloquear essa thread); `remove()` — com ou sem timeout — é a escolha certa para uma thread de limpeza dedicada que não tem mais nada a fazer além de esperar por eventos de enfileiramento.

### Cleaner: o substituto moderno e determinístico de finalize()

`Object.finalize()` foi descontinuado para remoção no Java 9 e formalmente marcado como **descontinuado para remoção** pela JEP 421 (Java 18) por causa de problemas bem documentados: finalizadores rodam em uma thread imprevisível, escolhida pela JVM, podem nunca rodar, podem ressuscitar o objeto reestabelecendo uma referência strong a ele, e um finalizador lento pode travar a finalização de todo outro objeto enfileirado atrás dele. `java.lang.ref.Cleaner`, adicionado no Java 9, o substitui envolvendo um mecanismo baseado em `PhantomReference` atrás de uma API pequena e segura:

```java
import java.lang.ref.Cleaner;

public class NativeResource implements AutoCloseable {
    private static final Cleaner CLEANER = Cleaner.create();

    // State captured by the cleanup action must NOT hold a reference to `this` —
    // that would keep the resource reachable and defeat the whole mechanism.
    private static class State implements Runnable {
        private long nativeHandle;

        State(long nativeHandle) {
            this.nativeHandle = nativeHandle;
        }

        @Override
        public void run() {
            // release the native handle here
            System.out.println("Releasing native handle " + nativeHandle);
        }
    }

    private final State state;
    private final Cleaner.Cleanable cleanable;

    public NativeResource(long nativeHandle) {
        this.state = new State(nativeHandle);
        this.cleanable = CLEANER.register(this, state);
    }

    @Override
    public void close() {
        cleanable.clean(); // explicit, deterministic cleanup — runs the action immediately
    }
}
```

`Cleaner.register(this, state)` internamente cria uma `PhantomReference` para `this` em uma `ReferenceQueue` que o `Cleaner` gerencia, com uma thread dedicada fazendo polling dessa fila e invocando `state.run()` assim que o objeto se torna phantom-reachable — ou seja, depois de ser finalizado (pulado, já que não há `finalize()` aqui) e estar de resto inalcançável. Chamar `cleanable.clean()` explicitamente (a partir de `close()`) roda a mesma ação imediatamente e a marca como concluída, então a eventual limpeza da thread de fundo disparada pelo GC vira uma rede de segurança sem efeito em vez do mecanismo principal. `try-with-resources` sobre `NativeResource` continua sendo o caminho principal de limpeza; o `Cleaner` só protege contra um chamador que esquece de chamar `close()`.

## Trade-offs

- **`System.gc()` é um pedido, nunca uma garantia.** Toda demonstração acima depende de a JVM de fato rodar uma coleta depois de `System.gc()`, o que a especificação explicitamente não promete — código de produção nunca deve depender de que uma referência específica seja limpa em um momento específico.
  ```java
  System.gc(); // JVM may ignore this call entirely
  ```
- **Referências weak podem sumir mais rápido do que o esperado.** Como uma `WeakReference` é limpa assim que não sobra nenhuma referência strong, um valor que só é alcançável fracamente pode desaparecer entre uma instrução e a próxima, se por acaso um ciclo de GC rodar entre elas — código que lê `get()` sempre precisa tratar um resultado `null`, mesmo logo depois de confirmar que ele era não-nulo.
  ```java
  if (weakRef.get() != null) {
      // GC could still clear it here, before the next line runs
      use(weakRef.get()); // must re-check for null
  }
  ```
- **Caches com `SoftReference` trocam previsibilidade por dimensionamento automático.** Eles evitam lógica manual de evicção e evitam `OutOfMemoryError` de um cache sem limite, mas não oferecem controle sobre exatamente quando ou em que ordem as entradas são limpas — um cache com requisitos rígidos de latência ou tamanho ainda precisa de uma estrutura explícita, limitada/LRU, em vez disso.
- **`PhantomReference` não consegue ressuscitar nem inspecionar o objeto.** `get()` sempre retorna `null`, então ela é inútil para qualquer coisa além de *perceber* a coleta — qualquer estado real de limpeza (como um handle nativo) precisa ser armazenado separadamente, no objeto passado a `Cleaner.register()` ou mantido ao lado da `PhantomReference`, nunca recuperado da própria referência.
- **Limpeza baseada em `Cleaner`/phantom é uma rede de segurança, não um substituto para gerenciamento explícito de recursos.** A thread de limpeza só roda depois que o objeto já está inalcançável e um ciclo de GC por acaso ocorre — não há limite para quanto tempo isso leva, então depender só dela (em vez de `try-with-resources`/`close()`) pode deixar recursos nativos retidos por muito mais tempo do que o necessário.
- **`Object.finalize()` está descontinuado para remoção (JEP 421, Java 18).** Código que ainda o sobrescreve deve migrar para `Cleaner`, que não permite ressurreição e roda a limpeza em uma thread dedicada em vez de uma thread de finalizador não especificada.

## Documentation Links

- [Reference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Reference.html) — doc
- [WeakReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/WeakReference.html) — doc
- [SoftReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/SoftReference.html) — doc
- [PhantomReference — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/PhantomReference.html) — doc
- [ReferenceQueue — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/ReferenceQueue.html) — doc
- [Cleaner — java.lang.ref](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ref/Cleaner.html) — doc
- [WeakHashMap — java.util](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/WeakHashMap.html) — doc
- [JEP 421: Deprecate Finalization for Removal](https://openjdk.org/jeps/421) — doc
