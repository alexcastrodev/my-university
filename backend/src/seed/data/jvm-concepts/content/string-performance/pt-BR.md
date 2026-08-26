---
version: 1.0
updatedAt: 2026-08-13
title: Performance de String: Compact Strings, Deduplicação e Concatenação
summary: Como compact strings reduzem pela metade o custo de heap de uma String média, quando vale a pena ligar a deduplicação de strings do G1, e por que a otimização de concatenação do próprio compilador costuma bater uma cadeia de StringBuilder escrita à mão.
---
## Objective

Entender três otimizações de `String` no nível do JVM que importam em escala: compact strings (quanto de heap uma string realmente custa), deduplicação de strings (removendo cópias redundantes depois do fato) e como o compilador transforma concatenação com `+` em algo mais rápido do que parece.

## Use Cases

- Explicar uma queda real em pausas de GC depois de um upgrade de JDK sem nenhuma mudança de código (compact strings).
- Decidir se `-XX:+UseStringDeduplication` vale a pena testar num serviço que mantém muitas strings quase duplicadas em caches de longa duração.
- Saber que uma string concatenada com `+` num loop quente não é automaticamente um problema de performance — mas uma cadeia de `StringBuilder` caseira e ingênua pode ser *mais lenta* do que simplesmente escrever `+`.

## Deep Dive

### Compact strings: a maioria das strings Java não precisa de 16 bits por caractere

Toda `String` costumava ser armazenada como um `char[]` — 16 bits por caractere, mesmo para texto ASCII puro que só precisa de 8. Desde o Java 9, strings são armazenadas como um `byte[]` com uma flag de codificação, usando 8 bits por caractere a menos que o conteúdo realmente exija caracteres de 16 bits (`Latin-1` vs `UTF-16` internamente) — é isso que significa "compact strings". Como objetos `String` costumam responder por algo como metade de um heap Java típico, isso reduz aproximadamente pela metade o custo de memória de uma string média, o que por sua vez significa menos trabalho de garbage collection para a mesma quantidade de dados vivos. É controlado por `-XX:+CompactStrings`, ligado por padrão — praticamente nunca há motivo para desligar, a menos que literalmente toda string da aplicação exija codificação de 16 bits.

### Deduplicação de strings: deixando o G1 fundir cópias idênticas depois do fato

Compact strings reduzem cada string; deduplicação, em vez disso, remove strings *redundantes* — muitos objetos de longa duração acabam guardando instâncias `String` separadas com conteúdo idêntico (`"Name"` aparecendo 300.000 vezes entre registros analisados, por exemplo). Com `-XX:+UseStringDeduplication` (desligado por padrão, e originalmente exclusivo do G1), uma thread de background encontra strings com conteúdo igual durante o GC e reaponta seus arrays internos de bytes para uma cópia única compartilhada, liberando o resto:

```
[gc,stringdedup]  Inspected: 62420  Hashed: 62420 (100.0%)  New: 62420 (100.0%)
[gc,stringdedup]  Deduplicated: 15604 (25.0%)   731.4K (22.2%)
```

É opt-in em vez de padrão porque custa algo para obter esse benefício: trabalho extra durante fases de GC, uma thread de background extra competindo por CPU e — se uma aplicação não tem de fato muitas strings duplicadas — a própria contabilidade pode piorar o uso de memória, não melhorar. Teste antes de ligar em produção; ganhos esperados costumam ser citados em torno de 10%, não uma vitória garantida.

### Concatenação: o compilador já otimiza o `+`

```java
String answer = integerPart + "." + mantissa;
```

Isso nunca de fato roda uma string intermediária desperdiçada por `+`. O `javac` reescreve concatenação simples para algo eficiente automaticamente — a estratégia exata mudou entre releases do JDK (veja Trade-offs), mas o ponto que importa no dia a dia é o mesmo em todas elas: **fazer sua própria cadeia de `StringBuilder` na mão para "ajudar" não ajuda**. No próprio benchmark do livro, `prefix + strings[0]` consistentemente venceu um `new StringBuilder().append(prefix).append(strings[0]).toString()` escrito manualmente — a otimização do próprio compilador já dá conta dos casos comuns melhor do que digitar na mão.

## Trade-offs

- **Deduplicação de strings é um trade-off real, não uma vitória de graça** — trabalho extra em fase de GC, uma thread de background extra e possivelmente *mais* overhead de memória se simplesmente não houver muitas duplicatas para remover; essa é uma flag de "meça na sua carga real", não uma que devia vir ligada por padrão.
- **Compact strings têm uma desvantagem estreita** — operações em strings que realmente exigem codificação de 16 bits do início ao fim podem ser marginalmente mais lentas sob compact strings do que eram antes, já que há uma checagem de codificação envolvida; irrelevante para a vasta maioria dos programas, cujas strings são majoritariamente compatíveis com Latin-1.
- **Book vs today**: o livro contrasta as strings baseadas só em `char[]` do Java 8 com as compact strings do Java 11, e separadamente contrasta as estratégias de bytecode de concatenação de strings do Java 8 vs. Java 11 (baseada em `StringBuilder` no 8, uma chamada `invokedynamic` para `StringConcatFactory` desde o Java 9 via [JEP 280](https://openjdk.org/jeps/280)) como uma mudança recente e ainda em evolução. Em JDKs atuais, ambas estão assentadas há muito tempo: compact strings e concatenação baseada em `invokedynamic` são o mecanismo padrão estável desde o Java 9, não algo ainda mudando de release para release — a nuance de "book vs today" aqui é principalmente que o que o livro enquadra como uma transição Java 8→11 em andamento é hoje simplesmente como todo JDK suportado sempre funcionou para quem está começando do zero.

## Documentation Links

- Scott Oaks, *Java Performance: The Definitive Guide*, 2nd Edition (O'Reilly, 2020) — Chapter 12 "Java SE API Tips", "Strings", pp. 363-374 — book
- [JEP 254: Compact Strings](https://openjdk.org/jeps/254) — doc
- [JEP 280: Indify String Concatenation](https://openjdk.org/jeps/280) — doc
