---
version: 1.0
updatedAt: 2026-08-18
title: "Scoped Values: Um Substituto Moderno para o ThreadLocal"
summary: ScopedValue (finalizado no Java 25 pela JEP 506) substitui o slot mutável e propenso a leak por thread do ThreadLocal por um binding imutável cujo tempo de vida é exatamente a extensão dinâmica de uma lambda run()/call() — sem set(), sem remove() para esquecer, e herança automática por subtasks disparadas em um StructuredTaskScope.
---
## Objective

Por vinte anos, a única forma de entregar um valor para código lá no fundo de uma call stack sem passá-lo por toda assinatura de método foi `ThreadLocal` — um slot mutável por thread que qualquer código que tenha a chave pode sobrescrever com `set()`, e que vaza a menos que todo caminho que o escreve também chame `remove()` em um `finally`. `ScopedValue` (`java.lang.ScopedValue`), finalizado no Java 25 pela JEP 506, substitui esse slot por um binding imutável cujo tempo de vida é a *extensão dinâmica* de uma lambda: `ScopedValue.where(KEY, value).run(() -> ...)` faz `KEY.get()` retornar `value` para todo frame chamado a partir dessa lambda — incluindo threads disparadas dentro dela — e desfaz o binding no instante em que `run()` retorna. Não existe `set()`, então nada rio abaixo consegue mutar o contexto por baixo do seu chamador, e não existe `remove()` para esquecer, então não há nada para vazar. Esta é uma API estável, pronta para produção, não uma de preview.

## Use Cases

- Carregar contexto por requisição — request ID, usuário autenticado, tenant, identificadores de trace/span, locale — de um handler de entrada até um repositório ou logger muitos frames adiante, sem adicionar um parâmetro `RequestContext ctx` a cada método pelo caminho.
- Rodar esse mesmo padrão em um servidor que reutiliza platform threads de um pool, onde um `ThreadLocal` deixado para trás por uma requisição fica visível para a *próxima* requisição servida pela mesma thread — um bug de correção em cima do vazamento de memória.
- Rodar em virtual threads na escala para a qual elas foram construídas: um milhão de requisições em voo significa um milhão de threads, e uma cópia de `ThreadLocal` por thread é um milhão de cópias desse contexto; um binding de `ScopedValue` é desenhado exatamente para esse fan-out.
- Propagar contexto para subtasks disparadas de um `StructuredTaskScope` com zero plumbing — o filho enxerga o binding do pai automaticamente, sem `InheritableThreadLocal` e sem cópia manual no ponto do fork.
- Reforçar que um pedaço de contexto só é legível onde faz sentido: fora do binding, `get()` lança exceção em vez de silenciosamente retornar um valor obsoleto de uma requisição anterior.

## Deep Dive

### Declarando um scoped value: é uma chave, não um container

```java
public class Server {
    // static final — one shared key for the whole program
    static final ScopedValue<String> CURRENT_USER = ScopedValue.newInstance();
    static final ScopedValue<String> REQUEST_ID   = ScopedValue.newInstance();
}
```

`newInstance()` não cria um slot que guarda algo. O objeto `ScopedValue` é uma *chave* — o valor para o qual ela mapeia depende inteiramente de qual binding está ativo na thread atual no momento em que `get()` roda. É por isso que a declaração idiomática é `static final` e em nível de pacote/classe: o mesmo objeto chave precisa estar visível tanto para o código que faz o binding quanto para o código lá embaixo que o lê. Torná-lo um campo de instância, ou criar um novo por requisição, quebra todo o mecanismo — quem lê precisaria de uma referência para *aquela* instância, que é exatamente o problema de passar parâmetro que a classe existe para resolver.

### Fazendo binding com `run()` e `call()`

```java
// run() — no result
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());   // "alice"
    processRequest();                          // any depth below also sees "alice"
});

System.out.println(CURRENT_USER.isBound());    // false — binding is gone
```

`where(key, value)` retorna um `ScopedValue.Carrier`: uma descrição imutável de "esta chave vinculada a este valor", que ainda não teve efeito. Nada é vinculado até você invocar uma operação sobre o carrier. `run(Runnable)` executa a lambda com o binding em vigor e retorna `void`; `call(...)` faz o mesmo mas retorna o resultado da lambda e pode propagar exceções checadas:

```java
String greeting = ScopedValue.where(CURRENT_USER, "bob").call(() -> {
    return "Hello, " + CURRENT_USER.get();     // "Hello, bob"
});
```

O tempo de vida do binding é exatamente a execução dessa lambda — sua *extensão dinâmica*, significando todo método que ela chama, e todo método que esses chamam, nessa thread. Quando a lambda retorna (normalmente ou lançando exceção), o binding é desfeito pelo runtime. Não existe caminho de código que consiga pular essa desmontagem.

### Rebinding aninhado sombreia, não muta

Não existe `CURRENT_USER.set(...)`. A única forma de mudar para o que uma chave resolve é abrir um *novo* escopo que a vincula de novo; esse binding interno sombreia o externo pela sua própria extensão, e o valor externo volta automaticamente:

```java
ScopedValue.where(CURRENT_USER, "alice").run(() -> {
    System.out.println(CURRENT_USER.get());       // before: "alice"

    ScopedValue.where(CURRENT_USER, "admin").run(() -> {
        System.out.println(CURRENT_USER.get());   // during: "admin"
        escalatedOperation();                      // sees "admin"
    });

    System.out.println(CURRENT_USER.get());       // after:  "alice" — restored
});
```

Essa é a diferença estrutural em relação a `ThreadLocal`. Um rebinding só é visível *para baixo*, na lambda aninhada; ele nunca pode ser visível *para cima*, para o código que abriu o escopo externo. Um callee não consegue corromper a visão de contexto do seu chamador, porque o rebinding é delimitado pela construção da linguagem, não por disciplina.

### Acesso seguro: `isBound()`, `orElse()`, `orElseThrow()`

Chamar `get()` sem nenhum binding ativo é uma falha dura:

```java
static final ScopedValue<String> TENANT = ScopedValue.newInstance();

TENANT.get();   // NoSuchElementException — nothing is bound on this thread
```

Para código que pode legitimamente rodar tanto dentro quanto fora de um binding (um logger, um interceptor de métricas, um utilitário chamado tanto de um caminho de requisição quanto de um caminho de startup), use um dos acessores seguros em vez disso:

```java
if (TENANT.isBound()) {
    log("tenant=" + TENANT.get());
}

String tenant  = TENANT.orElse("default");
String tenant2 = TENANT.orElseThrow(() -> new IllegalStateException("no tenant bound"));
```

`orElse` fornece um fallback; `orElseThrow` troca o `NoSuchElementException` genérico por um específico do domínio, na fronteira onde a falha de fato tem significado. Note o contraste com `ThreadLocal.get()`, que retorna `null` (ou o `initialValue()`) quando não definido — um binding faltando ali é silenciosamente indistinguível de um binding cujo valor por acaso é `null`.

### Vinculando várias chaves em um carrier

`Carrier.where(...)` retorna um novo carrier com o binding extra adicionado, então bindings encadeiam:

```java
static final ScopedValue<String> USER   = ScopedValue.newInstance();
static final ScopedValue<String> LOCALE = ScopedValue.newInstance();

ScopedValue.where(USER, "alice")
           .where(LOCALE, "pt-PT")
           .run(() -> {
               System.out.println(USER.get());     // "alice"
               System.out.println(LOCALE.get());   // "pt-PT"
           });
```

Ambos os bindings compartilham um escopo: entram em vigor juntos quando `run()` começa e são desfeitos juntos quando ele retorna. Essa é a forma normal de estabelecer um contexto de requisição inteiro em um só lugar, em vez de aninhar um `run()` por chave.

### Herança por threads filhas e `StructuredTaskScope`

Um binding de scoped value é visível para threads criadas *dentro* de sua extensão, sem nenhum equivalente a `InheritableThreadLocal` e sem copiar o valor por thread:

```java
static final ScopedValue<String> REQUEST_ID = ScopedValue.newInstance();

ScopedValue.where(REQUEST_ID, "req-42").run(() -> {
    try (var scope = StructuredTaskScope.open()) {
        var user  = scope.fork(() -> fetchUser(REQUEST_ID.get()));    // sees "req-42"
        var order = scope.fork(() -> fetchOrder(REQUEST_ID.get()));   // sees "req-42"
        scope.join();
        render(user.get(), order.get());
    }
});
```

É aqui que as duas features de concorrência do Java 25 se encaixam: `StructuredTaskScope` garante que as subtasks disparadas terminem antes do bloco `try` sair, o que significa que elas têm garantia de terminar *dentro* da extensão do scoped value — então o binding que elas leem não pode ser desfeito enquanto ainda estão rodando. Um `Thread.start()` simples dentro da extensão também herda o binding, mas nada força essa thread a terminar antes que o escopo termine; um binding que sobrevive à sua estrutura é exatamente o que `StructureViolationException` existe para reportar. O conceito irmão `structured-concurrency` cobre o lado do escopo dessa combinação; note que `StructuredTaskScope` ainda é uma API de preview no Java 25 enquanto `ScopedValue` é final.

### Como isso se relaciona com o modelo de memória

O conceito complementar `visibility-and-safe-publication` cobre o que é necessário para compartilhar estado mutável entre threads corretamente — uma aresta happens-before via `volatile`, um lock, ou um campo `final`. `ScopedValue` não resolve esse problema; ele o evita. Um binding é estabelecido antes da subtask começar e nunca é escrito de novo, então não há escrita concorrente para um leitor perder e nenhum reordenamento a se preocupar. Duas subtasks lendo `REQUEST_ID.get()` não conseguem observar valores diferentes, não conseguem observar um valor rasgado, e não precisam de sincronização — porque não existe uma segunda escrita em lugar nenhum do quadro. Compartilhar um objeto *mutável* através de um scoped value te coloca de volta direto no território do modelo de memória, porém: o binding é imutável, o objeto para o qual ele aponta é o que você fez dele.

## Trade-offs

- **O valor só é legível dentro da extensão dinâmica que o vinculou.** Você não pode fazer o binding uma vez no startup e ler em qualquer lugar depois, da forma como alguns frameworks baseados em `ThreadLocal` são configurados; toda leitura precisa estar sob um `run()`/`call()` na mesma thread, e código que acaba fora de um falha ruidosamente em vez de degradar.

  ```java
  ScopedValue.where(CURRENT_USER, "alice").run(() -> doWork());
  CURRENT_USER.get();   // NoSuchElementException — extent already ended
  ```

- **"Chave, não container" é a mudança de modelo mental em que as pessoas tropeçam.** Desenvolvedores vindos de `ThreadLocal` esperam que o próprio objeto guarde algo e procuram por um setter; não existe um, e código escrito sobre a suposição errada tende a criar um `ScopedValue` novo por requisição, que nada rio abaixo consegue ler.

- **Imutável e limpo automaticamente vs. mutável e limpo manualmente.** O idiom de `ThreadLocal` empurra o fardo de correção para cada call site; a forma do scoped value torna ambas as propriedades estruturais.

  ```java
  // ThreadLocal — any code can set(), and forgetting remove() leaks on a pooled thread
  static final ThreadLocal<String> TL = new ThreadLocal<>();
  TL.set("alice");
  try {
      handle();          // callees may call TL.set(...) and change it for the caller
  } finally {
      TL.remove();       // must not forget this
  }

  // ScopedValue — no set() exists, teardown is not optional
  static final ScopedValue<String> SV = ScopedValue.newInstance();
  ScopedValue.where(SV, "alice").run(() -> handle());
  ```

- **Rebinding custa um escopo, não uma atribuição.** Onde `ThreadLocal` deixa você trocar um valor com uma instrução, mudar um scoped value significa abrir um `run()`/`call()` aninhado e mover o código afetado para dentro dele — mais limpo de raciocinar, mas um custo real de reestruturação quando atinge código que muta contexto em vários lugares.

- **Retrofitar uma stack existente baseada em `ThreadLocal` não é um rename mecânico.** O ponto de binding precisa ser elevado até um ponto que englobe toda leitura — tipicamente um servlet filter ou wrapper de handler — e qualquer biblioteca no caminho que lê o `ThreadLocal` antigo continua precisando dele, então setups mistos são comuns durante a migração.

- **Interop com frameworks e thread pools que você não controla.** Uma tarefa entregue a um executor que você não criou roda em uma thread fora da sua extensão, então o binding não a acompanha; o valor precisa ser capturado explicitamente e re-vinculado dentro da tarefa se precisar cruzar essa fronteira.

## Documentation Links

- [JEP 506 — Scoped Values](https://openjdk.org/jeps/506) — doc
- [ScopedValue — Java SE 25 API docs](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/ScopedValue.html) — doc
