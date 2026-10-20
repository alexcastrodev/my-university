---
version: 1.0
updatedAt: 2026-10-20
title: "Polimorfismo Paramétrico e System F"
summary: "System F acrescenta quantificação universal sobre tipos ao cálculo lambda simplesmente tipado, de modo que uma definição serve para todo tipo. Como uma função polimórfica não pode inspecionar o seu argumento de tipo, só o tipo já restringe o que ela pode fazer (\"teoremas de graça\"), a teoria por trás dos generics em Java, C#, Rust e Haskell."
---
## Objetivos de Aprendizagem

- Escrever a sintaxe e as duas regras de tipagem que o System F acrescenta ao cálculo lambda simplesmente tipado: abstração de tipo $\Lambda\alpha.\,e$ e aplicação de tipo $e\,[\tau]$.
- Definir termos polimórficos (identidade, booleanos e numerais de Church) e calcular seus tipos por instanciação.
- Usar parametricidade para derivar um "teorema de graça" só a partir de um tipo, e explicar quando uma linguagem a quebra.
- Contrastar o System F com a inferência de tipos de Hindley-Milner, e relacionar a teoria com a implementação de generics em Java, C#, Rust e Haskell.

## Contexto e Motivação

`software-distributed/programming-languages` apresentou o cálculo lambda simplesmente tipado, em que `id` precisa ser escrita uma vez por tipo, e depois a inferência de tipos por unificação, que dá a `id` o tipo $\forall\alpha.\,\alpha \to \alpha$ sem anotações. Este conceito olha o sistema por baixo: o **System F**, descoberto independentemente por Girard (1972) e Reynolds (1974), o cálculo lambda polimórfico. É o menor cálculo com generics de verdade, é o núcleo da linguagem intermediária do Haskell, um ancestral do polimorfismo da família ML e um modelo limpo para o `<T>` do Java e do C#.

O System F importa para quem programa por dois motivos. Primeiro, explica o que uma assinatura genérica promete. Como uma função de tipo $\forall\alpha.\,\alpha \to \alpha$ não pode olhar dentro de um valor de tipo desconhecido, a assinatura sozinha quase determina o comportamento, um princípio que Wadler chamou de "teoremas de graça". Segundo, explica por que generics são implementados de formas tão diferentes entre linguagens (apagamento, monomorfização, dicionários, reificação): a história da teoria de tipos é a mesma, a do runtime não.

## Teoria Central

### Sintaxe e regras

O System F estende o cálculo lambda simplesmente tipado com uma variável de tipo $\alpha$, um tipo universalmente quantificado e termos para introduzi-lo e eliminá-lo:

$$\tau ::= \alpha \mid \tau \to \tau \mid \forall\alpha.\,\tau \qquad e ::= x \mid \lambda x{:}\tau.\,e \mid e\ e \mid \Lambda\alpha.\,e \mid e\,[\tau]$$

$$\frac{\Gamma,\ \alpha \vdash e : \tau}{\Gamma \vdash \Lambda\alpha.\,e : \forall\alpha.\,\tau}\ \text{(T-TAbs)} \qquad \frac{\Gamma \vdash e : \forall\alpha.\,\tau_1}{\Gamma \vdash e\,[\tau_2] : \tau_1[\alpha \mapsto \tau_2]}\ \text{(T-TApp)}$$

Em T-TAbs, $\alpha$ não pode já ser livre em $\Gamma$. A função identidade é $\text{id} = \Lambda\alpha.\,\lambda x{:}\alpha.\,x$ com tipo $\forall\alpha.\,\alpha \to \alpha$, e $\text{id}\,[\text{Int}]\ 3$ tem tipo $\text{Int}$. A aplicação de tipo é verificada por substituição e apagada em tempo de execução; numa linguagem com inferência você raramente a escreve.

Uma característica marcante do System F é que o tipo quantificado pode ser instanciado no próprio tipo quantificado (**impredicatividade**). O termo $\lambda x{:}(\forall\alpha.\,\alpha \to \alpha).\ x\,[\forall\alpha.\,\alpha \to \alpha]\ x$ é bem tipado, e não tem tipagem no cálculo simplesmente tipado nem em Hindley-Milner.

### Codificando dados

O System F pode codificar tipos de dados sem construtores embutidos. **Booleanos de Church** têm tipo $\forall\alpha.\,\alpha \to \alpha \to \alpha$, com $\text{true} = \Lambda\alpha.\lambda t{:}\alpha.\lambda f{:}\alpha.\,t$ e `false` devolvendo $f$. **Numerais de Church** têm tipo $\text{Nat} = \forall\alpha.\,(\alpha \to \alpha) \to \alpha \to \alpha$, e o numeral de $n$ aplica o primeiro argumento $n$ vezes ao segundo. Todo termo bem tipado do System F termina (**normalização forte**), então o cálculo não consegue expressar recursão geral e não é Turing completo. É o mesmo motivo pelo qual uma linguagem funcional total e uma lógica podem dividir um sistema de tipos, ideia desenvolvida no conceito sobre tipos dependentes.

### Parametricidade e teoremas de graça

Uma função de tipo $\forall\alpha.\,\ldots$ precisa tratar $\alpha$ uniformemente, já que não tem nenhuma operação sobre valores de tipo desconhecido além de movê-los de lugar. Reynolds formalizou isso como **parametricidade**, e Wadler mostrou que ela gera teoremas só a partir de tipos:

- $f : \forall\alpha.\,\alpha \to \alpha$ precisa devolver o seu argumento (ou não terminar, numa linguagem com recursão geral).
- $r : \forall\alpha.\,[\alpha] \to [\alpha]$ comuta com `map`: $r\,(\text{map}\ g\ xs) = \text{map}\ g\ (r\ xs)$ para todo $g$. Então $r$ pode reordenar, descartar ou duplicar elementos por posição, mas não pode depender dos seus valores.
- $s : \forall\alpha.\,\alpha \to \alpha \to \alpha$ ou "devolve o primeiro" ou "devolve o segundo".

### Inferência: Hindley-Milner contra o System F completo

Hindley-Milner (ML, Haskell 98) restringe o System F para que os quantificadores apareçam só no nível mais externo de um tipo (**prenex**, polimorfismo de posto 1) e o polimorfismo seja introduzido só por `let`. Essa restrição torna a inferência de tipos decidível e eficiente por unificação, sem anotações. O System F completo é muito mais expressivo, mas a sua inferência de tipos é **indecidível** (Wells, 1994), então os programas precisam de anotações explícitas ao usar tipos de posto mais alto. O `RankNTypes` do GHC e as chamadas explícitas de método genérico do Java (`Collections.<String>emptyList()`) ficam de cada lado dessa troca, com inferência local preenchendo os casos óbvios.

### Como as linguagens implementam

A teoria de tipos é a mesma; o runtime é uma escolha de projeto:

| Estratégia | Linguagens | O que acontece |
|---|---|---|
| Apagamento | Java, Haskell, OCaml | Um único corpo compilado; os argumentos de tipo são verificados e depois removidos |
| Monomorfização | Templates do C++, Rust | Uma cópia especializada por instanciação: rápido, binários maiores |
| Passagem de dicionários | Type classes do Haskell | Capacidades (ex.: `Ord`) são passadas como argumentos extras |
| Reificação | C# / .NET | O runtime conhece `List<int>` e `List<string>` como tipos distintos |

O apagamento do Java explica as suas restrições: sem `new T[]`, sem `instanceof List<String>`, e casts inseridos pelo compilador nos pontos de uso. O Java também quebra a parametricidade pura, porque todo objeto tem `equals`, `hashCode`, `toString` e `getClass`, e reflexão e `null` estão sempre disponíveis.

## Exemplos Resolvidos

### Exemplo 1: tipando a identidade e aplicando-a

**Problema:** Derivar o tipo de $\Lambda\alpha.\,\lambda x{:}\alpha.\,x$ e depois o de $\text{id}\,[\text{Bool}]\ \text{true}$.

**Derivação:** Sob o contexto $\alpha, x{:}\alpha$, a variável $x$ tem tipo $\alpha$ por consulta. T-ABS dá $\lambda x{:}\alpha.\,x : \alpha \to \alpha$ sob o contexto $\alpha$. T-TABS então abstrai a variável de tipo: $\Lambda\alpha.\,\lambda x{:}\alpha.\,x : \forall\alpha.\,\alpha \to \alpha$. Para a aplicação, T-TAPP instancia com $\tau_2 = \text{Bool}$, substituindo no tipo do corpo para obter $\text{Bool} \to \text{Bool}$. T-APP com $\text{true} : \text{Bool}$ resulta em $\text{Bool}$. Em Java os mesmos dois passos são `static <T> T id(T x) { return x; }` seguido de `id(true)`, em que o compilador infere o argumento de tipo.

### Exemplo 2: numerais de Church

**Problema:** Conferir que $\text{two} = \Lambda\alpha.\,\lambda s{:}\alpha\to\alpha.\,\lambda z{:}\alpha.\,s\,(s\,z)$ tem tipo $\text{Nat}$ e calcular com ele.

**Solução:** Dentro do corpo, $z : \alpha$, então $s\,z : \alpha$ e $s\,(s\,z) : \alpha$. Abstraindo sobre $z$, $s$ e $\alpha$ obtém-se $\forall\alpha.\,(\alpha \to \alpha) \to \alpha \to \alpha$, que é $\text{Nat}$. Para usá-lo como número comum, instancie $\alpha := \text{Int}$ e forneça `succ` e `0`: $\text{two}\,[\text{Int}]\ (\lambda n.\,n+1)\ 0$ reduz a $(\lambda n.\,n+1)((\lambda n.\,n+1)\ 0) = 2$. O sucessor é $\text{succ} = \lambda n{:}\text{Nat}.\,\Lambda\alpha.\,\lambda s.\,\lambda z.\,s\,(n\,[\alpha]\ s\ z)$, e a soma $m + n$ é $m\,[\text{Nat}]\ \text{succ}\ n$.

### Exemplo 3: um teorema de graça como teste de propriedade

**Problema:** Um método de biblioteca tem a assinatura `static <T> List<T> rotate(List<T> xs)`, e a afirmação é que ele nunca examina os elementos. O que dá para testar sem conhecer a implementação?

**Solução:** A parametricidade prevê $\text{map}\ g\ (\text{rotate}\ xs) = \text{rotate}\ (\text{map}\ g\ xs)$ para toda função $g$. Um teste baseado em propriedades pode gerar uma lista aleatória e um $g$ aleatório e conferir que os dois lados são iguais. Se o teste falhar, o método está olhando valores dos elementos (talvez por `equals`, `hashCode` ou `instanceof`), o que a sua assinatura não admite. Compare com `static <T extends Comparable<? super T>> void sort(List<T> xs)`: o limite é uma capacidade extra, e o teorema de graça se enfraquece para "comuta com `map g` quando $g$ preserva a ordem".

## Equívocos Comuns e Armadilhas

- **"Generics são templates."** Templates do C++ são instanciados por uso e verificados depois da instanciação. Os generics do Java e do System F são verificados uma vez, na forma genérica, e é essa verificação que dá a garantia.
- **"Em Java, `<T> T f(T x)` precisa ser a identidade."** Só no System F. O Java deixa `f` devolver `null`, lançar exceção, chamar `x.toString()` ou inspecionar `x.getClass()`, porque a linguagem tem operações universais sobre todos os objetos.
- **"System F é só os tipos do Haskell."** A linguagem fonte do Haskell usa um fragmento de posto 1 com inferência, e usa o System F internamente (como linguagem núcleo tipada) depois da elaboração. Extensões como `RankNTypes` permitem escrever tipos de posto mais alto, com anotações.
- **"Apagamento significa que os generics do Java são inseguros."** Apagamento é uma estratégia de implementação. O verificador é correto enquanto não houver avisos de operação não verificada; tipos brutos (raw types) e casts não verificados causam *heap pollution* e os `ClassCastException` que a acompanham.

## Resumo

O System F acrescenta abstração e aplicação de tipo ao cálculo lambda simplesmente tipado, dando tipos $\forall\alpha.\,\tau$ com as regras T-TAbs e T-TApp, suficientes para codificar booleanos e números e para tipar a autoaplicação. Todo termo tipado termina. A parametricidade diz que funções polimórficas tratam o seu argumento de tipo uniformemente, o que gera teoremas de graça a partir de assinaturas. Hindley-Milner restringe o System F para tornar a inferência decidível, e a inferência do System F completo é indecidível. O Java apaga argumentos de tipo, C++ e Rust monomorfizam, o Haskell passa dicionários e o C# reifica, todos implementando a mesma teoria. O próximo conceito acrescenta a outra metade dos generics orientados a objetos: o subtipo, e como ele interage com o polimorfismo paramétrico por meio da variância.

## Documentation Links

- [Pierce: Types and Programming Languages (MIT Press), chapters 23 and 24](https://www.cis.upenn.edu/~bcpierce/tapl/): doc
- [Wadler: Theorems for Free! (FPCA 1989)](https://dl.acm.org/doi/10.1145/99370.99404): doc
- [The Java Language Specification: Type Erasure (section 4.6)](https://docs.oracle.com/javase/specs/jls/se25/html/jls-4.html#jls-4.6): doc
