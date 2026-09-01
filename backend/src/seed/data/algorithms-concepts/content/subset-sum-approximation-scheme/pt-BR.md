---
version: 1.0
updatedAt: 2026-08-18
title: "Subset Sum: Um Esquema de Aproximação Totalmente Polinomial"
description: "O algoritmo exato para subset sum constrói a lista de toda soma de subconjunto alcançável e é exponencial porque essa lista pode dobrar a cada iteração; recortá-la — descartando qualquer valor que outro valor sobrevivente já aproxime dentro de um fator de 1 + ε/2n — a reduz para comprimento polinomial e transforma o algoritmo num esquema de aproximação totalmente polinomial cujo tempo de execução é polinomial tanto no tamanho da entrada quanto em 1/ε."
---
## Objetivo

Os concepts irmãos `approximation-algorithms-vertex-cover` (Seções 35.1-35.2) e `set-covering-and-lp-rounding` (Seções 35.3-35.4) entregam todos algoritmos de aproximação com uma razão *fixa* embutida no algoritmo: 2, ou `O(lg |X|)`, ou 8/7. A Seção 35.5 fecha o capítulo com algo qualitativamente diferente — um **esquema** de aproximação, onde a precisão é um parâmetro de entrada `ε` que quem chama pode ajustar, e o tempo de execução do algoritmo é polinomial tanto no tamanho da entrada *quanto* em `1/ε`. Isso é um **esquema de aproximação totalmente polinomial (FPTAS)**, e Cormen et al. constroem um para a versão de otimização do problema de subset sum: dado um conjunto `S` de inteiros positivos e um alvo `t`, encontre um subconjunto cuja soma seja a maior possível sem exceder `t`. A versão de decisão é NP-completa (provada na Seção 34.5.5 e coberta pelo concept irmão `np-completeness-proofs-and-problem-catalog`), então o caminho é: começar de um algoritmo exato que constrói incrementalmente a lista de todas as somas de subconjunto alcançáveis — uma abordagem no mesmo espírito de recorrência incremental do concept irmão `dynamic-programming-fundamentals`, mas exponencial aqui porque a própria lista pode dobrar a cada passo — e depois torná-lo polinomial **recortando** a lista, descartando deliberadamente qualquer valor que outro valor sobrevivente já aproxime de perto o suficiente.

## Casos de Uso

- Resolver a forma prática de otimização de subset sum: o enquadramento da fonte é um caminhão que carrega no máximo `t` libras e até `n` caixas com pesos `x1, ..., xn`, e a pergunta é quão pesada uma carga ele pode levar sem exceder o limite.
- Recorrer a `EXACT-SUBSET-SUM` sem modificação quando os números cooperam — a fonte observa que ele é genuinamente polinomial nos casos especiais em que `t` é polinomial em `|S|` ou todos os números em `S` são limitados por um polinômio em `|S|`. Só quando os valores são grandes o crescimento exponencial da lista morde.
- Trocar precisão por tempo numa escala contínua em vez de aceitar uma razão fixa: `APPROX-SUBSET-SUM` recebe `ε` com `0 < ε < 1` e garante que o valor retornado está dentro de um fator de `1 + ε` do ótimo, então o mesmo código cobre "aproximadamente certo e rápido" e "quase exato e mais lento".
- Reconhecer o formato FPTAS quando ele aparece em outro lugar: uma família de algoritmos indexada por `ε`, com tempo de execução polinomial em `1/ε` *além de* no tamanho da entrada — em oposição a um esquema que só é polinomial no tamanho da entrada para cada `ε` fixo.
- Aprender o recorte de listas (trimming) como técnica reutilizável: sempre que um espaço de estados é uma lista de valores numéricos e quase-duplicatas são inofensivas, manter um representante por faixa multiplicativa colapsa uma lista exponencial numa de tamanho logarítmico.

## Aprofundamento

### O algoritmo exato: mantenha a lista de todas as somas alcançáveis, limitada a t

Seja `Pi` o conjunto de valores obtidos somando os membros de cada subconjunto (possivelmente vazio) de `{x1, x2, ..., xi}`. Para `S = {1, 4, 5}` isso dá `P1 = {0, 1}`, `P2 = {0, 1, 4, 5}`, e `P3 = {0, 1, 4, 5, 6, 9, 10}`. Todo o algoritmo exato repousa sobre uma identidade:

`Pi = P(i-1) ∪ (P(i-1) + xi)`

onde `L + x` significa a lista construída somando `x` a cada elemento de `L` — por exemplo, se `L = ⟨1, 2, 3, 5, 9⟩` então `L + 2 = ⟨3, 4, 5, 7, 11⟩`. A outra observação que torna o algoritmo prático é que, uma vez que a soma de um subconjunto excede `t`, nenhum superconjunto dele pode nunca ser ótimo, então pode ser descartado imediatamente.

```java
// Tradução fiel de EXACT-SUBSET-SUM(S, n, t) (CLRS, Seção 35.5).
// Li é a lista ordenada de somas de subconjuntos de {x1..xi} que não excedem t.
long exactSubsetSum(long[] x, int n, long t) {
    List<Long> l = new ArrayList<>(List.of(0L));      // linha 1: L0 = <0>

    for (int i = 1; i <= n; i++) {                    // linha 2
        l = mergeLists(l, addToEach(l, x[i - 1]));    // linha 3: merge, duplicatas removidas
        removeGreaterThan(l, t);                      // linha 4
    }
    return l.get(l.size() - 1);                       // linha 5: maior elemento em Ln
}
```

`MERGE-LISTS(L, L')` é o merge do merge-sort com duplicatas descartadas, rodando em tempo proporcional ao comprimento combinado, então mantém cada `Li` ordenada. Por indução em `i` (Exercício 35.5-1), `Li` é exatamente a lista ordenada de todo elemento de `Pi` que é no máximo `t`. O problema é o comprimento: `|Li|` pode chegar a `2^i`, então `EXACT-SUBSET-SUM` é exponencial em geral.

### TRIM: mantenha um representante por faixa multiplicativa

A chave para transformar isso num FPTAS é **recortar (trim)** cada `Li` logo após construí-la. A ideia: se dois valores numa lista estão próximos um do outro, não vale a pena manter os dois quando o objetivo é só uma resposta aproximada. Dado um parâmetro de corte `δ` com `0 < δ < 1`, recortar uma lista `L` remove o máximo de elementos possível tal que todo elemento removido `y` ainda tenha um elemento sobrevivente `z` **representando-o**, significando que `z` não é maior que `y`, mas está dentro de um fator de `1 + δ`:

`y / (1 + δ) ≤ z ≤ y`

Como todo valor sobrevivente já era um elemento real da lista original, o recorte só pode tornar a resposta *menor*, nunca ilegal — uma propriedade crucial para a prova de corretude mais adiante.

```java
// Tradução fiel de TRIM(L, delta) (CLRS, Seção 35.5).
// L precisa estar ordenada em ordem crescente. Roda em tempo Theta(m).
List<Long> trim(List<Long> l, double delta) {
    int m = l.size();
    List<Long> out = new ArrayList<>();
    out.add(l.get(0));                                // linha 2: L' = <y1>
    long last = l.get(0);                             // linha 3

    for (int i = 1; i < m; i++) {                     // linha 4: i = 2 até m
        long yi = l.get(i);
        if (yi > last * (1 + delta)) {                // linha 5: yi >= last, L está ordenada
            out.add(yi);                              // linha 6
            last = yi;                                // linha 7
        }
    }
    return out;                                       // linha 8
}
```

O procedimento faz uma única passada crescente, anexando um valor só quando é o primeiro elemento ou quando o valor mais recente colocado na saída não consegue representá-lo. O trace abaixo é o próprio exemplo de recorte da fonte: `L = ⟨10, 11, 12, 15, 20, 21, 22, 23, 24, 29⟩` com `δ = 0.1`. Cada token é um elemento de `L`, e desaparece da linha no momento em que `TRIM` decide não anexá-lo:

```viz
type: moves
remove 11 | last = 10. 11 > 10 x 1.1 = 11? Não, então a linha 5 falha e 11 é descartado -- ele é representado por 10.
remove 21 | 12 > 11, então 12 é mantido (last = 12); 15 > 13.2, mantido (last = 15); 20 > 16.5, mantido (last = 20). Agora: 21 > 20 x 1.1 = 22? Não -- descartado, representado por 20.
remove 22 | 22 > 22? Não -- também descartado, também representado por 20.
remove 24 | 23 > 22, então 23 é mantido e last = 23. 24 > 23 x 1.1 = 25.3? Não -- descartado, representado por 23.
---
10
11
12
15
20
21
22
23
24
29
```

A lista sobrevivente é `L' = ⟨10, 12, 15, 20, 23, 29⟩`: 11 é representado por 10, tanto 21 quanto 22 por 20, e 24 por 23. Dez elementos viraram seis, e todo valor descartado ainda tem um substituto próximo, ligeiramente menor.

### APPROX-SUBSET-SUM: algoritmo exato mais um recorte por iteração

```java
// Tradução fiel de APPROX-SUBSET-SUM(S, n, t, eps) (CLRS, Seção 35.5).
// Requer 0 < eps < 1. Retorna um valor dentro de um fator de (1 + eps) do ótimo.
long approxSubsetSum(long[] x, int n, long t, double eps) {
    List<Long> l = new ArrayList<>(List.of(0L));      // linha 1: L0 = <0>

    for (int i = 1; i <= n; i++) {                    // linha 2
        l = mergeLists(l, addToEach(l, x[i - 1]));    // linha 3
        l = trim(l, eps / (2.0 * n));                 // linha 4: note eps/2n, NÃO eps
        removeGreaterThan(l, t);                      // linha 5
    }
    return l.get(l.size() - 1);                       // linhas 6-7: maior valor em Ln
}
```

A única diferença estrutural em relação a `EXACT-SUBSET-SUM` é a linha 4. O parâmetro de recorte é `ε/2n` em vez de `ε` precisamente porque o recorte acontece `n` vezes e as imprecisões **se acumulam**: cada passada pode reduzir os valores sobreviventes por um fator de `1 + ε/2n`, então depois de `n` passadas o dano é `(1 + ε/2n)^n`, e encolher o parâmetro por passada por `2n` é o que mantém esse produto abaixo de `1 + ε`.

Aqui está a própria instância trabalhada pela fonte: `S = ⟨104, 102, 201, 101⟩`, `t = 308`, `ε = 0.40`, então o parâmetro de recorte é `δ = ε/2n = 0.40/8 = 0.05`.

| i | linha 3 — merge de `L(i-1)` com `L(i-1) + xi` | linha 4 — recorte por 0.05 | linha 5 — descarte valores > 308 |
|---|---|---|---|
| 1 (`x1 = 104`) | `⟨0, 104⟩` | `⟨0, 104⟩` | `⟨0, 104⟩` |
| 2 (`x2 = 102`) | `⟨0, 102, 104, 206⟩` | `⟨0, 102, 206⟩` | `⟨0, 102, 206⟩` |
| 3 (`x3 = 201`) | `⟨0, 102, 201, 206, 303, 407⟩` | `⟨0, 102, 201, 303, 407⟩` | `⟨0, 102, 201, 303⟩` |
| 4 (`x4 = 101`) | `⟨0, 101, 102, 201, 203, 302, 303, 404⟩` | `⟨0, 101, 201, 302, 404⟩` | `⟨0, 101, 201, 302⟩` |

Lendo os recortes: em `i = 2`, 104 é descartado porque está dentro de um fator de 1.05 de 102. Em `i = 3`, 206 é descartado por estar dentro de 1.05 de 201, e 407 sobrevive ao recorte só para ser cortado pela linha 5 por exceder `t = 308`. Em `i = 4`, 102 é descartado (dentro de 1.05 de 101), 203 é descartado (dentro de 1.05 de 201), e 303 é descartado (dentro de 1.05 de 302).

O procedimento retorna `z = 302`. O verdadeiro ótimo é `307 = 104 + 102 + 101`, então a resposta está dentro de 2% — confortavelmente dentro da margem prometida de `ε = 40%`. Essa diferença entre a garantia e o erro observado é típica: o limite é de pior caso.

### Por que é totalmente polinomial: o limite de precisão e o limite de comprimento da lista

**Teorema 35.7**: `APPROX-SUBSET-SUM` é um esquema de aproximação totalmente polinomial para o problema de subset sum. Duas coisas precisam ser provadas.

**A resposta é precisa.** Tanto a linha 4 quanto a linha 5 só *deletam* elementos, nunca inventam nenhum, então todo elemento de `Li` é um membro genuíno de `Pi` — o `z` retornado é verdadeiramente a soma de algum subconjunto de `S`, e a linha 5 garante `z ≤ t`. Seja `y*` o valor ótimo (o maior elemento de `Pn` que é no máximo `t`); então `z ≤ y*`, e o que resta é mostrar que `y*/z ≤ 1 + ε`.

- O Exercício 35.5-2 estabelece por indução em `i` que para todo `y ∈ Pi` com `y ≤ t`, algum `z ∈ Li` sobrevivente satisfaz `y / (1 + ε/2n)^i ≤ z ≤ y` — isto é, um recorte de `ε/2n` por iteração, acumulado `i` vezes.
- Aplicando isso a `y*` em `i = n` dá um elemento de `Ln` com `y*/z ≤ (1 + ε/2n)^n`, e como o `z` retornado é o *maior* elemento de `Ln`, o mesmo limite vale para ele.
- Resta mostrar que `(1 + ε/2n)^n ≤ 1 + ε`. A função `(1 + ε/2n)^n` é crescente em `n` (Exercício 35.5-3) e se aproxima de seu limite `e^(ε/2)`, então é limitada por `e^(ε/2) ≤ 1 + ε/2 + (ε/2)²`. Como `0 < ε < 1` força `(ε/2)² ≤ ε/2`, essa última expressão é no máximo `1 + ε`.

**O tempo de execução é polinomial no tamanho da entrada e em 1/ε.** Depois do recorte, quaisquer dois elementos sucessivos `z` e `z'` de `Li` precisam diferir por um fator maior que `1 + ε/2n` — isso é exatamente o que sobreviver ao recorte significa. Então cada lista contém o valor 0, possivelmente o valor 1, e no máximo `log_(1+ε/2n) t` valores adicionais, dando um limite de comprimento de

`log_(1+ε/2n) t + 2 = ln t / ln(1 + ε/2n) + 2 ≤ 2n(1 + ε/2n)·ln t / ε + 2 < 3n·ln t / ε + 2`

usando `0 < ε < 1` no último passo. Esse limite é polinomial em `1/ε` e no tamanho da entrada — que é os `lg t` bits necessários para escrever `t` mais os bits necessários para escrever `S`, ele próprio polinomial em `n`. Como o tempo de execução é polinomial nos comprimentos das listas, o esquema inteiro é totalmente polinomial. É esse o cerne: o recorte converte uma lista que poderia guardar `2^i` valores em uma que guarda `O(n·ln t / ε)` valores, e o erro acumulado permanece limitado porque o parâmetro por recorte foi dividido por `2n` desde o início.

## Trade-offs

- **Um esquema, não um algoritmo** — diferente dos algoritmos de razão fixa dos concepts irmãos, quem chama escolhe a precisão. Essa flexibilidade tem um preço: `1/ε` está no limite do tempo de execução (`3n·ln t / ε + 2` elementos por lista), então reduzir pela metade o erro permitido aproximadamente dobra o trabalho. Perseguir um `ε` muito pequeno vai reconduzindo de volta ao algoritmo exato exponencial.
- **A resposta recortada é sempre uma subestimativa, nunca uma superestimativa** — o recorte mantém um representante `z ≤ y` para todo `y` descartado, e a linha 5 impõe `z ≤ t`. Então o valor retornado é uma soma de subconjunto genuinamente alcançável que nunca excede o alvo, exatamente o que o enquadramento de carregamento do caminhão precisa. O Exercício 35.5-4 pergunta como modificar o esquema para aproximar a *menor* soma de subconjunto não menor que `t`.
- **Você obtém um valor, não um subconjunto** — como está escrito, `APPROX-SUBSET-SUM` retorna só o número `z`. Recuperar *quais* elementos somam a ele exige contabilidade extra (Exercício 35.5-5), da mesma forma que uma tabela de programação dinâmica entrega o custo ótimo antes de entregar a solução ótima.
- **O algoritmo exato às vezes já é bom o suficiente** — `EXACT-SUBSET-SUM` roda em tempo polinomial sempre que `t` é polinomial em `|S|` ou todos os números de entrada são polinomialmente limitados. O FPTAS só compensa quando os valores numéricos são genuinamente grandes, que é precisamente o regime onde a codificação binária da entrada torna o problema NP-completo em primeiro lugar.
- **A escolha de `ε/2n` é estrutural, não cosmética** — recortar diretamente com `ε` seria a implementação óbvia e estaria errada: `n` recortes de `ε` acumulados estouram muito além de um fator de `1 + ε`. Todo o argumento de corretude repousa em `(1 + ε/2n)^n ≤ 1 + ε`, que por sua vez precisa da precondição `0 < ε < 1` para se fechar.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4ª Edição, Capítulo 35 "Approximation Algorithms", Seção 35.5 "The subset-sum problem", pp. 1124-1130](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
