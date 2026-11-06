---
version: 1.0
updatedAt: 2026-11-05
title: "Coloração de Grafos e o Número Cromático"
summary: "Colorações próprias, o número cromático e suas cotas, coloração gulosa, o teorema das quatro cores para grafos planares e por que calcular o número cromático é difícil."
---
## Objetivos de Aprendizagem

- Definir o número cromático $\chi(G)$ e provar $\omega(G)\le\chi(G)\le\Delta(G)+1$, com grafos em que cada cota fica longe.
- Enunciar o teorema de Brooks com suas hipóteses e mostrar uma falha quando uma delas é retirada.
- Mostrar que a coloração gulosa depende da ordem dos vértices e testar 2-colorabilidade em tempo linear.
- Esboçar a prova curta das cinco cores e enunciar o teorema das quatro cores com a história precisa da prova.
- Situar a 3-colorabilidade entre os problemas NP-completos.

## Contexto e Motivação

Marcar provas de modo que nenhum aluno tenha duas ao mesmo tempo e distribuir frequências de modo que rádios com área sobreposta não coincidam são o mesmo problema: ponha os itens em conflito num grafo e dê a vértices adjacentes rótulos diferentes, chamados cores, usando o mínimo possível.

`planar-graphs` enunciou o teorema das quatro cores sem prova e deduziu o fato central por trás dele: todo grafo planar simples tem um vértice de grau no máximo 5. Esta lição prova cinco cores a partir desse fato e explica por que quatro foi tão mais difícil.

## Teoria Central

### Colorações próprias e o número cromático

Uma **coloração própria** com $k$ cores é uma função $c:V\to\{1,\dots,k\}$ com $c(u)\neq c(v)$ para toda aresta $uv$. $G$ é **$k$-colorível** se existe uma, e o **número cromático** $\chi(G)$ é o menor $k$ assim. As classes de cor são conjuntos independentes. Laços tornam a coloração impossível e arestas paralelas não mudam nada, então aqui os grafos são simples. Valores básicos: $\chi(K_n)=n$, ciclo par tem $\chi=2$, ciclo ímpar tem $\chi=3$.

A coloração se divide pela estrutura vista em `graph-connectivity-cut-vertices-and-bridges`. $\chi(G)$ é o máximo de $\chi$ sobre as componentes, e se $G$ é a união de $G_1$ e $G_2$ que só compartilham um ponto de articulação $v$, então $\chi(G)=\max(\chi(G_1),\chi(G_2))$: colora-se cada parte de forma ótima e renomeiam-se as cores de $G_2$ para que $v$ tenha a mesma cor nas duas. O grafo de trabalho daquela lição tem, assim, $\chi=3$, por causa do triângulo.

### A cota inferior pelas cliques

Uma **clique** é um conjunto de vértices dois a dois adjacentes, e $\omega(G)$ é o tamanho da maior. Vértices de uma clique precisam de cores distintas, então $\omega(G)\le\chi(G)$. A folga pode ser grande: o grafo de Grötzsch (11 vértices, 20 arestas, sem triângulo) tem $\omega=2$ e $\chi=4$, e Erdős provou em 1959 que para todo $k$ existe um grafo sem ciclos de comprimento até $k$ e com $\chi>k$ (Diestel, Teorema 5.2.5).

### A cota superior gulosa

**Coloração gulosa**: fixe uma ordem $v_1,\dots,v_n$ e dê a cada $v_i$ a menor cor não usada pelos vizinhos já coloridos. Quando se chega a $v_i$, no máximo $\Delta(G)$ vizinhos estão coloridos, então uma das $\Delta+1$ cores está livre:

$$\chi(G)\le\Delta(G)+1\quad\text{para todo grafo, em qualquer ordem.}$$

A igualdade vale para grafos completos e ciclos ímpares. Só os vizinhos *anteriores* contam, por isso a ordem **smallest-last** (coloque por último um vértice de grau mínimo, apague-o, repita) ajuda; a Proposição 5.2.2 de Diestel mostra que ela dá $\chi(G)\le\max_{H\subseteq G}\delta(H)+1$. Como todo subgrafo de um grafo planar simples tem um vértice de grau no máximo 5, grafos planares são 6-coloríveis.

### O teorema de Brooks

**Teorema (Brooks 1941).** Seja $G$ conexo. Se $G$ não é completo nem ciclo ímpar, então $\chi(G)\le\Delta(G)$.

Assim, entre os grafos conexos, só os completos e os ciclos ímpares atingem a cota gulosa $\Delta+1$. Cada hipótese conta:

- **Completo:** $K_4$ tem $\Delta=3$ e $\chi=4$.
- **Ciclo ímpar:** $C_5$ tem $\Delta=2$ e $\chi=3$.
- **Conexo:** a união disjunta de $K_4$ e $C_4$ não é completa nem ciclo ímpar, tem $\Delta=3$ e $\chi=4$. Aplique o teorema por componente.

Diestel atribui a Lovász (1973) uma prova que roda a coloração gulosa numa ordem escolhida com cuidado.

### A ordem importa

Para todo grafo existe uma ordem em que a gulosa usa exatamente $\chi(G)$ cores: liste os vértices classe por classe de uma coloração ótima. Um vértice da classe $i$ não tem vizinho anterior na própria classe, e os vizinhos anteriores das classes $1,\dots,i-1$ têm cores no máximo $i-1$ (por indução), então ele recebe cor no máximo $i$. Achar essa ordem é tão difícil quanto achar a coloração, e uma ordem ruim pode ser arbitrariamente pior (Exemplo 2).

### Duas cores: grafos bipartidos

Um grafo com pelo menos uma aresta tem $\chi=2$ exatamente quando é bipartido, e Lehman, Leighton e Meyer provam que um grafo é 2-colorível se e somente se não tem ciclo ímpar. O teste roda em $O(V+E)$: em cada componente, pinte cada vértice pela paridade da sua distância BFS a um vértice inicial. Se uma aresta liga dois vértices da mesma cor, os dois caminhos BFS até suas extremidades mais essa aresta formam um passeio fechado de comprimento ímpar, que contém um ciclo ímpar. O `Bipartite.java` de Princeton faz o mesmo com DFS.

### Cinco cores com uma prova curta

**Teorema.** Todo grafo planar é 5-colorível.

A prova de Lehman, Leighton e Meyer é uma indução forte no número de vértices, usando que apagar um vértice ou fundir dois vértices adjacentes mantém o grafo planar. Tome um vértice $g$ de grau no máximo 5, dado pelo lema de `planar-graphs`.

- Se $\deg g<5$, colora-se $G-g$ por indução; $g$ vê no máximo quatro cores, então sobra uma quinta.
- Se $\deg g=5$, há dois vizinhos $n_1,n_2$ não adjacentes, porque cinco vizinhos dois a dois adjacentes formariam $K_5$, que não é planar. Funda $n_1$, $g$ e $n_2$ num só vértice, o que mantém o grafo planar e tira dois vértices. Colora-se o grafo menor por indução, $n_1$ e $n_2$ recebem a cor do vértice fundido, e os cinco vizinhos de $g$ passam a usar no máximo quatro cores, então $g$ fica com a quinta.

Por que não quatro cores? O mesmo truque resolve $\deg g\le4$ com quatro cores, mas um grafo planar pode ter todos os graus iguais a 5 (Exemplo 4). Com grau 5, os vizinhos podem usar as quatro cores mesmo depois de uma fusão, e o argumento precisaria de duas fusões ao mesmo tempo, o que nada garante. A tentativa de Kempe de 1879 para quatro cores falhou justamente nesse caso de grau 5, num passo que troca cores ao longo de cadeias de duas cores: trocar uma cadeia pode embaralhar outra, e Kempe não percebeu isso (relato de Gonthier). Heawood achou o erro em 1890 e transformou o argumento numa prova de cinco cores (notas de Diestel).

### O teorema das quatro cores

**Teorema.** Todo grafo planar é 4-colorível. Para mapas: as regiões de um mapa podem ser coloridas com quatro cores de modo que regiões com um trecho de fronteira em comum (não só um ponto) fiquem diferentes, desde que cada região seja uma peça conexa. Regiões em vários pedaços podem exigir mais cores.

A história da prova, pelos relatos abertos listados abaixo:

- Francis Guthrie levantou a questão em 1852. A prova de Kempe de 1879 estava errada (Heawood, 1890).
- Kenneth Appel e Wolfgang Haken anunciaram uma prova em 1976 e a publicaram em 1977, em duas partes no Illinois Journal of Mathematics, a segunda com Koch. O método: exibir um conjunto **inevitável** de configurações (uma delas tem de aparecer em qualquer contraexemplo mínimo, o que se mostra por "descarga") e provar que cada uma é **redutível** (não pode aparecer num contraexemplo mínimo). A redutibilidade foi verificada por computador, em mais de mil configurações, e a parte da inevitabilidade, feita à mão, também era grande; Gonthier a descreve como 10.000 casos, difíceis de verificar, em que vários pequenos erros foram encontrados.
- Robertson, Sanders, Seymour e Thomas deram uma prova nova, publicada em 1997 depois de um anúncio em 1996, com 633 configurações redutíveis e 32 regras de descarga. A redutibilidade continua exigindo computador. O método deles também dá um algoritmo de tempo quadrático para 4-colorir um grafo planar.
- Georges Gonthier escreveu uma prova formal verificada pelo assistente de provas Coq, seguindo Robertson et al. e cobrindo tanto a parte matemática quanto a computacional, como descreve o relatório dele linkado abaixo. O que resta confiar é software e hardware de uso geral, não programas escritos para este teorema.

### Por que calcular o número cromático é difícil

- **2 cores:** tempo linear, pelo teste de bipartição.
- **3 cores:** decidir a 3-colorabilidade é NP-completo, e Lehman, Leighton e Meyer observam que isso continua valendo para grafos planares. Uma coloração proposta é conferida aresta por aresta, e por isso `np-completeness-and-cook-levin` lista a 3-colorabilidade entre os problemas em NP; a dificuldade vem de uma redução no estilo de `proving-np-completeness-via-reduction`.
- **$k\ge3$ cores:** também NP-completo. Acrescentar $k-3$ vértices novos, adjacentes entre si e a todos os vértices antigos, transforma uma pergunta de 3-coloração numa de $k$-coloração.
- **Planar, 4 cores:** a resposta é sempre sim, e uma coloração é achada em tempo polinomial.

Logo, calcular $\chi$ é NP-difícil; a força bruta sobre $3^n$ atribuições já chega a $3^{30}\approx2{,}06\times10^{14}$ com $n=30$.

## Exemplos Resolvidos

### Exemplo 1: as cotas em nove grafos

$\chi$ foi calculado por backtracking exaustivo e $\omega$ pelas cliques maximais (networkx 3.4.2). A última coluna é a cota de Brooks quando as hipóteses valem.

| grafo | $n$ | $m$ | $\omega$ | $\chi$ | $\Delta+1$ | Brooks |
|---|---|---|---|---|---|---|
| $K_4$ | 4 | 6 | 4 | 4 | 4 | completo |
| $C_5$ | 5 | 5 | 2 | 3 | 3 | ciclo ímpar |
| $C_6$ | 6 | 6 | 2 | 2 | 3 | $\le2$ |
| estrela $K_{1,6}$ | 7 | 6 | 2 | 2 | 7 | $\le6$ |
| $K_{3,3}$ | 6 | 9 | 2 | 2 | 4 | $\le3$ |
| roda (centro + $C_5$) | 6 | 10 | 3 | 4 | 6 | $\le5$ |
| Petersen | 10 | 15 | 2 | 3 | 4 | $\le3$ |
| Grötzsch | 11 | 20 | 2 | 4 | 6 | $\le5$ |
| icosaedro | 12 | 30 | 3 | 4 | 6 | $\le5$ |

A estrela mostra quão frouxa $\Delta+1$ pode ser (7 contra 2), o grafo de Grötzsch quão frouxa $\omega$ pode ser (2 contra 4). A roda e o icosaedro, planares, precisam de quatro cores, então quatro não pode virar três.

### Exemplo 2: a ordem gulosa num caminho e numa coroa

No caminho $1$-$2$-$3$-$4$, a ordem $1,2,3,4$ dá as cores $1,2,1,2$. A ordem $1,4,2,3$ dá cor 1 a $1$ e $4$, cor 2 a $2$, e então $3$ vê as cores 2 e 1 e fica com a cor 3: três cores num grafo bipartido.

O **grafo coroa** em $a_1,\dots,a_n,b_1,\dots,b_n$ tem uma aresta $a_ib_j$ para todo $i\neq j$. Ele é bipartido. Com $n=4$ (12 arestas) e a ordem $a_1,b_1,a_2,b_2,a_3,b_3,a_4,b_4$, cada par $a_i,b_i$ é não adjacente mas vê todas as cores anteriores, então a gulosa dá a $a_i$ e $b_i$ a cor $i$ e usa 4 cores. A ordem $a_1,\dots,a_4,b_1,\dots,b_4$ usa 2. Nas $8!=40.320$ ordens possíveis, 30.240 dão 2 cores, 7.200 dão 3 e 2.880 dão 4. Com $n$ pares a ordem ruim usa $n$ cores (um exercício de Diestel). As estratégias `largest_first`, `smallest_last` e `DSATUR` do `greedy_color` do networkx usaram 2 cores nas coroas com $n=3,4,5$, mas nenhuma regra de ordenação de tempo polinomial é ótima em todo grafo, a menos que P = NP.

### Exemplo 3: o teste de 2-coloração em $C_5$

Rotule o ciclo $0$-$1$-$2$-$3$-$4$-$0$ e rode uma BFS a partir de $0$ com cor 0. Os vértices $1$ e $4$ recebem cor 1; depois $2$ (vindo de $1$) e $3$ (vindo de $4$) recebem cor 0. A aresta $2$-$3$ liga dois vértices de cor 0. Os caminhos BFS $0,1,2$ e $0,4,3$ mais essa aresta formam o passeio fechado $0,1,2,3,4,0$ de comprimento 5, um ciclo ímpar, que certifica que não existe 2-coloração.

### Exemplo 4: o passo das cinco cores no icosaedro

O icosaedro é planar e todos os seus vértices têm grau exatamente 5, então o lema do grau baixo é justo e a prova precisa do segundo caso. Na rotulação do networkx, o vértice $0$ tem vizinhos $1,5,7,8,11$, que induzem um 5-ciclo; os pares não adjacentes são $\{1,7\},\{1,11\},\{5,7\},\{5,8\},\{8,11\}$. Fundir $1$, $0$ e $7$ dá um grafo com 10 vértices que o `check_planarity` confirma ser planar e cujo número cromático é 4. Dar a $1$ e $7$ a cor do vértice fundido deixa o vértice $0$ diante de no máximo quatro cores, então sobra uma quinta. (O próprio icosaedro tem $\chi=4$; a gulosa em ordem smallest-last achou uma 4-coloração.)

## Equívocos Comuns e Armadilhas

- **"A coloração gulosa acha $\chi$."** Depende da ordem: 3 cores num caminho, 4 numa coroa bipartida (Exemplo 2).
- **"$\chi\le\Delta$ para todo grafo."** Brooks exige conexo, não completo e não ciclo ímpar; $K_4$, $C_5$ e $K_4\cup C_4$ quebram a desigualdade.
- **"Todo grafo planar precisa de quatro cores."** No máximo quatro. Árvores com uma aresta precisam de duas; o teorema limita o máximo.
- **"O teorema das quatro cores é só uma busca por computador."** O computador verifica a redutibilidade de um conjunto finito de configurações escolhido por um argumento matemático, e a prova inteira já foi verificada formalmente em Coq.
- **"Grafos planares são 4-coloríveis, então 3-colori-los é fácil."** Decidir a 3-colorabilidade planar é NP-completo.
- **"O compilador calcula o $\chi$ do grafo de interferência."** `register-allocation-via-graph-coloring` colore com $K$ cores, uma por registrador da máquina, usando uma ordem de remoção e despejando (spill) um valor para a memória quando não sobra nó seguro.

## Resumo

$\chi(G)$ é o menor número de cores que dá cores diferentes a vértices adjacentes, e ele se divide por componentes e pontos de articulação. Cliques dão $\omega\le\chi$, a coloração gulosa dá $\chi\le\Delta+1$ em qualquer ordem, e as duas cotas podem ficar longe de $\chi$. Brooks baixa a cota superior para $\Delta$ nos grafos conexos que não são completos nem ciclos ímpares. A gulosa depende da ordem: alguma ordem é ótima, e uma ruim usa $n$ cores num grafo bipartido. Duas cores bastam exatamente quando não há ciclo ímpar, o que se testa em tempo linear. Grafos planares são 5-coloríveis por uma indução curta; quatro cores exigiram a prova assistida por computador de Appel e Haken, a prova mais curta de Robertson, Sanders, Seymour e Thomas e a verificação formal de Gonthier. Decidir 3-colorabilidade é NP-completo mesmo para grafos planares, então calcular $\chi$ é NP-difícil. `register-allocation-via-graph-coloring` aplica a coloração com um número fixo de registradores.

## Documentation Links

- [Lehman, Leighton and Meyer, Mathematics for Computer Science](https://people.csail.mit.edu/meyer/mcs.pdf): Seções 11.7 e 11.9.2 sobre coloração, a cota pelo grau e 2-colorabilidade, e Seção 12.6 com a prova das cinco cores.
- [Diestel, Graph Theory, Chapter 5 (free preview)](https://www.math.uni-hamburg.de/home/diestel/books/graph.theory/preview/Ch5.pdf): o teorema das cinco cores, a coloração gulosa, o teorema de Brooks e notas sobre a história das quatro cores.
- [Robin Thomas, The Four Color Theorem](https://thomas.math.gatech.edu/FC/fourcolor.html): história, a prova de 1997 com 633 configurações e 32 regras de descarga, e o algoritmo quadrático.
- [Gonthier, A computer-checked proof of the Four Color Theorem](https://inria.hal.science/hal-04034866/document): a formalização em Coq, com um relato do argumento de Kempe e das provas anteriores.
- [rocq-community, fourcolor](https://github.com/rocq-community/fourcolor): a prova formal mantida e as publicações relacionadas.
- [Sedgewick and Wayne, Algorithms, 4.1 Undirected Graphs](https://algs4.cs.princeton.edu/41graph/): 2-colorabilidade por busca em profundidade em tempo linear.
- [NetworkX, greedy_color](https://networkx.org/documentation/stable/reference/algorithms/generated/networkx.algorithms.coloring.greedy_color.html): as estratégias gulosas usadas no Exemplo 2.
