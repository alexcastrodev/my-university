---
version: 1.0
updatedAt: 2026-08-21
question: Como formatar uma string de caracteres?
---
## Question

# Como formatar uma string de caracteres?

## Short Answer

Existe um método para isso.

## Less Short Answer

Na verdade, existem várias soluções oferecidas pelo JDK, mas a mais simples é provavelmente o método de fábrica `format` da classe `String`. Ele recebe um formato como primeiro argumento, seguido pelos objetos que você quer passar para esse formato, para que sejam renderizados na string final.

```java
String message = String.format("%s scored %d points", "Ana", 92);
// message = "Ana scored 92 points"
```

## Inspired by C's `printf`

Essa sintaxe de formato é inspirada no (in)famoso formato usado pela função `printf` do C — aquele que todo mundo conhece, ou pelo menos já esbarrou em algum momento. Está totalmente descrito no Javadoc da classe `Formatter`, que é o motor por trás de `String.format`, `PrintStream.printf` e `PrintWriter.printf`.

Existem, no entanto, diferenças entre o `printf` do C e o `Formatter` do Java:

- **Erros não são tratados da mesma forma.** O `printf` do C confia na string de formato e lê a memória de acordo com ela, independentemente do que foi realmente passado — uma incompatibilidade pode corromper silenciosamente a saída ou travar o programa. O `Formatter` do Java verifica o tipo de cada argumento contra seu especificador e lança `IllegalFormatConversionException` em caso de incompatibilidade.
- **Algumas personalizações foram feitas** em cima da sintaxe original do C — por exemplo, o índice de argumento `n$` e o separador de linha independente de plataforma `%n` não têm equivalente no `printf` do C.

## Practical Example

```java
System.out.printf("%-10s | %5.2f%n", "Total", 42.5);   // escreve direto no System.out
String s = String.format("%-10s | %5.2f", "Total", 42.5); // mesma renderização, retornada como String
```

## One Last Word: Thread Safety

Formatar strings pode te tentar a compartilhar uma instância de `Formatter` pra economizar recursos — mas cuidado: um `Formatter` carrega estado interno mutável (seu buffer de saída), então compartilhar um entre threads não é seguro. `String.format` e `printf` nunca caem nesse problema porque cada chamada cria seu próprio `Formatter` privado internamente.

## References

- [Java Coding Tip #388: How Can You Format a String of Characters?](https://youtube.com/shorts/DUX5bEvepbo?is=vDI15IXtwHnAcxGv) — video
- [String.format — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/lang/String.html#format(java.lang.String,java.lang.Object...)) — doc
- [Formatter — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Formatter.html) — doc
