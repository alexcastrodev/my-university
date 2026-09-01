---
version: 1.0
updatedAt: 2026-08-13
title: "Longest Common Subsequence: A Tabela de DP em 2D"
description: "Como derivar a recorrência c[i][j] do LCS comparando os últimos caracteres de duas sequências, preencher a tabela 2D resultante bottom-up em tempo O(mn), e percorrer um caminho de volta pela tabela pronta para reconstruir a subsequência de fato, não só seu tamanho."
---
## Objetivo

Aprenda a técnica específica de programação dinâmica com tabela 2D para o problema do longest common subsequence (LCS): como derivar a recorrência da tabela comparando os últimos caracteres de duas sequências, como preencher a tabela bottom-up, e como ler a tabela pronta para reconstruir a subsequência de fato — não só o seu tamanho. Isso assume que você já sabe o que é programação dinâmica em geral (subproblemas sobrepostos, memoização vs. tabulação); o foco aqui é essa forma clássica de tabela 2D e como percorrer um caminho de volta por ela.

## Casos de Uso

- Fazer diff entre dois arquivos ou duas versões de um documento — as linhas "inalteradas" que uma ferramenta de diff mostra são exatamente um LCS das sequências de linhas dos dois arquivos.
- Comparar duas sequências de DNA ou proteína para medir o quão parecidos são dois organismos, encontrando a sequência mais longa de bases que aparece, em ordem, nas duas cadeias.
- Responder perguntas de entrevista do tipo "qual é a distância de edição mínima / o maior compartilhamento de ordenação entre essas duas strings", onde a tabela 2D é a forma de solução esperada.

## Aprofundamento

### O problema: subsequência, não substring

Uma **subsequência** de uma sequência é essa mesma sequência com zero ou mais elementos removidos, sem perturbar a ordem relativa do que resta — os elementos mantidos não precisam ser contíguos. Isso é diferente de uma **substring**, que precisa ser um trecho contíguo. Por exemplo, `"ACE"` é subsequência de `"ABCDE"` (remova B e D), mas não é substring dela, porque A, C e E não são adjacentes na sequência original.

Dadas duas sequências X e Y, uma **subsequência comum** é uma sequência que é subsequência de ambas. O problema do **longest common subsequence (LCS)** pede a maior sequência desse tipo. Tome um par pequeno e concreto:

```
X = "ABCBDAB"
Y = "BDCABA"
```

`"BCBA"` é subsequência de ambas (remova A e D de X; remova D e C de Y — confira que a ordem bate), e acontece de ser um LCS de comprimento 4; não existe nenhuma subsequência comum de comprimento 5 para esse par.

Força bruta enumeraria toda subsequência de X (existem 2^m delas, uma por subconjunto dos índices de X) e testaria cada uma contra Y — tempo exponencial, inviável assim que as sequências passam de algumas dezenas de caracteres.

### A recorrência: comparando os últimos caracteres

A saída é perceber que um LCS de X e Y é construído a partir de um LCS de um *prefixo* de X e um *prefixo* de Y — o problema tem subestrutura ótima. Defina `c[i][j]` como o comprimento de um LCS dos primeiros `i` caracteres de X e dos primeiros `j` caracteres de Y. Raciocinar sobre os *últimos* caracteres `x_i` e `y_j` dá exatamente três casos:

1. **Caso base** — se `i == 0` ou `j == 0`, um dos prefixos está vazio, então `c[i][j] = 0`.
2. **Os últimos caracteres coincidem** (`x_i == y_j`) — esse caractere compartilhado precisa pertencer ao LCS (adicioná-lo a um LCS dos dois prefixos mais curtos não pode ser superado), então `c[i][j] = c[i-1][j-1] + 1`.
3. **Os últimos caracteres diferem** (`x_i != y_j`) — o LCS descarta `x_i` ou descarta `y_j` (não pode precisar de ambos, já que não coincidem), então pegue o melhor dos dois: `c[i][j] = max(c[i-1][j], c[i][j-1])`.

Cada célula depende apenas da célula na diagonal acima-à-esquerda, da célula diretamente acima e da célula diretamente à esquerda — todas já computadas se a tabela for preenchida em ordem row-major (linha do topo primeiro, da esquerda para a direita dentro de cada linha). Essa forma de dependência é o que torna possível uma tabela bottom-up, em vez de uma árvore exponencial de chamadas recursivas:

```java
int[][] buildLcsTable(String x, String y) {
    int m = x.length(), n = y.length();
    int[][] c = new int[m + 1][n + 1]; // c[0][*] e c[*][0] permanecem 0 (caso base)

    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (x.charAt(i - 1) == y.charAt(j - 1)) {
                c[i][j] = c[i - 1][j - 1] + 1;
            } else {
                c[i][j] = Math.max(c[i - 1][j], c[i][j - 1]);
            }
        }
    }
    return c; // c[m][n] é o comprimento do LCS
}
```

### A tabela preenchida e a reconstrução da subsequência de fato

Preenchendo `c` para `X = "ABCBDAB"` (linhas) contra `Y = "BDCABA"` (colunas), obtém-se:

| c[i][j] | ""  | B   | D   | C   | A   | B   | A   |
|---------|-----|-----|-----|-----|-----|-----|-----|
| **""**  | 0   | 0   | 0   | 0   | 0   | 0   | 0   |
| **A**   | 0   | 0   | 0   | 0   | 1   | 1   | 1   |
| **B**   | 0   | 1   | 1   | 1   | 1   | 2   | 2   |
| **C**   | 0   | 1   | 1   | 2   | 2   | 2   | 2   |
| **B**   | 0   | 1   | 1   | 2   | 2   | 3   | 3   |
| **D**   | 0   | 1   | 2   | 2   | 2   | 3   | 3   |
| **A**   | 0   | 1   | 2   | 2   | 3   | 3   | 4   |
| **B**   | 0   | 1   | 2   | 2   | 3   | 4   | 4   |

`c[7][6] = 4` no canto inferior direito: o LCS tem comprimento 4. Só o comprimento está visível até aqui — recuperar os caracteres reais significa percorrer um caminho de volta de `c[7][6]` até `c[0][0]`, perguntando em cada célula qual caso da recorrência produziu seu valor:

- Se `x_i == y_j` naquela célula, esse caractere pertence ao LCS — registre-o, depois mova-se na diagonal para `c[i-1][j-1]`.
- Caso contrário, mova-se em direção a qualquer um entre `c[i-1][j]` (acima) ou `c[i][j-1]` (esquerda) que seja igual ao valor da célula atual (em caso de empate, qualquer direção dá um LCS válido; escolher "acima" corresponde ao pseudocódigo clássico).

Percorrendo isso nessa tabela: comece em `c[7][6]=4` (linha B, coluna A) — `x_7='B'`, `y_6='A'` não coincidem, `c[6][6]=4 >= c[7][5]=4`, então mova para cima até `c[6][6]`. Ali, `x_6='A'`, `y_6='A'` coincidem — registre **A**, mova na diagonal para `c[5][5]=3`. Ali, `x_5='D'`, `y_5='B'` não coincidem, `c[4][5]=3 >= c[5][4]=2`, mova para cima até `c[4][5]`. Ali, `x_4='B'`, `y_5='B'` coincidem — registre **B**, mova na diagonal para `c[3][4]=2`. Ali, `x_3='C'`, `y_4='A'` não coincidem, `c[2][4]=1 < c[3][3]=2`, mova para a esquerda até `c[3][3]`. Ali, `x_3='C'`, `y_3='C'` coincidem — registre **C**, mova na diagonal para `c[2][2]=1`. Ali, `x_2='B'`, `y_2='D'` não coincidem, `c[1][2]=0 < c[2][1]=1`, mova para a esquerda até `c[2][1]`. Ali, `x_2='B'`, `y_1='B'` coincidem — registre **B**, mova na diagonal para `c[1][0]=0`, que atinge o caso base e para.

Os caracteres foram registrados em ordem reversa **A, B, C, B**; invertendo, obtém-se o próprio LCS: **`"BCBA"`** — o mesmo comprimento 4 que `c[7][6]` reportou, mas agora como uma string de fato, não apenas um número.

```java
String reconstructLcs(String x, String y, int[][] c) {
    StringBuilder sb = new StringBuilder();
    int i = x.length(), j = y.length();
    while (i > 0 && j > 0) {
        if (x.charAt(i - 1) == y.charAt(j - 1)) {
            sb.append(x.charAt(i - 1));
            i--; j--;
        } else if (c[i - 1][j] >= c[i][j - 1]) {
            i--;
        } else {
            j--;
        }
    }
    return sb.reverse().toString(); // "BCBA"
}
```

### Tempo de execução: O(mn) em vez de exponencial

A tabela tem `(m + 1) * (n + 1)` células, e cada célula faz trabalho O(1) (uma comparação de caracteres e no máximo uma soma ou max de dois valores já conhecidos), então preencher a tabela inteira custa O(mn). Reconstruir a subsequência depois disso percorre `c[m][n]` até algum `c[i][0]` ou `c[0][j]`, decrementando ao menos um índice por passo, então essa passada é O(m + n). Total: O(mn) — uma melhora dramática sobre a enumeração O(2^m) de toda subsequência de X da abordagem de força bruta, e bem dentro do que é prático para sequências com milhares de caracteres (cadeias de DNA, arquivos-fonte, revisões de documentos), onde a força bruta exponencial nunca terminaria.

## Trade-offs

- **Tempo e espaço O(mn) vs. força bruta exponencial** — a tabela `c` completa custa memória Θ(mn), o que é significativo para sequências muito longas (por exemplo, duas cadeias de DNA de 100.000 caracteres são 10 bilhões de células), mas é o preço de transformar um problema exponencial em um polinomial.
- **Tabela completa vs. economia de espaço só-comprimento** — se você só precisa do *comprimento* do LCS, não da subsequência real, a tabela pode ser reduzida a duas linhas (atual e anterior), derrubando o espaço para O(min(m, n)); mas essa representação menor não retém histórico suficiente para retraçar quais células produziram quais valores, então reconstruir a subsequência real ainda exige a tabela completa O(mn) (ou uma técnica mais avançada, como o algoritmo de divide-and-conquer de Hirschberg, que reconstrói em tempo O(mn) mas apenas O(m + n) de espaço).
- **A ordem de preenchimento row-major é uma escolha válida, não a única** — qualquer ordem que preencha `c[i-1][j-1]`, `c[i-1][j]` e `c[i][j-1]` antes de `c[i][j]` funciona (por exemplo, preencher por antidiagonais é comum ao paralelizar); row-major é simplesmente a mais simples de implementar e raciocinar.

## Documentation Links

- Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4ª Edição (MIT Press, 2022) — Capítulo 14 "Dynamic Programming", Seção 14.4 "Longest common subsequence", pp. 393-399 — book
- [GNU diffutils manual — How diff Works](https://www.gnu.org/software/diffutils/manual/html_node/Comparison-Style.html) — doc
