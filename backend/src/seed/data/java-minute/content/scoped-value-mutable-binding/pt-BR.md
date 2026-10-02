---
version: 1.0
updatedAt: 2026-10-02
question: Você pode vincular objetos mutáveis a scoped values?
---
## Question

# Você pode vincular objetos mutáveis a scoped values?

## Short Answer

Sim, mas eu acho que você não deveria.

## Less Short Answer

Mutabilidade sempre traz problemas de race condition. A única forma de ter certeza de que não existe nenhuma race condition possível no seu código é quando você tem uma única thread executando tudo, e isso também vale para scoped values.

## Scoped Values Não São Sobre Threads

Scoped values não têm relação com multithreading. Você chama uma tarefa, modelada por um `Runnable` ou um `Callable`, e define um binding para uma variável scoped value que fica disponível no escopo dessa tarefa. Se você tem certeza de que nenhuma thread é criada nessa tarefa, então vincular um valor mutável é seguro. Se não, você precisa gerenciar as possíveis race conditions por conta própria.

```java
static final ScopedValue<List<String>> LOG = ScopedValue.newInstance();

// uma única thread: a lista mutável nunca é compartilhada, então é seguro
ScopedValue.where(LOG, new ArrayList<>()).run(() -> {
    LOG.get().add("start");
    LOG.get().add("end");
});
```

## Onde Quebra

Subtarefas criadas com `fork` em um `StructuredTaskScope` enxergam o binding do pai. Com um valor mutável, todas compartilham o mesmo objeto, a partir de threads diferentes:

```java
ScopedValue.where(LOG, new ArrayList<>()).run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        for (int i = 0; i < 1_000; i++) {
            int n = i;
            scope.fork(() -> LOG.get().add("task " + n)); // ArrayList não é thread-safe
        }
        scope.join();
    } catch (InterruptedException e) {
        Thread.currentThread().interrupt();
    }
    System.out.println(LOG.get().size()); // pode imprimir menos de 1000, ou lançar exceção
});
```

Vincular um valor imutável resolve o problema: todas as subtarefas leem o mesmo valor, e ninguém consegue alterá-lo.

```java
static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> {
    // seguro ler de qualquer subtarefa: uma String não muda
});
```

## One Last Word

Fique seguro, fique longe de vincular valores mutáveis. Não é porque você pode fazer algo que você deveria fazer.

## References

- [Java Coding Tip #400: Can You Bind Mutable Objects to Scoped Values?](https://youtube.com/shorts/S5d3H01efbw) (video)
- [ScopedValue (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) (doc)
- [StructuredTaskScope (Java SE 25 API)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/concurrent/StructuredTaskScope.html) (doc)
- [JEP 506: Scoped Values](https://openjdk.org/jeps/506) (doc)
