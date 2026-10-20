---
version: 1.0
updatedAt: 2026-10-20
title: "Parsing LR Bottom-Up e Geradores de Parser"
summary: "Um parser LR lê a entrada da esquerda para a direita e constrói a derivação mais à direita de trás para frente, usando uma pilha e um autômato finito sobre conjuntos de itens da gramática para decidir entre deslocar e reduzir. Entender as tabelas explica de onde vêm os conflitos shift/reduce e por que yacc, Bison e seus descendentes aceitam as gramáticas que aceitam."
---
## Objetivos de Aprendizagem

- Acompanhar um parse shift-reduce usando uma pilha de estados do autômato e uma tabela ACTION/GOTO, e dizer o que é um handle.
- Construir os conjuntos de itens LR(0) de uma gramática pequena com `closure` e `goto`, e preencher a tabela SLR(1) a partir deles.
- Explicar de onde vêm os conflitos shift/reduce e reduce/reduce, e resolvê-los com declarações de precedência ou reescrevendo a gramática.
- Comparar SLR(1), LALR(1) e LR(1) canônico, e comparar o parsing LR com a descida recursiva.

## Contexto e Motivação

`software-distributed/programming-languages` analisou expressões com descida recursiva, um método top-down que prevê uma produção antes de ler a sua entrada, e `algorithms-software/formal-languages-automata` mostrou que um autômato de pilha reconhece exatamente as linguagens livres de contexto. O **parsing LR** é a contrapartida bottom-up: o parser lê a entrada da esquerda para a direita ("L"), constrói a derivação mais à direita de trás para frente ("R") e decide o que fazer a partir dos símbolos já vistos mais um lookahead limitado. Onde um parser top-down precisa adivinhar qual regra expandir, o parser LR espera ter visto o lado direito inteiro e só então o reduz.

Knuth introduziu o parsing LR(k) em 1965, e ele continua sendo o motor dos **geradores de parser** como yacc, Bison e seus descendentes. A gramática SQL do PostgreSQL e a gramática do PHP são arquivos Bison. Muitos compiladores de produção (os front ends de C e C++ do GCC, o Clang, o Go) usam descida recursiva escrita à mão, por mensagens de erro melhores e truques sensíveis a contexto, mas quem já encontrou a mensagem "shift/reduce conflict" precisa entender as tabelas por trás dela. O CS143 de Stanford e o "livro do dragão" apresentam esse algoritmo como a forma padrão de transformar uma especificação de gramática em parser.

## Teoria Central

### Parsing shift-reduce

O parser mantém uma pilha de símbolos da gramática e o resto da entrada. Ele repete dois tipos de ação:

- **Shift** (deslocar): mover o próximo token da entrada para a pilha.
- **Reduce** (reduzir) por $A \to \alpha$: quando o topo da pilha é $\alpha$, substituí-lo por $A$.

Lendo as ações de trás para frente obtém-se uma derivação mais à direita. A subcadeia pronta para ser reduzida em cada passo se chama **handle**. A dificuldade toda é escolher corretamente entre deslocar e reduzir, e entre várias reduções possíveis, sem retrocesso.

### Itens LR(0) e o autômato

Um **item** é uma produção com um ponto marcando quanto do lado direito já foi visto: $E \to E + {\cdot}\,T$ significa "$E +$ está na pilha e um $T$ é esperado em seguida". Um **estado** é um conjunto de itens. Duas operações constroem os estados:

- $\text{closure}(I)$: se $A \to \alpha \cdot B \beta$ está em $I$, adicionar $B \to \cdot\,\gamma$ para cada produção de $B$, repetidamente.
- $\text{goto}(I, X)$: mover o ponto sobre $X$ em todo item que tem $X$ depois do ponto, e então fechar.

Começando da produção aumentada $S' \to E$ obtém-se um autômato determinístico cujos estados são os **prefixos viáveis** da gramática. A pilha do parser guarda esses estados. Uma tabela tem duas partes: ACTION[estado, token] é shift, reduce, accept ou erro, e GOTO[estado, não-terminal] diz para onde ir depois de uma redução.

### Classes de gramática e lookahead

- **LR(0)** reduz sempre que há um item completo, ignorando o lookahead, e funciona em pouquíssimas gramáticas.
- **SLR(1)** reduz por $A \to \alpha$ só quando o lookahead está em $\text{FOLLOW}(A)$. É fácil de construir, mas usa uma aproximação global grosseira.
- **LR(1) canônico** coloca o lookahead exato dentro de cada item, $[A \to \alpha \cdot \beta,\ a]$. Aceita toda gramática LR(1), que são exatamente as gramáticas das linguagens livres de contexto determinísticas, mas as tabelas podem ficar enormes.
- **LALR(1)** funde os estados LR(1) canônicos que têm o mesmo núcleo (itens sem lookahead). As tabelas têm o tamanho do autômato LR(0), e quase todas as gramáticas reais de linguagens são LALR(1). A fusão pode introduzir um conflito reduce/reduce que o LR(1) canônico não tem. O Bison constrói tabelas LALR(1) por padrão e pode construir tabelas LR(1) canônicas ou IELR(1) sob pedido.

As inclusões são $\text{LR}(0) \subset \text{SLR}(1) \subset \text{LALR}(1) \subset \text{LR}(1)$ e $\text{LL}(k) \subset \text{LR}(k)$. LR trata recursão à esquerda diretamente, o que gramáticas LL precisam reescrever.

### Conflitos e como as ferramentas os resolvem

Um conflito **shift/reduce** significa que um estado permite as duas ações no mesmo token. Um conflito **reduce/reduce** significa que duas reduções diferentes são possíveis. Os dois apontam uma ambiguidade na gramática ou lookahead insuficiente. O Bison reporta o conflito, resolve shift/reduce a favor de deslocar e reduce/reduce a favor da regra anterior, e deixa o autor sobrescrever com declarações de precedência e associatividade (`%left`, `%right`, `%nonassoc`). Para entrada realmente ambígua, `%glr-parser` explora todos os parses em paralelo.

## Exemplos Resolvidos

### Exemplo 1: um parse completo

**Problema:** Analisar `id + id` com a gramática aumentada $S' \to E$, $E \to E + T \mid T$, $T \to \mathbf{id}$.

**Autômato:** $I_0$ = {$S' \to \cdot E$, $E \to \cdot E + T$, $E \to \cdot T$, $T \to \cdot \mathbf{id}$}. Depois $\text{goto}(I_0,E) = I_1$ = {$S' \to E \cdot$, $E \to E \cdot + T$}, $\text{goto}(I_0,T) = I_2$ = {$E \to T \cdot$}, $\text{goto}(I_0,\mathbf{id}) = I_3$ = {$T \to \mathbf{id} \cdot$}, $\text{goto}(I_1,+) = I_4$ = {$E \to E + \cdot T$, $T \to \cdot \mathbf{id}$} e $\text{goto}(I_4,T) = I_5$ = {$E \to E + T \cdot$}. Com $\text{FOLLOW}(E) = \text{FOLLOW}(T) = \{+, \$\}$, a tabela não precisa de resolução de conflitos.

**Traço (pilha de estados, entrada, ação):**

```text
0            id + id $   shift 3
0 3          + id $      reduce T -> id      (desempilha 1, goto(0,T) = 2)
0 2          + id $      reduce E -> T       (desempilha 1, goto(0,E) = 1)
0 1          + id $      shift 4
0 1 4        id $        shift 3
0 1 4 3      $           reduce T -> id      (desempilha 1, goto(4,T) = 5)
0 1 4 5      $           reduce E -> E + T   (desempilha 3, goto(0,E) = 1)
0 1          $           accept
```

### Exemplo 2: o else pendente

**Problema:** A gramática $S \to \texttt{if}\ E\ \texttt{then}\ S \mid \texttt{if}\ E\ \texttt{then}\ S\ \texttt{else}\ S \mid \texttt{other}$ é ambígua: em `if a then if b then x else y`, qual `if` é dono do `else`?

**Análise:** Depois que o parser leu `if E then S` e o próximo token é `else`, um estado contém ao mesmo tempo $S \to \texttt{if}\ E\ \texttt{then}\ S \cdot$ e $S \to \texttt{if}\ E\ \texttt{then}\ S \cdot \texttt{else}\ S$. Reduzir é legal porque `else` pode seguir $S$ dentro de um `if` que o envolve, e deslocar é legal porque o `else` pode pertencer a este `if`. Esse é o conflito shift/reduce. O padrão do Bison (deslocar) prende o `else` ao `if` mais próximo, que é a regra de C e Java, então o conflito é benigno aqui; a correção limpa é uma gramática que separa os comandos em formas *casadas* e *não casadas*.

### Exemplo 3: declarações de precedência

**Problema:** A gramática $E \to E + E \mid E * E \mid \mathbf{id}$ tem conflitos shift/reduce nos estados depois de `E + E` e `E * E`. Faça `*` ligar mais forte que `+`, e os dois associarem à esquerda.

**Solução:** Declare `%left '+'` e depois `%left '*'`; declarações posteriores têm precedência maior. No estado com $E \to E + E \cdot$ e lookahead `*`, o Bison compara a precedência da regra (a do seu último terminal, `+`) com a do lookahead: `*` é maior, então desloca, e `a + b * c` é analisado como `a + (b * c)`. Com lookahead `+`, as precedências são iguais e `%left` manda reduzir, então `a + b + c` é analisado como `(a + b) + c`. Nenhuma reescrita da gramática é necessária.

## Equívocos Comuns e Armadilhas

- **"Um conflito é um bug do gerador."** É um fato sobre a gramática: alguma entrada tem duas ações de parse válidas com o lookahead disponível. Corrija a gramática, adicione uma regra de precedência ou aceite o padrão depois de conferir que faz o que você pretende.
- **"LALR(1) aceita tudo que o LR(1) aceita."** Aceita um subconjunto: a fusão de estados pode criar um conflito reduce/reduce que a construção canônica evita. Na prática, gramáticas reais raramente esbarram nisso.
- **"Parsers LR não dão boas mensagens de erro."** As tabelas detectam o erro no primeiro token que não continua nenhum prefixo válido, o que é uma força. Mensagens ruins vêm da ação genérica "syntax error"; compiladores de produção acrescentam produções de erro ou usam parsers escritos à mão para recuperação sob medida.
- **"Precedência é uma propriedade da gramática."** Nas declarações `%left` ela é uma propriedade da construção da tabela. Escrever a precedência na gramática como não-terminais separados ($E \to E + T$, $T \to T * F$) dá o mesmo resultado sem declarações.

## Resumo

Um parser LR mantém uma pilha de estados do autômato de itens LR(0) e usa as tabelas ACTION e GOTO para deslocar tokens e reduzir handles, reconstruindo uma derivação mais à direita de trás para frente. SLR, LALR e LR(1) canônico diferem em quão precisamente calculam o lookahead, trocando tamanho de tabela pelo conjunto de gramáticas que aceitam; LALR(1) é o padrão prático no yacc e no Bison. Conflitos expõem ambiguidades reais, e declarações de precedência ou reescritas da gramática os resolvem. A descida recursiva escrita à mão continua comum em compiladores de produção por diagnósticos e flexibilidade. O próximo conceito sai do front end para o meio: a representação intermediária que o LLVM usa para separar linguagens de alvos.

## Documentation Links

- [GNU Bison manual: the Bison parser algorithm and conflicts](https://www.gnu.org/software/bison/manual/bison.html): doc
- [Knuth: On the Translation of Languages from Left to Right (Information and Control, 1965)](https://www.sciencedirect.com/science/article/pii/S0019995865904262): doc
- [Stanford CS143: Compilers](https://web.stanford.edu/class/cs143/): doc
- [Grune, Jacobs: Parsing Techniques: A Practical Guide (2nd ed.)](https://dickgrune.com/Books/PTAPG_2nd_Edition/): doc
