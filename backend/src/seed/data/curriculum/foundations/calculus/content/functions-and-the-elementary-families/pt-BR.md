---
version: 1.0
updatedAt: 2026-11-04
title: "Funções e as Famílias Elementares"
summary: "Funções como mapeamentos com domínio e imagem, e as famílias que o restante da disciplina usa o tempo todo: afim, quadrática, polinomial, exponencial, logarítmica e trigonométrica, com composição e inversas. Esta lição absorve a pré-cálculo que a disciplina pressupõe."
---
## Objetivos de Aprendizagem

- Enunciar o que é uma função (domínio, contradomínio, imagem) e encontrar o domínio natural de uma expressão com quociente, raiz de índice par ou logaritmo.
- Formar uma composição $f\circ g$, encontrar seu domínio e explicar por que $f\circ g$ e $g\circ f$ costumam ser funções diferentes.
- Decidir quando uma função tem inversa, construí-la e nomear a restrição de domínio que a faz existir.
- Reconhecer as seis famílias que o restante da disciplina usa (afim, quadrática, polinomial, exponencial, logarítmica, trigonométrica) e descrever forma, domínio e imagem de cada uma.
- Usar o logaritmo para responder "quantas duplicações" e "quanto tempo para dobrar", evitando os erros de domínio que as leis do logaritmo convidam.

## Contexto e Motivação

O cálculo estuda como uma grandeza muda quando outra muda, então toda afirmação nele é uma afirmação sobre uma função. Uma função é a versão matemática de um procedimento puro: dê uma entrada, receba exatamente uma saída, sem estado escondido. Quem programa já pensa assim, mas há uma diferença que importa aqui. O código costuma aceitar "qualquer inteiro" ou "qualquer float" e quebra ou devolve lixo fora dos casos que o autor imaginou. A matemática exige que o conjunto de entradas legais faça parte da definição, e a maioria dos erros de cálculo (um fator cancelado que removeu um ponto, um logaritmo de número negativo, uma inversa que não é inversa) são erros sobre esse conjunto.

Esta lição também faz algo incomum num curso de cálculo: absorve a pré-cálculo que as lições seguintes pressupõem. Ela é seletiva. Não reensina fatoração nem o círculo unitário do zero. Reúne os fatos que limites, derivadas e integrais vão usar sem parar: o que é um domínio, como funcionam composição e inversas, e as poucas famílias de funções que modelam quase tudo. A exponencial e o logaritmo recebem mais atenção, porque se ligam diretamente à computação: o número de vezes que dá para dividir um problema ao meio até resolvê-lo é um logaritmo, e uma grandeza que dobra a cada passo é uma exponencial. A próxima lição, `limits-intuition-and-the-formal-definition`, pressupõe tudo que está aqui.

## Teoria Central

### Funções, domínio e imagem

Uma **função** $f$ de um conjunto $D$ em um conjunto $C$ associa a cada $x$ em $D$ exatamente um elemento $f(x)$ de $C$. $D$ é o **domínio**, $C$ o **contradomínio**, e o conjunto dos valores realmente produzidos, $\{f(x) : x\in D\}$, é a **imagem**. A imagem pode ser menor que o contradomínio: $f(x)=x^2$ com contradomínio $\mathbb{R}$ tem imagem $[0,\infty)$.

Quando uma fórmula vem sem domínio, o **domínio natural** é o conjunto dos $x$ reais para os quais a fórmula faz sentido. Três restrições cobrem quase todos os casos:

- o denominador não pode ser zero ($1/(x-3)$ exclui $x=3$);
- uma raiz de índice par exige argumento não negativo ($\sqrt{x-1}$ exige $x\ge 1$);
- um logaritmo exige argumento positivo ($\ln(x)$ exige $x>0$).

Um gráfico de $y=f(x)$ representa uma função apenas se toda reta vertical o cortar no máximo uma vez. Se uma função é **injetora** (nunca dá a mesma saída para duas entradas diferentes) é a versão horizontal do teste: toda reta horizontal corta o gráfico no máximo uma vez.

Em código, `math.sqrt(-1)` levanta um `ValueError` em Python, que é o domínio sendo imposto. O NumPy devolve `nan`, que é o domínio sendo ignorado, e o `nan` viaja pelo resto da conta. Conhecer o domínio de antemão é o jeito de saber o que você recebeu.

### Composição e inversas

A **composição** $(f\circ g)(x)=f(g(x))$ aplica $g$ primeiro. Seu domínio é o conjunto dos $x$ no domínio de $g$ para os quais $g(x)$ está no domínio de $f$. A ordem importa: com $f(t)=t+1$ e $g(t)=t^2$, temos $f(g(2))=5$ mas $g(f(2))=9$.

Uma função $f$ tem **inversa** $f^{-1}$ exatamente quando $f$ é injetora. A inversa é definida na imagem de $f$ e a desfaz:

$$f^{-1}(f(x))=x \text{ para todo } x \text{ no domínio de } f, \qquad f(f^{-1}(y))=y \text{ para todo } y \text{ na imagem de } f.$$

A hipótese não é enfeite. $f(x)=x^2$ em todo $\mathbb{R}$ não é injetora, pois $f(-3)=f(3)=9$, então não tem inversa. Restringir o domínio a $[0,\infty)$ a torna injetora, e aí a inversa é $\sqrt{y}$. Sem a restrição, "desfazer" falha: $\sqrt{(-3)^2}=3$, não $-3$. A identidade correta em todo $\mathbb{R}$ é $\sqrt{x^2}=\lvert x\rvert$. O gráfico de $f^{-1}$ é o gráfico de $f$ refletido na reta $y=x$.

### As famílias

- **Afim**, $mx+b$: domínio $\mathbb{R}$. Taxa de variação constante $m$; $b$ é o valor em $x=0$.
- **Quadrática**, $ax^2+bx+c$ com $a\ne0$: domínio $\mathbb{R}$. Uma parábola com um vértice, então a imagem é limitada de um lado.
- **Polinomial**, $a_nx^n+\dots+a_0$ com $a_n\ne0$: domínio $\mathbb{R}$. No máximo $n$ raízes reais, e para $\lvert x\rvert$ grande o termo $a_nx^n$ domina.
- **Exponencial**, $a^x$ com $a>0$, $a\ne1$: domínio $\mathbb{R}$, imagem $(0,\infty)$. Cresce se $a>1$, decai se $0<a<1$.
- **Logaritmo**, $\log_a x$: domínio $(0,\infty)$, imagem $\mathbb{R}$. A inversa de $a^x$.
- **Trigonométricas**, $\sin x$, $\cos x$, $\tan x$: $\sin$ e $\cos$ têm domínio $\mathbb{R}$, imagem $[-1,1]$ e período $2\pi$; $\tan$ exclui $\pi/2+k\pi$.

**Quadráticas.** Completar o quadrado reescreve $ax^2+bx+c$ como $a(x-h)^2+k$, o que expõe de uma vez o vértice $(h,k)$ e a imagem. O discriminante $b^2-4ac$ diz quantas raízes reais existem: duas se positivo, uma se zero, nenhuma se negativo.

**Exponenciais e logaritmos.** Escrevendo $\log_a$ para a inversa de $a^x$, vale, para todo real $x$ e todo $y>0$:

$$\log_a(a^x)=x, \qquad a^{\log_a y}=y.$$

As leis $\log_a(uv)=\log_a u+\log_a v$ e $\log_a(u^r)=r\log_a u$ valem para $u,v>0$. Trocar de base é um fator constante: $\log_a x=\ln x/\ln a$. A base especial $e\approx 2{,}71828$ é aquela cuja exponencial tem a taxa de variação mais simples, o que uma lição posterior, `derivatives-of-exponentials-logarithms-and-trigonometric-functions`, explica.

**Trigonometria.** Ângulos são medidos em radianos, de modo que o comprimento de arco no círculo unitário é igual ao ângulo. O ponto de ângulo $x$ no círculo unitário é $(\cos x,\sin x)$, o que dá a identidade $\sin^2x+\cos^2x=1$. Como $\sin$ e $\cos$ se repetem a cada $2\pi$, nenhuma é injetora em $\mathbb{R}$. As inversas só existem depois de uma restrição: $\arcsin$ devolve valores em $[-\pi/2,\pi/2]$ e $\arccos$ em $[0,\pi]$.

## Exemplos Resolvidos

### Exemplo 1: domínio e imagem

Encontre o domínio natural de $f(x)=\dfrac{\sqrt{x-1}}{x-3}$ e a imagem de $g(x)=x^2-4x+7$.

Para $f$, a raiz exige $x-1\ge0$, logo $x\ge1$. O denominador proíbe $x=3$. O domínio é $[1,3)\cup(3,\infty)$.

Para $g$, complete o quadrado: $g(x)=(x-2)^2+3$. Um quadrado nunca é negativo, então $g(x)\ge3$, com igualdade em $x=2$. Todo valor acima de 3 é atingido, então a imagem é $[3,\infty)$. O discriminante é $(-4)^2-4(1)(7)=-12<0$, o que concorda: o gráfico nunca toca o eixo $x$. Uma varredura numérica de $g$ em $[-50,50]$ dá mínimo exatamente $3{,}0$.

### Exemplo 2: composição e inversa

Seja $h(x)=e^{2x-1}$. Sua imagem é $(0,\infty)$. Para inverter, faça $y=e^{2x-1}$, aplique $\ln$ aos dois lados (legítimo porque $y>0$) e resolva:

$$\ln y=2x-1 \quad\Longrightarrow\quad x=\frac{1+\ln y}{2}.$$

Então $h^{-1}(y)=\dfrac{1+\ln y}{2}$ com domínio $(0,\infty)$, a imagem de $h$. Confira as duas composições:

$$h^{-1}(h(x))=\frac{1+(2x-1)}{2}=x, \qquad h(h^{-1}(y))=e^{(1+\ln y)-1}=y.$$

Uma checagem numérica em $x=0{,}5$ dá $h(0{,}5)=e^0=1$ e $h^{-1}(1)=0{,}5$. A segunda identidade exige $y>0$. Sem essa restrição ela falha, porque $\ln y$ não existe.

Para o domínio de uma composição, tome $f(t)=\sqrt{t}$ e $g(x)=x-4$. Então $(f\circ g)(x)=\sqrt{x-4}$, com domínio $[4,\infty)$: a função interna é definida em toda parte, mas sua saída precisa cair no domínio da raiz quadrada.

### Exemplo 3: o logaritmo na computação e uma equação trigonométrica

*Quantas duplicações chegam a um bilhão?* Comece com $i=1$ e dobre até $i\ge10^9$. Queremos o menor inteiro $k$ com $2^k\ge10^9$, isto é, $k\ge\log_2(10^9)=29{,}897\ldots$, logo $k=30$. Rodar o laço confirma: ele para após 30 iterações com $i=2^{30}=1.073.741.824$. A mesma contagem aparece quando uma busca divide o intervalo ao meio a cada passo, e por isso dividir ao meio um intervalo de $10^6$ itens leva no máximo $\lceil\log_2 10^6\rceil=\lceil19{,}93\rceil=20$ passos.

*Quanto tempo para dobrar a 7% ao ano?* Precisamos de $1{,}07^t=2$, logo $t=\ln2/\ln1{,}07\approx10{,}24$ anos. Conferências em anos inteiros concordam: $1{,}07^{10}=1{,}967$ ainda não chega a 2, e $1{,}07^{11}=2{,}105$ já passou.

*Resolva $\sin x=\tfrac12$ em $[0,2\pi]$.* A função inversa dá $\arcsin(1/2)=\pi/6$, mas $\sin$ não é injetora aqui, e a calculadora informa só uma resposta. A simetria $\sin(\pi-x)=\sin x$ dá a segunda solução, $5\pi/6$. As duas satisfazem a equação numericamente ($\sin(5\pi/6)=0{,}5$ a menos de arredondamento). A inversa de uma restrição devolve um representante do conjunto de soluções, então você precisa fornecer os outros.

## Equívocos Comuns e Armadilhas

- **"Cancelar um fator não muda a função."** $\dfrac{x^2-1}{x-1}$ e $x+1$ coincidem para todo $x\ne1$, mas são funções diferentes: a primeira não tem valor em $x=1$. Essa diferença é o ponto de partida da próxima lição.
- **"$f^{-1}$ significa $1/f$."** O $-1$ em $f^{-1}$ é a inversa sob composição, não um recíproco. $\sin^{-1}x$ é $\arcsin x$, enquanto $1/\sin x$ é $\csc x$.
- **"$\sqrt{x^2}=x$."** É igual a $\lvert x\rvert$. Elevar ao quadrado e extrair a raiz só se desfazem em $x\ge0$.
- **"$\ln(x^2)=2\ln x$."** A regra exige $x>0$. Para $x=-3$, o lado esquerdo é $\ln 9=2{,}197$, enquanto $\ln(-3)$ não existe. A forma segura para todo $x\ne0$ é $\ln(x^2)=2\ln\lvert x\rvert$.
- **"Polinômios de grau $n$ têm $n$ raízes reais."** Têm no máximo $n$. A quadrática $x^2-4x+7$ não tem nenhuma.
- **"Graus e radianos são intercambiáveis."** As fórmulas do cálculo para funções trigonométricas pressupõem radianos. Calcular `sin(30)` numa linguagem que usa radianos responde a uma pergunta diferente de $\sin 30^\circ$.
- **"O $\sin\pi$ calculado é exatamente 0."** Em precisão dupla ele vale cerca de $1{,}22\times10^{-16}$, porque o próprio $\pi$ é armazenado arredondado. Código numérico compara com uma tolerância, não com zero.

## Resumo

Uma função é uma regra junto com seu domínio, e muitos erros de cálculo são erros de domínio: um denominador que se anula, uma raiz par de número negativo, um logaritmo de número não positivo. A composição aplica uma função depois da outra e seu domínio é reduzido pela saída da interna. Uma inversa só existe para uma função injetora, e por isso $x^2$, $\sin$ e $\cos$ precisam de domínios restritos antes de serem invertidas. As famílias para levar adiante são a afim (taxa constante), a quadrática (um vértice e um discriminante), a polinomial (dominada pelo termo de maior grau), a exponencial e o logaritmo (inversas uma da outra, com o logaritmo contando duplicações e divisões ao meio) e o seno e o cosseno periódicos. A próxima lição, `limits-intuition-and-the-formal-definition`, usa essas funções para perguntar o que uma função faz perto de um ponto onde ela pode não estar definida.

## Documentation Links

- [OpenStax Calculus Volume 1: 1.1 Review of Functions](https://openstax.org/books/calculus-volume-1/pages/1-1-review-of-functions): domínio, imagem, composição e simetria de funções, com gráficos.
- [OpenStax Calculus Volume 1: 1.2 Basic Classes of Functions](https://openstax.org/books/calculus-volume-1/pages/1-2-basic-classes-of-functions): funções lineares, polinomiais, racionais e algébricas e suas transformações.
- [OpenStax Calculus Volume 1: 1.3 Trigonometric Functions](https://openstax.org/books/calculus-volume-1/pages/1-3-trigonometric-functions): medida em radianos, círculo unitário, identidades e gráficos das funções trigonométricas.
- [OpenStax Calculus Volume 1: 1.4 Inverse Functions](https://openstax.org/books/calculus-volume-1/pages/1-4-inverse-functions): funções injetoras, domínios restritos e funções trigonométricas inversas.
- [OpenStax Calculus Volume 1: 1.5 Exponential and Logarithmic Functions](https://openstax.org/books/calculus-volume-1/pages/1-5-exponential-and-logarithmic-functions): exponenciais, o número e, leis do logaritmo e mudança de base.
