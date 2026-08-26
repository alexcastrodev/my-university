---
version: 1.0
updatedAt: 2026-08-13
title: "Collections API e Streams: Sizing, Sincronização e Laziness"
summary: "Por que coleções não são sincronizadas por padrão, por que dimensionar uma coleção antecipadamente importa, e por que uma cadeia de operações de Stream processa muito menos dados do que parece."
---
## Objective

Entender três defaults relevantes para performance nas APIs de Collections e Streams do Java: por que coleções não são sincronizadas por padrão, por que dimensionar uma coleção antecipadamente importa, e por que uma cadeia de operações de `Stream` processa muito menos dados do que parece.

## Use Cases

- Decidir entre `Collections.synchronizedList()` e um `ArrayList` simples para uma coleção que hoje é single-threaded mas pode não continuar assim.
- Explicar por que construir um `HashMap` ou `ArrayList` com uma capacidade inicial precisa reduz de forma mensurável a pressão sobre o garbage collector num hot path.
- Entender por que encadear várias chamadas `Stream.filter()` seguidas de `findFirst()` pode ser dramaticamente mais barato do que parece, em vez de assumir que cada filter varre a coleção inteira.

## Deep Dive

### Não sincronizado por padrão, de propósito

Quase toda classe de coleção Java não é sincronizada por padrão — `Hashtable`, `Vector` e seus parentes são as exceções históricas, datando de antes de o Collections Framework existir, quando o Java tentava tornar thread safety o padrão. Essa abordagem acabou custando performance real mesmo quando nada estava de fato disputando o lock, então toda classe de coleção adicionada desde então foi na direção contrária: rápida e não sincronizada, com `Collections.synchronizedList()` e afins disponíveis para quando você realmente precisa da segurança. Medida em single-thread, a diferença entre uma chamada de método não sincronizada, uma `synchronized` e uma baseada em CAS é de alguns nanossegundos — real, mas geralmente insignificante perto de tudo o mais que uma requisição típica faz. A decisão de fato não é realmente sobre essa diferença: é se a coleção pode algum dia ser tocada por mais de uma thread, agora ou depois.

### Sizing importa porque coleções são apoiadas em arrays

Um `ArrayList`, por baixo dos panos, é um `Object[]`. Um `HashMap` é um array de entries indexado por hash. Qualquer classe de coleção cujo construtor aceita um argumento de tamanho inicial está te dizendo que ela é apoiada em array, e que sua performance depende de acertar esse tamanho aproximadamente. Um `ArrayList` sem tamanho definido começa com capacidade 10 e cresce por aproximadamente 50% a cada vez que enche (10 → 15 → 22 → 33 → …), e todo resize significa alocar um novo array de suporte e copiar todo elemento existente para ele — memória desperdiçada (que vira trabalho de GC depois) e um custo real e repetido de cópia. Construir a coleção com uma estimativa razoável do seu tamanho final — `new ArrayList<>(expectedSize)` — evita os dois custos completamente. O mesmo raciocínio se aplica a `StringBuilder`, `StringBuffer` e `ByteArrayOutputStream`, que dobram seu array de suporte no resize em vez de crescer 50%, mas pagam a mesma categoria de custo se nunca dimensionados antecipadamente.

### Streams são lazy — uma cadeia de filter faz menos trabalho do que parece

```java
Stream<String> stream = symbols.stream();
Optional<String> t = stream
    .filter(s -> s.charAt(0) != 'A')
    .filter(s -> s.charAt(1) != 'A')
    .filter(s -> s.charAt(2) != 'A')
    .filter(s -> s.charAt(3) != 'A')
    .findFirst();
```

Cada chamada `filter()` não varre nada — ela apenas encadeia um predicado ao pipeline do stream. Nenhuma comparação de fato acontece até que `findFirst()` puxe um valor, e mesmo então, elementos são puxados e testados **um de cada vez, filter por filter**, só até onde for necessário a jusante: o primeiro filter pega um elemento e testa; se falhar, ele mesmo imediatamente pega o próximo em vez de passar qualquer coisa adiante. Compare isso com o equivalente eager — construir um novo `ArrayList` inteiro depois de cada passo de filter — que precisa materializar completamente cada lista intermediária antes que o próximo filter sequer possa começar. Sobre 456.976 símbolos ordenados de quatro letras, a versão lazy só precisa inspecionar de fato 18.278 deles antes de encontrar um match; a versão eager processa a lista inteira em cada um dos quatro estágios.

## Trade-offs

- **Escolher uma coleção não sincronizada é uma aposta de que acesso concorrente nunca vai acontecer** — mais barato hoje, mas "isso algum dia será tocado por mais de uma thread" é uma pergunta sobre o futuro do código, não só sobre seus call sites atuais; na dúvida, o pequeno custo de sincronização costuma ser o default mais seguro a pagar.
- **Subdimensionar uma coleção custa memória e tempo de cópia; superdimensionar desperdiça memória à toa** — o ganho de um sizing preciso só existe se a estimativa for de fato próxima; uma capacidade inicial exageradamente grande troca o custo de resize por heap permanentemente desperdiçado.
- **Laziness é um ganho para operações de short-circuit (`findFirst`, `anyMatch`, `limit`) e um não-problema para as que precisam ver tudo de qualquer forma (`collect`, `count` sem `limit`, `forEach`)** — não espere que um pipeline lazy magicamente economize trabalho numa operação que sempre ia processar o stream inteiro independentemente de como os passos intermediários foram escritos.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 12 "Java SE API Tips", "Java Collections API" and "Stream and Filter Performance", pp. 392-401 — book
- [Collections — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html) — doc
- [Stream — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/stream/Stream.html) — doc
