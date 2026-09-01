---
version: 1.0
updatedAt: 2026-08-13
title: "Distância de Edição: A PD de Levenshtein e Alinhamento de Sequências"
description: "Calcule o número mínimo de operações de inserção, remoção e substituição para transformar uma string em outra usando uma tabela de PD 2D que estende a técnica de preenchimento de tabela de LCS com uma terceira célula predecessora para substituição, depois faça o backtrack pela tabela para recuperar a sequência de edição real."
---
## Objetivo

Aprenda a solução padrão de programação dinâmica para a **distância de edição** (também chamada de distância de Levenshtein): o número mínimo de inserções, remoções e substituições de um único caractere necessárias para transformar uma string em outra. Este concept é uma generalização estrutural direta do concept irmão `longest-common-subsequence` (LCS) — mesmo formato de tabela 2D, mesma ordem de preenchimento de baixo para cima, mesma técnica de "traçar um caminho de trás para frente para recuperar a resposta real, não só seu tamanho" — mas com uma recorrência diferente, porque a distância de edição permite um terceiro movimento (substituição) que LCS não tem. Cormen, Leiserson, Rivest e Stein (CLRS) propõem a distância de edição como o Problema 14-5, mas a versão deles é mais elaborada do que o que normalmente se entende pelo termo: CLRS define *seis* operações (copiar, substituir, remover, inserir, trocar posição adjacente, matar), cada uma com seu próprio custo configurável, e deixa encontrar a transformação de custo mínimo como um exercício para o leitor. O que este concept cobre é a versão mais simples e universalmente usada — três operações (inserir, remover, substituir), cada uma custando 1 — a versão que corretores ortográficos, `diff`, `git diff` e praticamente todo curso de algoritmos e entrevista técnica querem dizer quando falam "distância de edição".

## Casos de Uso

- Corretores ortográficos e autocorreção sugerindo palavras substitutas — as palavras candidatas com a menor distância de edição em relação ao que você digitou são as correções mais prováveis.
- Busca fuzzy de strings / recursos de "você quis dizer" — quando uma busca por correspondência exata não retorna nada, mas uma correspondência com pequena distância de edição provavelmente é o que o usuário quis dizer.
- Comparação de sequências de DNA ou proteínas por *alinhamento* — inserir gaps em duas sequências e pontuar correspondências, discordâncias e gaps é uma técnica próxima parente da distância de edição, e o próprio Problema 14-5 de CLRS traça essa conexão diretamente.
- A família de algoritmos de diff usada por ferramentas de controle de versão e comparação de texto (`diff`, `git diff`) é intimamente relacionada: tanto a distância de edição quanto o diff em nível de linha resolvem "quantas mudanças, no mínimo, transformam A em B", só que em granularidades diferentes (caracteres vs. linhas).

## Aprofundamento

### O problema: transformar uma string em outra

Dadas duas strings X e Y, a **distância de edição** de X até Y é o número mínimo de operações de um único caractere necessárias para transformar X em Y, onde cada operação é uma destas:

- **Inserir** um caractere em X.
- **Remover** um caractere de X.
- **Substituir** um caractere de X por um caractere diferente.

Pegue o par clássico de livro-texto:

```
X = "kitten"
Y = "sitting"
```

A resposta conhecida é 3 operações. Verificando à mão: substitua `k` → `s` (`kitten` → `sitten`), substitua `e` → `i` (`sitten` → `sittin`), depois insira `g` no final (`sittin` → `sitting`). Três operações, e nenhuma sequência com menos de três funciona — `kitten` e `sitting` diferem em comprimento por 1 e compartilham apenas 4 caracteres em posições correspondentes uma vez alinhados, então pelo menos 3 edições são inevitáveis. A recorrência abaixo deriva essa mesma resposta mecanicamente, e os subtópicos seguintes rastreiam a sequência exata de operações de volta a partir da tabela preenchida.

Busca por força bruta sobre todas as possíveis sequências de operações é exponencial — exatamente o mesmo obstáculo que a força bruta de LCS enfrentava ao enumerar toda subsequência — o que é o que torna uma tabela de programação dinâmica 2D algo que vale a pena construir.

### A recorrência: estendendo a tabela de LCS com uma terceira opção

Defina `D(i, j)` como a distância de edição entre os primeiros `i` caracteres de X e os primeiros `j` caracteres de Y — o mesmo estilo de definição que o concept de LCS usou para `c[i][j]`, só que nomeando a grandeza distância em vez de tamanho. Os casos base tratam de uma das strings estar vazia:

- `D(i, 0) = i` — transformar os primeiros `i` caracteres de X na string vazia custa exatamente `i` remoções.
- `D(0, j) = j` — transformar a string vazia nos primeiros `j` caracteres de Y custa exatamente `j` inserções.

Para o caso geral, compare os últimos caracteres `X[i]` e `Y[j]`:

- **Eles coincidem** (`X[i] == Y[j]`) — nenhuma operação é necessária nesse par; a distância é o que já era para os dois prefixos mais curtos: `D(i, j) = D(i-1, j-1)`.
- **Eles diferem** — alguma operação tem que reconciliá-los, e existem exatamente três candidatas, cada uma custando 1 mais a melhor subsolução: remover `X[i]` (`D(i-1, j)`), inserir `Y[j]` (`D(i, j-1)`), ou substituir `X[i]` por `Y[j]` (`D(i-1, j-1)`). Pegue a mais barata: `D(i, j) = 1 + min(D(i-1, j), D(i, j-1), D(i-1, j-1))`.

Esse é o formato da recorrência de LCS com uma célula predecessora a mais. O caso de discordância de LCS só *estende* uma subsequência comum existente ou *pula* um caractere de um dos lados — duas células predecessoras, `c[i-1][j]` e `c[i][j-1]`. O caso de discordância da distância de edição também permite *substituir*, alcançando a predecessora diagonal `D(i-1, j-1)` diretamente, em vez de só através de uma correspondência — três células predecessoras em vez de duas. Essa é toda a diferença estrutural entre os dois problemas: mesma tabela, mesma ordem de preenchimento, uma seta adicional para cada célula.

```java
int[][] buildEditDistanceTable(String x, String y) {
    int m = x.length(), n = y.length();
    int[][] d = new int[m + 1][n + 1];

    for (int i = 0; i <= m; i++) d[i][0] = i; // remove todos os i caracteres de x
    for (int j = 0; j <= n; j++) d[0][j] = j; // insere todos os j caracteres de y

    for (int i = 1; i <= m; i++) {
        for (int j = 1; j <= n; j++) {
            if (x.charAt(i - 1) == y.charAt(j - 1)) {
                d[i][j] = d[i - 1][j - 1];
            } else {
                d[i][j] = 1 + Math.min(d[i - 1][j - 1],
                              Math.min(d[i - 1][j], d[i][j - 1]));
            }
        }
    }
    return d; // d[m][n] é a distância de edição
}
```

Cada célula ainda depende apenas da célula acima, da célula à esquerda e da célula diagonal acima-esquerda, então a ordem de preenchimento por linhas (linha superior primeiro, da esquerda para a direita dentro de cada linha) funciona exatamente como funcionava para LCS.

### A tabela preenchida e o backtrack até a sequência de edição real

Preenchendo `D` para `X = "kitten"` (linhas) contra `Y = "sitting"` (colunas):

| D[i][j] | ""  | s   | i   | t   | t   | i   | n   | g   |
|---------|-----|-----|-----|-----|-----|-----|-----|-----|
| **""**  | 0   | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| **k**   | 1   | 1   | 2   | 3   | 4   | 5   | 6   | 7   |
| **i**   | 2   | 2   | 1   | 2   | 3   | 4   | 5   | 6   |
| **t**   | 3   | 3   | 2   | 1   | 2   | 3   | 4   | 5   |
| **t**   | 4   | 4   | 3   | 2   | 1   | 2   | 3   | 4   |
| **e**   | 5   | 5   | 4   | 3   | 2   | 2   | 3   | 4   |
| **n**   | 6   | 6   | 5   | 4   | 3   | 3   | 2   | 3   |

`D[6][7] = 3` no canto inferior direito: a distância de edição é 3, batendo com a contagem à mão do primeiro subtópico. Recuperar as operações reais significa traçar um caminho de trás para frente, de `D[6][7]` até `D[0][0]`, perguntando a cada célula qual caso da recorrência produziu seu valor:

- Se `X[i] == Y[j]`, essa posição não precisou de operação — mova diagonalmente para `D[i-1][j-1]` sem registrar operação.
- Caso contrário, verifique de qual predecessora o valor atual veio: diagonal (`D[i-1][j-1]`) significa substituir, acima (`D[i-1][j]`) significa remover `X[i]`, esquerda (`D[i][j-1]`) significa inserir `Y[j]`. Mova para a predecessora que for igual a `D[i][j] - 1`.

Percorrendo passo a passo: comece em `D[6][7]=3` (`X[6]='n'`, `Y[7]='g'`) — discordância; predecessoras são `D[5][7]=4` (acima), `D[6][6]=2` (esquerda), `D[5][6]=3` (diagonal); a célula da esquerda é a que vale `3-1=2`, então **insira 'g'**, mova para a esquerda até `D[6][6]`. Ali, `X[6]='n'`, `Y[6]='n'` coincidem — sem operação, mova diagonalmente para `D[5][5]=2`. Ali, `X[5]='e'`, `Y[5]='i'` discordam; predecessoras `D[4][5]=2` (acima), `D[5][4]=2` (esquerda), `D[4][4]=1` (diagonal); a célula diagonal é `2-1=1`, então **substitua e → i**, mova diagonalmente para `D[4][4]=1`. Ali, `X[4]='t'`, `Y[4]='t'` coincidem — mova diagonalmente para `D[3][3]=1`. Ali, `X[3]='t'`, `Y[3]='t'` coincidem — mova diagonalmente para `D[2][2]=1`. Ali, `X[2]='i'`, `Y[2]='i'` coincidem — mova diagonalmente para `D[1][1]=1`. Ali, `X[1]='k'`, `Y[1]='s'` discordam; predecessoras `D[0][1]=1` (acima), `D[1][0]=1` (esquerda), `D[0][0]=0` (diagonal); a célula diagonal é `1-1=0`, então **substitua k → s**, mova diagonalmente para `D[0][0]=0`, o caso base — pare.

Lendo as operações registradas na ordem direta (o reverso do traço para trás): substituir `k`→`s`, coincidir `i`, coincidir `t`, coincidir `t`, substituir `e`→`i`, coincidir `n`, inserir `g` — exatamente a sequência de 3 operações verificada à mão anteriormente, agora derivada mecanicamente da tabela, em vez de apenas afirmada.

```java
List<String> reconstructOperations(String x, String y, int[][] d) {
    Deque<String> ops = new ArrayDeque<>();
    int i = x.length(), j = y.length();

    while (i > 0 || j > 0) {
        if (i > 0 && j > 0 && x.charAt(i - 1) == y.charAt(j - 1)) {
            ops.addFirst("match " + x.charAt(i - 1));
            i--; j--;
        } else if (i > 0 && j > 0 && d[i][j] == d[i - 1][j - 1] + 1) {
            ops.addFirst("substitute " + x.charAt(i - 1) + " -> " + y.charAt(j - 1));
            i--; j--;
        } else if (i > 0 && d[i][j] == d[i - 1][j] + 1) {
            ops.addFirst("delete " + x.charAt(i - 1));
            i--;
        } else {
            ops.addFirst("insert " + y.charAt(j - 1));
            j--;
        }
    }
    return new ArrayList<>(ops); // ["substitute k -> s", "match i", "match t", "match t", "substitute e -> i", "match n", "insert g"]
}
```

### Tempo de execução e a conexão com alinhamento de sequências

A tabela tem `(m + 1) * (n + 1)` células, e cada célula faz trabalho O(1) — uma comparação de caractere e um min entre no máximo três valores já conhecidos — então preencher a tabela custa O(mn), igual a LCS. O backtrack depois decrementa pelo menos um índice por passo, então essa passada é O(m + n). Total: O(mn) de tempo e espaço.

O próprio texto de CLRS enquadra a distância de edição como uma generalização do alinhamento de sequências de DNA: dadas duas sequências, insira gaps em cada uma delas até que fiquem com o mesmo tamanho, depois pontue cada posição (um bônus para caracteres que coincidem, uma penalidade para discordâncias, uma penalidade maior para um gap), e some as pontuações ao longo do alinhamento. Encontrar o alinhamento de melhor pontuação é resolvido com o mesmo estilo de tabela 2D da distância de edição, só que com uma função de pontuação em vez de um custo unitário por operação — um uso real, além da edição de texto, dessa técnica de preenchimento de tabela. No lado da edição de texto, esse é o algoritmo por trás de ferramentas práticas: corretores ortográficos ranqueando candidatos de correção pela distância de edição, e ferramentas estilo `diff` que, em nível de caractere ou linha, estão calculando (ou aproximando) exatamente esse problema de contagem mínima de operações.

## Trade-offs

- **O(mn) de tempo e espaço vs. força bruta exponencial** — a mesma troca de LCS: a tabela `D` completa custa Θ(mn) de memória, substancial para strings muito longas, mas transforma uma busca exponencial sobre sequências de operações em uma busca polinomial.
- **Tabela completa vs. economia de espaço só-tamanho** — se apenas o valor da distância for necessário, não a sequência de operações, a tabela colapsa para duas linhas, derrubando o espaço para O(min(m, n)); reconstruir as operações reais, como reconstruir a subsequência real de LCS, exige a tabela completa (ou uma abordagem de divisão e conquista estilo Hirschberg para manter o espaço baixo).
- **Levenshtein de custo unitário vs. distância de edição ponderada** — este concept assume que toda inserção, remoção e substituição custa exatamente 1, combinando com a definição padrão; algumas aplicações (ex: correção de erros de OCR, bioinformática) ponderam as operações de forma diferente, o que só muda os termos "+1" da recorrência para custos específicos por operação, não o formato da tabela.
- **Versão padrão de 3 operações vs. a generalização completa de 6 operações de CLRS** — o Problema 14-5 real de CLRS define seis operações (copiar, substituir, remover, inserir, trocar para transpor caracteres adjacentes, e matar para truncar o resto da origem), cada uma com seu próprio custo configurável, e propõe a transformação de custo mínimo como um exercício em aberto, não um exemplo resolvido. Essa versão mais completa é uma generalização real que vale a pena saber que existe, mas não é o que "distância de edição" significa na prática — a forma Levenshtein de 3 operações coberta aqui é o que corretores ortográficos, `diff`, e questões de entrevista realmente usam.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein, "Introduction to Algorithms", 4th Edition (MIT Press, 2022)](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — Chapter 14 "Dynamic Programming", Problem 14-5 "Edit distance", pp. 409-411 — book
- [NIST Dictionary of Algorithms and Data Structures — Levenshtein distance](https://xlinux.nist.gov/dads/HTML/Levenshtein.html) — doc
