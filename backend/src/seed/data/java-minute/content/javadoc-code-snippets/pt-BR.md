---
version: 1.0
updatedAt: 2026-07-18
question: Como adicionar um trecho de código no seu Javadoc?
---
## Question

# Como adicionar um trecho de código no seu Javadoc?

## Short Answer

Use a tag `{@snippet}`, introduzida pela JEP 413. Ela renderiza código inline no seu Javadoc com formatação adequada e, ao contrário do velho truque `<pre>{@code ...}</pre>`, não exige que você escape manualmente caracteres HTML como `<`, `>` e `&`.

## What It Is

Antes da JEP 413, embutir um exemplo de código no Javadoc significava envolvê-lo em `<pre>{@code ... }</pre>` e escapar à mão qualquer caractere sensível a HTML dentro do trecho. Funcionava, mas era frágil e fácil de errar em qualquer coisa além de uma linha trivial.

`{@snippet}` substitui esse padrão por uma tag dedicada que cuida do escaping pra você e suporta tanto trechos inline quanto arquivos externos de snippet.

## Inline Snippets

A forma mais simples embute o código diretamente no comentário Javadoc:

```java
/**
 * {@snippet :
 * List<String> names = List.of("Ana", "Bruno");
 * names.forEach(System.out::println);
 * }
 */
void printNames(List<String> names) { ... }
```

Nenhum escaping necessário — `<`, `>` e `&` são escritos como sintaxe Java normal.

## External Snippet Files

Para exemplos mais longos ou reutilizáveis, você pode puxar o trecho de um arquivo externo usando `snippet-files`, um diretório de arquivos-fonte mantido junto com as fontes do seu Javadoc. Referencie um arquivo pelo nome, ou uma região específica dele usando comentários de marcação (`@start region=...` / `@end`):

```java
/**
 * {@snippet file="Example.java" region="main"}
 */
```

Informe à ferramenta `javadoc` onde encontrar esses arquivos com a opção `--snippet-path`.

## Why It Matters

Manter os exemplos como arquivos-fonte reais e separados significa que eles podem de fato ser compilados e testados, então não apodrecem silenciosamente fora de sincronia com a API que documentam — um problema comum com código embutido como texto simples dentro de comentários.

## Solution and Conclusion

Prefira `{@snippet}` ao velho padrão `<pre>{@code}</pre>` em qualquer Javadoc novo: é mais limpo para exemplos inline e, via `snippet-files` e `--snippet-path`, permite manter exemplos mais longos como arquivos-fonte externos e verificáveis.

## References

- [Java Coding Tip #374: Javadoc Code Snippets](https://www.youtube.com/shorts/ZNe_-Z1qxp8) — video
- [JEP 413: Code Snippets in Java API Documentation](https://openjdk.org/jeps/413) — doc
- [javadoc — Java SE 25 Tool Reference (--snippet-path option)](https://docs.oracle.com/en/java/javase/25/docs/specs/man/javadoc.html) — doc
