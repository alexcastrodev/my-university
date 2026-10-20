---
version: 1.0
updatedAt: 2026-10-20
title: "Tipos Dependentes e a Correspondência de Curry-Howard"
summary: "Quando tipos podem mencionar valores, um tipo pode enunciar uma especificação precisa (um vetor de tamanho n, uma lista ordenada) e um programa desse tipo é uma prova de que ela vale. Pela correspondência de Curry-Howard, implicação é o tipo função, conjunção é o tipo par e quantificação universal é o tipo função dependente, e é assim que Lean, Coq/Rocq e Agda funcionam ao mesmo tempo como linguagens de programação e assistentes de prova."
---
## Objetivos de Aprendizagem

- Enunciar a correspondência de Curry-Howard entre proposições e tipos, provas e programas, e usá-la para traduzir um enunciado lógico em um tipo.
- Definir tipos função dependentes ($\Pi$) e tipos par dependentes ($\Sigma$), e escrever um vetor indexado pelo tamanho cujo `head` não pode ser aplicado a um vetor vazio.
- Explicar por que a checagem de tipos dependentes exige avaliação dentro de tipos e por que a linguagem precisa ser total.
- Comparar tipos dependentes com tipos de refinamento, contratos e testes como formas de enunciar especificações, com o seu custo.

## Contexto e Motivação

Os conceitos anteriores construíram uma escada de sistemas de tipos: cálculo lambda simplesmente tipado, System F (tipos dependem de tipos), subtipagem e propriedade. O próximo degrau é deixar tipos dependerem de **valores**. `ai-theory/formal-methods` apresentou provadores de teoremas e assistentes de prova como ferramentas para provar a correção de programas, e tratou a teoria de tipos por baixo deles como uma caixa-preta. Este conceito a abre.

A observação central, de Curry e Howard, é que as regras de tipagem do cálculo lambda são as regras de inferência de uma lógica. Um tipo é uma proposição, um programa desse tipo é uma prova dela, e normalizar um programa é simplificar uma prova. Estenda os tipos para depender de valores e você obtém a lógica de predicados: um tipo pode dizer "uma lista ordenada de tamanho $n$", e um programa desse tipo é uma prova de que a propriedade vale. Esse é o fundamento de Lean, Coq/Rocq, Agda e Idris. A mesma maquinaria verificou um compilador C (CompCert, em Coq), uma biblioteca criptográfica (HACL*, em F*) e grandes trechos de matemática (Mathlib, em Lean). "Propositions as Types", de Wadler, e o volume *Logical Foundations* do Software Foundations são as introduções padrão.

## Teoria Central

### Proposições como tipos

| Lógica | Teoria de tipos |
|---|---|
| proposição $P$ | tipo $A$ |
| prova de $P$ | termo (programa) do tipo $A$ |
| $P \wedge Q$ (e) | tipo par $A \times B$ |
| $P \vee Q$ (ou) | tipo soma $A + B$ |
| $P \to Q$ (implica) | tipo função $A \to B$ |
| $\top$ (verdadeiro) | tipo unitário (um valor) |
| $\bot$ (falso) | tipo vazio (nenhum valor) |
| $\forall x{:}A.\ P(x)$ | tipo função dependente $\Pi x{:}A.\ B(x)$ |
| $\exists x{:}A.\ P(x)$ | tipo par dependente $\Sigma x{:}A.\ B(x)$ |
| simplificação de prova | avaliação (normalização) |

O cálculo lambda simplesmente tipado corresponde à lógica proposicional intuicionista, o System F à lógica proposicional de segunda ordem e os tipos dependentes à lógica de predicados. Uma prova de $P \wedge Q \to Q \wedge P$ é a função que troca os componentes de um par. Uma prova de $\neg P$ é uma função $P \to \bot$. Não existe termo fechado de tipo $\bot$ em um sistema consistente, e é isso que "consistente" significa.

### Tipos dependentes

Um **tipo função dependente** $\Pi x{:}A.\ B(x)$ é uma função cujo tipo de resultado pode mencionar o argumento; um **par dependente** $\Sigma x{:}A.\ B(x)$ é um par cujo tipo do segundo componente depende do primeiro. O exemplo padrão é um vetor indexado pelo seu tamanho: `Vec α n` é uma lista de `n` elementos do tipo `α`. O tipo de `append` pode dizer `Vec α m → Vec α n → Vec α (m + n)`, e `head` pode exigir `Vec α (n + 1)`, de modo que aplicá-lo a um vetor vazio não é erro de execução, é erro de tipo. Uma função que devolve "um `x` tal que `P x`" devolve um par $\Sigma$: uma testemunha junto com uma prova sobre ela.

### Tipos precisam de computação

Quando tipos contêm termos, decidir se dois tipos são iguais exige avaliar esses termos: `Vec α (2 + 2)` e `Vec α 4` são o mesmo tipo porque `2 + 2` reduz a `4`. O verificador de tipos portanto contém um avaliador, e a igualdade de tipos é a **igualdade definicional** (igualdade módulo computação). Uma prova de que duas expressões são iguais, mas não por computação, como `n + 0 = 0 + n`, precisa ser escrita, normalmente por indução.

### Totalidade e consistência

Se a recursão geral fosse permitida, `def loop : False := loop` definiria uma "prova" de falsidade e a lógica desabaria, já que toda proposição seria demonstrável. Teorias de tipos dependentes portanto exigem que toda função termine, checado por recursão estrutural sobre um argumento indutivo ou por uma medida bem fundada explícita, e exigem que tipos indutivos satisfaçam uma condição de *positividade*. Essa é a propriedade de normalização forte do System F, estendida. O preço é que uma linguagem assim deliberadamente não é Turing completa; programas que precisam divergir (servidores, interpretadores) são modelados com combustível explícito ou coindução.

### Provas construtivas e indução

As provas aqui são *construtivas*: uma prova de $\exists x.\ P(x)$ precisa produzir um $x$, e a lei do terceiro excluído não é derivável (o Lean a oferece como axioma explícito, `Classical.em`, quando você a quer). Uma prova por indução sobre um número natural é uma função recursiva, e a checagem de terminação sobre ela é a checagem de que a indução é bem fundada.

### Pontos mais baratos no mesmo espectro

Tipos dependentes completos são a opção mais expressiva e mais cara. **Tipos de refinamento** (Liquid Haskell, F*) anexam um predicado decidível a um tipo base, `{v : Int | v > 0}`, e descarregam as obrigações com um solver SMT, como em `ai-theory/formal-methods`. **Contratos** (Eiffel, JML, Dafny) checam especificações em tempo de execução ou estaticamente. **Testes** checam só exemplos. Em linguagens comuns, "tornar estados ilegais irrepresentáveis" com uma hierarquia selada ou um record validado é o mesmo instinto em escala pequena. Quanto mais você quer que o verificador de tipos prove, mais prova você escreve.

## Exemplos Resolvidos

### Exemplo 1: um enunciado lógico como programa

**Problema:** Provar em Lean 4 que $p \wedge q \to q \wedge p$ e ler isso como um programa.

```text
theorem and_swap (p q : Prop) : p ∧ q → q ∧ p :=
  fun h => ⟨h.2, h.1⟩
```

**Solução:** A proposição `p ∧ q → q ∧ p` é um tipo função de um par para um par. A prova recebe a evidência `h` de `p ∧ q`, pega o segundo componente `h.2 : q` e o primeiro `h.1 : p`, e constrói um novo par. É o programa `swap : A × B → B × A`. O verificador de provas aceita porque o termo tem o tipo declarado, sem etapa separada de "checagem de prova" além da checagem de tipos.

### Exemplo 2: vetores indexados pelo tamanho

**Problema:** Definir vetores cujo tipo registra o tamanho, um `head` total e um `map` que provadamente preserva o tamanho.

```text
inductive Vec (α : Type) : Nat → Type where
  | nil  : Vec α 0
  | cons : {n : Nat} → α → Vec α n → Vec α (n + 1)

def Vec.head {α : Type} {n : Nat} : Vec α (n + 1) → α
  | .cons x _ => x

def Vec.map {α β : Type} {n : Nat} (f : α → β) : Vec α n → Vec β n
  | .nil       => .nil
  | .cons x xs => .cons (f x) (Vec.map f xs)
```

**Solução:** `nil` tem tamanho 0 e `cons` soma um. `head` aceita só `Vec α (n + 1)`, então não precisa de caso para `nil`: o compilador vê que um vetor de tamanho `0` não pode ter tamanho `n + 1`, e `Vec.head .nil` falha na checagem de tipos, em vez de lançar exceção em tempo de execução como o `List.getFirst()` do Java faz numa lista vazia (`NoSuchElementException`). Em `map`, o resultado declarado `Vec β n` é conferido contra os dois ramos: `nil` dá tamanho 0 e `cons` dá `(n' + 1)`, então um `map` que descartasse ou duplicasse um elemento seria rejeitado.

### Exemplo 3: uma prova por indução é uma função recursiva

**Problema:** Provar que $0 + n = n$ para todo natural $n$ (isso não vale por computação, porque a adição recorre sobre o segundo argumento, então `n + 0` reduz a `n` mas `0 + n` não).

```text
theorem zero_add' : (n : Nat) → 0 + n = n
  | 0     => rfl
  | n + 1 => congrArg Nat.succ (zero_add' n)
```

**Solução:** O caso base `0 + 0 = 0` vale por computação (`rfl`, reflexividade da igualdade). No passo, `0 + (n + 1)` reduz pela definição da adição a `Nat.succ (0 + n)`, e a chamada recursiva `zero_add' n` prova `0 + n = n`. Aplicar `congrArg Nat.succ` a essa equação dá `Nat.succ (0 + n) = Nat.succ n`, que é o objetivo. A prova é uma função recursiva que se chama com um argumento menor, e o verificador de terminação confere que a recursão é sobre um `n` estruturalmente menor: raciocínio circular seria rejeitado.

## Equívocos Comuns e Armadilhas

- **"Tipos dependentes só movem checagens para o tempo de compilação."** Fazem mais: precisa existir uma prova para cada uso, inclusive para os casos que o programa nunca alcança. Onde uma checagem em tempo de execução pode dizer "esta entrada é ruim", um tipo precisa excluí-la ou o chamador precisa fornecer evidência.
- **"Se passa na checagem de tipos, o programa está correto."** Está correto *em relação ao tipo declarado*. Uma especificação errada (um `sort` cujo tipo esquece de exigir uma permutação da entrada) verifica normalmente. Especificações precisam de tanta revisão quanto o código.
- **"Curry-Howard diz que todo programa é uma prova."** Só numa teoria de tipos terminante e consistente. Um método Java que entra em laço infinito tem o tipo `int` e não prova nada.
- **"Esses sistemas são só para matemáticos."** CompCert, HACL* e sistemas de arquivos e criptografia verificados mostram usos industriais, mas o custo é alto: a engenharia de provas costuma ser várias vezes o tamanho do programa, e as provas quebram quando o código é refatorado.

## Resumo

Pela correspondência de Curry-Howard, proposições são tipos, provas são programas, implicação é o tipo função, conjunção é o par e avaliação é simplificação de prova. Deixar tipos dependerem de valores acrescenta tipos $\Pi$ e $\Sigma$, que correspondem à quantificação universal e existencial, e permite que um tipo como `Vec α (n + 1)` exclua classes inteiras de erros de execução. A checagem de tipos passa a exigir avaliação dentro de tipos, e a consistência força a totalidade, então essas linguagens deliberadamente não são Turing completas. Tipos de refinamento, contratos e testes ficam em pontos mais baratos do mesmo espectro de quanto uma especificação é checada. O próximo conceito volta à análise de programas comuns, que são parciais e imperativos, com a interpretação abstrata.

## Documentation Links

- [Theorem Proving in Lean 4](https://lean-lang.org/theorem_proving_in_lean4/): doc
- [Wadler: Propositions as Types (Communications of the ACM, 2015)](https://homepages.inf.ed.ac.uk/wadler/papers/propositions-as-types/propositions-as-types.pdf): doc
- [Software Foundations, Volume 1: Logical Foundations](https://softwarefoundations.cis.upenn.edu/lf-current/index.html): doc
