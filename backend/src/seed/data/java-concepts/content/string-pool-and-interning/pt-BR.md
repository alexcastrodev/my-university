---
version: 1.0
updatedAt: 2026-08-19
title: O String Pool e o Interning
summary: "Literais de string são automaticamente internados em um pool compartilhado, então == é true entre dois literais com o mesmo conteúdo mas false contra um new String(...) com conteúdo idêntico — uma consequência direta e previsível de onde cada string veio, não uma peculiaridade da linguagem."
---
## Objective

`String s1 = "hi"; String s2 = "hi"; s1 == s2` é `true`. `String s3 = new String("hi"); s1 == s3` é `false`. Tanto `s1.equals(s2)` quanto `s1.equals(s3)` são `true`. O motivo não é uma peculiaridade da linguagem para decorar — é um único mecanismo consistente: a JVM mantém um **string pool**, uma tabela de instâncias `String` únicas, e todo literal de string é automaticamente internado nela no carregamento da classe, então dois literais com o mesmo conteúdo são o *mesmo objeto*. `new String(...)` opta explicitamente por sair desse compartilhamento e aloca um objeto novo, não agrupado no pool, mesmo quando seu conteúdo é idêntico a algo já presente no pool. Saber disso transforma `==` em strings de "às vezes funciona, às vezes não" em uma consequência previsível de onde cada string veio.

## Use Cases

- Explicar (e evitar) o bug clássico: comparar entrada do usuário ou um valor lido de um arquivo/banco de dados com `==` em vez de `.equals()`, o que "por acaso funciona" em testes improvisados com literais e depois falha assim que o valor é lido em runtime.
- Decidir se vale a pena chamar `.intern()` em um grande conjunto de strings construídas em runtime com muita duplicação (tokens parseados, chaves de configuração repetidas) para reduzir memória, e saber o que isso realmente custa.
- Ler um heap dump ou diagnosticar uso de memória de strings inesperadamente alto, onde saber o que é e o que não é agrupado no pool explica o motivo.
- Entender por que switch-on-String e certas comparações de valores de reflexão/anotação podem depender de igualdade de referência internamente sem que isso seja uma armadilha para esse uso específico e controlado.

## Deep Dive

### De onde uma string vem decide se ela é agrupada no pool

```java
String a = "hello";              // literal — interned automatically
String b = "hello";              // same literal — same pooled instance
System.out.println(a == b);      // true

String c = new String("hello");  // explicit new object, NOT pooled
System.out.println(a == c);      // false
System.out.println(a.equals(c)); // true — equals() compares content, always

String d = "hel" + "lo";         // both operands are compile-time constants
System.out.println(a == d);      // true — the compiler folds this into one literal "hello"

String e = "hel";
String f = e + "lo";             // built at runtime, e is a variable, not a constant
System.out.println(a == f);      // false — runtime concatenation allocates a new String
```

A regra que explica todos os quatro casos: uma `String` só é agrupada no pool quando o compilador consegue resolvê-la para uma constante em tempo de compilação (um literal, ou um `+` de literais/constantes `final` de tempo de compilação). No momento em que uma variável que não é uma constante de tempo de compilação faz parte da expressão, o resultado é um objeto genuinamente novo construído em tempo de execução, e o pooling não se aplica.

### `.intern()`: colocando uma string de runtime no pool

```java
String g = new String("hello").intern();
System.out.println(a == g);      // true — g now points at the same pooled instance as a
```

`intern()` procura no pool uma string com conteúdo igual; se encontrar, retorna essa referência agrupada, senão adiciona essa string ao pool e a retorna. Essa é a única forma de fazer uma string *construída em runtime* participar do compartilhamento por igualdade de referência — útil especificamente quando você tem muitas strings semanticamente repetidas (por exemplo, dezenas de milhares de tokens parseados onde só algumas centenas de valores distintos de fato ocorrem) e quer que elas colapsem em instâncias compartilhadas em vez de cada uma ter seu próprio `char[]`.

### Por que isso existe: `String` é imutável, então compartilhar é de graça

O pooling só é seguro porque `String` é imutável — duas variáveis podem apontar para o mesmo objeto com risco zero de que a mutação de um chamador surpreenda outro, o que é exatamente a propriedade que torna `String` utilizável como chave de `HashMap` ou compartilhável entre threads sem cópia defensiva, para começar. Um tipo mutável nunca poderia ser agrupado no pool dessa forma; `StringBuilder` não é, e não deveria ser.

### Onde o pool de fato vive

Desde o JDK 7 (JDK-6962931), o string pool vive no heap comum, não mais no espaço PermGen (já removido) onde vivia antes — uma string agrupada no pool é coletada pelo garbage collector como qualquer outro objeto assim que nada mais a referencia, ela só é deduplicada enquanto está viva. Isso importa na prática: internar milhões de strings únicas não cria um vazamento fixo e não coletável como poderia acontecer em JVMs anteriores à 7; isso só coloca pressão de memória no heap comum como qualquer outro grande conjunto de objetos vivos faria.

## Trade-offs

- **`==` em strings não é "às vezes bugado" — é uma função determinística da proveniência**, e uma vez que isso fica claro, a correção é sempre a mesma: use `.equals()` para comparação de conteúdo, ponto final, e reserve `==` para o raro caso em que você deliberadamente quer identidade de referência (por exemplo, um objeto sentinela).
- **`.equals()` deveria ser o padrão mesmo quando `==` por acaso funciona hoje.** Código comparado com literais em um teste unitário e passando em checagens com `==` vai quebrar assim que o mesmo valor chegar da entrada do usuário, de um arquivo, de `String.format` ou de qualquer outro caminho de construção em runtime — a distinção entre literal e runtime é invisível no ponto de chamada a menos que você vá procurar por ela especificamente.
- **`.intern()` não é de graça, e nem sempre é uma vitória.** Cada chamada faz uma busca no pool (uma comparação baseada em hash contra o conteúdo já agrupado), então internar strings que na maioria não são duplicadas custa CPU sem nenhum benefício de memória — compensa especificamente quando a duplicação é alta e as strings têm vida longa, não como um hábito reflexo em toda string que você constrói.
- **Concatenação de constantes dobrada pelo compilador (`"hel" + "lo"`) é uma garantia só de tempo de compilação.** A mesma expressão escrita com até uma única variável local não-final misturada perde essa dobra e produz um objeto genuinamente novo, fora do pool — um refactor que troca um literal por uma variável pode silenciosamente mudar o comportamento de `==` mesmo que o comportamento de `.equals()` não seja afetado.
- **Isso é comportamento em nível de linguagem, não algo que `record`/`var`/sintaxe mais nova mude.** Um componente de `record` que guarda uma `String` e um `var` inferido como `String` seguem exatamente as mesmas regras de pooling que qualquer outra referência do tipo `String` — não há caso especial para lembrar com sintaxe mais nova.

## Documentation Links

- [String — Java SE 25 API (see `intern()`)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#intern()) — doc
- [JLS §3.10.5 — String Literals](https://docs.oracle.com/javase/specs/jls/se25/html/jls-3.html#jls-3.10.5) — doc
- [JDK-6962931: Move string pool out of PermGen](https://bugs.openjdk.org/browse/JDK-6962931) — doc
