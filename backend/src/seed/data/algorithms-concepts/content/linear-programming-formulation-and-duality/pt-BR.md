---
version: 1.0
updatedAt: 2026-08-18
title: "Programação Linear: Formulando Problemas e Duality"
description: "Como modelar um problema como um programa linear em forma padrão — caminhos mínimos, max-flow, fluxo de custo mínimo e fluxo multicommodity — por que uma solução ótima sempre fica num vértice da região viável, e como duality transforma um LP de maximização num LP de minimização cujo valor objetivo casado certifica otimalidade."
---
## Objetivo

Aprenda a habilidade de modelagem que Cormen et al. chamam de "talvez o aspecto mais importante da programação linear": reconhecer quando um problema pode ser escrito como um **programa linear** — maximizar ou minimizar um objetivo linear sujeito a um conjunto finito de restrições lineares — e depois escrevê-lo em forma padrão. Depois aprenda **duality**: a receita mecânica que transforma um LP de maximização num LP de minimização com o mesmo valor ótimo, e por que isso te dá um *certificado* de que uma solução é ótima em vez de apenas a melhor que seu solver encontrou. Este conceito deliberadamente para onde a própria 4ª edição para: ele **não** ensina o algoritmo simplex. O prefácio do livro diz que ele removeu a apresentação detalhada do simplex "por ser matematicamente pesada sem realmente transmitir muitas ideias algorítmicas", e a Seção 29.1 afirma diretamente que os algoritmos de LP conhecidos "são todos complicados demais para mostrar aqui". O que você tem em vez disso — e o que este conceito cobre — é formulação, a intuição geométrica de por que um ótimo fica num vértice, e a teoria de duality.

## Casos de Uso

- Transformar um problema de alocação de recursos que não tem algoritmo de livro-texto — uma companhia aérea escalando tripulações de voo sob limites de horas da FAA, uma petrolífera escolhendo locais de perfuração sob um orçamento fixo — num LP e entregá-lo a um solver pronto. O enquadramento da fonte é direto: uma vez que você formula um problema como um programa linear de tamanho polinomial, você pode resolvê-lo em tempo polinomial, e vários pacotes de software de LP farão isso por você.
- Modelar *variantes* de problemas de grafo que você já sabe resolver, onde a variante quebra o algoritmo especializado. Adicionar um custo por aresta e uma demanda de fluxo fixa ao max-flow dá fluxo de custo mínimo; dividir o fluxo em várias commodities compartilhando uma rede dá fluxo multicommodity — para o qual, a fonte observa, o único algoritmo conhecido em tempo polinomial é "expresse como um LP e resolva o LP".
- Provar que uma solução é ótima exibindo uma solução dual com o mesmo valor objetivo — o mesmo movimento de exibir um corte cuja capacidade iguala o valor de um fluxo no conceito irmão Max-Flow Min-Cut, que o CLRS apresenta explicitamente como o exemplo motivador de duality.
- Saber quando o enquadramento em LP *para* de ajudar: adicionar "e todas as variáveis precisam ser inteiras" transforma isso num **programa linear inteiro**, e só encontrar uma solução viável para isso já é NP-hard (Exercício 34.5-3), o que se conecta diretamente ao conceito irmão P vs. NP e reducibilidade.

## Aprofundamento

### Forma padrão: o que um programa linear realmente é

Dados coeficientes reais `a_1 … a_n` e variáveis `x_1 … x_n`, uma **função linear** é `f(x_1, …, x_n) = a_1·x_1 + a_2·x_2 + … + a_n·x_n`. Igualar uma função linear a um número real `b` dá uma **igualdade linear**; exigir que seja `<= b` ou `>= b` dá uma **desigualdade linear**; ambas são **restrições lineares**. Desigualdades estritas (`<`, `>`) não são permitidas. Um problema de programação linear é então: minimizar ou maximizar uma função linear sujeita a um conjunto finito de restrições lineares.

Por convenção, um LP de maximização é escrito em **forma padrão**: encontre `x_1 … x_n` que

- **maximizam** `soma sobre j de c_j·x_j`  (a **função objetivo**)
- **sujeita a** `soma sobre j de a_ij·x_j <= b_i` para `i = 1 … m`
- e `x_j >= 0` para `j = 1 … n`  (as **restrições de não negatividade**)

ou compactamente, com uma matriz `m × n` `A = (a_ij)`, um vetor `m`-dimensional `b`, e vetores `n`-dimensionais `c` e `x`: **maximize `cᵀx` sujeito a `Ax <= b`, `x >= 0`**. Esse é o formato de entrada inteiro, e é pequeno o suficiente para modelar diretamente:

```java
// Forma padrão (CLRS 29.14-29.16): maximize c'x sujeito a Ax <= b, x >= 0.
// a é m x n, b tem comprimento m, c tem comprimento n.
record StandardFormLp(double[][] a, double[] b, double[] c) {

    /** O valor objetivo de uma configuração particular das variáveis (o CLRS escreve x-barra). */
    double objectiveValue(double[] x) {
        double total = 0;
        for (int j = 0; j < c.length; j++) total += c[j] * x[j];
        return total;
    }

    /** Viável = satisfaz toda restrição, incluindo não negatividade. Caso contrário, inviável. */
    boolean isFeasible(double[] x) {
        for (double xj : x) {
            if (xj < 0) return false;                       // restrições de não negatividade
        }
        for (int i = 0; i < b.length; i++) {
            double lhs = 0;
            for (int j = 0; j < c.length; j++) lhs += a[i][j] * x[j];
            if (lhs > b[i]) return false;                   // restrição i violada
        }
        return true;
    }
}
```

O vocabulário que acompanha isso, todo da Seção 29.1:

- Uma configuração das variáveis que satisfaz toda restrição é uma **solução viável**; uma que viola pelo menos uma restrição é **inviável**.
- O conjunto de todos os pontos satisfazendo todas as restrições é a **região viável**.
- Uma solução viável cujo valor objetivo é máximo sobre todas as soluções viáveis é uma **solução ótima**, e esse valor é o **valor objetivo ótimo**.
- Um LP sem nenhuma solução viável é **inviável**; um com soluções viáveis mas sem valor objetivo ótimo finito é **ilimitado** (unbounded — e sua região viável também é). A recíproca não vale: o Exercício 29.1-5 pede para você construir um LP cuja região viável é ilimitada mas cujo valor objetivo ótimo é finito.

Forma padrão é uma convenção, não uma restrição. Problemas reais chegam com restrições de igualdade, restrições `>=`, variáveis autorizadas a ficar negativas, ou um objetivo de minimização; a fonte deixa as conversões como exercícios em vez de trabalhá-las (29.1-6: transforme uma igualdade num par de desigualdades, e transforme uma desigualdade `<=` numa igualdade introduzindo uma variável de folga não negativa `s`; 29.1-7: transforme uma minimização numa maximização equivalente).

### Por que o ótimo fica num vértice — a imagem de duas variáveis

Esta é a única ilustração algorítmica resolvida que a Seção 29.1 dá, e é explicitamente rotulada como intuição em vez de algoritmo: "Embora este exemplo não generalize imediatamente para um algoritmo eficiente para problemas maiores, ele introduz alguns conceitos importantes."

O LP de exemplo (29.17-29.21):

| | |
|---|---|
| maximize | `x_1 + x_2` |
| sujeito a | `4·x_1 - x_2 <= 8` |
| | `2·x_1 + x_2 <= 10` |
| | `5·x_1 - 2·x_2 >= -2` |
| | `x_1, x_2 >= 0` |

Cada restrição é um semiplano; sua interseção é a região viável, que é **convexa** (para quaisquer dois pontos nela, o segmento inteiro entre eles também está nela). Ela contém infinitos pontos, então "avalie o objetivo em todo ponto viável" não é um começo — você precisa de um jeito de encontrar o máximo sem enumerar.

Em duas dimensões você pode fazer isso graficamente. O conjunto de pontos onde `x_1 + x_2 = z` é uma reta de inclinação `-1`; `z = 0` é essa reta passando pela origem, e aumentar `z` desliza a reta para fora. A interseção da reta com a região viável é exatamente o conjunto de soluções viáveis de valor objetivo `z`, então a resposta é o maior `z` cuja reta ainda toca a região. A Figura 29.2(b) do CLRS desenha `z = 0`, `z = 4` e `z = 8`, e a última toca a região num único ponto: **`x_1 = 2`, `x_2 = 6`, valor objetivo `8`** — um *vértice* da região viável. (Verificação: `4·2 - 6 = 2 <= 8`; `2·2 + 6 = 10`, justa; `5·2 - 2·6 = -2`, justa — o ótimo é onde as restrições 29.19 e 29.20 se encontram.)

O ótimo cair num vértice não é sorte. O maior `z` cuja reta encontra a região precisa encontrá-la na *fronteira*, e essa interseção é ou um único vértice (uma solução ótima) ou um segmento de reta (caso em que todo ponto do segmento empata, incluindo os dois extremos — que são vértices). De qualquer forma há uma solução ótima num vértice.

A mesma intuição sobe: com três variáveis cada restrição é um semiespaço, o conjunto de nível do objetivo é um plano, e empurrar esse plano para longe da origem ao longo da normal do objetivo encontra valores objetivo crescentes. Com `n` variáveis cada restrição é um semiespaço em espaço `n`-dimensional, a região viável formada pela interseção delas é chamada de **simplex**, o conjunto de nível do objetivo é um hiperplano, e por convexidade uma solução ótima ainda ocorre num vértice.

Esse fato do vértice é toda a ideia algorítmica que o capítulo transmite sobre o **simplex**: ele começa em algum vértice do simplex e itera, cada iteração se movendo ao longo de uma aresta para um vértice vizinho cujo valor objetivo não é menor (geralmente maior), parando num máximo local — um vértice cujos vizinhos são todos piores. Como a região é convexa e o objetivo é linear, esse ótimo local é um ótimo global. **Isso é todo o mecanismo que a fonte dá.** Não há regra de pivoteamento, nem tableau, nem pseudocódigo `SIMPLEX`, e nenhuma sequência de pivôs resolvida nesta edição — o capítulo adia a *prova* de que o vértice retornado é ótimo para duality na Seção 29.3, e adia os algoritmos em si para as notas do capítulo.

O que a fonte afirma sobre o panorama de algoritmos:

- O **simplex** é o método mais comumente implantado e frequentemente resolve LPs gerais rapidamente na prática, mas em entradas cuidadosamente construídas pode exigir tempo exponencial (as notas do capítulo creditam a Klee e Minty uma instância forçando `2^n - 1` iterações).
- Os **algoritmos de elipsoide** foram o primeiro método em tempo polinomial para LP (Khachian, 1979) mas rodam devagar na prática.
- Os **métodos de ponto interior** também são em tempo polinomial. Onde o simplex caminha pelo *exterior* da região viável, mantendo um vértice a cada iteração, os métodos de ponto interior se movem pelo *interior* — soluções intermediárias são viáveis mas não vértices, embora a solução final seja um vértice. Em entradas grandes eles podem igualar ou superar o simplex.
- Qualquer algoritmo de LP também precisa detectar os LPs sem solução e os LPs sem solução ótima finita.
- **LP geral é resolvível em tempo polinomial. LP inteiro não se sabe que é** — o Exercício 34.5-3 mostra que apenas encontrar uma solução viável para um programa linear inteiro é NP-hard.

### Formulando problemas como programas lineares

A Seção 29.2 é o coração do capítulo, e é tudo modelagem. Note a mudança de notação: LPs usam variáveis com subscrito em vez da notação de atributo da Parte VI, então a estimativa de caminho mínimo para o vértice `v` é `d_v` (não `v.d`) e o fluxo de `u` para `v` é `f_uv` (não `(u,v).f`), enquanto as entradas mantêm seus nomes usuais `w(u,v)` e `c(u,v)`.

**Caminho mínimo entre um par único.** Dado um grafo direcionado ponderado, source `s` e destino `t`, a desigualdade triangular dá `d_v <= d_u + w(u,v)` para toda aresta `(u,v)`, e a fonte começa com `d_s = 0`:

- **maximize** `d_t`
- **sujeito a** `d_v <= d_u + w(u,v)` para toda aresta `(u,v)` em `E`
- `d_s = 0`

A surpresa é o *maximize*. Minimizar estaria errado: com pesos de aresta não negativos, definir todo `d_v = 0` satisfaz toda restrição e seria "ótimo" sem resolver nada. A solução de caminho mínimo define cada `d_v` como o mínimo de `d_u + w(u,v)` sobre as arestas de entrada, ou seja, `d_v` é o *maior* valor que ainda é `<=` todos esses limites — então empurrar as estimativas para cima o tanto que as restrições permitirem é exatamente certo, e maximizar `d_t` consegue isso. O LP tem `|V|` variáveis e `|E| + 1` restrições. (Estender isso para caminhos mínimos de fonte única para todo `v` é o Exercício 29.2-2.)

Gerar essas restrições a partir de um grafo é mecânico, o que é o ponto — modelar é o trabalho, resolver é uma chamada de biblioteca:

```java
// Constrói a lista de restrições para o LP de caminho mínimo entre um par único (CLRS 29.22-29.24).
// Uma desigualdade d_v - d_u <= w(u,v) por aresta, mais d_s = 0; o objetivo é "maximize d_t".
// As linhas são indexadas pelo id do vértice, uma variável d_v por vértice.
List<double[]> shortestPathConstraintRows(List<Edge> edges, int vertexCount) {
    List<double[]> rows = new ArrayList<>();
    for (Edge e : edges) {
        double[] row = new double[vertexCount + 1]; // a última célula guarda o lado direito b_i
        row[e.to()]   = 1;                          //  d_v
        row[e.from()] = -1;                          // -d_u
        row[vertexCount] = e.weight();               // <= w(u,v)
        rows.add(row);
    }
    return rows; // d_s = 0 é adicionada separadamente como uma restrição de igualdade
}
```

**Fluxo máximo.** A restrição de capacidade e a conservação de fluxo já são lineares, e o valor de um fluxo é uma função linear, então max-flow se transcreve diretamente (assumindo `c(u,v) = 0` para não arestas e sem arestas antiparalelas):

- **maximize** `soma sobre v de f_sv  -  soma sobre v de f_vs`  (fluxo saindo do source menos fluxo entrando nele)
- **sujeito a** `f_uv <= c(u,v)` para todo `u, v` em `V`
- `soma sobre v de f_vu = soma sobre v de f_uv` para todo `u` em `V - {s, t}`  (conservação)
- `f_uv >= 0` para todo `u, v` em `V`

Como está escrito, isso tem `|V|²` variáveis e `2|V|² + |V| - 2` restrições, porque carrega uma variável para todo *par* de vértices, aresta ou não. A fonte sinaliza que LPs menores resolvem mais rápido e deixa a reescrita com `O(V + E)` restrições como Exercício 29.2-4 — um lembrete útil de que uma formulação correta e uma formulação eficiente são conquistas diferentes. O conceito irmão Max-Flow Min-Cut cobre Ford-Fulkerson, e o CLRS é explícito que um algoritmo feito sob medida como o de Dijkstra ou Ford-Fulkerson frequentemente supera LP nesses problemas, tanto na teoria quanto na prática.

**Fluxo de custo mínimo.** É aqui que LP ganha seu lugar. Adicione um custo `a(u,v)` por aresta e uma demanda de fluxo `d`: envie exatamente `d` unidades de `s` para `t` minimizando o custo total `soma sobre arestas de a(u,v)·f_uv`. O LP é o de max-flow com o objetivo substituído e uma restrição adicionada:

- **minimize** `soma sobre (u,v) em E de a(u,v)·f_uv`
- **sujeito a** as mesmas restrições de capacidade e conservação, mais `soma sobre v de f_sv - soma sobre v de f_vs = d`, e `f_uv >= 0`

A Figura 29.3 do CLRS resolve uma pequena instância que envia 4 unidades de `s` para `t` a um custo total mínimo de `(2·2) + (5·2) + (3·1) + (7·1) + (1·3) = 27`. (Os rótulos de capacidade e custo por aresta da figura estão bagunçados demais neste extrato para reproduzir fielmente, então só os totais são citados aqui.) Algoritmos em tempo polinomial específicos para fluxo de custo mínimo existem mas estão fora do escopo do livro; a formulação LP é a ferramenta que ele te entrega.

**Fluxo multicommodity.** `k` commodities `K_i = (s_i, t_i, d_i)` compartilham uma rede capacitada única; `f_i,uv` é o fluxo da commodity `i` em `(u,v)` e o **fluxo agregado** `f_uv` é a soma sobre commodities, que é o que a capacidade se aplica. Não há objetivo nenhum — a pergunta é só se tal fluxo existe — então o LP tem um objetivo "nulo", literalmente **minimize `0`**, sujeito a capacidade agregada, conservação por commodity, demanda por commodity e não negatividade. **O único algoritmo em tempo polinomial conhecido para esse problema é expressá-lo como um programa linear e resolvê-lo com um algoritmo de LP em tempo polinomial.** Essa única frase é o argumento mais forte que o capítulo faz para aprender a formular.

O capítulo também aponta para aparições de LP em outros lugares do livro: sistemas de restrições de diferença (Seção 22.4) são um caso especial de LP já visto, e a Seção 35.4 usa programação linear como ferramenta para encontrar uma solução aproximada para um problema de grafo — a técnica que conecta LP ao conceito irmão Algoritmos de Aproximação. (Este extrato só nomeia essa conexão; não a desenvolve.)

### Duality: o menor limite superior sobre o primal

Dado um problema de maximização, duality te dá um problema de minimização relacionado com o mesmo valor objetivo ótimo. O LP original é chamado **primal**; o derivado é o **dual**.

A construção é mecânica. A partir do primal `maximize soma_j c_j·x_j sujeito a soma_j a_ij·x_j <= b_i, x_j >= 0`:

- **minimize** `soma sobre i de b_i·y_i`
- **sujeito a** `soma sobre i de a_ij·y_i >= c_j` para `j = 1 … n`
- `y_i >= 0` para `i = 1 … m`

Em palavras: mude maximize para minimize, troque os papéis dos coeficientes objetivo e os lados direitos, e substitua todo `<=` por `>=`. Cada uma das `m` restrições primais vira uma variável dual `y_i`; cada uma das `n` restrições duais corresponde a uma variável primal `x_j`. Lendo os índices, a matriz de restrição fica transposta — `a_ij` é somado sobre `j` no primal e sobre `i` no dual:

```java
// O dual de um LP de maximização em forma padrão (CLRS 29.31-29.36):
// primal  max c'x  s.t. Ax <= b, x >= 0
// dual    min b'y  s.t. A'y >= c, y >= 0
record DualLp(double[][] aTransposed, double[] c, double[] b) { }   // min b'y s.t. A'y >= c, y >= 0

DualLp dualOf(StandardFormLp p) {
    int m = p.b().length, n = p.c().length;
    double[][] at = new double[n][m];
    for (int i = 0; i < m; i++)
        for (int j = 0; j < n; j++)
            at[j][i] = p.a()[i][j];                 // transpõe
    return new DualLp(at, p.c(), p.b());            // c vira o RHS, b vira o objetivo
}
```

O par resolvido da fonte (29.37-29.46). Primal:

| | |
|---|---|
| maximize | `3·x_1 + x_2 + 4·x_3` |
| sujeito a | `x_1 + x_2 + 3·x_3 <= 30` |
| | `2·x_1 + 2·x_2 + 5·x_3 <= 24` |
| | `4·x_1 + x_2 + 2·x_3 <= 36` |
| | `x_1, x_2, x_3 >= 0` |

Seu dual:

| | |
|---|---|
| minimize | `30·y_1 + 24·y_2 + 36·y_3` |
| sujeito a | `y_1 + 2·y_2 + 4·y_3 >= 3` |
| | `y_1 + 2·y_2 + y_3 >= 1` |
| | `3·y_1 + 5·y_2 + 2·y_3 >= 4` |
| | `y_1, y_2, y_3 >= 0` |

**Por que esses números significam algo.** Toda restrição primal é um limite superior sobre uma combinação das variáveis, e somar múltiplos não negativos de restrições produz outra restrição válida. Some as duas primeiras restrições primais: `3·x_1 + 3·x_2 + 8·x_3 <= 54`. Compare isso com o objetivo `3·x_1 + x_2 + 4·x_3`: todo coeficiente à esquerda é pelo menos o coeficiente objetivo correspondente, e as variáveis são não negativas, então

`3·x_1 + x_2 + 4·x_3  <=  3·x_1 + 3·x_2 + 8·x_3  <=  54`

— o valor ótimo do primal é no máximo 54, provado combinando duas restrições. Generalize: para quaisquer multiplicadores não negativos `y_1, y_2, y_3`, combinar as restrições dá `(y_1 + 2·y_2 + 4·y_3)·x_1 + (y_1 + 2·y_2 + y_3)·x_2 + (3·y_1 + 5·y_2 + 2·y_3)·x_3 <= 30·y_1 + 24·y_2 + 36·y_3`. Sempre que o coeficiente de cada `x_j` à esquerda é pelo menos seu coeficiente objetivo — que é precisamente as três restrições do dual — o lado direito é um limite superior válido sobre o ótimo primal. Os multiplicadores precisam ser não negativos ou você não conseguiria combinar as desigualdades de forma alguma, o que é de onde vem `y >= 0`. E você quer o limite mais *justo* possível, então você minimiza `30·y_1 + 24·y_2 + 36·y_3`. **O dual é exatamente o problema de encontrar o menor limite superior provável sobre o primal.**

**Weak duality (Lema 29.1).** Para qualquer primal viável `x̄` e qualquer dual viável `ȳ`: `soma_j c_j·x̄_j <= soma_i b_i·ȳ_i`. A prova são duas substituições: substitua cada `c_j` pelo maior `soma_i a_ij·ȳ_i` (viabilidade dual), troque a ordem da soma, depois substitua `soma_j a_ij·x̄_j` pelo maior `b_i` (viabilidade primal).

**O certificado (Corolário 29.2).** Se uma solução primal viável e uma solução dual viável acontecem de ter valores objetivo *iguais*, ambas são ótimas. Weak duality limita todo valor primal por todo valor dual, então uma vez que eles se encontram, nenhum pode melhorar. Esse é o retorno prático: você não precisa confiar na busca do solver, você precisa de um par que bata.

**Strong duality (Teorema 29.4).** Se o primal e seu dual são ambos viáveis e limitados, então para soluções ótimas `x*` e `y*`, `cᵀx* = bᵀy*`. A prova nesta seção roda por contradição: seja `δ` o valor ótimo do dual, forme um *primal aumentado* que adiciona a restrição `cᵀx >= δ` (reescrita como `-cᵀx <= -δ` para que o sistema inteiro fique `<=`), e observe que qualquer solução viável para esse sistema aumentado finalizaria o teorema via weak duality. Para mostrar que o sistema aumentado é viável, assuma que não é e aplique o **lema de Farkas (Lema 29.3)** — dados `M` e `g`, exatamente um de "existe `v` com `M·v <= g`" ou "existe `w >= 0` com `wᵀM = 0` e `wᵀg < 0`" é verdadeiro. A inviabilidade força a segunda alternativa, cujo `w` se divide num vetor com formato dual e um escalar; os dois casos (escalar zero, escalar positivo) constroem cada um uma *solução dual viável com valor objetivo estritamente abaixo de `δ`*, contradizendo `δ` ser ótimo. O capítulo deixa a prova do próprio lema de Farkas para o Problema 29-4.

**O teorema fundamental (Teorema 29.5).** Todo LP em forma padrão ou tem uma solução ótima com valor objetivo finito, ou é inviável, ou é ilimitado — não há quarto desfecho. (Sua prova é o Exercício 29.3-8.)

**Você já viu duality antes.** O CLRS introduz a seção inteira apontando para o teorema max-flow min-cut (Teorema 24.6): dado um fluxo `f`, exibir um corte de capacidade `|f|` prova que `f` é máximo. Esse é exatamente o formato de duality — um problema de maximização emparelhado com um problema de minimização cujos ótimos coincidem. Os exercícios tornam a correspondência literal: o Exercício 29.3-3 pede para você escrever o dual do LP de max-flow e interpretá-lo como o problema de corte mínimo, e o Exercício 29.3-6 pergunta qual resultado do Capítulo 24 *é* weak duality para max-flow. O conceito irmão Max-Flow Min-Cut cobre esse teorema e sua prova construtiva em detalhe; este conceito é a teoria geral da qual ele acaba sendo uma instância.

Duality também tem uma fronteira que vale conhecer: o Problema 29-3 pede para você mostrar que weak duality ainda vale para programas lineares *inteiros*, mas strong duality **não** — os ótimos inteiros primal e dual podem ficar de cada lado do ótimo LP comum, `IP <= P = D <= ID`. Essa lacuna entre um programa inteiro e seu relaxamento LP é a costura onde algoritmos de aproximação baseados em LP trabalham.

## Trade-offs

- **Um algoritmo feito sob medida geralmente supera a formulação LP em problemas que têm um.** O CLRS diz isso diretamente: um algoritmo projetado para um problema específico, como o de Dijkstra para caminhos mínimos de fonte única, "frequentemente será mais eficiente que programação linear, tanto na teoria quanto na prática". O verdadeiro valor de LP está em problemas *sem* algoritmo especializado conhecido (o cenário de orçamento do político no capítulo, fluxo de custo mínimo, fluxo multicommodity), e em variantes onde uma pequena mudança no problema quebra o algoritmo especializado mas custa uma linha no LP.
- **Uma formulação correta e uma formulação eficiente são coisas diferentes.** O LP de max-flow como escrito carrega `|V|²` variáveis e `2|V|² + |V| - 2` restrições porque aloca uma variável por *par* de vértices; o Exercício 29.2-4 pede a versão com `O(V + E)` restrições. Como o tempo de resolução depende do tamanho do LP, "é de tamanho polinomial" é a barra para tratabilidade, não a barra para um bom modelo.
- **Adicionar integralidade destrói a garantia.** LP geral é resolvível em tempo polinomial, mas exigir que as variáveis sejam inteiras torna até *encontrar uma solução viável* NP-hard (Exercício 34.5-3), então não há algoritmo em tempo polinomial conhecido para programação linear inteira. Se seu modelo precisa de "atribua tripulações inteiras" ou "ou perfure aqui ou não perfure", você não está mais no mundo tratável — veja o conceito irmão P vs. NP e reducibilidade para o que fazer a seguir.
- **Tempo polinomial e rápido não são a mesma afirmação aqui.** Os algoritmos em tempo polinomial são o método do elipsoide (que "roda devagar na prática" e não parece competitivo com simplex) e os métodos de ponto interior (competitivos, às vezes mais rápidos, em entradas grandes); o algoritmo mais comumente implantado, simplex, é exponencial no pior caso mas performa bem na prática. Complexidade de pior caso é um mau preditor de qual solver de LP escolher.
- **A garantia de strong duality é condicional; a de weak duality não é.** O Teorema 29.4 exige que tanto o primal quanto o dual sejam viáveis e limitados. Weak duality (Lema 29.1) precisa só de viabilidade nos dois lados, o que já basta para a direção útil: qualquer solução dual viável é um limite superior provado sobre o ótimo primal, mesmo antes de você saber o ótimo. Use-a como critério de parada e como verificação de sanidade sobre a saída de um solver.
- **Este capítulo ensina modelagem, não resolução — planeje de acordo.** A 4ª edição removeu a apresentação detalhada do simplex de propósito, e a Seção 29.1 afirma que os algoritmos de LP são "todos complicados demais para mostrar aqui". Você pode terminar este material sabendo escrever um LP correto e certificar otimalidade via duality, mas não sabendo implementar um solver; as notas do capítulo apontam para livros dedicados de LP (Chvátal, Gass, Karloff, Schrijver, Vanderbei) para isso, e o caminho prático é uma biblioteca solver.

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Chapter 29 "Linear Programming", Sections 29.1-29.3, pp. 853-876](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
