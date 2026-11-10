---
version: 1.0
updatedAt: 2026-11-04
title: "Aplicações: Área, Volume e Valor Médio"
summary: "Montar integrais para a área entre curvas, volumes por fatiamento e por revolução, e o valor médio de uma função em um intervalo."
---
## Objetivos de Aprendizagem

- Montar a área entre duas curvas como $\int\lvert f-g\rvert$, dividindo nos cruzamentos e escolhendo $dx$ ou $dy$ para evitar a divisão.
- Calcular volumes a partir de áreas de seções transversais, com discos, arruelas e cascas cilíndricas, medindo o raio a partir do eixo de rotação real.
- Explicar a receita fatiar-aproximar-somar-tomar o limite e vê-la convergir numericamente.
- Calcular o valor médio de uma função, enunciar o Teorema do Valor Médio para Integrais com sua hipótese e mostrar um caso em que ele falha.
- Conectar o valor médio a amostragem, estimativa de Monte Carlo e erro quadrático médio.

## Contexto e Motivação

`the-definite-integral-and-riemann-sums` definiu a integral como limite de somas, e `integration-by-substitution-and-by-parts` forneceu ferramentas para calculá-la. Esta lição trata de montar integrais. A mesma receita produz área, volume, massa, trabalho e valores esperados: corte a grandeza em pedaços finos, aproxime cada pedaço por algo simples, some e tome o limite. Quando uma grandeza está escrita como $\int(\text{algo})\,dx$, as duas lições anteriores a calculam.

O valor médio é a peça de maior alcance em computação. A média de uma função num intervalo é a versão contínua da média de dados: é o alvo de um estimador de Monte Carlo, a constante que minimiza o erro quadrático e, aplicada a $f^2$ e seguida de uma raiz quadrada, o valor quadrático médio (RMS) usado em sinais e funções de perda.

## Teoria Central

### A receita

Divida $[a,b]$ em $n$ pedaços de largura $\Delta x$. No $i$-ésimo pedaço, aproxime a grandeza por uma forma simples usando o valor da função num ponto-tag, como um retângulo, um disco ou uma casca fina. Some tudo para obter uma soma de Riemann. Se a grandeza é aditiva entre os pedaços e a aproximação é precisa em primeira ordem em $\Delta x$, o limite é uma integral definida. O difícil é a montagem: um esboço, uma fatia representativa e o seu tamanho.

### Área entre curvas

Se $f$ e $g$ são contínuas em $[a,b]$,

$$\text{Área} = \int_a^b \lvert f(x)-g(x)\rvert\,dx$$

Quando $f\ge g$ em todo o intervalo, isso é $\int(f-g)$. Quando as curvas se cruzam, ache os cruzamentos (resolva $f=g$), divida ali e integre (de cima menos de baixo) em cada pedaço. Às vezes uma região é mais simples como função de $y$: área $=\int(x_{\text{direita}}-x_{\text{esquerda}})\,dy$.

### Volumes por seções transversais

Se um sólido está entre $x=a$ e $x=b$ e $A(x)$ é a área (contínua) de sua seção transversal perpendicular ao eixo $x$,

$$V=\int_a^b A(x)\,dx$$

Três casos comuns quando uma região gira em torno de uma reta:

- **Discos.** Região $0\le y\le f(x)$ em torno do eixo $x$: $A=\pi f(x)^2$.
- **Arruelas.** Região entre uma curva externa e uma interna: $A=\pi(R^2-r^2)$, onde $R$ e $r$ são as distâncias externa e interna **ao eixo**. Note $R^2-r^2$, e não $(R-r)^2$.
- **Cascas.** Girar uma faixa de largura $dx$ a uma distância $\rho(x)$ de um eixo vertical varre uma casca cilíndrica fina de volume aproximado $2\pi\rho(x)\,h(x)\,dx$, então $V=2\pi\int\rho(x)\,h(x)\,dx$, com $h$ a altura da faixa.

Essas fórmulas supõem que a região fica de um só lado do eixo. Uma região que atravessa o eixo pode se dobrar sobre si mesma ao girar: onde os dois lados varrem sólido sobreposto, somar os dois conta a sobreposição em dobro. (Quando os dois lados ficam em posições diferentes ao longo do eixo, como em $\sin x$ em $[0,2\pi]$ em torno do eixo $x$, nada se sobrepõe.)

### Valor médio

Para $f$ integrável em $[a,b]$:

$$f_{\text{méd}}=\frac1{b-a}\int_a^b f(x)\,dx$$

É o limite da média comum de $n$ amostras igualmente espaçadas, pois $\frac1n\sum f(x_i^*)=\frac1{b-a}\sum f(x_i^*)\Delta x$.

**Teorema do Valor Médio para Integrais.** Se $f$ é **contínua** em $[a,b]$, existe $c\in[a,b]$ com $f(c)=f_{\text{méd}}$. A razão: a média fica entre o mínimo e o máximo de $f$ (que existem, pela continuidade num intervalo fechado), e uma função contínua assume todo valor intermediário (veja `continuity-and-the-intermediate-value-theorem`). Sem continuidade, pode falhar: $f=0$ em $[0,\tfrac12)$ e $f=1$ em $[\tfrac12,1]$ tem média $\tfrac12$, valor que $f$ nunca assume. O teorema diz que algum $c$ existe, não que é único.

## Exemplos Resolvidos

### Exemplo 1: área entre curvas

As curvas $y=x$ e $y=x^2$ se encontram onde $x=x^2$, em $x=0$ e $x=1$, com $x\ge x^2$ entre elas:

$$\int_0^1(x-x^2)\,dx=\frac12-\frac13=\frac16$$

### Exemplo 2: curvas que se cruzam

Ache a área entre $y=\sin x$ e $y=\cos x$ em $[0,\pi]$. Elas se cruzam onde $\tan x=1$, em $x=\pi/4$ (o cruzamento seguinte, $5\pi/4$, está fora). Então $\cos\ge\sin$ em $[0,\pi/4]$ e $\sin\ge\cos$ em $[\pi/4,\pi]$:

$$\int_0^{\pi/4}(\cos x-\sin x)\,dx+\int_{\pi/4}^{\pi}(\sin x-\cos x)\,dx=(\sqrt2-1)+(\sqrt2+1)=2\sqrt2\approx2{,}8284$$

A quadratura de $\lvert\sin x-\cos x\rvert$ dá os mesmos $2{,}8284$. O atalho $\int_0^\pi(\sin x-\cos x)\,dx=2$ é uma área com sinal e erra por cerca de 29%.

### Exemplo 3: escolhendo a variável

A região entre $x=y^2$ e $y=x-2$ tem cruzamentos em $(1,-1)$ e $(4,2)$. Em $y$ é uma só integral:

$$\int_{-1}^{2}\big((y+2)-y^2\big)\,dy=\frac92$$

Em $x$ a fronteira inferior muda em $x=1$ (do ramo inferior da parábola, $-\sqrt x$, para a reta), então são dois pedaços: $\int_0^1 2\sqrt x\,dx+\int_1^4(\sqrt x-x+2)\,dx=\frac43+\frac{19}6=\frac92$.

### Exemplo 4: um volume como limite visível

Gire $y=\sqrt x$, $0\le x\le4$, em torno do eixo $x$. Cada fatia é um disco de área $\pi x$, então $V=\pi\int_0^4x\,dx=8\pi\approx25{,}1327$. Somas de Riemann dos volumes dos discos convergem para ele:

```text
   n     left sum   right sum   (exact 8*pi = 25.1327)
   4     18.8496     31.4159
  16     23.5619     26.7035
  64     24.7400     25.5254
 256     25.0346     25.2309
1024     25.1082     25.1573
```

O erro diminui como $1/n$, a taxa usual das somas pela esquerda e pela direita quando o integrando assume valores diferentes nas duas pontas (aqui $0$ e $4\pi$). A soma de ponto médio é exata para todo $n$ aqui, porque a área da fatia $\pi x$ é linear em $x$ e a regra do ponto médio integra funções lineares exatamente.

### Exemplo 5: arruelas e cascas concordam

A região entre $y=x$ e $y=x^2$, $0\le x\le1$. Em torno do eixo $x$, arruelas com $R=x$, $r=x^2$: $\pi\int_0^1(x^2-x^4)\,dx=\frac{2\pi}{15}\approx0{,}41888$. Em torno do eixo $y$, cascas de raio $x$ e altura $x-x^2$: $2\pi\int_0^1x(x-x^2)\,dx=\frac\pi6\approx0{,}52360$. Arruelas em $y$ (raio externo $\sqrt y$, raio interno $y$) dão $\pi\int_0^1(y-y^2)\,dy=\frac\pi6$ também. Dois métodos, uma resposta.

### Exemplo 6: um eixo que não é coordenado

Gire a mesma região em torno da reta $x=2$. O raio da casca é a distância ao eixo, $2-x$:

$$V=2\pi\int_0^1(2-x)(x-x^2)\,dx=\frac\pi2\approx1{,}5708$$

Arruelas em $y$ dão o mesmo: $\pi\int_0^1\big[(2-y)^2-(2-\sqrt y)^2\big]dy=\frac\pi2$. Uma estimativa de Monte Carlo (NumPy `default_rng(1)`, $N=4\,000\,000$ pontos uniformes na caixa $[0,4]\times[0,1]\times[-2,2]$ de volume $16$, contando os pontos dentro do sólido) deu $1{,}5707$ com erro padrão de cerca de $0{,}0024$, consistente. Usar o raio $x$ por hábito daria $\frac\pi6$, o volume em torno do eixo $y$, e não deste sólido.

### Exemplo 7: seções transversais não circulares

Uma pirâmide com base quadrada de lado $s$ e altura $h$ tem, à distância $x$ acima da base, uma seção quadrada de lado $s(1-x/h)$, então $V=\int_0^hs^2(1-x/h)^2dx=\frac{s^2h}3$. Para $s=3$, $h=5$ isso dá $15$, batendo com a quadratura.

### Exemplo 8: valor médio e erro quadrático

Em $[0,\pi]$, $\sin$ tem média $\frac2\pi\approx0{,}63662$. A equação $\sin c=\frac2\pi$ tem duas soluções, $c\approx0{,}6901$ e $2{,}4515$. A média de $\sin$ em $n$ pontos médios dá $0{,}65328$ ($n=4$), $0{,}63764$ ($16$), $0{,}63668$ ($64$), $0{,}636620$ ($1024$). A média em pontos aleatórios é integração de Monte Carlo: $0{,}6443$ ($n=100$), $0{,}6305$ ($10^4$), $0{,}63676$ ($10^6$), convergindo mais devagar e de forma irregular, a uma taxa de cerca de $1/\sqrt n$.

Que constante $c$ aproxima melhor $f(x)=x^2$ em $[0,1]$ em erro quadrático médio? Expandindo,

$$\text{EQM}(c)=\int_0^1(x^2-c)^2\,dx=c^2-\tfrac23c+\tfrac15$$

que é minimizado em $c=\tfrac13=f_{\text{méd}}$, com mínimo $\tfrac4{45}\approx0{,}0889$. Numericamente, $c=0{,}2$ dá $0{,}1067$ e $c=0{,}5$ dá $0{,}1167$. Em geral, o valor médio é a constante de mínimos quadrados. O valor RMS de $\sin$ num período é $\sqrt{1/2}=0{,}7071$, pois a média de $\sin^2$ é $\tfrac12$.

## Equívocos Comuns e Armadilhas

- **Integrar $f-g$ atravessando um cruzamento.** Isso dá área com sinal. Divida nos cruzamentos ou integre $\lvert f-g\rvert$ (Exemplo 2).
- **Raio igual a $x$.** O raio é a distância ao eixo de rotação. Em torno de $x=2$ ele é $2-x$ (Exemplo 6).
- **Área da arruela como $\pi(R-r)^2$.** É $\pi(R^2-r^2)$.
- **Misturar métodos.** Cascas combinam com $dx$ para um eixo vertical e arruelas com $dy$. Escrever o raio de uma casca junto com a área de uma arruela numa só integral não faz sentido.
- **Média das extremidades.** Para $\sin$ em $[0,\pi]$ a média de $f(0)$ e $f(\pi)$ é $0$, enquanto $f_{\text{méd}}=0{,}6366$. Para $f$ linear as duas coincidem; em geral, não.
- **Acreditar que a média é sempre assumida.** A continuidade garante um ponto em que $f$ é igual à média, mas sem ela o valor pode não ser atingido (Teoria Central). A continuidade é suficiente, não necessária: $f$ igual a $0$, $1$, $2$ nos três terços de $[0,1]$ tem média $1$ e a atinge. O ponto em geral não é o meio do intervalo.
- **Girar uma região que cruza o eixo** e somar as duas metades. As metades podem se sobrepor, e então a sobreposição é contada duas vezes.

## Resumo

Montar uma integral é fatiar, aproximar cada fatia por uma forma simples, somar e tomar o limite. Para área, integre de cima menos de baixo, dividindo nos cruzamentos (ou integre $\lvert f-g\rvert$), e mude para $y$ se isso evitar uma divisão. Para volume, integre a área da seção transversal: $\pi f^2$ para discos, $\pi(R^2-r^2)$ para arruelas e $2\pi\rho h$ para cascas, com todos os raios medidos a partir do eixo e a região de um só lado dele. Uma soma de Riemann pela esquerda ou pela direita dos volumes das fatias converge para o volume exato, como a tabela de $8\pi$ mostra. O valor médio $\frac1{b-a}\int_a^bf$ é o limite das médias amostrais, é igual a $f(c)$ para algum $c$ quando $f$ é contínua (e pode falhar caso contrário), e é a constante que minimiza o erro quadrático médio. A próxima lição, `improper-integrals`, estende a integral a intervalos e integrandos ilimitados.

## Documentation Links

- [OpenStax Calculus Volume 1, 6.1 Areas between Curves](https://openstax.org/books/calculus-volume-1/pages/6-1-areas-between-curves): integrar em relação a x ou y, e regiões com curvas que se cruzam.
- [OpenStax Calculus Volume 1, 6.2 Determining Volumes by Slicing](https://openstax.org/books/calculus-volume-1/pages/6-2-determining-volumes-by-slicing): fatiamento, discos e arruelas.
- [OpenStax Calculus Volume 1, 6.3 Volumes of Revolution: Cylindrical Shells](https://openstax.org/books/calculus-volume-1/pages/6-3-volumes-of-revolution-cylindrical-shells): o método das cascas e quando escolhê-lo.
- [OpenStax Calculus Volume 1, 5.3 The Fundamental Theorem of Calculus](https://openstax.org/books/calculus-volume-1/pages/5-3-the-fundamental-theorem-of-calculus): o Teorema do Valor Médio para Integrais e o valor médio de uma função.
- [Active Calculus, 6.2 Using definite integrals to find volume](https://activecalculus.org/single/sec-6-2-volume.html): volumes a partir de fatias, discos e arruelas.
- [MIT OCW 18.01SC, Unit 3 Part C](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-3-the-definite-integral-and-its-applications/part-c-average-value-probability-and-numerical-integration/): aulas sobre valor médio e integração numérica.
