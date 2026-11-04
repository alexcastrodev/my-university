---
version: 1.0
updatedAt: 2026-11-04
title: "Métodos Iterativos: Jacobi e Gauss-Seidel"
summary: "As iterações de Jacobi e Gauss-Seidel para grandes sistemas esparsos, as condições de dominância diagonal e de raio espectral para a convergência, e quando a iteração supera a fatoração."
---
## Objetivos de Aprendizagem

- Escrever as varreduras de Jacobi e Gauss-Seidel entrada a entrada e como splittings $x^{(k+1)}=Gx^{(k)}+c$, e contar os flops de uma varredura numa matriz esparsa.
- Enunciar o teorema do raio espectral e as condições suficientes (dominância diagonal estrita, matriz simétrica definida positiva) com suas hipóteses, e mostrar o que acontece quando cada uma falta.
- Medir o fator de convergência a partir de uma execução e compará-lo com $\rho(G)$.
- Parar pelo resíduo sabendo o que ele diz e o que não diz sobre o erro, e achar o ponto em que o arredondamento encerra a iteração.
- Decidir, a partir de fill-in medido, contagem de varreduras e número de lados direitos, quando a iteração supera a fatoração e quando não supera.

## Contexto e Motivação

`lu-decomposition-and-partial-pivoting` resolve um sistema denso em cerca de $\tfrac23n^3$ flops. Uma matriz esparsa não continua esparsa nesse processo: $L$ e $U$ ganham não zeros onde $A$ não tem, o chamado **fill-in**. Numa grade 3D com $n=64\,000$ incógnitas, $A$ tem $4{,}4\times10^5$ não zeros e seus fatores esparsos têm $9{,}6\times10^7$.

Uma iteração evita isso por completo. Ela toca só os não zeros existentes, guarda poucos vetores e pode parar assim que a resposta estiver boa o bastante. Jacobi não precisa de nada além da diagonal e do produto de $A$ por um vetor. O preço é que ela pode convergir devagar ou nem convergir, conforme a matriz. Jacobi e Gauss-Seidel são os dois métodos mais simples desse tipo, e suas condições de convergência mostram o tipo de análise que qualquer iteração exige.

## Teoria Central

### Duas varreduras

Resolva a equação $i$ para $x_i$, supondo todo $a_{ii}\neq0$. **Jacobi** usa só valores antigos:

$$x_i^{(k+1)}=\frac{1}{a_{ii}}\Big(b_i-\sum_{j\neq i}a_{ij}x_j^{(k)}\Big).$$

**Gauss-Seidel** usa cada valor novo assim que ele existe:

$$x_i^{(k+1)}=\frac{1}{a_{ii}}\Big(b_i-\sum_{j<i}a_{ij}x_j^{(k+1)}-\sum_{j>i}a_{ij}x_j^{(k)}\Big).$$

Jacobi precisa de dois vetores, ignora a ordem das equações e suas atualizações podem rodar ao mesmo tempo. Gauss-Seidel sobrescreve no próprio vetor, mas seus iterados dependem da ordem, e as atualizações são sequenciais, a menos que o padrão de esparsidade permita grupos de incógnitas independentes. Uma varredura de qualquer um deles numa matriz com `nnz` não zeros custa $\text{nnz}-n$ multiplicações, $\text{nnz}-n$ subtrações e $n$ divisões: $2\,\text{nnz}-n$ flops.

### O splitting

Escreva $A=D+L+U$: a diagonal e as partes estritamente inferior e superior. Estes $L$ e $U$ são pedaços de $A$, não os fatores de uma decomposição LU. Então

$$G_J=-D^{-1}(L+U),\qquad G_{GS}=-(D+L)^{-1}U,$$

e cada método é $x^{(k+1)}=Gx^{(k)}+c$. A solução $x$ de $Ax=b$ satisfaz $x=Gx+c$, então subtrair dá $e^{(k+1)}=Ge^{(k)}$ e $e^{(k)}=G^ke^{(0)}$. Isso é `fixed-point-iteration` em $n$ dimensões, com $G$ no papel de $g'$.

### O teorema de convergência

O **raio espectral** $\rho(G)$ é o maior $\lvert\lambda\rvert$ entre os autovalores de $G$.

**Hipóteses.** $A$ é não singular e todo $a_{ii}\neq0$. **Conclusão.** A iteração converge para $x$ a partir de todo $x^{(0)}$ se e somente se $\rho(G)<1$.

Se $\rho(G)<1$ então $G^k\to0$. Se $\rho(G)\ge1$, um ponto de partida cujo erro é autovetor desse autovalor nunca converge. Um ponto de sorte ainda pode funcionar, e é por isso que o teorema diz "todo". Assintoticamente o erro encolhe por $\rho(G)$ a cada varredura, então reduzi-lo por $10^{-d}$ leva cerca de $d/(-\log_{10}\rho)$ varreduras. É uma taxa de longo prazo, não uma promessa para cada varredura.

### Condições suficientes

Calcular $\rho(G)$ pode ser tão difícil quanto o problema original, então testes mais simples importam.

- **Dominância diagonal estrita por linhas:** $\lvert a_{ii}\rvert>\sum_{j\neq i}\lvert a_{ij}\rvert$ para todo $i$. As somas das linhas de $\lvert G_J\rvert$ ficam então abaixo de 1, logo $\lVert G_J\rVert_\infty<1$. Jacobi e Gauss-Seidel convergem a partir de qualquer ponto, e $A$ é automaticamente não singular. O mesmo vale com colunas no lugar de linhas.
- **Dominância fraca com irredutibilidade**, com desigualdade estrita em pelo menos uma linha, também basta. Isso cobre o problema-modelo do Exemplo 2.
- **$A$ simétrica definida positiva:** Gauss-Seidel converge a partir de qualquer ponto. Jacobi precisa de mais: $2D-A$ também tem de ser definida positiva.

Tudo isso é suficiente, não necessário, e em geral nenhum dos dois métodos domina o outro (Exemplo 3).

Uma relação à parte não é teste nenhum: para $A$ tridiagonal com diagonal não nula, $\rho(G_{GS})=\rho(G_J)^2$. Quando Jacobi converge, uma varredura de Gauss-Seidel vale então duas de Jacobi. Quando diverge, Gauss-Seidel também diverge, como $\begin{pmatrix}1&3\\4&1\end{pmatrix}$ mostra no Exemplo 3.

### Parada, e o que o resíduo significa

A quantidade calculável é o resíduo $r^{(k)}=b-Ax^{(k)}$, uma medida de erro reverso. O erro obedece a $e^{(k)}=-A^{-1}r^{(k)}$, o que dá

$$\frac{\lVert e^{(k)}\rVert}{\lVert x\rVert}\le\kappa(A)\,\frac{\lVert r^{(k)}\rVert}{\lVert b\rVert}.$$

Um resíduo pequeno numa matriz mal condicionada pode, portanto, esconder um erro grande. Veja `conditioning-and-numerical-stability`. Limite também as varreduras, pois uma execução que diverge pode nunca disparar o teste.

## Exemplos Resolvidos

### Exemplo 1: um sistema estritamente dominante

$$A=\begin{pmatrix}4&-1&1\\2&6&-1\\1&1&5\end{pmatrix},\qquad b=\begin{pmatrix}5\\11\\18\end{pmatrix},\qquad x=\begin{pmatrix}1\\2\\3\end{pmatrix}.$$

A soma fora da diagonal dividida pela diagonal é $0{,}5$, $0{,}5$, $0{,}4$ por linha, então os dois métodos convergem, e sob Jacobi o erro cai por pelo menos $0{,}5$ a cada varredura na norma infinito. A partir de $x^{(0)}=0$, uma varredura de Jacobi dá $(\tfrac54,\tfrac{11}6,\tfrac{18}5)$. Uma varredura de Gauss-Seidel dá $x_1=1{,}25$, depois $x_2=(11-2{,}5)/6=1{,}4167$, depois $x_3=(18-1{,}25-1{,}4167)/5=3{,}0667$. Uma execução em float64, com a norma infinito do erro:

```text
varredura   Jacobi      Gauss-Seidel
1           6.000e-01   5.833e-01
4           1.389e-02   4.958e-04
8           2.277e-04   9.970e-08
12          2.168e-06   2.498e-12
16          3.527e-08   4.441e-16
```

Os autovalores dão $\rho(G_J)=0{,}338$ e $\rho(G_{GS})=0{,}091$. Esses autovalores são complexos, então a razão entre varreduras oscila, e a medida certa é uma média geométrica: $0{,}332$ para Jacobi nas varreduras de 4 a 24 e $0{,}083$ para Gauss-Seidel nas varreduras de 2 a 12. As duas ficam abaixo do $0{,}5$ garantido. `numpy.linalg.solve` devolve o mesmo $(1,2,3)$.

### Exemplo 2: o problema-modelo e a taxa medida

A matriz tridiagonal com $2$ na diagonal e $-1$ ao lado, de tamanho $n$, vem de um problema de difusão 1D. Ela é só fracamente dominante, mas é irredutível, então os dois métodos convergem. Sua matriz de Jacobi tem $\rho=\cos\big(\pi/(n+1)\big)$. Para $n=50$ isso prevê $0{,}998103$ para Jacobi e $0{,}996210$ para Gauss-Seidel. Com solução exata $x_i=\sin(\pi t_i)+0{,}3\sin(3\pi t_i)$, $t_i=i/51$, $b=Ax$ e $x^{(0)}=0$:

```text
varredura  erro Jacobi  razao     erro Gauss-Seidel  razao
100        7.939e-01    0.998038  6.556e-01          0.996215
1000       1.435e-01    0.998103  2.153e-02          0.996210
2000       2.149e-02    0.998103  4.832e-04          0.996210
4000       4.823e-04    0.998103  2.433e-07          0.996210
8000       2.428e-07    0.998103  6.398e-14          0.996677
```

Os erros são relativos na norma 2, e a razão é $\lVert e^{(k)}\rVert/\lVert e^{(k-1)}\rVert$. As razões medidas batem com a previsão em seis dígitos. Gauss-Seidel na varredura 1000 iguala Jacobi na varredura 2000, como diz $\rho_{GS}=\rho_J^2$. A razão $0{,}996677$ na última linha é o arredondamento começando a interferir: o erro de Gauss-Seidel congela em $1{,}9\times10^{-14}$ na varredura 9000, enquanto `numpy.linalg.solve` obtém $6{,}2\times10^{-15}$. Antes do congelamento o erro é o truncamento da iteração. Depois dele, mais varreduras não fazem nada.

O problema é a taxa. Reduzir o erro por $10^{-6}$ leva cerca de 334 varreduras de Jacobi em $n=10$, 28.554 em $n=100$ e $2{,}8\times10^6$ em $n=1000$, crescendo como $n^2$. Aqui um LU em banda resolve o sistema em $O(n)$ flops, então iterar nessa matriz unidimensional é uma escolha ruim.

O teste do resíduo também se comporta como dito. Em $n=50$ o resíduo relativo cai abaixo de $10^{-6}$ pela primeira vez na varredura 6722 em Jacobi e 3362 em Gauss-Seidel, com erro relativo $2{,}7\times10^{-6}$ nos dois. Com $\kappa_2(A)=1053$ a cota permite $10^{-3}$. É uma cota, não uma estimativa.

### Exemplo 3: o que cada hipótese faz

Cada execução toma $x=(1,2)$ ou $(1,2,3)$, define $b=Ax$ e parte de zero.

| Matriz | O que falta | $\rho(G_J)$ | $\rho(G_{GS})$ | Medido a partir de $x^{(0)}=0$ |
|---|---|---|---|---|
| $\begin{pmatrix}0&1\\1&0\end{pmatrix}$ | $a_{ii}\neq0$ | indefinido | indefinido | divisão por zero na primeira varredura; trocar as linhas resolve |
| $\begin{pmatrix}1&3\\4&1\end{pmatrix}$ | dominância | $3{,}46$ | $12$ | os dois divergem |
| $\begin{pmatrix}4&1\\1&3\end{pmatrix}$ | nada | $0{,}289$ | $0{,}083$ | as mesmas equações reordenadas: os dois convergem |
| $\begin{pmatrix}1&0{,}8&0{,}8\\0{,}8&1&0{,}8\\0{,}8&0{,}8&1\end{pmatrix}$ | $2D-A$ definida positiva | $1{,}6$ | $0{,}716$ | definida positiva, mas o erro de Jacobi é $2{,}9\times10^8$ na varredura 40; o de Gauss-Seidel é $7{,}1\times10^{-6}$ |
| $\begin{pmatrix}1&2&-2\\1&1&1\\2&2&1\end{pmatrix}$ | dominância | $0$ | $2$ | Jacobi é exato depois de 3 varreduras ($G_J^3=0$); o erro de Gauss-Seidel é $2{,}1\times10^5$ na varredura 12 |
| $\begin{pmatrix}2&3\\1&2{,}5\end{pmatrix}$ | dominância | $0{,}775$ | $0{,}6$ | os dois convergem: dominância não é necessária |

Logo, nenhum método é sempre melhor, e a ordem das linhas pode decidir tudo. A linha com $\rho=0$ também alerta para a leitura assintótica no sentido oposto. Tome $I$ menos $2{,}5$ na superdiagonal, $n=30$, com $x$ só de uns e $b=Ax$. Jacobi tem $\rho(G_J)=0$ e fica exato na varredura 30, mas antes o erro cresce até $3{,}5\times10^{11}$ na varredura 29. $\rho<1$ decide o limite, não o caminho.

### Exemplo 4: quando a iteração supera a fatoração

Cada linha abaixo compara `scipy.sparse.linalg.splu` (uma fatoração e uma solução, resíduo relativo perto de $10^{-16}$) com Jacobi rodado a partir de zero até um resíduo relativo de $10^{-6}$. As três primeiras linhas usam `x = default_rng(0).standard_normal(n)` e `b = A @ x`. A contagem de varreduras depende de $b$: na primeira matriz, cinco outros lados direitos deram de 18.188 a 28.555 varreduras. A última linha resolve o sistema do PageRank abaixo e para em $\lVert x^{(k+1)}-x^{(k)}\rVert_1<10^{-10}$. Os tempos são de uma execução numa máquina, e só a ordem de grandeza importa. As precisões diferem, então isto compara Jacobi com seis dígitos e LU com precisão total.

```text
problema                    n        nnz(A)    nnz(L+U)  splu    varred.  Jacobi
Poisson 2D, 100x100         10,000   49,600    6.5e+05   0.03 s  14,905   1.1 s
Poisson 3D, 40x40x40        64,000   438,400   9.6e+07   31 s    3,282    2.8 s
I + Poisson 2D, 500x500     250,000  1.25e+06  2.9e+07   1.5 s   52       0.3 s
PageRank, grafo aleatorio   20,000   219,946   2.7e+08   670 s   18       0.004 s
```

**Poisson 2D: a fatoração vence.** Os fatores esparsos são só 13 vezes mais densos que $A$, e Jacobi precisa de dezenas de milhares de varreduras porque $\rho\to1$ conforme a grade se refina. Ser grande e esparsa, sozinho, não é motivo para iterar.

**Poisson 3D: o fill-in decide.** Os fatores são 218 vezes mais densos que $A$, e isso cresce rápido com a grade, então até uma iteração lenta vence.

**Um passo de difusão implícita: $\rho$ não depende de $n$.** Somar a identidade à matriz de Poisson 2D faz a diagonal valer $5$ e a soma fora da diagonal valer no máximo $4$, então $\lVert G_J\rVert_\infty\le0{,}8$ em qualquer grade. Jacobi levou 52 varreduras nas grades $100\times100$, $300\times300$ e $500\times500$, então seu custo total é linear em $n$. Partindo da solução anterior, depois de uma pequena mudança no lado direito, levou 23 na maior grade. Este é o caso bom para a iteração: diagonal dominante e um bom chute inicial.

**PageRank é Jacobi.** A atualização $x\leftarrow dMx+(1-d)\tfrac1n\mathbf 1$ de `pagerank-via-power-iteration` é exatamente a varredura de Jacobi para $(I-dM)x=(1-d)\tfrac1n\mathbf 1$ quando nenhuma página aponta para si mesma, porque então $D=I$. Com $M$ estocástica por colunas, $\lVert G\rVert_1=d=0{,}85$, o que garante um fator de $0{,}85$ por varredura para qualquer $n$. Neste grafo (10 links aleatórios por página) o fator medido foi $0{,}27$, e foram 18 varreduras em $n=20\,000$, $10^5$ e $10^6$, cada uma com $2\,\text{nnz}-n$ flops. Um LU denso em $n=20\,000$ custaria $5{,}3\times10^{12}$ flops, e o esparso acima teve 1.200 vezes mais não zeros que $A$.

**Muitos lados direitos favorecem a fatoração.** Depois do `splu` na grade $500\times500$, cada nova solução levou $0{,}04$ s, enquanto 23 varreduras no ritmo acima levam cerca de $0{,}13$ s, então a fatoração se paga quando chegam lados direitos suficientes.

### Livro vs hoje

Jacobi e Gauss-Seidel puros raramente são o solver final hoje. No problema 2D acima, `scipy.sparse.linalg.cg` (para $A$ simétrica definida positiva) precisou de 187 iterações contra 14.905 de Jacobi com o mesmo $b$, e de 91 contra 3.282 no 3D. Sua contagem também varia com $b$: de 1 a 256 naqueles cinco outros lados direitos. Métodos de Krylov e multigrid assumiram o posto, e essas varreduras sobrevivem dentro deles como precondicionadores e suavizadores. No problema-modelo com $n=50$, cinco varreduras de Gauss-Seidel deixam $0{,}4\%$ do modo de erro de frequência mais alta e $98\%$ do mais suave, o comportamento que um ciclo de multigrid explora. Cinco varreduras de Jacobi puro deixam $99\%$ dos dois, porque seus autovalores nas duas pontas têm o mesmo tamanho, e por isso um multigrid baseado em Jacobi usa uma variante amortecida.

## Equívocos Comuns e Armadilhas

- **"Dominância diagonal é obrigatória."** Ela é suficiente. A última linha do Exemplo 3 converge sem ela, e o Exemplo 2 só tem dominância fraca.
- **"Gauss-Seidel é sempre mais rápido que Jacobi."** O Exemplo 3 tem uma matriz em que Jacobi termina em 3 varreduras e Gauss-Seidel diverge.
- **"Definida positiva significa que Jacobi funciona."** Essa garantia é de Gauss-Seidel. O Exemplo 3 tem $\rho(G_J)=1{,}6$ numa matriz definida positiva.
- **"$\rho<1$ significa que o erro cai a cada varredura."** O caso final do Exemplo 3 cresce por um fator de $10^{11}$ antes.
- **"A iteração vence em qualquer matriz grande e esparsa."** Em Poisson 2D, `splu` foi cerca de 40 vezes mais rápido que Jacobi, e com muito mais precisão.
- **"Mais varreduras, mais dígitos."** O Exemplo 2 congela em $1{,}9\times10^{-14}$.
- **"Resíduo pequeno significa erro pequeno."** Só a menos de um fator $\kappa(A)$.
- **"Estes $L$ e $U$ são os fatores LU."** São os triângulos estritos da própria $A$.

## Resumo

Jacobi resolve cada equação com valores antigos, e Gauss-Seidel usa os novos na hora. Os dois são $x^{(k+1)}=Gx^{(k)}+c$ com erro $G^ke^{(0)}$, então, com $A$ não singular e diagonal não nula, convergem a partir de todo ponto exatamente quando $\rho(G)<1$, a cerca de $\rho$ por varredura no longo prazo. A dominância diagonal estrita garante os dois, a definição positiva garante Gauss-Seidel, e a estrutura tridiagonal dá $\rho_{GS}=\rho_J^2$, medido aqui com seis dígitos. Nada disso é necessário, e nenhum método sempre vence. Uma varredura custa $2\,\text{nnz}-n$ flops, então a iteração vence quando o fill-in é severo ou quando $\rho$ fica longe de 1 conforme $n$ cresce, como em passos implícitos e no PageRank, e perde na matriz de Poisson 2D e com muitos lados direitos. O arredondamento impõe um piso perto de $10^{-14}$ no Exemplo 2, e o resíduo limita o erro só por meio de $\kappa(A)$.

## Documentation Links

- [Templates for the Solution of Linear Systems, Stationary Iterative Methods](https://netlib.org/linalg/html_templates/node11.html): visão geral de Jacobi, Gauss-Seidel, SOR e SSOR.
- [Templates for the Solution of Linear Systems, Convergence of the Jacobi method](https://netlib.org/linalg/html_templates/node13.html): o problema-modelo e o espectro da sua matriz de Jacobi.
- [Templates for the Solution of Linear Systems, The Gauss-Seidel Method](https://netlib.org/linalg/html_templates/node14.html): dependência da ordem e atualizações sequenciais.
- [Saad, Iterative Methods for Sparse Linear Systems, 2nd ed.](https://www-users.cse.umn.edu/~saad/IterMethBook_2ndEd.pdf): o Capítulo 4 prova o resultado geral de convergência e os casos diagonalmente dominante e definido positivo.
- [Fundamentals of Numerical Computation, 8.1 Sparsity and structure](https://fncbook.com/structure-1): armazenamento esparso e fill-in.
- [Fundamentals of Numerical Computation, 8.6 MINRES and conjugate gradients](https://fncbook.com/minrescg): os métodos de Krylov que substituíram as varreduras puras para matrizes simétricas.
- [SciPy, scipy.sparse.linalg.splu](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.splu.html): o LU esparso usado no Exemplo 4.
- [SciPy, scipy.sparse.linalg.cg](https://docs.scipy.org/doc/scipy/reference/generated/scipy.sparse.linalg.cg.html): a rotina de gradientes conjugados usada na comparação.
