---
version: 1.0
updatedAt: 2026-08-26
question: Como substituir todos os elementos de uma lista?
---
## Question

# Como substituir todos os elementos de uma lista?

## Short Answer

Existe um método para isso.

## Less Short Answer

Existe um método de fábrica na classe utilitária `Collections` chamado `replaceAll`, que, como o nome sugere, substitui todas as ocorrências de um valor em uma lista por outro. Ele recebe a lista como primeiro parâmetro, depois o valor que você quer substituir, e por fim o valor pelo qual quer substituí-lo.

```java
List<String> names = new ArrayList<>(List.of("Ana", "Bob", "Ana", "Cid"));
Collections.replaceAll(names, "Ana", "Zoe");
// names = ["Zoe", "Bob", "Zoe", "Cid"]
```

## Replacing `null` Values

Esse método suporta a substituição de valores `null`, o que é ótimo, porque você pode usar esse padrão para trocar os valores `null` que você tenha na sua lista por um valor padrão.

```java
List<String> values = new ArrayList<>(Arrays.asList("A", null, "B", null));
Collections.replaceAll(values, null, "N/A");
// values = ["A", "N/A", "B", "N/A"]
```

## Under the Hood

Se você olhar a implementação do método, vai ver que ele é otimizado dependendo do tamanho e da natureza da sua lista — pode acessar seus elementos por índice, ou recorrer a um `ListIterator`, o que for mais eficiente para o tipo de lista que você passou.

## One Last Word: What the Return Value Means

Esse método retorna `true` se o elemento a ser substituído foi encontrado na lista — o que não significa que sua lista foi realmente modificada, porque você poderia ter pedido para substituí-lo pelo mesmo valor que ele já tinha. Por que alguém faria isso? Ninguém sabe, mas quem projetou a API pensou nisso mesmo assim.

## References

- [Java Coding Tip #389: How Can You Replace All the Elements of a List?](https://youtube.com/shorts/eRRKMgEBsHQ?is=Swn3DDxijA91ljpd) — video
- [Collections.replaceAll — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/Collections.html#replaceAll(java.util.List,java.lang.Object,java.lang.Object)) — doc
- [List — Java SE 25 API](https://docs.oracle.com/en/java/javase/25/docs/api/java.base/java/util/List.html) — doc
