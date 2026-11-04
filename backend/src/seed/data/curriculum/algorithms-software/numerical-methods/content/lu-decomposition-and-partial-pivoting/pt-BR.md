---
version: 1.0
updatedAt: 2026-11-04
title: "Decomposição LU e Pivoteamento Parcial"
summary: "A decomposição LU como eliminação gaussiana com os multiplicadores registrados, por que o pivoteamento parcial é necessário para a estabilidade, PA = LU e o reuso dos fatores para vários lados direitos. Este pivoteamento não é o pivô do simplex, e a lição diz isso."
---
## Objetivos de Aprendizagem

- Ler a decomposição LU como eliminação gaussiana com os multiplicadores registrados e dizer quando $A=LU$ existe.
- Calcular $PA=LU$ à mão com pivoteamento parcial, resolver por substituição direta e retroativa e reutilizar os fatores para um novo lado direito.
- Contar o número exato de operações de ponto flutuante da fatoração e de cada solução.
- Mostrar em float64 como a eliminação sem pivoteamento destrói a resposta numa matriz bem condicionada, medindo erro direto, erro reverso e crescimento.
- Separar o pivô do pivoteamento parcial do pivô do simplex e apontar os casos em que o pivoteamento parcial é desnecessário ou insuficiente.

## Contexto e Motivação

`gaussian-elimination` resolveu um sistema por operações de linha, com troca só quando um pivô necessário era zero. Duas coisas mudam num computador. Primeiro, aquela lição jogou os multiplicadores fora, então um segundo lado direito repetiria todo o trabalho, embora a matriz seja a mesma. Guardar os multiplicadores resolve isso: o trabalho sobre $A$ é feito uma vez e cada novo $b$ sai barato. Segundo, em ponto flutuante a regra de troca não basta. Um pivô minúsculo, mas não nulo, passa pela regra e arruína o resultado, mesmo quando o problema em si é bem condicionado, no sentido de `conditioning-and-numerical-stability`.

## Teoria Central

### A eliminação registra a própria inversa

O passo $k$ subtrai $m_{ik}=a_{ik}/a_{kk}$ vezes a linha $k$ de cada linha $i>k$. Em forma matricial isso é $M_kA$ com $M_k=I-\mathbf m_k\mathbf e_k^T$, em que $\mathbf m_k$ guarda os multiplicadores abaixo da posição $k$. Depois de $n-1$ passos, $M_{n-1}\cdots M_1A=U$ é triangular superior. Cada inversa só troca um sinal, $M_k^{-1}=I+\mathbf m_k\mathbf e_k^T$, e na ordem em que aparecem os produtos não interagem:

$$A=\underbrace{M_1^{-1}\cdots M_{n-1}^{-1}}_{L}\,U,\qquad L=I+\sum_{k=1}^{n-1}\mathbf m_k\mathbf e_k^T.$$

Assim, $L$ é triangular inferior unitária, com os multiplicadores no próprio lugar. A eliminação não precisa de uma segunda matriz: os multiplicadores sobrescrevem os zeros que criam, e esse é o formato que `scipy.linalg.lu_factor` devolve.

**Existência.** Uma matriz quadrada $A$ tem $A=LU$ com $L$ triangular inferior unitária e $U$ triangular superior não singular se e somente se toda submatriz principal líder de $A$ é não singular. Não basta $A$ ser não singular: $\begin{pmatrix}0&1\\1&0\end{pmatrix}$ é não singular e não tem essa fatoração, pois $u_{11}=0$ contradiria $l_{21}u_{11}=1$.

### Por que um pivô pequeno causa dano

Os erros de arredondamento de uma fatoração escalam com as entradas de $L$ e $U$, não com as de $A$. Um pivô pequeno gera um multiplicador grande, que amplia uma linha, e somar isso a uma linha menor faz o arredondamento apagar a menor. Duas medidas acompanham o efeito: o **fator de crescimento** $\rho=\max_{i,j}\lvert u_{ij}\rvert/\max_{i,j}\lvert a_{ij}\rvert$ e o **erro reverso** $\lVert b-A\hat x\rVert_\infty\big/\big(\lVert A\rVert_\infty\lVert\hat x\rVert_\infty+\lVert b\rVert_\infty\big)$, que diz quanto os dados precisam mudar para $\hat x$ ser solução exata. O erro direto relativo é no máximo algo como o número de condição vezes o erro reverso, então um erro direto grande numa matriz bem condicionada acusa o algoritmo.

### Pivoteamento parcial e PA = LU

No passo $k$, procure na coluna $k$, da diagonal para baixo, o maior módulo, troque essa linha para a posição $k$ (linhas inteiras, multiplicadores guardados inclusive) e só então elimine. Todo multiplicador passa a ter $\lvert m_{ik}\rvert\le1$. "Parcial" significa que só uma coluna é examinada; o pivoteamento completo examina todo o bloco restante.

**Teorema.** Para toda matriz quadrada $A$ existe uma matriz de permutação $P$ com $PA=LU$, em que $L$ é triangular inferior unitária com $\lvert l_{ij}\rvert\le1$ e $U$ é triangular superior. $A$ é não singular se e somente se todo $u_{kk}\neq0$.

Para resolver $Ax=b$, resolva $Ly=Pb$ para a frente e $Ux=y$ para trás. Vale também $\det A=(-1)^s\prod_k u_{kk}$ para $s$ trocas.

### Este pivô não é o pivô do simplex

`the-simplex-method-tableau-and-pivoting` também diz "pivô". A palavra é compartilhada porque nos dois casos se divide por uma entrada para limpar uma coluna; as funções são diferentes.

| | Pivoteamento parcial em LU | Pivô do simplex |
|---|---|---|
| Finalidade | limitar o erro de arredondamento | ir para um vértice adjacente |
| Entrada escolhida por | maior módulo na coluna | regra de entrada na linha objetivo, depois o teste da razão |
| Operação | troca linhas, elimina só abaixo | Gauss-Jordan: limpa a coluna inteira, linha objetivo inclusive |
| Efeito na resposta | nenhum: o mesmo $x$, por um caminho com menos arredondamento | muda a solução atual, de propósito |
| Em aritmética exata | necessário só para pivôs nulos | é o próprio algoritmo |

A regra do simplex olha viabilidade e objetivo, não o tamanho da entrada, então seu pivô pode ser pequeno. A regra do pivoteamento parcial olha só o tamanho.

### Contando o trabalho

Conte um flop para cada $+$, $-$, $\times$, $\div$. O passo $k$ faz $n-k$ divisões e $(n-k)^2$ pares de multiplicação e subtração, então

$$\text{fatoração: }\sum_{k=1}^{n-1}\big[(n-k)+2(n-k)^2\big]=\tfrac23n^3-\tfrac12n^2-\tfrac16n.$$

A substituição direta com diagonal unitária custa $n^2-n$. A retroativa custa $n^2$, com $n$ divisões incluídas. Cada solução custa, portanto, $2n^2-n$ flops. A busca do pivô acrescenta $n(n-1)/2$ comparações e as trocas, e nada disso é flop. Com $k$ lados direitos, o total é $\tfrac23n^3-\tfrac12n^2-\tfrac16n+k(2n^2-n)$.

## Exemplos Resolvidos

### Exemplo 1: o mesmo sistema, agora fatorado

Use o sistema de `gaussian-elimination`:

$$A=\begin{pmatrix}1&1&1\\2&3&1\\1&1&2\end{pmatrix},\qquad b=\begin{pmatrix}6\\11\\8\end{pmatrix}.$$

As operações de linha daquela lição usaram multiplicadores $2$ e $1$, e a terceira linha não precisou de nada na coluna 2. Guardá-los dá, sem trocas,

$$L=\begin{pmatrix}1&0&0\\2&1&0\\1&0&1\end{pmatrix},\quad U=\begin{pmatrix}1&1&1\\0&1&-1\\0&0&1\end{pmatrix}.$$

Com pivoteamento parcial, a maior entrada da coluna 1 é o $2$, então as linhas 1 e 2 trocam de lugar. Os multiplicadores são $\tfrac12,\tfrac12$, o que deixa as linhas $(0,-\tfrac12,\tfrac12)$ e $(0,-\tfrac12,\tfrac32)$. A coluna 2 dá empate, então não há troca, o multiplicador é $1$ e

$$P=\begin{pmatrix}0&1&0\\1&0&0\\0&0&1\end{pmatrix},\quad L=\begin{pmatrix}1&0&0\\\tfrac12&1&0\\\tfrac12&1&1\end{pmatrix},\quad U=\begin{pmatrix}2&3&1\\0&-\tfrac12&\tfrac12\\0&0&1\end{pmatrix}.$$

Agora $Pb=(11,6,8)$, a substituição direta dá $y=(11,\tfrac12,2)$ e a retroativa dá $x=(3,1,2)$, a resposta daquela lição. Um novo $b=(1,0,0)$ não exige eliminação: $Pb=(0,1,0)$, $y=(0,1,-1)$, $x=(5,-3,-1)$, por 15 flops. Além disso, $\det A=(-1)^1\cdot2\cdot(-\tfrac12)\cdot1=1$. `scipy.linalg.lu` devolve os mesmos $L$ e $U$, com seu $P$ definido por $A=PLU$, então o $P$ dela é a transposta deste. `numpy.linalg.solve` dá as mesmas duas soluções.

### Exemplo 2: entradas comuns, um pivô feito de ruído

$$A=\begin{pmatrix}3&1&2\\0{,}3&0{,}1&0{,}7\\1&2&1\end{pmatrix},\qquad x=\begin{pmatrix}1\\1\\1\end{pmatrix},\qquad b=Ax=\begin{pmatrix}6\\1{,}1\\4\end{pmatrix}.$$

Nada aqui é pequeno, e $\kappa_2(A)=10{,}3$, então o problema é bem condicionado. Em decimal, o primeiro passo torna a entrada $(2,2)$ exatamente $0{,}1-\tfrac{0{,}3}{3}\cdot1=0$, e viria uma troca. Mas $0{,}3$ e $0{,}1$ não são frações binárias. Em float64, `0.3/3` dá `0.09999999999999999`, e a entrada vira $1{,}39\times10^{-17}$. Isso é ruído de arredondamento, não é zero, e a regra de troca de `gaussian-elimination` nunca dispara. O multiplicador seguinte é $1{,}667/(1{,}39\times10^{-17})=1{,}2\times10^{17}$, e $u_{33}=0{,}333-(1{,}2\times10^{17})(0{,}5)=-6{,}0\times10^{16}$, em que o $0{,}333$ desapareceu. Os resultados:

```text
metodo               x                    erro max   erro reverso   crescimento
sem pivoteamento     (1.3333, 0, 1.0000)  1.0        0.12           2.0e+16
pivoteamento parcial (1, 1, 1)            2.2e-16    0              1
numpy.linalg.solve   (1, 1, 1)
```

O resíduo da resposta sem pivoteamento é $(0,0,1{,}67)$: as duas primeiras equações valem e a terceira se perdeu. O pivoteamento parcial usa a linha com $1{,}667$ como segundo pivô, e a entrada de ruído só produz um multiplicador de $8\times10^{-18}$.

### Exemplo 3: o tamanho do dano e uma armadilha de escala

Para $A=\begin{pmatrix}\varepsilon&1\\1&1\end{pmatrix}$ e $b=(1,2)$, a solução exata fica perto de $(1,1)$ e $\kappa_\infty(A)\approx4$ para todos estes $\varepsilon$:

```text
epsilon   erro sem pivoteamento   erro com pivoteamento parcial
1e-08     5.0e-09                2.2e-16
1e-12     2.2e-05                0
1e-20     1.0  (x = (0, 1))      0
```

O pivoteamento parcial compara tamanhos crus, então depende da escala. Multiplique a primeira equação do caso $\varepsilon=10^{-20}$ por $10^{20}$: $\begin{pmatrix}1&10^{20}\\1&1\end{pmatrix}$ com $b=(10^{20},2)$. A solução é a mesma, mas a primeira coluna agora empata, não há troca, e tanto um LU escrito à mão quanto `numpy.linalg.solve` devolvem $(0,1)$. Dividir cada linha pela sua maior entrada antes recupera $(1,1)$. O pivoteamento parcial supõe linhas de escala comparável.

O dano também aparece sem nenhuma entrada plantada. Tome `rng = numpy.random.default_rng(42)`, `A = rng.uniform(-1, 1, (1000, 1000))`, `x = rng.uniform(-1, 1, 1000)`, `b = A @ x`, para os quais $\kappa_2=4269$. Com erro direto relativo na norma infinito:

```text
                  erro direto   erro reverso   crescimento   max |L|
sem pivoteamento  4.5e-10       7.5e-13        2.9e+04       1.3e+03
parcial           1.3e-12       1.3e-15        4.7e+01       1
```

Aqui o pivoteamento salva mais de dois dígitos, e a implementação concorda com `numpy.linalg.solve` em $2{,}2\times10^{-12}$.

### Exemplo 4: as contagens, executadas

Um laço instrumentado que incrementa um contador a cada operação aritmética, em matrizes aleatórias:

```text
n    sub      mul      div    fator    formula  direta   retro  sol.   2n^2-n
2    1        1        1      3        3        2        4      6      6
3    5        5        3      13       13       6        9      15     15
10   285      285      45     615      615      90       100    190    190
100  328350   328350   4950   661650   661650   9900     10000  19900  19900
200  2646700  2646700  19900  5313300  5313300  39800    40000  79800  79800
```

Para $n=2000$ a fatoração custa $5{,}33\times10^9$ flops e uma solução $8{,}0\times10^6$, então uma fatoração equivale a cerca de 667 soluções. Para 100 lados direitos, fatorar uma vez e resolver 100 vezes custa $6{,}13\times10^9$ flops, contra $5{,}34\times10^{11}$ de 100 eliminações separadas, um fator de 87.

Isso também resolve o "é só inverter $A$". Calcular as $n$ colunas de $A^{-1}$ acrescenta $n(2n^2-n)$ à fatoração, cerca de $\tfrac83n^3$ nesta contagem (menos se os zeros dos vetores unitários forem aproveitados), e depois $A^{-1}b$ custa $2n^2-n$, exatamente o que custam as duas soluções triangulares. Não é mais rápido por lado direito, e na matriz aleatória do Exemplo 3 o erro reverso foi $7{,}7\times10^{-14}$ contra $2{,}0\times10^{-15}$ de `numpy.linalg.solve`, 38 vezes maior; as sementes de 0 a 3 deram fatores de 22 a 52.

### Exemplo 5: onde o pivoteamento parcial não basta, e onde nem é preciso

**Não basta.** O teorema limita os multiplicadores, não o crescimento, e $\rho\le2^{n-1}$ pode ser atingido. Tome uns na diagonal, $-1$ abaixo dela e uns na última coluna. Toda entrada abaixo da diagonal empata com o pivô, então não há troca (empates mantêm a linha atual), a última coluna dobra a cada passo e, para $n=60$:

```text
kappa_2 = 26.8   crescimento = 5.8e+17 (2^59)
numpy.linalg.solve: erro direto 0.89, erro reverso 0.045
fatoracao QR:       erro direto 3.0e-15
```

Logo, o pivoteamento parcial não é estável no sentido reverso no pior caso. Ele é o padrão porque matrizes assim são raras na prática: nas 20 matrizes `numpy.random.default_rng(s).uniform(-1, 1, (500, 500))`, com $s=0,\dots,19$, o crescimento ficou entre 25 e 41.

**$A$ singular.** A matriz $A$ de linhas $(1,2,3)$, $(4,5,6)$, $(7,8,9)$ é singular e $b=(1,2,4)$ não tem solução. O arredondamento deixa $u_{33}=-1{,}6\times10^{-16}$ em vez de $0$, então `numpy.linalg.solve` não levanta nada e devolve entradas da ordem de $6\times10^{15}$. `scipy.linalg.solve` devolve o mesmo com um aviso de mau condicionamento. `numpy.linalg.solve` levanta `LinAlgError` em $\begin{pmatrix}1&2\\2&4\end{pmatrix}$, em que o pivô é exatamente $0$. Um pivô não nulo não prova que a matriz é não singular.

**Nem é preciso.** Se cada entrada da diagonal domina estritamente sua coluna, ela continua a maior e o pivoteamento parcial nunca troca. Tome `rng = numpy.random.default_rng(42)`, `R = rng.uniform(-1, 1, (500, 500))`, `x = rng.uniform(-1, 1, 500)`, `b = A @ x`. Com $A$ igual a $R$, mas com cada entrada da diagonal trocada por $1$ mais a soma dos valores absolutos das outras entradas da sua coluna, houve 0 trocas, crescimento $1{,}00$ e erro reverso $6\times10^{-16}$ sem pivoteamento. A simétrica definida positiva $A=R^TR+10^{-3}I$, com $\kappa_2=5\times10^5$, deu crescimento $0{,}95$ e erro reverso $8\times10^{-17}$ sem pivoteamento, e essas matrizes usam Cholesky, com cerca de metade dos flops. `iterative-methods-jacobi-and-gauss-seidel` trata do caso esparso, em que a fatoração tem outro problema.

## Equívocos Comuns e Armadilhas

- **"Pivoteamento é para pivôs nulos."** Em ponto flutuante o pivô perigoso é o pequeno, e no Exemplo 2 um zero verdadeiro chegou disfarçado de $10^{-17}$.
- **"Resposta ruim significa matriz ruim."** O Exemplo 2 tem $\kappa_2=10{,}3$. O dano veio do algoritmo.
- **"O pivoteamento parcial torna o LU sempre estável."** O Exemplo 5 perdeu todos os dígitos em $n=60$ com $\kappa_2=26{,}8$. Ele é confiável na prática, não no pior caso.
- **"O pivô do simplex é o mesmo pivô."** Um escolhe um vértice e muda a solução. O outro só reduz o arredondamento e não mexe na solução.
- **"Resíduo pequeno significa solução precisa."** Significa erro reverso pequeno. O erro direto é isso vezes até o número de condição.
- **"Inverta $A$ e multiplique."** Custa mais de início, o mesmo por lado direito, e o erro reverso foi 38 vezes maior na matriz do Exemplo 4.
- **"`scipy.linalg.lu` dá $PA=LU$."** Dá $A=PLU$. Confira a convenção antes de usar seu $P$.

## Resumo

A decomposição LU é eliminação com memória: os multiplicadores formam uma $L$ triangular inferior unitária, o resultado é $U$, e $A=LU$ com $U$ não singular existe exatamente quando todas as submatrizes principais líderes são não singulares. O pivoteamento parcial toma a maior entrada de cada coluna, o que dá $PA=LU$ para toda matriz quadrada, com $\lvert l_{ij}\rvert\le1$. A fatoração custa exatamente $\tfrac23n^3-\tfrac12n^2-\tfrac16n$ flops e cada solução $2n^2-n$, então reutilizar os fatores é o principal ganho prático. Sem pivoteamento, um pivô de ruído de $10^{-17}$ destruiu um sistema com $\kappa_2=10{,}3$, e um sistema aleatório com $n=1000$ perdeu mais de dois dígitos. O pivô aqui reduz arredondamento e deixa a solução intacta, ao contrário do pivô do simplex. Ele depende da escala das linhas, pode ser derrotado por um crescimento de $2^{n-1}$ e é desnecessário em matrizes diagonalmente dominantes e definidas positivas.

## Documentation Links

- [Fundamentals of Numerical Computation, 2.4 LU factorization](https://fncbook.com/lu): a visão de LU por produtos externos e a solução por sistemas triangulares.
- [Fundamentals of Numerical Computation, 2.5 Efficiency of matrix computations](https://fncbook.com/efficiency): contagem de flops e notação assintótica para algoritmos matriciais.
- [Fundamentals of Numerical Computation, 2.6 Row pivoting](https://fncbook.com/pivoting): a falha do LU sem pivoteamento, a fatoração PLU e por que se escolhe a maior entrada.
- [Fundamentals of Numerical Computation, 2.9 Exploiting matrix structure](https://fncbook.com/structure): dominância diagonal, matrizes em banda e Cholesky.
- [What Every Computer Scientist Should Know About Floating-Point Arithmetic (Goldberg)](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): erro de representação e de arredondamento, a origem do pivô de ruído.
- [SciPy, scipy.linalg.lu](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.lu.html): a fatoração e sua convenção $A=PLU$.
- [SciPy, scipy.linalg.lu_factor](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.lu_factor.html): fatores compactos no próprio lugar, para reuso com `lu_solve`.
- [NumPy, numpy.linalg.solve](https://numpy.org/doc/stable/reference/generated/numpy.linalg.solve.html): o solver denso, construído sobre a `_gesv` do LAPACK.
