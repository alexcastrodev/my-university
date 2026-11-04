---
version: 1.0
updatedAt: 2026-11-04
title: "Equações Diferenciais e Problemas de Valor Inicial"
summary: "O que é uma equação diferencial, ordem e soluções, problemas de valor inicial, campos de direções (slope fields) e crescimento e decaimento exponencial como primeiro modelo."
---
## Objetivos de Aprendizagem

- Definir equação diferencial, sua ordem e o que significa uma função ser solução em um intervalo.
- Verificar uma solução candidata substituindo-a na equação e na condição inicial.
- Distinguir solução geral de solução particular e dizer o que um problema de valor inicial acrescenta.
- Enunciar o teorema de existência e unicidade com suas hipóteses e reconhecer uma equação em que a conclusão falha.
- Ler um campo de direções (slope field), segui-lo com o método de Euler e avaliar o erro do resultado.
- Resolver $y' = ky$ e usá-la para crescimento exponencial, decaimento, tempo de duplicação e meia-vida.

## Contexto e Motivação

Muitas leis de variação são enunciadas como taxas: uma população cresce em proporção ao seu tamanho, um objeto quente perde calor em proporção à diferença de temperatura, um vetor de parâmetros se move contra o gradiente de uma função de perda. Uma taxa é uma derivada, então a lei é uma equação que contém a função desconhecida e sua derivada. Isso é uma **equação diferencial**, e resolvê-la é achar a função cuja taxa de variação obedece à lei.

O caso mais simples, $y' = f(t)$, se resolve com primitivas (`antiderivatives-and-initial-value-problems`). Aqui o lado direito pode depender do próprio $y$, e a resposta deixa de estar a uma integral de distância. Esta lição monta o vocabulário, a verificação por substituição usada em todas as soluções seguintes, o teorema que diz quando existe resposta e quando ela é única, e o primeiro modelo, crescimento e decaimento exponencial. A próxima lição, `separable-differential-equations`, resolve uma classe inteira dessas equações.

## Teoria Central

### Equações, ordem e soluções

Uma **equação diferencial ordinária** (EDO) relaciona uma função desconhecida $y(t)$ de uma variável com suas derivadas. A **ordem** é a maior derivada que aparece: $y' = 2y$ é de primeira ordem, $y'' + 4y = 0$ é de segunda ordem.

Uma **solução** em um intervalo $I$ é uma função derivável que transforma a equação em identidade verdadeira para todo $t \in I$. O intervalo faz parte da resposta: uma fórmula pode resolver a equação em um intervalo e não fazer sentido em outro.

O teste confiável de uma solução é a substituição: ponha o candidato e suas derivadas na equação e confira que os dois lados coincidem para todo $t$ do intervalo, isto é, que o resíduo $y' - f(t, y)$ se simplifica a $0$. Funciona não importa como o candidato foi achado, por isso é o último passo de todo problema abaixo.

### Solução geral, solução particular, problema de valor inicial

Em uma equação de primeira ordem, as soluções costumam vir em uma família com uma constante arbitrária. Para $y' = 2y$, toda função $y = Ce^{2t}$ serve: $y' = 2Ce^{2t} = 2y$. Essa é uma **solução geral**. Uma **solução particular** fixa a constante. Uma equação de segunda ordem costuma precisar de duas constantes, uma por ordem.

Um **problema de valor inicial** (PVI) junta a equação a condições que fixam as constantes: na primeira ordem, $y(t_0) = y_0$. Para $y' = 2y$, $y(0) = 3$ dá $C = 3$ e $y = 3e^{2t}$. A condição inicial também precisa ser verificada.

Uma solução geral não garante que não existam outras soluções; o Exemplo 2 tem uma fora da família.

### Existência e unicidade

Considere o PVI $y' = f(t, y)$, $y(t_0) = y_0$.

**Teorema (Picard e Lindelöf).** Suponha que $f$ e $\partial f/\partial y$ sejam ambas contínuas em um retângulo aberto do plano $(t, y)$ que contém $(t_0, y_0)$. Então existe algum intervalo em torno de $t_0$ no qual o PVI tem solução, e duas soluções coincidem em todo intervalo que contém $t_0$ no qual ambas permanecem dentro do retângulo.

O teorema é **local**: garante solução perto de $t_0$, não para todo $t$. E a unicidade é garantida pela **segunda** hipótese (suficiente, não necessária: $y' = \lvert y\rvert$ não tem $\partial f/\partial y$ em $y = 0$, e mesmo assim cada PVI dela tem uma só solução). Com $f$ apenas contínua, a solução existe, mas a unicidade pode falhar. As duas falhas aparecem abaixo. Uma consequência usada depois: quando as hipóteses valem em toda parte, duas curvas-solução distintas nunca se tocam, pois tocar-se significaria duas soluções por um mesmo ponto.

### Campos de direções e o método de Euler

A equação $y' = f(t, y)$ atribui uma inclinação a cada ponto $(t, y)$. Desenhe em cada ponto um segmento curto com essa inclinação e você tem um **campo de direções** (slope field). Uma curva-solução é tangente aos segmentos por onde passa. Para $y' = t - y$, as inclinações em alguns pontos são:

```text
inclinação = t - y   t=0   t=1   t=2   t=3   t=4
y =  3               -3    -2    -1     0     1
y =  2               -2    -1     0     1     2
y =  1               -1     0     1     2     3
y =  0                0     1     2     3     4
y = -1                1     2     3     4     5
```

A inclinação é $0$ ao longo da reta $y = t$, negativa acima dela e positiva abaixo. Uma solução que começa acima dessa reta desce até encontrá-la e depois sobe.

O **método de Euler** transforma o desenho em algoritmo: de $(t_n, y_n)$, siga a inclinação local por um passo $h$:

$$y_{n+1} = y_n + h\,f(t_n, y_n), \qquad t_{n+1} = t_n + h.$$

É a aproximação pela reta tangente aplicada repetidamente. O erro em um tempo fixo diminui aproximadamente em proporção a $h$ (é um método de primeira ordem) e em geral não desaparece para $h$ fixo.

### Crescimento e decaimento exponencial

Suponha uma grandeza que varia a uma taxa proporcional ao seu tamanho: $y' = ky$, $y(0) = y_0$, com $k$ constante. A função $y = y_0 e^{kt}$ a resolve. Para ver que é a **única** solução, seja $y$ uma solução qualquer em um intervalo e calcule

$$\frac{d}{dt}\left(y\,e^{-kt}\right) = y'e^{-kt} - ky\,e^{-kt} = (y' - ky)\,e^{-kt} = 0.$$

Uma função de derivada nula em um **intervalo** é constante nele (consequência do Teorema do Valor Médio, `the-mean-value-theorem-and-monotonicity`), então $y e^{-kt} = C$, e a condição inicial dá $C = y_0$. A palavra "intervalo" importa: em um domínio como $t \neq 0$, que tem duas partes, a constante pode ser diferente em cada uma.

Para $k > 0$ há crescimento com **tempo de duplicação** $T_2 = \ln 2 / k$. Para $k < 0$ há decaimento com **meia-vida** $T_{1/2} = \ln 2 / \lvert k \rvert$. Ambos independem da quantidade inicial, que é a assinatura da variação exponencial.

## Exemplos Resolvidos

### Exemplo 1: verificando uma solução e seu intervalo

Verifique que $y = 1/(1 - t)$ resolve $y' = y^2$, $y(0) = 1$.

$$y' = \frac{1}{(1-t)^2} = y^2, \qquad y(0) = \frac{1}{1 - 0} = 1.$$

Os dois lados coincidem, então a fórmula resolve a equação onde estiver definida e for derivável, isto é, em $t \neq 1$, conjunto de duas partes. Ela cumpre $y(0) = 1$ na parte que contém $t_0 = 0$. A solução do PVI por $(0, 1)$ vive em $(-\infty, 1)$, a parte que contém $t_0 = 0$. Uma integração numérica concorda ($y(0{,}9) = 10$, $y(0{,}99) = 100$) e dispara para o infinito quando $t \to 1^-$.

Esta é a localidade do teorema: $y^2$ e $2y$ são contínuas no plano todo, e mesmo assim a solução explode em tempo finito.

### Exemplo 2: quando a unicidade falha

Considere $y' = 3y^{2/3}$, $y(0) = 0$, com a raiz cúbica real. A função $y \equiv 0$ é solução: os dois lados valem $0$. A função $y = t^3$ também é: $y' = 3t^2$ e $3(t^3)^{2/3} = 3t^2$ para todo real $t$, e $y(0) = 0$. Um PVI, duas soluções.

Há muitas outras. Para qualquer $c \ge 0$, tome $y = 0$ para $t \le c$ e $y = (t - c)^3$ para $t > c$: o segundo pedaço tem derivada $3(t-c)^2 \to 0$ em $t = c$, igual à do primeiro, então a função colada resolve a equação. Uma solução pode ficar em $0$ o tempo que quiser e depois decolar.

O teorema explica. Aqui $f(y) = 3y^{2/3}$ é contínua, mas $\partial f/\partial y = 2y^{-1/3}$ não está definida em $y = 0$ e é ilimitada perto dele (vale $20$ em $y = 10^{-3}$ e $2000$ em $y = 10^{-9}$). A segunda hipótese falha exatamente no ponto inicial. Além disso, a família $y = (t - c)^3$ nunca é a função nula, então $y \equiv 0$ fica fora dessa "solução geral".

### Exemplo 3: método de Euler contra a solução exata

Tome $y' = t - y$, $y(0) = 1$. A função $y = t - 1 + 2e^{-t}$ a resolve: $y' = 1 - 2e^{-t}$ e $t - y = 1 - 2e^{-t}$, além de $y(0) = -1 + 2 = 1$. Com $h = 0{,}5$, Euler dá:

```text
t      y Euler    y exato
0.0    1.0000     1.0000
0.5    0.5000     0.7131
1.0    0.5000     0.7358
1.5    0.7500     0.9463
2.0    1.1250     1.2707
```

O erro em $t = 2$ é $0{,}1457$. Reduzindo o passo à metade, os erros em $t = 2$ são $0{,}0704$ ($h = 0{,}25$), $0{,}0345$ ($h = 0{,}125$) e $0{,}0171$ ($h = 0{,}0625$): cada divisão de $h$ por dois divide o erro aproximadamente por dois.

### Exemplo 4: o método de Euler é o gradient descent

Minimize $f(x) = 5x^2$ por gradient descent com passo $h$: $x_{k+1} = x_k - h\,f'(x_k) = (1 - 10h)\,x_k$. Isto é exatamente o método de Euler aplicado ao **fluxo do gradiente** $x' = -f'(x) = -10x$, cuja solução é $x(t) = x_0 e^{-10t}$ (veja `gradients-extending-derivatives-to-several-variables` para o gradiente em várias variáveis). Partindo de $x_0 = 1$:

```text
h      fator 1-10h   x_0..x_5
0.05    0.5          1, 0.5, 0.25, 0.125, 0.0625, 0.0312
0.15   -0.5          1, -0.5, 0.25, -0.125, 0.0625, -0.0312
0.20   -1.0          1, -1, 1, -1, 1, -1
0.25   -1.5          1, -1.5, 2.25, -3.375, 5.0625, -7.5938
```

O fluxo verdadeiro decai monotonicamente, mas as iteradas de Euler convergem só quando $\lvert 1 - 10h \rvert < 1$, isto é, $0 < h < 0{,}2$. Em $h = 0{,}15$ elas convergem trocando de sinal, ou seja, não acompanham o fluxo; em $h = 0{,}25$ divergem. Um passo grande demais quebra a discretização mesmo com a equação contínua perfeitamente comportada.

### Exemplo 5: meia-vida

Uma substância decai com meia-vida de $8$ dias (valor hipotético). Então $k = -\ln 2 / 8 \approx -0{,}08664\ \text{dia}^{-1}$ e $y = y_0 e^{kt} = y_0\,2^{-t/8}$. Após $30$ dias resta a fração $2^{-30/8} \approx 0{,}0743$, cerca de $7{,}4\%$. O tempo para cair a $1\%$ resolve $2^{-t/8} = 0{,}01$, logo $t = 8\log_2 100 \approx 53{,}15$ dias. Verificação por substituição: $y' = -\frac{\ln 2}{8}\,y_0 2^{-t/8} = k y$.

## Equívocos Comuns e Armadilhas

- **"Uma solução é um número."** É uma função, e vem com um intervalo. A fórmula do Exemplo 1 também está definida para $t > 1$, mas esse ramo é outra solução e não satisfaz $y(0) = 1$.
- **"Uma equação suave tem solução para todo tempo."** O teorema é local, e $y' = y^2$ explode.
- **"Todo PVI tem exatamente uma solução."** Tem, em algum intervalo em torno de $t_0$, quando $f$ e $\partial f/\partial y$ são contínuas perto do ponto inicial. Sem a segunda condição, o Exemplo 2 pode surgir.
- **"A solução geral lista todas as soluções."** Ela lista a família que o método usual produz. Procure soluções fora dela, como a próxima lição faz de forma sistemática.
- **"Passo de Euler menor é sempre mais seguro, e maior é só menos preciso."** Um passo grande demais pode tornar a iteração instável, como no Exemplo 4.
- **Conferir a fórmula e esquecer a condição inicial.** Uma função pode satisfazer a equação e errar $y(t_0) = y_0$, resolvendo então outro PVI.

## Resumo

Uma solução de uma equação diferencial é uma função em um intervalo que transforma a equação em identidade, testada por substituição. A solução geral de primeira ordem tem uma constante, que a condição inicial fixa. Se $f$ e $\partial f/\partial y$ são contínuas perto de $(t_0, y_0)$, o PVI tem solução única em algum intervalo em torno de $t_0$, mas só localmente, e sem a segunda hipótese a unicidade pode falhar ($y' = 3y^{2/3}$). Campos de direções mostram as curvas-solução e o método de Euler as segue em passos, com erro proporcional a $h$ e instabilidade para $h$ grande, o que também explica o limite de passo do gradient descent. A equação $y' = ky$ tem a solução única $y_0e^{kt}$, com tempo de duplicação ou meia-vida $\ln 2 / \lvert k \rvert$.

## Documentation Links

- [OpenStax Calculus Volume 2, 4.1 Basics of Differential Equations](https://openstax.org/books/calculus-volume-2/pages/4-1-basics-of-differential-equations): ordem, soluções geral e particular, problemas de valor inicial e verificação de soluções.
- [OpenStax Calculus Volume 2, 4.2 Direction Fields and Numerical Methods](https://openstax.org/books/calculus-volume-2/pages/4-2-direction-fields-and-numerical-methods): campos de direções, curvas-solução, equilíbrios e o método de Euler.
- [MIT OpenCourseWare 18.01SC, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): notas de aula, vídeos e problemas, incluindo a sessão "Introduction to Differential Equations".
