---
version: 1.0
updatedAt: 2026-08-19
title: Formatter e Especificadores de Formato
summary: "String.format/printf/Formatter compartilham o mesmo motor de conversão — width e precision significam coisas diferentes dependendo da conversão, as flags de vírgula/+/espaço/( cobrem a maioria das necessidades reais de formatação, e a indexação de argumentos n$/< permite reutilizar um argumento em vários especificadores sem repeti-lo."
---
## Objective

`String.format`, `printf` e `Formatter` passam todos pelo mesmo motor de conversão: uma string de formato composta de caracteres literais mais especificadores prefixados com `%`, cada um consumindo um argumento em ordem e renderizando-o de acordo com um caractere de conversão (`%d`, `%s`, `%f`, ...) mais flags opcionais para largura (width), precisão (precision), preenchimento e agrupamento. A maior parte disso é descobrível por exemplo, mas um punhado de detalhes específicos — indexação de argumentos, as flags de vírgula/espaço/`(`/`0`, e a diferença entre width e precision — são genuinamente fáceis de errar ou esquecer, e são exatamente as partes que vale a pena ter como referência clara.

## Use Cases

- Produzir saída alinhada e legível para console/log — colunas de números justificadas à direita ou à esquerda, casas decimais consistentes, milhares agrupados.
- Formatar saída de moeda ou medida com exibição explícita de sinal (`+100` vs. `100`) ou números negativos no estilo contábil (`(100)` em vez de `-100`).
- Reutilizar o mesmo argumento em múltiplos pontos de uma string de formato (uma data formatada como dia, depois mês, depois ano, todos vindos de um único argumento `Calendar`/`TemporalAccessor`) sem repeti-lo na chamada.
- Construir um `Formatter` interno explicitamente (em vez de via `String.format`) quando a saída precisa acumular em um `Appendable` específico, ou ser escrita direto em um arquivo através de um dos construtores de `Formatter` apoiados em arquivo.

## Deep Dive

### As três formas de chegar ao mesmo motor

```java
String s = String.format("%s scored %d%%", "Ana", 92);   // one-shot, returns a String
System.out.printf("%s scored %d%%%n", "Ana", 92);         // writes straight to System.out

Formatter fmt = new Formatter();                            // explicit Formatter, own buffer
fmt.format("%s scored %d%%", "Ana", 92);
String result = fmt.toString();
fmt.close();
```

`printf` (em `PrintStream`/`PrintWriter`) e `String.format` são ambos wrappers finos sobre `Formatter` — recorra à forma explícita só quando precisar de um controle que `String.format` não oferece: escrever diretamente em um arquivo através de um dos construtores de `Formatter` apoiados em arquivo, ou acumular em um `Appendable`/`StringBuilder` existente ao longo de várias chamadas `format()`.

### Conversões: um caractere decide o formato

```java
String.format("%d", 42);        // 42            — integer, decimal
String.format("%f", 3.14159);   // 3.141590      — floating-point, 6 decimals by default
String.format("%e", 12345.6);   // 1.234560e+04  — scientific notation
String.format("%x", 250);       // fa            — hexadecimal
String.format("%X", 250);       // FA            — uppercase variant
String.format("%o", 250);       // 372           — octal
String.format("%s", "hi");      // hi            — any object, via toString()
String.format("%c", 'z');       // z             — a single character
```

Java **verifica o tipo** de cada argumento contra seu especificador — `%d` em um argumento `double` lança `IllegalFormatConversionException` em vez de converter silenciosamente, diferente do `printf` do C, que confia na string de formato e lê memória de acordo com ela independentemente do que foi de fato passado.

### Width, precision e a diferença entre eles

```java
String.format("[%10.4f]", 10.12345);   // [   10.1235]  — width 10, 4 decimal places
String.format("[%-10.4f]", 10.12345);  // [10.1235   ]  — left-justified in the same field
String.format("[%5.7s]", "hi");         // [   hi]       — width 5 (padded), max length 7
```

**Width** é o comprimento mínimo total do campo (preenchido com espaços, ou `0`s se a flag `0` for usada); **precision** significa algo diferente por conversão — casas decimais para `%f`/`%e`, dígitos significativos para `%g`, e comprimento *máximo* de string para `%s` (truncando, não preenchendo, se a string for mais longa). Os dois números ocupam a mesma posição `%width.precision`, mas respondem perguntas diferentes, que é a parte mais fácil de confundir.

### As flags que realmente pesam

```java
String.format("%+d", 100);        // +100      — always show the sign
String.format("% d", 100);        // " 100"    — leading space for positive, aligns with "-100"
String.format("%(d", -100);       // (100)     — accounting-style negative, no minus sign
String.format("%05d", 42);        // 00042     — zero-padded instead of space-padded
String.format("%,.2f", 4356783497.34);  // 4,356,783,497.34   — grouping separator
String.format("%#x", 250);        // 0xfa      — # prefixes hex with 0x, octal with a leading 0
```

`,` (agrupamento), `+`/espaço (exibição de sinal), `(` (negativos entre parênteses) e `0` (preenchimento com zero) são as flags que valem a pena decorar — a maioria das formatações do dia a dia precisa de alguma combinação delas, e não só do caractere de conversão puro.

### Índice de argumento e índice relativo: reutilização sem repetição

```java
String.format("%3$d %1$d %2$d", 10, 20, 30);   // "30 10 20" — explicit n$ index, 1-based
String.format("%d in hex is %1$x", 255);        // "255 in hex is ff" — reuse argument 1
String.format("%d in hex is %<x", 255);         // same result — "<" reuses the PREVIOUS argument
```

Um `n$` explícito logo após o `%` sobrepõe completamente o casamento da esquerda para a direita; `<` é um atalho para "o argumento que o especificador anterior acabou de usar." Isso é mais valioso ao formatar o mesmo valor de várias formas em uma única chamada — um formato `%t` de data/hora que precisa de dia, mês e ano todos extraídos de um único argumento `Calendar`/`TemporalAccessor` é o caso canônico: `%<` permite que esse argumento seja passado uma vez e referenciado repetidamente, em vez de aparecer três vezes na lista de argumentos.

### `%n` vs. `\n`

```java
System.out.printf("line one%nline two%n");
```

`%n` insere o separador de linha próprio da plataforma (`\r\n` no Windows, `\n` nos demais) da mesma forma que `System.lineSeparator()` faz; um `\n` literal na string de formato sempre insere exatamente `\n`, independentemente da plataforma. `%n` é a escolha portável especificamente dentro de uma string de formato; `%%` é o escape correspondente para um caractere `%` literal, já que um `%` isolado em uma string de formato é interpretado como início de um especificador.

## Trade-offs

- **`Formatter` verifica tipos de forma estrita, o que expõe bugs cedo mas quebra em qualquer incompatibilidade** — passar um `Integer` onde `%f` espera um tipo de ponto flutuante lança imediatamente em vez de formatar errado silenciosamente, o que é mais seguro que o `printf` do C, mas significa que uma string de formato e sua lista de argumentos precisam permanecer exatamente sincronizadas conforme o código evolui; um refactor que muda o tipo de um argumento sem atualizar o especificador falha em tempo de execução, não em tempo de compilação.
- **Locale importa e é fácil de esquecer.** O caractere de agrupamento de `%,d`, os pontos decimais e a formatação de data/hora dependem do locale ativo — o construtor sem locale de `Formatter` usa o padrão da JVM, que varia entre ambientes; um argumento `Locale` explícito (`String.format(Locale.US, "%,.2f", amount)`) é a única forma de garantir saída idêntica independentemente de onde o código roda. Veja `resource-bundles-and-locale` para o quadro completo de resolução de locale.
- **Width/precision em `%s` trunca strings silenciosamente** — uma string de exibição mais longa que a precision especificada perde o final sem nenhuma indicação na saída de que houve truncamento, o que é aceitável para uma coluna de relatório de largura fixa e uma fonte real de bugs se a string completa importava.
- **Um `Formatter` construído explicitamente segura um recurso e deve ser fechado** (ele implementa `AutoCloseable`) — especialmente quando apoiado em arquivo, onde um `Formatter` não fechado pode deixar saída em buffer sem descarregar; `String.format`/`printf` nunca expõem essa preocupação porque gerenciam seu próprio `Formatter` interno para você.
- **Indexação relativa (`%<`) só reutiliza o argumento do especificador *imediatamente anterior*** — não é um mecanismo genérico de "voltar N argumentos", então reordenar especificadores em uma string de formato pode silenciosamente mudar para qual argumento `%<` agora aponta; um índice `n$` explícito é a escolha mais robusta assim que uma string de formato fica complexa o suficiente para que reordenação seja provável.
- **Um `Formatter` explícito não é thread-safe.** Ele armazena sua saída em estado interno mutável, então compartilhar uma instância entre threads (ex.: colocá-lo em um campo `static` para "economizar recursos") corrompe a saída sob chamadas concorrentes. `String.format`/`printf` nunca sofrem isso porque cada chamada constrói seu próprio `Formatter` privado internamente.
  ```java
  static final Formatter shared = new Formatter(); // unsafe: concurrent format() calls race on the buffer

  // safe alternative: no shared state to race on
  String s = String.format("%s scored %d%%", name, score);
  ```

## Documentation Links

- [Formatter — Java SE 25 API (full conversion and flag reference)](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Formatter.html) — doc
- [String.format — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#format(java.lang.String,java.lang.Object...)) — doc
- [PrintStream.printf — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/io/PrintStream.html#printf(java.lang.String,java.lang.Object...)) — doc
