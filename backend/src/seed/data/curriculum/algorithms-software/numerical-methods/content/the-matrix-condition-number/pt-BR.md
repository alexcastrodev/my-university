---
version: 1.0
updatedAt: 2026-11-04
title: "O Número de Condição de uma Matriz"
summary: "O número de condição de uma matriz, como ele limita a amplificação do erro relativo em Ax = b, e a matriz de Hilbert como o caso clássico de mau condicionamento."
---
## Objetivos de Aprendizagem

- Definir $\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert$, calculá-lo nas normas 1, 2 e $\infty$, e lê-lo como o inverso da distância relativa até uma matriz singular.
- Deduzir a cota $\lVert\Delta x\rVert/\lVert x\rVert \le \kappa(A)\,\lVert\Delta b\rVert/\lVert b\rVert$ e enunciar a hipótese necessária quando a própria $A$ é perturbada.
- Explicar por que um resíduo minúsculo não significa um erro minúsculo, e ligar os dois por meio de $\kappa$.
- Usar "$\kappa \approx 10^t$ custa até $t$ dígitos" como teto, não como previsão.
- Medir a matriz de Hilbert perdendo dígitos, e distinguir um número de condição ruim de um determinante pequeno ou de uma escala ruim.

## Contexto e Motivação

`conditioning-and-numerical-stability` separa a sensibilidade de um problema da qualidade de um algoritmo. Esta lição põe um número nessa sensibilidade para $Ax = b$. O número importa porque solvers como `lu-decomposition-and-partial-pivoting` e `iterative-methods-jacobi-and-gauss-seidel` devolvem um vetor sem nenhum comentário. Mais adiante nesta lição, um sistema de Hilbert $12\times12$ é resolvido com resíduo relativo de cerca de $10^{-16}$ e erro relativo de $30\%$. Nada na saída sugere isso, e `numpy.linalg.solve` não emite aviso. É o número de condição que prevê esse resultado.

## Teoria Central

### Definição

Para uma matriz quadrada invertível e uma norma induzida,

$$\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert,$$

e $\kappa(A) = \infty$ quando $A$ é singular. Três fatos saem direto. Como $1 = \lVert I\rVert = \lVert AA^{-1}\rVert \le \lVert A\rVert\,\lVert A^{-1}\rVert$, sempre vale $\kappa(A)\ge 1$. Como $(cA)^{-1} = c^{-1}A^{-1}$, vale $\kappa(cA) = \kappa(A)$ para $c \ne 0$. E na norma 2, $\kappa_2(A) = \sigma_{\max}/\sigma_{\min}$, a razão entre o maior e o menor eixo do elipsoide em que $A$ transforma a esfera unitária; para uma matriz simétrica definida positiva isso é $\lambda_{\max}/\lambda_{\min}$. O valor depende da norma, em geral pouco: a matriz de Hilbert $8\times8$ tem $\kappa_2 = 1{,}53\times10^{10}$ e $\kappa_\infty = 3{,}39\times10^{10}$.

### Perturbando o lado direito

**Hipóteses.** $A$ é invertível, $b \ne 0$, $Ax = b$ e $A(x+\Delta x) = b+\Delta b$. **Conclusão.**

$$\frac{\lVert\Delta x\rVert}{\lVert x\rVert} \le \kappa(A)\,\frac{\lVert\Delta b\rVert}{\lVert b\rVert}.$$

A prova tem duas linhas. Subtraindo, $A\,\Delta x = \Delta b$, logo $\lVert\Delta x\rVert \le \lVert A^{-1}\rVert\,\lVert\Delta b\rVert$. E $b = Ax$ dá $\lVert b\rVert \le \lVert A\rVert\,\lVert x\rVert$, isto é, $1/\lVert x\rVert \le \lVert A\rVert/\lVert b\rVert$. Multiplique as duas. A igualdade exige as duas desigualdades justas ao mesmo tempo: $x$ na direção que $A$ mais estica e $\Delta b$ na direção que $A^{-1}$ mais estica. O Exemplo 1 atinge a cota, então ela não pode ser melhorada em geral.

### Perturbando a matriz

**Hipóteses.** $A$ é invertível, $b \ne 0$ e $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert < 1$. **Conclusão.** $A+\Delta A$ é invertível, e a solução de $(A+\Delta A)(x+\Delta x) = b+\Delta b$ satisfaz

$$\frac{\lVert\Delta x\rVert}{\lVert x\rVert} \le \frac{\kappa(A)}{1-\kappa(A)\,\lVert\Delta A\rVert/\lVert A\rVert}\left(\frac{\lVert\Delta A\rVert}{\lVert A\rVert}+\frac{\lVert\Delta b\rVert}{\lVert b\rVert}\right).$$

A hipótese não é enfeite. O menor $\Delta A$ que torna $A$ singular tem $\lVert\Delta A\rVert_2/\lVert A\rVert_2 = 1/\kappa_2(A)$, então $\kappa_2$ é exatamente o inverso da distância relativa até uma matriz singular. Uma perturbação desse tamanho já pode deixar o sistema sem solução, logo nenhuma cota a cobre (Exemplo 2).

### Resíduo versus erro

Para um $\hat x$ calculado, o resíduo é $r = b - A\hat x$. Então $\hat x$ resolve exatamente o sistema com lado direito $b - r$, e o primeiro teorema dá

$$\frac{\lVert x-\hat x\rVert}{\lVert x\rVert} \le \kappa(A)\,\frac{\lVert r\rVert}{\lVert b\rVert}.$$

O resíduo mede o erro reverso (backward error) e pode ser calculado. O erro é o erro direto (forward error) e não pode. Uma iteração de `iterative-methods-jacobi-and-gauss-seidel` que para com resíduo pequeno também paga esse fator.

A eliminação de Gauss com pivoteamento parcial normalmente devolve $\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert)$ perto do arredondamento unitário $u$ (cerca de $1{,}1\times10^{-16}$ em float64, $6{,}0\times10^{-8}$ em float32). Como $x-\hat x = A^{-1}r$, isso dá $\lVert x-\hat x\rVert/\lVert\hat x\rVert \le \kappa(A)\,\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert)$, cerca de $\kappa u$. A razão $\lVert r\rVert/\lVert b\rVert$ não precisa ficar perto de $u$: para $H_{12}$ com $x$ igual ao seu menor vetor singular à direita ela vale $0{,}16$, enquanto $\lVert r\rVert/(\lVert A\rVert\,\lVert\hat x\rVert) = 9{,}3\times10^{-18}$. Daí a regra de trabalho: com $\kappa \approx 10^t$, espere perder **até** $t$ dos cerca de 16 (float64) ou 7 (float32) dígitos significativos. É um teto vindo de uma cota de pior caso, não uma previsão.

### A matriz de Hilbert

$H_n$ tem entradas $1/(i+j+1)$ para $i,j = 0,\ldots,n-1$. É simétrica definida positiva, e sua inversa tem entradas inteiras (`scipy.linalg.invhilbert` com `exact=True` as devolve como inteiros). É uma matriz de Gram:

$$(H_n)_{ij} = \int_0^1 x^i x^j\, dx.$$

Assim, $H_n$ é o que aparece ao ajustar funções por polinômios na base de monômios em $[0,1]$, e seu mau condicionamento diz que $1, x, x^2, \ldots$ são quase linearmente dependentes ali. Esse fio continua em `least-squares-curve-fitting`. O crescimento conhecido é $\kappa_2(H_n) = O\big((1+\sqrt2)^{4n}/\sqrt n\big)$, um fator que tende a $(1+\sqrt2)^4 \approx 33{,}97$ por unidade de $n$, ou cerca de $1{,}5$ dígito por linha.

## Exemplos Resolvidos

### Exemplo 1: linhas quase paralelas, e a cota atingida

Tome

$$A = \begin{pmatrix}1 & 1\\ 1 & 1{,}0001\end{pmatrix},\quad b = \begin{pmatrix}2\\ 2{,}0001\end{pmatrix},\quad x = \begin{pmatrix}1\\ 1\end{pmatrix}, \quad A^{-1} = \begin{pmatrix}10001 & -10000\\ -10000 & 10000\end{pmatrix}.$$

Então $\lVert A\rVert_\infty = 2{,}0001$ e $\lVert A^{-1}\rVert_\infty = 20001$, logo $\kappa_\infty(A) = 40004{,}0001$. Também $\kappa_2(A) = 40002{,}0$. Mudar $b_2$ em $10^{-4}$, para $2{,}0002$, dá $x+\Delta x = (0, 2)$. A mudança relativa em $b$ é $5{,}0\times10^{-5}$ e em $x$ é $1$, então a amplificação é $20001$, metade da cota.

A pior direção é $\Delta b = (\delta, -\delta)$. Com $\delta = 10^{-6}$, a aritmética exata dá $x+\Delta x = (1{,}020001;\ 0{,}98)$. Agora $\lVert\Delta x\rVert_\infty = 0{,}020001$, a mudança relativa em $b$ é $\delta/2{,}0001$, e a razão entre elas é $40004{,}0001$, exatamente $\kappa_\infty(A)$.

### Exemplo 2: quando a hipótese sobre $\Delta A$ falha

Mantenha $A$ e $b$ e mude só $a_{22}$, com frações exatas. Escreva $\rho = \lVert A^{-1}\rVert_\infty\lVert\Delta A\rVert_\infty$.

```text
novo a22   rho      solução x          mudança rel.   cota completa   1a ordem kappa*dA/A
1.00009    0.200    (0.8889, 1.1111)   0.111          0.250           0.200
1.000001   1.980    (-98, 100)         99             não vale        1.980
1          2.000    nenhuma (singular) indefinida     não vale        2.000
```

Com $\rho = 0{,}2$ a cota vale com folga. Com $\rho = 1{,}98$ a hipótese se foi, o denominador da fórmula fica negativo, e a estimativa de primeira ordem $1{,}98$ erra por um fator de $50$. A última linha não tem solução nenhuma, porque $b$ está fora da imagem da matriz singular.

### Exemplo 3: a matriz de Hilbert em tamanho real

Resolva $H_n x = b$ com `numpy.linalg.solve` em float64. A solução verdadeira é $x = (1,\ldots,1)$, e $b$ é calculado em racionais exatos e depois arredondado, então é tão bom quanto o float64 permite. Os valores de $\kappa_2$ vêm de autovalores com 200 dígitos, e a coluna do resíduo é $\lVert r\rVert_2/(\lVert H_n\rVert_2\lVert\hat x\rVert_2)$.

```text
 n   kappa_2    resíduo rel.   erro rel.   dígitos corretos   16 - log10(kappa)
 4   1.55e+04   0.00e+00       2.91e-13    12.5               11.8
 6   1.50e+07   6.86e-17       9.61e-11    10.0                8.8
 8   1.53e+10   3.27e-17       2.75e-07     6.6                5.8
10   1.60e+13   2.83e-17       3.15e-04     3.5                2.8
12   1.71e+16   8.21e-17       2.95e-01     0.5               -0.2
14   1.85e+19   2.06e-17       4.48e+00    -0.7               -3.3
16   2.02e+22   2.42e-17       6.35e+00    -0.8               -6.3
```

O resíduo fica abaixo de $10^{-16}$ enquanto o erro sobe até $100\%$ e passa disso. Até $n=12$ a regra acompanha o erro, com cerca de um dígito de pessimismo. Depois disso o teto fica alto demais para informar algo: em $n=14$ o erro é $4{,}48$, longe de $\kappa u \approx 2000$. A razão $\kappa_2(H_{n+1})/\kappa_2(H_n)$ sobe de $27{,}2$ em $n=2$ para $32{,}8$ em $n=11$, rumo a $33{,}97$.

Os mesmos tamanhos quebram as ferramentas que os medem:

```text
 n   kappa_2 exato   numpy.linalg.cond
12   1.71e+16        1.68e+16
13   5.63e+17        2.50e+18
14   1.85e+19        1.89e+17
16   2.02e+22        4.35e+17
```

Passado $1/u$, o $\sigma_{\min}$ calculado é ruído de arredondamento, e a resposta pode errar para qualquer lado. `scipy.linalg.solve` emite um `LinAlgWarning` em $n=12$ (com `rcond` informado de $2{,}5\times10^{-17}$) e nenhum em $n=8$; `numpy.linalg.solve` não emitiu aviso em nenhum tamanho testado.

### Exemplo 4: os dados, sozinhos, causam o estrago

A culpa é do solver? Pegue $H_n$ e $b$ já guardados em float64 e resolva em aritmética racional exata, de modo que nenhuma operação arredonde.

```text
 n   solução exata dos dados guardados   numpy.linalg.solve
 8   2.91e-07                            2.75e-07
10   2.42e-04                            3.15e-04
12   1.43e-01                            2.95e-01
14   4.20e+00                            4.48e+00
```

Arredondar $1/3$, $1/7$ e assim por diante ao guardar a matriz já custa os mesmos dígitos. Isso é condicionamento, não instabilidade. A matriz guardada é mensuravelmente outra: $H_{14}$ tem menor autovalor verdadeiro $9{,}9\times10^{-20}$, e sua cópia em float64 tem $-6{,}3\times10^{-18}$, então nem definida positiva ela é. Para $H_{12}$, a distância relativa até a singularidade é $5{,}8\times10^{-17}$, abaixo de $u$.

O mesmo solver, no mesmo tamanho, com uma matriz boa serve de controle: a matriz tridiagonal com $2$ na diagonal e $-1$ ao lado, $n=12$, tem $\kappa_2 = 67{,}8$, e o erro para $x = (1,\ldots,1)$ é $3{,}2\times10^{-17}$.

O float32 acaba antes, como a regra diz: o erro é $2{,}0\times10^{-5}$ em $n=4$, $3{,}25\times10^{-2}$ em $n=6$ e $3{,}55$ em $n=8$. Como as entradas de Hilbert são conhecidas exatamente, mais dígitos resolvem este caso: com `lu_solve` do mpmath em 50 dígitos decimais, $H_{12}$ dá erro relativo na norma 2 entre $2\times10^{-38}$ e $7\times10^{-37}$, conforme o arredondamento de $b$. Com dados medidos, mais precisão de trabalho não devolve o que os dados nunca tiveram.

### Exemplo 5: determinante e escala são outras perguntas

```text
matriz                     det      kappa_2
0.1 * I (tamanho 20)       1e-20    1
[[1, 1e8], [0, 1]]         1        1e+16
[[1, 2], [3, 4]]           -2       14.9
[[1e10, 2e10], [3, 4]]     -2e10    2.5e+10
```

O determinante escala com o tamanho das entradas; $\kappa$ não. As duas últimas linhas são as mesmas equações com a primeira multiplicada por $10^{10}$, como acontece quando uma equação é escrita em outra unidade. $\kappa$ salta nove ordens, e mesmo assim `numpy.linalg.solve` não perde nada: em 2000 lados direitos aleatórios, o pior erro relativo foi $1{,}4\times10^{-15}$. Reescalar linhas ou colunas muda $\kappa$, então equilibre antes de lê-lo como veredito.

## Equívocos Comuns e Armadilhas

- **"Resíduo pequeno significa resposta precisa."** Só quando $\kappa$ é moderado. No Exemplo 3, $n=12$ tem resíduo $8\times10^{-17}$ e erro de $30\%$.
- **"Determinante pequeno significa mal condicionada."** $0{,}1\,I$ de tamanho 20 tem determinante $10^{-20}$ e $\kappa = 1$. Um determinante unitário pode conviver com $\kappa = 10^{16}$.
- **"$\kappa = 10^{t}$ significa perder exatamente $t$ dígitos."** É um teto de pior caso. A matriz reescalada do Exemplo 5 não perdeu nenhum, e as soluções de Hilbert perderam cerca de um dígito a menos que a regra.
- **"Um solver melhor resolve."** A aritmética exata sobre os dados guardados foi igualmente ruim (Exemplo 4). As curas usuais são reformular (uma base melhor, como em `least-squares-curve-fitting`), reescalar, ou ter dados exatos e mais precisão.
- **"`cond` sempre dá o número verdadeiro."** Passado cerca de $1/u$, ele informa ruído (Exemplo 3).
- **"A cota de $\Delta A$ vale para qualquer perturbação."** Ela exige $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert < 1$ (Exemplo 2).

## Resumo

$\kappa(A) = \lVert A\rVert\,\lVert A^{-1}\rVert$ limita como uma mudança relativa em $b$ ou em $A$ é amplificada em $x$, a cota é atingida, e para mudanças em $A$ ela exige $\lVert A^{-1}\rVert\,\lVert\Delta A\rVert<1$. Na norma 2 ele vale $\sigma_{\max}/\sigma_{\min}$, e seu inverso é a distância relativa até a singularidade. O resíduo mede o erro reverso e só vira erro direto depois de multiplicado por $\kappa$, o que dá o teto de cerca de $\log_{10}\kappa$ dígitos perdidos. A matriz de Hilbert, a matriz de Gram dos monômios em $[0,1]$, mostra isso por inteiro: $\kappa_2$ cresce quase 34 vezes por linha, $n=12$ deixa cerca de meio dígito, e a aritmética exata sobre os dados guardados não faz melhor. $\kappa$ não é o determinante e muda com a escala.

## Documentation Links

- [Fundamentals of Numerical Computation, 2.8 Conditioning of linear systems](https://fncbook.com/condition-number/): o número de condição de uma matriz, o teorema de perturbação e o resíduo como erro reverso.
- [MIT OpenCourseWare 18.335J, Week 2](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-2/): resumos de aula sobre normas, estabilidade reversa e números de condição.
- [NumPy: numpy.linalg.cond](https://numpy.org/doc/stable/reference/generated/numpy.linalg.cond.html): as normas aceitas e o cálculo da norma 2 pela SVD.
- [SciPy: scipy.linalg.hilbert](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.hilbert.html): as entradas $1/(i+j+1)$ usadas aqui.
- [SciPy: scipy.linalg.solve](https://docs.scipy.org/doc/scipy/reference/generated/scipy.linalg.solve.html): o solver, incluindo o `LinAlgWarning` para entrada mal condicionada.
- [Wikipedia: Hilbert matrix](https://en.wikipedia.org/wiki/Hilbert_matrix): a forma de Gram e a taxa de crescimento do número de condição.
