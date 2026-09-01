---
version: 1.0
updatedAt: 2026-08-18
title: "Recursão e Relações de Recorrência: Analisando Algoritmos Autorreferentes"
description: "Recursão é uma função definida em termos de si mesma via um caso base e um passo recursivo; o formato da recorrência resultante — subtrair uma constante de n versus dividir n — é o que decide se o tempo de execução é linear, exponencial ou logarítmico, como concretamente mostrado por fatorial, Fibonacci ingênuo, Torres de Hanói e busca binária. Este é o pré-requisito que os concepts irmãos algorithm-analysis-order-of-growth e dynamic-programming-fundamentals usam sem rederivar."
---
## Objetivo

Entenda recursão — uma função definida em termos de si mesma, interrompida por um caso base — como o pré-requisito de que os concepts irmãos `algorithm-analysis-order-of-growth` e `dynamic-programming-fundamentals` dependem sem rederivar: o tempo de execução de todo algoritmo recursivo é ele próprio definido por uma relação de recorrência (`T(n)` em termos de `T` em entradas menores), e *como essa recorrência é moldada* — subtrair uma constante de `n` versus dividir `n` — é a maior alavanca única sobre o resultado ser linear, exponencial ou logarítmico. Este concept é onde esse formato é lido de uma definição recursiva e transformado num limite de forma fechada, à mão, antes que qualquer um dos dois concepts irmãos seja necessário.

## Casos de Uso

- Reconhecer, a partir da própria estrutura de uma função recursiva, aproximadamente qual será seu tempo de execução *antes* de rodá-la — a diferença entre `T(n) = T(n-1) + O(1)` (linear) e `T(n) = 2T(n-1) + O(1)` (exponencial) é um único multiplicador, e ele decide se uma entrada de tamanho 40 termina instantaneamente ou efetivamente nunca.
- Qualquer problema naturalmente autorreferente: percurso de árvore/grafo, algoritmos de dividir-para-conquistar (mergesort, quicksort, multiplicação de matrizes de Strassen), busca com backtracking — em qualquer lugar onde a própria definição do problema já se descreve em termos de uma versão menor de si mesmo.
- Decidir se uma solução recursiva precisa da correção que o concept irmão `dynamic-programming-fundamentals` cobre — um algoritmo recursivo que se chama no *mesmo* subproblema menor mais de uma vez (Fibonacci ingênuo, corte de barra ingênuo) é candidato a memoização/tabulação; um que nunca revisita um subproblema (as duas metades do mergesort) não é, e cacheá-lo só adicionaria overhead.
- Estimar se uma implementação recursiva sequer é segura de rodar em Java especificamente, onde recursão profunda arrisca uma falha real, em nível de JVM (`StackOverflowError`), não só lentidão.

## Aprofundamento

### O que torna uma definição recursiva: um caso base, e um passo que encolhe até ele

Uma função (ou, mais geralmente, uma classe de objetos) é recursiva quando é definida em termos de si mesma, via exatamente dois ingredientes: um **caso base** — uma condição em que o processo termina e produz uma resposta diretamente, sem mais autorreferência — e um **passo recursivo** — uma regra que reduz todo outro caso a uma instância menor do mesmo problema, eventualmente alcançando o caso base. Fatorial é o exemplo trabalhado mais simples possível: `n! = n · (n-1)!`, terminando em `1! = 1`.

```java
static long factorial(int n) {
    if (n <= 1) return 1;             // caso base
    return n * factorial(n - 1);      // passo recursivo: n! em termos de (n-1)!
}
```

Sua recorrência é imediata a partir do código: uma multiplicação e uma chamada recursiva por nível, `T(n) = T(n-1) + O(1)`, se desenrolando para `T(n) = T(0) + n·O(1) = O(n)` — linear, porque cada passo descasca exatamente uma unidade de `n` e faz uma quantidade constante de trabalho extra.

### A família de recorrência "subtrair um": Fibonacci e sua explosão exponencial

A tradução recursiva ingênua da definição de Fibonacci (`F(0)=0`, `F(1)=F(2)=1`, `F(n) = F(n-1) + F(n-2)` para `n > 2`) parece tão direta quanto a do fatorial:

```java
static long fib(int n) {
    if (n == 0) return 0;
    if (n == 1 || n == 2) return 1;
    return fib(n - 1) + fib(n - 2);
}
```

Mas contar as chamadas recursivas reais feitas ao avaliar `fib(n)` conta uma história muito diferente da do fatorial:

| `n` | 3 | 4 | 5 | 6 | 7 |
|---|---|---|---|---|---|
| chamadas recursivas | 2 | 4 | 8 | 14 | 24 |

Isso não é crescimento linear, e a razão é visível diretamente na árvore de recursão para algo tão pequeno quanto `fib(5)`: calcular `fib(5)` chama `fib(4)` e `fib(3)` — mas `fib(4)` *em si* chama `fib(3)` de novo, do zero, como uma de suas duas próprias subchamadas. O exato mesmo subproblema, `fib(3)`, é recalculado por completo em dois ramos diferentes da árvore, e cada um *desses* ramos recalcula `fib(2)` múltiplas vezes por sua vez. A recorrência para o número de chamadas é `T(n) = T(n-1) + T(n-2) + O(1)`. Como `T(n-1)` e `T(n-2)` são próximos em tamanho para `n` grande, aproximar `T(n-1) ≈ T(n-2)` dá `T(n) ≈ 2T(n-1) + O(1)` — o mesmo formato "subtrair um, dobrar" que Torres de Hanói produz abaixo — que se desenrola (substituindo repetidamente, exatamente como a recorrência `CUT-ROD` do concept irmão `dynamic-programming-fundamentals` faz) para `T(n) = O(2^n)`. Concretamente: `fib(100)` sozinho precisaria de algo da ordem de `2^100 ≈ 1.27 × 10^30` chamadas — a uma chamada por nanossegundo, aproximadamente `4 × 10^13` anos, milhares de vezes a idade do universo. (O limite preciso e justo — não só esta aproximação por duplicação — é `Θ(φ^n)`, onde `φ = (1+√5)/2 ≈ 1.618` é a razão áurea; `φ < 2`, então o crescimento verdadeiro é um pouco mais lento que a aproximação `2^n`, mas continua plenamente exponencial.)

### O mesmo formato "subtrair um, dobrar": Torres de Hanói

Mover `n` discos de um pino para outro, um de cada vez, nunca colocando um disco maior sobre um menor, se decompõe recursivamente: mova os `n-1` discos do topo para fora do caminho, mova o único disco maior, depois mova os `n-1` discos de volta por cima dele.

```java
static void hanoi(int n, char from, char to, char aux) {
    if (n == 0) return;
    hanoi(n - 1, from, aux, to);                                   // mova n-1 discos para fora do caminho
    System.out.println("Move disk " + n + " from " + from + " to " + to);
    hanoi(n - 1, aux, to, from);                                   // mova-os de volta por cima
}
```

Toda chamada a `hanoi(n, ...)` faz exatamente duas chamadas recursivas em `n-1`, mais um movimento de disco de tempo constante: `T(n) = 2T(n-1) + O(1)`. Traçar casos pequenos à mão confirma a duplicação diretamente — `1, 3, 7, 15, 31` movimentos para `n = 1..5` (cada um é `2×` o anterior `+1`) — e desenrolar a recorrência da mesma forma que a aproximação de Fibonacci acima (substituir repetidamente até alcançar o caso base `T(0)`) dá `T(n) = 2^n · T(0) + O(1) = O(2^n)`, batendo exatamente com `2^n - 1` movimentos. Diferente da explosão exponencial de Fibonacci, porém, esta não é corrigível por memoização — Torres de Hanói não tem subproblemas sobrepostos (ambas as chamadas recursivas em todo nível operam sobre arranjos de disco genuinamente disjuntos), então `2^n - 1` movimentos é um limite inferior rígido em qualquer solução correta, não culpa da recursão ingênua.

### Um formato de recorrência inteiramente diferente: "dividir" em vez de "subtrair"

Busca sequencial sobre um array não ordenado de tamanho `n` custa `T(n) = T(n-1) + O(1)` no pior caso (checa um elemento, recursa no resto) — o mesmo formato subtrair-um do fatorial, dando O(n). Busca binária sobre um array *ordenado* em vez disso descarta metade dos elementos restantes a cada passo: `T(n) = T(n/2) + O(1)`. Substituindo repetidamente — `T(n) = T(n/2) + 1 = T(n/4) + 2 = T(n/8) + 3 = ... = T(n/2^k) + k` — e parando quando `n/2^k = 1`, isto é, `k = log_2 n`, dá `T(n) = T(1) + log_2 n = O(log n)`. A lacuna prática é enorme, não só assintótica: sobre 1.024 elementos, busca sequencial precisa de até 1.023 comparações no pior caso, busca binária precisa de no máximo `log_2 1024 = 10` — cerca de 1% do trabalho — puramente porque *dividir* `n` o encolhe muito mais rápido do que *subtrair* uma constante dele, para exatamente o mesmo formato "faça O(1) de trabalho e recurse uma vez".

### Resolvendo uma recorrência em geral: três métodos, um teorema

Os dois formatos de recorrência acima (`T(n) = T(n-1) + f(n)`, `T(n) = T(n/b) + f(n)`) são casos especiais das recorrências que surgem de qualquer algoritmo de dividir-para-conquistar ou autorreferente. CLRS nomeia três técnicas gerais para resolvê-las, no Capítulo 4 ("Divide-and-Conquer"):

- **O método de substituição** — chute a resposta em forma fechada, depois prove por indução, substituindo o chute de volta na recorrência para checar que o passo indutivo se sustenta. Funciona para qualquer coisa, mas exige já suspeitar da resposta certa.
- **O método da árvore de recursão** — desenhe a recursão como uma árvore (exatamente as árvores de `fib` e `hanoi` acima), some o trabalho feito em cada nível, e some entre níveis. Este é o método de fato usado acima para chegar aos dois resultados `O(2^n)` à mão.
- **O método mestre** — uma fórmula direta de plug-in para recorrências do formato específico `T(n) = a·T(n/b) + f(n)` (`a >= 1` subproblemas, cada um de tamanho `n/b`, mais `f(n)` de trabalho extra para dividir/combinar), comparando `f(n)` contra `n^(log_b a)`:
  - **Caso 1**: se `f(n) = O(n^(log_b a - ε))` para algum `ε > 0` (as chamadas recursivas dominam), então `T(n) = Θ(n^(log_b a))`.
  - **Caso 2**: se `f(n) = Θ(n^(log_b a) · log^k n)` para algum `k >= 0` (os dois são comparáveis), então `T(n) = Θ(n^(log_b a) · log^(k+1) n)`.
  - **Caso 3**: se `f(n) = Ω(n^(log_b a + ε))` para algum `ε > 0` *e* uma condição de regularidade se sustenta (o trabalho extra domina), então `T(n) = Θ(f(n))`.

  A própria recorrência do mergesort — o próprio exemplo condutor de Sedgewick & Wayne — é a aplicação de livro-texto do Caso 2: `T(n) = 2T(n/2) + O(n)` tem `a=2, b=2`, então `n^(log_2 2) = n^1 = n`, e `f(n) = O(n) = Θ(n^1 · log^0 n)` bate com o Caso 2 com `k=0`, dando `T(n) = Θ(n log n)` — o limite linearítmico que ambos os livros afirmam diretamente para o mergesort, obtido aqui a partir da fórmula geral em vez de uma prova dedicada.

### Por que este concept fica a montante da programação dinâmica

`T(n) = T(n-1) + T(n-2) + O(1)` de Fibonacci e `T(n) = 1 + sum(T(j) for j=0..n-1)` do corte de barra (a própria recorrência do concept irmão `dynamic-programming-fundamentals`) são ambas exponenciais pela razão idêntica: a recursão revisita o *mesmo* subproblema menor — o mesmo valor de `n` — a partir de mais de um lugar na árvore de chamadas. Nada sobre a *definição recursiva em si* precisa mudar para corrigir isso; o que muda é a contabilidade — cachear a resposta de cada subproblema na primeira vez que é calculado (memoização) ou preencher uma tabela do menor valor para o maior de forma que nada seja recalculado (tabulação), transformando o `O(2^n)` do `fib` (ou, precisamente, `Θ(φ^n)`) em O(n) garantindo que cada um dos `n` tamanhos distintos de subproblema seja resolvido exatamente uma vez. Essa correção — e o vocabulário de "subproblemas sobrepostos" que nomeia quando ela se aplica — é o assunto do concept irmão; este concept é o que torna "a recursão recalcula a mesma coisa duas vezes" uma afirmação que você realmente pode ver e contar, em vez de aceitar por fé.

### O custo real da recursão em Java: a pilha de chamadas

Toda chamada recursiva é um frame de pilha real, não uma abstração matemática — parâmetros, variáveis locais e o endereço de retorno todos são empilhados na pilha de chamadas da JVM, e desempilhados só quando aquela chamada retorna. Uma recursão que é correta e até razoavelmente eficiente em termos de Big-O (digamos, `O(n)`) ainda pode falhar completamente em Java se `n` for grande o suficiente para esgotar a pilha, lançando `java.lang.StackOverflowError` — um risco real, específico da JVM, não meramente uma preocupação de desempenho da forma que um `O(n^2)` lento é. Isso importa mais em Java do que em linguagens que garantem **eliminação de chamada de cauda** (reescrever uma chamada autorrecursiva em posição de cauda como um laço, reusando o mesmo frame de pilha): a JVM não realiza essa otimização mesmo quando a chamada recursiva de um método Java é escrita em posição de cauda, então uma função Java profundamente recursiva precisa de uma reescrita iterativa explícita ou uma simulação explícita baseada em pilha para ser segura em entradas grandes — escrever código Java "com aparência tail-recursive" não compra nenhuma da segurança de pilha que compraria numa linguagem cujo runtime de fato elimina a chamada de cauda.

### Veja acontecendo: Fibonacci ingênuo recalcula a mesma chamada três vezes

Traçar a árvore de chamadas completa de `fib(4)` à mão — 9 chamadas no total — torna concreta a afirmação de "o mesmo subproblema revisitado a partir de múltiplos lugares": `fib(2)` é calculado duas vezes do zero (uma vez sob cada uma das duas subchamadas de `fib(4)`), e `fib(1)` três vezes, cada uma refazendo o trabalho idêntico que a outra já fez.

```viz
type: tree
insert f4 fib(4) | Chama fib(4): não é um caso base -- chama fib(3), depois fib(2).
insert f3 fib(3) parent=f4 side=left | fib(4) chama fib(3) primeiro.
insert f2a fib(2) parent=f3 side=left | fib(3) chama fib(2) -- a primeira vez que fib(2) é calculado.
insert f1a fib(1) parent=f2a side=left | fib(2) chama fib(1) -- caso base, retorna 1.
insert f0a fib(0) parent=f2a side=right | fib(2) chama fib(0) -- caso base, retorna 0.
insert f1b fib(1) parent=f3 side=right | fib(3) também chama fib(1) diretamente -- um segundo caso base, separado.
insert f2b fib(2) parent=f4 side=right | fib(4) agora chama fib(2) de novo -- a SEGUNDA vez que fib(2) é calculado do zero, refazendo toda a subárvore de f2a.
insert f1c fib(1) parent=f2b side=left | fib(2) chama fib(1) -- a TERCEIRA chamada separada de fib(1) neste único trace.
insert f0b fib(0) parent=f2b side=right | fib(2) chama fib(0) -- a segunda chamada separada de fib(0).
```

## Trade-offs

- **O formato da recorrência, não seus fatores constantes, decide o resultado assintótico.** `T(n) = T(n-1) + O(1)` é linear; `T(n) = 2T(n-1) + O(1)` é exponencial; `T(n) = T(n/2) + O(1)` é logarítmico — três recorrências que diferem só em como o argumento da chamada recursiva encolhe, produzindo três classes de complexidade completamente diferentes. Ler a recorrência de uma definição recursiva por inspeção, antes de sequer rodá-la, é a habilidade real que este concept constrói.
- **Subproblemas sobrepostos são uma propriedade da *estrutura* recursiva, não do problema ser difícil** — Fibonacci e corte de barra são ambos problemas fáceis (um preenchimento de tabela O(n) e O(n²), respectivamente, uma vez memoizados) que só parecem exponenciais em sua tradução recursiva mais direta e ingênua. O custo exponencial de Torres de Hanói, em contraste, é real e inevitável — não há correção por memoização, porque não há nada sobreposto para cachear.
- **Um algoritmo recursivo comprovadamente correto ainda pode falhar em Java especificamente, num tamanho que nenhum limite Big-O avisa**, porque `StackOverflowError` é um limite fixo de recurso físico (profundidade de pilha), não uma função do tempo de execução assintótico — uma recursão O(n) pode ser totalmente prática em termos de tempo em `n = 10^7` e ainda assim travar a JVM completamente, algo que um laço iterativo equivalente sobre o mesmo `n` nunca faria.
- **Reconhecer qual das duas famílias de recorrência você realmente tem é um julgamento de modelagem, não um passo mecânico** — nada na *sintaxe* de uma função recursiva anuncia se é o formato "subtrair uma constante" ou o formato "dividir por uma constante"; isso precisa ser lido do que a chamada recursiva realmente faz com seu argumento, que é exatamente o que separa a família linear-ou-exponencial de fatorial/Fibonacci/Hanói da família logarítmica da busca binária.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4ª Edição, Capítulo 4 "Divide-and-Conquer", Seções 4.3 "The substitution method", 4.4 "The recursion-tree method", e 4.5 "The master method", pp. 90-106](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — book
- [Robert Sedgewick, Kevin Wayne — Algorithms, 4ª Edição, Seção 2.2 "Mergesort" (análise de recorrência do tempo de execução do mergesort)](https://algs4.cs.princeton.edu/22mergesort/) — doc
- [Fibonacci number — Wikipedia (definição recursiva e a taxa de crescimento Θ(φⁿ) da avaliação recursiva ingênua)](https://en.wikipedia.org/wiki/Fibonacci_sequence) — doc
