---
version: 1.0
updatedAt: 2026-10-20
title: "Subtipagem, Variância e Polimorfismo Limitado"
summary: "A subtipagem deixa um valor de um tipo mais específico ocupar o lugar de um mais geral, e a regra dos tipos de função (contravariante no argumento, covariante no resultado) decide quais tipos genéricos podem ser substituídos. Contêineres mutáveis precisam ser invariantes para manter a segurança, e por isso os arrays do Java são um erro histórico e existem wildcards, in/out do Kotlin e quantificação limitada."
---
## Objetivos de Aprendizagem

- Enunciar a regra de subsunção e derivar a regra de subtipagem para tipos de função (contravariante no argumento, covariante no resultado).
- Classificar um parâmetro de tipo como covariante, contravariante ou invariante pela posição em que aparece, e explicar por que contêineres mutáveis precisam ser invariantes.
- Usar wildcards do Java (`? extends`, `? super`) com a regra PECS, e compará-los com a variância no ponto de declaração em Kotlin, Scala e C#.
- Ler parâmetros de tipo limitados e F-limitados como `<T extends Comparable<? super T>>`, e relacionar o princípio de substituição de Liskov com a variância.

## Contexto e Motivação

`algorithms-software/programming-paradigms` apresentou o polimorfismo de subtipos por meio da herança, e o conceito anterior apresentou o polimorfismo paramétrico com o System F. Linguagens reais combinam os dois, e é na combinação que nasce a maior parte da perplexidade com APIs genéricas: por que `List<Integer>` não é um `List<Number>`, por que `Collections.copy` tem dois wildcards na assinatura e por que `Comparable<? super T>` aparece nos métodos de ordenação do JDK.

**Subtipagem** é uma relação $S <: T$ que significa que um valor do tipo $S$ pode ser usado onde se espera um $T$. O livro *Types and Programming Languages*, de Pierce, a desenvolve nos capítulos sobre subtipagem (15) e quantificação limitada (26), e Bracha, Odersky, Stoutamire e Wadler a uniram aos generics no Java 5. As regras são poucas, mas a dos tipos de função vai contra a intuição, e errar o caso mutável é o furo de segurança de tipos mais antigo do Java.

## Teoria Central

### Subsunção e as regras básicas

A **regra de subsunção** liga a relação à tipagem:

$$\frac{\Gamma \vdash e : S \qquad S <: T}{\Gamma \vdash e : T}\ \text{(T-Sub)}$$

A relação é reflexiva e transitiva, e tem um tipo topo (`Object`, `Any`). Para registros (e objetos vistos como registros), a **subtipagem em largura** diz que um registro com mais campos é subtipo de um com menos, e a **subtipagem em profundidade** diz que os tipos dos campos podem eles mesmos ser subtipos, o que só é seguro se os campos nunca forem escritos.

### Tipos de função: argumentos contravariantes

Uma função substitui outra se aceita pelo menos o que a outra aceita e devolve no máximo o que a outra devolve:

$$\frac{T_1 <: S_1 \qquad S_2 <: T_2}{S_1 \to S_2\ <:\ T_1 \to T_2}\ \text{(S-Arrow)}$$

A posição do argumento inverte a direção (**contravariante**) e a do resultado a mantém (**covariante**). Com `Dog <: Animal`, uma função `Animal -> Dog` pode substituir uma prometida como `Dog -> Animal`: ela aceita qualquer cachorro (na verdade qualquer animal) e devolve um cachorro, que é um animal.

### Variância de construtores de tipo

Para um construtor de tipo $F$, o parâmetro é **covariante** se $S <: T$ implica $F[S] <: F[T]$, **contravariante** se implica $F[T] <: F[S]$, e **invariante** se nenhuma das duas vale. A regra prática é pela posição: um parâmetro que aparece só em posições de saída (tipos de retorno, campos só de leitura) pode ser covariante, um que aparece só em posições de entrada (parâmetros de método) pode ser contravariante, e um que aparece nas duas precisa ser invariante. Uma célula mutável `Ref[T]` tem `get(): T` (saída) e `set(T)` (entrada), então é invariante.

O Java erra isso nos arrays: `String[] <: Object[]` (arrays são covariantes) embora arrays sejam mutáveis. O compilador aceita `Object[] a = new String[1]; a[0] = 42;`, e a JVM precisa checar cada escrita em array em tempo de execução e lançar `ArrayStoreException`. Os generics aprenderam a lição: `List<String>` não é subtipo de `List<Object>`.

### Variância no ponto de uso: wildcards do Java

O Java expressa variância onde o tipo é usado, com wildcards. `List<? extends Number>` é uma lista de algum subtipo desconhecido de `Number`: ler dá um `Number`, e escrever é rejeitado (exceto `null`) porque o tipo real do elemento é desconhecido. `List<? super Integer>` é uma lista de algum supertipo desconhecido de `Integer`: dá para adicionar um `Integer`, e ler dá só `Object`. O mnemônico é **PECS**, "Producer Extends, Consumer Super" (Bloch, *Effective Java*, Item 31): um parâmetro que produz valores para você usa `extends`, um que consome valores seus usa `super`. A subtipagem entre tipos com wildcard segue: `List<Integer> <: List<? extends Number> <: List<?>`.

### Variância no ponto de declaração: Kotlin, Scala, C#

Outras linguagens deixam o autor de um tipo genérico declarar a variância uma vez. O `List<out E>` do Kotlin e o `IEnumerable<out T>` do C# são covariantes, então um `List<String>` já é diretamente um `List<Any>`. O `Comparable<in T>` do Kotlin e o `Action<in T>` do C# são contravariantes. O compilador verifica a declaração: um parâmetro `out` só pode aparecer em posições de saída dos membros do tipo. O `MutableList<E>` do Kotlin precisa ser invariante exatamente pelo motivo acima. A variância no ponto de declaração dispensa wildcards no código cliente; a variância no ponto de uso é mais flexível para uma única classe que tem métodos de leitura e de escrita.

### Polimorfismo limitado e F-limitado

A **quantificação limitada** restringe um parâmetro de tipo a um subtipo de um limite, $\forall\alpha <: \tau.\ \sigma$, escrita `<T extends Number>` em Java. O limite deixa o corpo usar as operações do limite sobre um $T$. Um parâmetro **F-limitado** menciona a si mesmo no seu limite, como em `<T extends Comparable<T>>`: "um $T$ que pode ser comparado com outros $T$". Uma forma mais geral é `<T extends Comparable<? super T>>`, que também aceita uma subclasse cuja comparação é herdada de uma superclasse. Combinado com PECS, isso explica a assinatura do JDK `<T extends Object & Comparable<? super T>> T max(Collection<? extends T> coll)`.

### Subtipagem comportamental

A subtipagem no verificador de tipos trata de assinaturas, mas a substituição também deve preservar comportamento. A **subtipagem comportamental** de Liskov e Wing (o princípio de substituição de Liskov) exige que um subtipo mantenha o contrato do supertipo: pode *enfraquecer* pré-condições e *fortalecer* pós-condições, a mesma variância dos tipos de função (entrada contravariante, saída covariante). Um `Square` que estende um `Rectangle` mutável viola o contrato de que mudar a largura deixa a altura inalterada.

## Exemplos Resolvidos

### Exemplo 1: qual função pode ser passada?

**Problema:** `class Animal`, `class Dog extends Animal`. Um método precisa de uma função que, dado um `Dog`, produza um `Animal`. Qual entre `Function<Dog, Dog>`, `Function<Animal, Dog>` e `Function<Dog, Object>` ele aceita?

**Solução:** Aplique S-Arrow. O resultado pode ser qualquer subtipo de `Animal`, e o argumento pode ser qualquer supertipo de `Dog`. `Function<Animal, Dog>` serve (argumento `Animal :> Dog`, resultado `Dog <: Animal`) e `Function<Dog, Dog>` também (resultado `Dog <: Animal`). `Function<Dog, Object>` não serve, pois o seu resultado `Object` não é um `Animal`. O Java expressa isso com wildcards:

```java
static void feedAll(List<Dog> dogs, Function<? super Dog, ? extends Animal> f) {
    for (Dog d : dogs) { Animal a = f.apply(d); }
}
```

A API de streams do JDK usa exatamente essa forma: `Stream.map` recebe uma `Function<? super T, ? extends R>`.

### Exemplo 2: o furo dos arrays e a correção dos generics

**Problema:** Prever o que o compilador e a JVM fazem com o trecho a seguir.

```java
Object[] objs = new String[1];
objs[0] = 42;                          // compila
List<Object> list = new ArrayList<String>();   // não compila
```

**Solução:** As duas primeiras linhas compilam porque `String[] <: Object[]`, mas a escrita de um `Integer` num array cujo tipo em tempo de execução é `String[]` lança `ArrayStoreException`: o erro de tipo se mudou da compilação para a execução. A terceira linha é um erro de compilação porque `List<T>` é invariante, e é isso que torna o equivalente genérico seguro: se compilasse, `list.add(42)` colocaria silenciosamente um `Integer` numa lista de strings, descoberto só depois como `ClassCastException`, longe da causa.

### Exemplo 3: `copy`, PECS e `Comparable<? super T>`

**Problema:** Por que `static <T> void copy(List<? super T> dst, List<? extends T> src)` é melhor do que `copy(List<T> dst, List<T> src)`? E por que `max` precisa de `Comparable<? super T>`?

**Solução:** Com `T = Number`, a versão sem wildcards não aceita uma origem `List<Integer>`, já que `List<Integer>` não é um `List<Number>`. A versão com wildcards aceita `copy(List<Number> dst, List<Integer> src)` com `T = Integer`, porque `List<Number>` é um `List<? super Integer>` e `List<Integer>` é um `List<? extends Integer>`: `src` é produtor, `dst` é consumidor. Para o `max`, seja `Animal implements Comparable<Animal>` e `Dog extends Animal`. Um `Dog` é um `Comparable<Animal>`, mas não um `Comparable<Dog>`. Com o limite `T extends Comparable<T>`, `max(List<Dog>)` não compilaria, embora comparar cachorros com o método herdado seja perfeitamente seguro. `Comparable<? super T>` diz "sabe comparar dois `T`, possivelmente pela comparação de um supertipo", o que aceita `Dog`.

## Equívocos Comuns e Armadilhas

- **"Se `Integer` é um `Number`, então `List<Integer>` é um `List<Number>`."** Só para visões somente de leitura. Uma lista mutável é produtora e consumidora ao mesmo tempo, então é invariante. Use `List<? extends Number>` para acesso de leitura.
- **"`? extends T` significa estritamente uma subclasse."** Inclui o próprio `T`. O wildcard é um limite superior, não uma exigência de subtipo próprio.
- **"Parâmetros de método covariantes são uma comodidade."** Linguagens que os permitem (os parâmetros covariantes do Eiffel, os parâmetros de método bivariantes do TypeScript) aceitam programas que falham em tempo de execução. O `strictFunctionTypes` do TypeScript checa propriedades de tipo função de forma contravariante, mas deixa declarações de método bivariantes por compatibilidade.
- **"Há subtipagem se as assinaturas casam."** Há para o compilador. Substituir por uma subclasse que viola o contrato da superclasse ainda passa no verificador de tipos e falha em produção; a regra de Liskov é o que diz que está errado.

## Resumo

A subsunção deixa um subtipo ocupar o lugar de um supertipo. Para tipos de função, o argumento é contravariante e o resultado covariante, e a mesma variância governa pré-condições e pós-condições na subtipagem comportamental. Um parâmetro genérico que é lido e escrito precisa ser invariante, e por isso os generics do Java são invariantes e os arrays do Java (covariantes, com checagem em tempo de execução) são um furo histórico. Os wildcards do Java declaram variância em cada uso (PECS), Kotlin, Scala e C# a declaram uma vez na declaração, e parâmetros limitados e F-limitados como `Comparable<? super T>` deixam o código genérico usar as operações do seu limite. O próximo conceito passa de classificar valores por tipo para controlar quantas vezes podem ser usados: propriedade (ownership) e tipos lineares.

## Documentation Links

- [Pierce: Types and Programming Languages (MIT Press), chapters 15 and 26](https://www.cis.upenn.edu/~bcpierce/tapl/): doc
- [The Java Tutorials: Wildcards](https://docs.oracle.com/javase/tutorial/java/generics/wildcards.html): doc
- [Kotlin documentation: Generics, declaration-site variance](https://kotlinlang.org/docs/generics.html): doc
- [Liskov, Wing: A Behavioral Notion of Subtyping (TOPLAS 1994)](https://dl.acm.org/doi/10.1145/197320.197383): doc
