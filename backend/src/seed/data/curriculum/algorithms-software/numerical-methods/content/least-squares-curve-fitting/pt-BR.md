---
version: 1.0
updatedAt: 2026-11-04
title: "Ajuste de Curvas por Mínimos Quadrados"
summary: "Ajuste de curvas por mínimos quadrados pelo lado numérico: equações normais versus QR, condicionamento e a escolha da base, construindo sobre a lição de álgebra linear em vez de repeti-la."
---
## Objetivos de Aprendizagem

- Montar um ajuste de curva como $\min\lVert Ax-b\rVert_2$ para qualquer modelo linear nos parâmetros, com a hipótese de posto que ele exige.
- Mostrar que $\kappa_2(A^TA)=\kappa_2(A)^2$ e medir quantos dígitos as equações normais perdem contra QR num ajuste mal condicionado.
- Resolver um problema de mínimos quadrados por QR, à mão e em código, e conferi-lo contra `numpy.linalg.lstsq`.
- Explicar como o tamanho do resíduo muda a precisão de cada método.
- Escolher uma base e uma escala que deixem o ajuste bem condicionado, e reconhecer quando nenhuma base resolve.

## Contexto e Motivação

`least-squares-via-linear-algebra` deduziu as equações normais $A^TAx=A^Tb$ duas vezes, por projeção e por gradiente, e `linear-regression-as-least-squares` escreveu a forma fechada $\theta=(X^TX)^{-1}X^Ty$ para um modelo linear. Essas lições resolvem qual é a resposta. Esta pergunta como calculá-la em float64, e a fórmula acaba sendo um algoritmo ruim. É a versão de ajuste da história da matriz de Hilbert em `the-matrix-condition-number`.

O ajuste também termina o que a interpolação começou. `polynomial-interpolation-lagrange-and-newton` e `splines` forçam a curva a passar por todos os pontos, o que é o objetivo errado quando os dados têm ruído. Com menos parâmetros que pontos, a curva suaviza.

## Teoria Central

### O problema

Tome um modelo $g(x)=\sum_{j=1}^{n} c_j\varphi_j(x)$, linear nos coeficientes $c_j$ e possivelmente não linear em $x$, e dados $(x_i,y_i)$ para $i=1,\ldots,m$ com $m>n$. Com $A_{ij}=\varphi_j(x_i)$ e $b_i=y_i$, ache o $c$ que minimiza $\lVert Ac-b\rVert_2$. **Hipótese:** $A$ tem posto coluna completo. Então o minimizador é único. Sem isso há infinitos (Exemplo 6).

### Por que as equações normais perdem dígitos

Da SVD $A=U\Sigma V^T$ vem $A^TA=V\Sigma^2V^T$, então com posto coluna completo

$$\kappa_2(A^TA)=\kappa_2(A)^2.$$

Formar $A^TA$ e resolver por Cholesky custa cerca de $mn^2+\tfrac13n^3$ flops. É barato, mas o problema entregue ao solver é condicionado como o quadrado do original, e o erro escala junto. Com $\kappa_2(A)=10^8$, $A^TA$ está no limite do que o float64 consegue distinguir de uma matriz singular.

### QR

Escreva $A=QR$ na forma reduzida: $Q$ é $m\times n$ com colunas ortonormais e $R$ é $n\times n$ triangular superior. O posto coluna completo torna $R$ invertível. Substituir nas equações normais e cancelar $R^T$ deixa

$$Rx=Q^Tb.$$

Nada é elevado ao quadrado neste passo: $\kappa_2(R)=\kappa_2(A)$, porque multiplicar por $Q$ preserva a norma 2. QR de Householder custa cerca de $2mn^2-\tfrac23n^3$ flops, aproximadamente o dobro das equações normais quando $m\gg n$. `numpy.linalg.lstsq` vai além e trabalha com os valores singulares, que também revelam o posto numérico.

### O que o resíduo faz

A sensibilidade dos mínimos quadrados não é simplesmente $\kappa(A)$. Ela tem um termo perto de $\kappa(A)$ e um termo em $\kappa(A)^2\tan\theta$, onde $\theta$ é o ângulo entre $b$ e a imagem de $A$. O segundo termo domina quando $\tan\theta$ chega a cerca de $1/\kappa(A)$, que é $5\times10^{-8}$ para $\kappa(A)=2{,}1\times10^7$, então um resíduo que parece minúsculo já pode acioná-lo. Assim, QR nem sempre escapa de $\kappa^2$: ele acompanha a sensibilidade verdadeira do problema, enquanto as equações normais pagam $\kappa^2$ de qualquer jeito (Exemplo 3).

### A base

Os polinômios de grau no máximo $d$ formam um único espaço, mas cada base dá uma $A$ diferente. Uma base de monômios em $[0,1]$ tem colunas quase coincidentes, e a matriz de Gram $A^TA/m$ tende à matriz de Hilbert quando $m$ cresce. Polinômios de Chebyshev no intervalo dos dados mantêm as colunas longe de paralelas, embora não sejam ortogonais em dados equiespaçados: em $d=12$ com 100 pontos equiespaçados, o maior cosseno entre duas colunas é $0{,}465$, contra $0{,}999$ dos monômios em $[0,1]$. Trocar de base muda o condicionamento do problema; trocar de solver não muda.

## Exemplos Resolvidos

### Exemplo 1: QR à mão num ajuste conhecido

Use os quatro pontos de `least-squares-via-linear-algebra`, $(0,1),(1,1),(2,2),(3,2)$, que deram $y=0{,}9+0{,}4x$. As colunas de $A$ são $a_1=(1,1,1,1)$ e $a_2=(0,1,2,3)$. Gram-Schmidt dá $r_{11}=2$, $q_1=\tfrac12(1,1,1,1)$, $r_{12}=q_1\cdot a_2=3$. Então $a_2-3q_1=(-1{,}5;\ -0{,}5;\ 0{,}5;\ 1{,}5)$, logo $r_{22}=\sqrt5$. Com $b=(1,1,2,2)$, $Q^Tb=(3,\ 2/\sqrt5)$, e a substituição regressiva em

$$\begin{pmatrix}2&3\\0&\sqrt5\end{pmatrix}\begin{pmatrix}c\\m\end{pmatrix}=\begin{pmatrix}3\\2/\sqrt5\end{pmatrix}$$

dá $m=\tfrac25$, $c=\tfrac9{10}$, a mesma reta. `numpy.linalg.qr` devolve $R$ com as duas entradas da diagonal negativas e a mesma solução. Aqui $\kappa_2(A)=3{,}76$ e $\kappa_2(A^TA)=14{,}13=3{,}76^2$.

### Exemplo 2: equações normais contra QR num ajuste real

Ajuste monômios de grau $d$ a $m=100$ pontos equiespaçados em $[0,1]$, com $y=\sin 4x$ mais ruído Normal de desvio padrão $0{,}01$ (semente 42). A referência é o minimizador exato dos $A$ e $y$ guardados, calculado com 250 dígitos, então a tabela mede só o erro do solver.

```python
Q, R = np.linalg.qr(A)
x_qr = scipy.linalg.solve_triangular(R, Q.T @ y)
c = scipy.linalg.cho_factor(A.T @ A, lower=True)
x_ne = scipy.linalg.cho_solve(c, A.T @ y)
```

Erros relativos nos coeficientes e nos valores ajustados $Ax$ (NE = equações normais):

```text
 d   kappa(A)   kappa(A^T A)   coef NE    coef QR    curva NE   curva QR
 4   6.65e+02   4.42e+05       3.90e-12   4.90e-15   1.87e-13   1.07e-15
 6   2.07e+04   4.27e+08       2.91e-10   5.47e-14   5.78e-13   9.33e-16
 8   6.56e+05   4.31e+11       6.48e-06   5.38e-12   8.03e-09   2.31e-14
10   2.12e+07   4.47e+14       4.35e-03   4.08e-10   7.70e-06   1.36e-12
12   6.90e+08   4.76e+17       2.64e-01   8.68e-08   7.63e-05   2.46e-11
14   2.27e+10   5.16e+20       falha      3.26e-07   falha      9.13e-10
```

Em $d=10$, QR mantém cerca de 9 dígitos nos coeficientes e as equações normais cerca de 2. Em $d=14$, Cholesky informa que a matriz não é definida positiva. Recorrer a LU ali dá erro $1{,}0$ nos coeficientes. A norma do resíduo calculado denuncia a falha: em $d=18$ esse recurso informa $0{,}0745$, mais que os $0{,}0725$ de $d=12$, o que é impossível para um minimizador verdadeiro num espaço maior. QR dá $0{,}0664$.

`numpy.linalg.lstsq` concorda com o código de QR: em $d=12$ os coeficientes diferem em $6{,}8\times10^{-14}$ em termos relativos. Concordância não é precisão: os dois ficam a $8{,}68\times10^{-8}$ do minimizador exato, e só a referência de alta precisão mostra isso. Os dígitos das equações normais também são ruído: com o padrão `lower=False`, o erro em $d=10$ é $7{,}98\times10^{-3}$ em vez de $4{,}35\times10^{-3}$. Repare que as curvas são mais precisas que os coeficientes. Os erros vão principalmente para combinações de colunas quase dependentes, que mal mudam $Ax$.

A ligação com a matriz de Hilbert é mensurável. Para $d=9$ e $10^5$ pontos médios, $A^TA/m$ difere de $H_{10}$ em no máximo $7{,}5\times10^{-11}$ por entrada, e os números de condição são $1{,}602\times10^{13}$ e $1{,}603\times10^{13}$.

### Exemplo 3: o resíduo muda o quadro

Mantenha $d=10$ e construa $b=A\mathbf 1+t\hat r$. Aqui $\hat r$ é `numpy.random.default_rng(0).normal(size=100)` sem sua projeção na imagem de $A$, removida em alta precisão, e depois normalizado, repetido em 40 sorteios sucessivos. A norma do resíduo é $t$, e $\lVert A\mathbf 1\rVert\approx39$. Erros nos coeficientes:

```text
resíduo t    NE mediana   QR mediana   QR mín     QR máx     QR pior que NE
0            7.17e-03     5.01e-10     (sem r, um caso)      0
1e-03        6.33e-03     6.56e-09     1.37e-10   2.93e-08   0 de 40
1e-01        6.15e-03     6.44e-07     2.54e-08   2.95e-06   0 de 40
1            5.71e-03     6.44e-06     2.59e-07   2.95e-05   0 de 40
1e+02        4.82e-03     6.44e-04     2.60e-05   2.95e-03   3 de 40
1e+04        6.19e-02     6.44e-02     2.60e-03   2.95e-01   18 de 40
```

O erro de QR cresce linearmente com $t$: é o termo $\kappa^2\tan\theta$ em ação, e `lstsq` tem as mesmas medianas de $t=0{,}1$ em diante. Já em $t=10^{-3}$ a mediana é 13 vezes o valor de $t=0$. A inclinação depende da direção de $\hat r$, por um fator de cerca de 100 nesses sorteios. As equações normais ficam perto de $6\times10^{-3}$ até o resíduo superar de longe o ajuste. A vantagem de QR encolhe de cerca de sete ordens de grandeza até sumir: em $t=10^4$ ele perde em 18 dos 40 sorteios.

### Exemplo 4: a base é o conserto de verdade

$\kappa_2(A)$ para os mesmos 100 pontos e o mesmo espaço de polinômios:

```text
 d   monômios em [0,1]   monômios em [-1,1]   Chebyshev em [-1,1]
 4   6.65e+02            1.85e+01             2.33
 8   6.56e+05            5.31e+02             2.81
12   6.90e+08            1.63e+04             2.92
16   7.56e+11            5.24e+05             2.94
```

Com a base de Chebyshev em $d=12$, até as equações normais chegam a erro de coeficientes $1{,}1\times10^{-15}$, contra $5{,}3\times10^{-16}$ de QR, e `numpy.polynomial.Chebyshev.fit` coincide com os coeficientes de QR até $1{,}0\times10^{-15}$. Portanto, as equações normais não estão sempre erradas. Numa matriz de Chebyshev $2\times10^6\times10$ ($\kappa_2=3{,}7$), elas levaram $0{,}02$ s contra $0{,}18$ s de `lstsq` e $0{,}32$ s de `qr` numa máquina, com respostas diferindo em $2{,}8\times10^{-14}$. Essa distância é maior que a razão de flops de 2, em parte porque `qr` também forma $Q$ explicitamente. $A^TA$ também pode ser acumulada linha a linha com memória $O(n^2)$, o que serve para fluxos longos demais para guardar.

Uma boa base tem limites. Com $m=100$ pontos equiespaçados, o $\kappa_2$ de Chebyshev é $3{,}0$ em $d=18$, $112$ em $d=40$, $3{,}0\times10^{6}$ em $d=60$ e $8{,}1\times10^{13}$ em $d=80$. Em $d=60$ a curva ajustada chega a cerca de $9559$ entre as amostras de dados limitados a cerca de 1. O fenômeno de Runge está de volta, num problema em que nenhuma base ajuda.

Manter $d$ bem abaixo de $m$ evita isso. Erros máximos para a função de Runge $1/(1+25x^2)$ amostrada em $m$ pontos equiespaçados:

```text
  m   d=10       d=20       d=30       d=40       d=60
 41   1.03e-01   6.39e-02   4.75e+00   1.05e+05   
101   1.02e-01   1.39e-02   5.60e-03   1.53e-02   5.51e+00
401   1.01e-01   1.39e-02   1.91e-03   2.61e-04   1.70e-05
```

O caso $m=41$, $d=40$ é interpolação, e reproduz a explosão da lição anterior. O melhor grau sobe com $m$, ficando bem abaixo dele.

### Exemplo 5: ajustando uma tendência em timestamps Unix

Tome 720 amostras horárias de latência a partir de $t=1{,}7\times10^9$ s, uma série ilustrativa com média perto de 135 ms e tendência quadrática. Ajuste uma parábola ao $t$ bruto.

```python
t = 1.7e9 + 3600 * np.arange(720.0)
days = (t - 1.7e9) / 86400
y = 120 + 0.6 * days + 0.02 * days**2 + np.random.default_rng(7).normal(0, 1.5, 720)
c, _, rank, _ = np.linalg.lstsq(np.vander(t, 3), y, rcond=None)   # rank == 2
p = np.polynomial.Polynomial.fit(t, y, 2)                         # mapeia t para [-1, 1]
```

A matriz bruta tem $\kappa_2=1{,}67\times10^{25}$. O corte padrão, $720\,\varepsilon_{\text{mach}}\sigma_1$, remove o menor valor singular sem nenhum aviso, e o posto devolvido é 2. A curvatura volta como $0{,}00006$ ms por dia$^2$ em vez de $0{,}0205$, a norma do resíduo é $52{,}6$ em vez de $37{,}5$, e a previsão uma semana depois dos dados é $161{,}4$ ms em vez de $169{,}7$. Mapear $t$ para $[-1,1]$ dá $\kappa_2=3{,}75$. `Polynomial.fit` coincide com o ajuste exato até $3\times10^{-12}$ ms. `numpy.polyfit` escala as colunas internamente e chega a $2\times10^{-9}$ ms.

### Exemplo 6: quando as hipóteses falham

**Deficiência de posto.** Tome $x=0,0,1,1,2,2$ e $y=1;\ 1{,}2;\ 2;\ 2{,}2;\ 5;\ 4{,}8$ com uma cúbica: quatro coeficientes, três abscissas distintas, posto 3. Infinitas cúbicas têm os mesmos valores ajustados ótimos. Cholesky falha, QR sem pivoteamento dá $r_{44}=1{,}5\times10^{-15}$ e coeficientes de até $6\times10^{13}$, e `lstsq` informa posto 3 e devolve a solução de norma mínima, em potências crescentes, $(1{,}10;\ 0{,}457;\ 0{,}364;\ 0{,}179)$. `numpy.polyfit` avisa que o ajuste pode estar mal condicionado.

**Um modelo não linear nos parâmetros.** $y=ae^{bx}$ não tem a forma acima. Tirar logaritmos o torna linear, mas exige $y>0$ e minimiza outra soma. Para `x = np.linspace(0, 4, 30)` e `y = 2 * np.exp(0.8 * x) + np.random.default_rng(11).normal(0, 1, 30)`, o ajuste em log dá $a=2{,}159$, $b=0{,}767$ com erro quadrático $24{,}7$. Um ajuste direto com `scipy.optimize.curve_fit` dá $a=2{,}038$, $b=0{,}789$ com erro quadrático $19{,}6$.

## Equívocos Comuns e Armadilhas

- **"$(A^TA)^{-1}A^Tb$ é como se calcula o ajuste."** Isso define a resposta. O Exemplo 2 mostra essa conta perdendo cerca do dobro dos dígitos de QR quando $\kappa$ é grande.
- **"Equações normais são sempre ruins."** Com $A$ bem condicionada elas empatam com QR e custam menos (Exemplo 4).
- **"QR sempre dá erro $\kappa u$."** Quando $\tan\theta$ passa de cerca de $1/\kappa$, o termo $\kappa^2\tan\theta$ domina, mesmo com um resíduo que parece minúsculo (Exemplo 3).
- **"Qualquer QR serve."** Em $d=12$ a perda de ortogonalidade $\lVert Q^TQ-I\rVert_2$ é $3{,}0$ para Gram-Schmidt clássico, $2{,}0\times10^{-8}$ para Gram-Schmidt modificado e $1{,}1\times10^{-15}$ para Householder. Resolver por $Q^Tb$ dá erros de coeficientes de $1{,}0$, $1{,}9\times10^{-5}$ e $8{,}7\times10^{-8}$.
- **"`lstsq` avisa quando algo está errado."** Ele devolve `rank` e não emite aviso. O Exemplo 5 perdeu um grau de liberdade inteiro em silêncio, então compare `rank` com o número de colunas.
- **"Resíduo menor significa modelo melhor."** O resíduo mínimo só pode cair quando $d$ sobe, enquanto o ajuste de $d=60$ no Exemplo 4 oscila até cerca de $9559$ entre as amostras.
- **"Livro vs hoje."** A documentação do NumPy marca `numpy.polyfit` como parte da API antiga de polinômios e prefere `numpy.polynomial`, cujos métodos `fit` mapeiam os dados para uma janela padrão.

## Resumo

Minimizar $\lVert Ac-b\rVert_2$ tem solução única quando $A$ tem posto coluna completo, e as equações normais a caracterizam sem ser o jeito certo de calculá-la, porque $\kappa_2(A^TA)=\kappa_2(A)^2$. Num ajuste de monômios com $\kappa_2(A)=2{,}1\times10^7$, as equações normais deixaram erro de coeficientes $4{,}4\times10^{-3}$ e QR deixou $4{,}1\times10^{-10}$. QR resolve $Rx=Q^Tb$ com cerca do dobro de flops, `lstsq` acrescenta a detecção de posto pelos valores singulares, e um resíduo com $\tan\theta$ acima de cerca de $1/\kappa$ degrada os dois via $\kappa^2\tan\theta$. A ferramenta mais forte é a base: mapear os dados para $[-1,1]$ e usar polinômios de Chebyshev levou $\kappa_2$ de $6{,}9\times10^8$ a $2{,}9$ em $d=12$, e depois disso até as equações normais funcionam. Mantenha o grau bem abaixo de $m$ e confira `rank`.

## Documentation Links

- [Fundamentals of Numerical Computation, 3.2 The normal equations](https://fncbook.com/normaleqns/): a contagem de flops, o número de condição ao quadrado e um exemplo de instabilidade.
- [Fundamentals of Numerical Computation, 3.3 The QR factorization](https://fncbook.com/qr/): QR reduzida e a solução de mínimos quadrados por ela.
- [Fundamentals of Numerical Computation, 3.4 Computing QR factorizations](https://fncbook.com/house/): refletores de Householder e a contagem de flops.
- [MIT OpenCourseWare 18.335J, Week 4](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-4/): resumos de aula sobre equações normais, perda de ortogonalidade em Gram-Schmidt e QR de Householder.
- [NumPy: numpy.linalg.lstsq](https://numpy.org/doc/stable/reference/generated/numpy.linalg.lstsq.html): a solução de norma mínima, o `rcond` padrão e o posto devolvido.
- [NumPy: numpy.linalg.qr](https://numpy.org/doc/stable/reference/generated/numpy.linalg.qr.html): a fatoração reduzida usada aqui.
- [NumPy: numpy.polyfit](https://numpy.org/doc/stable/reference/generated/numpy.polyfit.html): a nota sobre a API antiga de polinômios e o aviso de posto.
- [NumPy: Polynomial.fit](https://numpy.org/doc/stable/reference/generated/numpy.polynomial.polynomial.Polynomial.fit.html): ajuste com domínio mapeado.
- [NumPy: Chebyshev.fit](https://numpy.org/doc/stable/reference/generated/numpy.polynomial.chebyshev.Chebyshev.fit.html): ajuste na base de Chebyshev.
- [SciPy: scipy.optimize.curve_fit](https://docs.scipy.org/doc/scipy/reference/generated/scipy.optimize.curve_fit.html): mínimos quadrados não lineares para modelos como $ae^{bx}$.
