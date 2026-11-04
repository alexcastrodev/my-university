---
version: 1.0
updatedAt: 2026-11-04
title: "Limites no Infinito e Crescimento Assintótico"
summary: "Limites quando x cresce sem limite, assíntotas horizontais e verticais e a hierarquia de dominância entre logaritmos, polinômios e exponenciais, que é o cálculo por baixo do enunciado formal de Big-O."
---
## Objetivos de Aprendizagem

- Enunciar a definição de $\lim_{x\to\infty}f(x)=L$ e demonstrar um caso simples com $\varepsilon$ e $N$ explícitos.
- Calcular limites no infinito de funções racionais e de expressões com raízes, incluindo o cuidado com o sinal em $-\infty$.
- Encontrar assíntotas horizontais, verticais e oblíquas de uma função, e distinguir uma assíntota de um buraco.
- Ordenar logaritmos, potências e exponenciais por crescimento, e dizer com precisão o que significa "cresce mais rápido".
- Usar o limite de uma razão para decidir relações de Big-O, e nomear o caso em que esse teste não consegue decidir.

## Contexto e Motivação

A pergunta por trás da análise assintótica é o que uma função faz na ponta distante do seu domínio. Em `big-o-and-asymptotic-complexity`, $f(n)$ é $O(g(n))$ quando $f(n)\le c\,g(n)$ para todo $n\ge n_0$, e as taxas de crescimento ali são ordenadas com tabelas e com pontos de cruzamento como $n=100$, onde $100n$ encontra $n^2$. Essa lição dá a notação e a definição. Esta fornece o cálculo por baixo: o limite de uma razão quando a variável cresce sem limite é uma conta, e para as famílias de funções comuns ela resolve a comparação sem tabela.

Limites no infinito também descrevem comportamento de longo prazo em geral: o regime estacionário de um sistema, a velocidade de um objeto em queda se aproximando da velocidade terminal, a taxa de aprendizado que decai em direção a zero. As ferramentas são as de `limit-laws-and-indeterminate-forms`, agora aplicadas a $x\to\infty$ em vez de $x\to a$.

## Teoria Central

### Limites quando x cresce sem limite

**Definição.** Seja $f$ definida em algum intervalo $(c,\infty)$. Então $\lim_{x\to\infty}f(x)=L$ significa: para todo $\varepsilon>0$ existe um número $N$ tal que

$$x>N \quad\Longrightarrow\quad \lvert f(x)-L\rvert<\varepsilon.$$

É o jogo $\varepsilon$-$\delta$ de antes, com "$x$ perto de $a$" trocado por "$x$ lá longe". A afirmação $\lim_{x\to\infty}f(x)=\infty$ significa que para todo $M$ existe $N$ com $x>N\Rightarrow f(x)>M$; como antes, o símbolo descreve como o limite deixa de ser um número real. O caso $x\to-\infty$ é a imagem no espelho. As leis dos limites da lição anterior valem para limites no infinito com as mesmas demonstrações e as mesmas hipóteses (as partes precisam ter limites finitos; um quociente exige limite do denominador diferente de zero).

Dois blocos de construção: $\lim_{x\to\infty}1/x^p=0$ para todo $p>0$, e $\lim_{x\to\infty}x^p=\infty$.

**Variável real versus variável inteira.** Big-O é enunciado para inteiros $n$. Se $\lim_{x\to\infty}f(x)=L$, então $\lim_{n\to\infty}f(n)=L$ ao longo dos inteiros, já que os inteiros estão entre os $x$ que precisam ficar próximos. A recíproca falha: $\sin(\pi x)$ vale $0$ em todo inteiro, então ao longo dos inteiros seu limite é $0$, mas como função de $x$ real ela não tem limite.

### Funções racionais: compare os graus

Para $f=p/q$ com $p$ de grau $m$ e $q$ de grau $n$, divida numerador e denominador por $x^n$:

- $m<n$: o limite em $\pm\infty$ é $0$;
- $m=n$: o limite é a razão dos coeficientes líderes;
- $m>n$: não há limite finito; $f$ cresce sem limite em módulo.

Raízes exigem cuidado com sinais. Para $x>0$, $\sqrt{x^2}=x$, mas para $x<0$, $\sqrt{x^2}=\lvert x\rvert=-x$. Por isso $\lim_{x\to\infty}\dfrac{x}{\sqrt{x^2+1}}=1$ enquanto $\lim_{x\to-\infty}\dfrac{x}{\sqrt{x^2+1}}=-1$. A diferença $\sqrt{x^2+x}-x$ é uma forma $\infty-\infty$, resolvida multiplicando pelo conjugado (Exemplo 3).

### Assíntotas

- Uma **assíntota horizontal** é uma reta $y=L$ com $\lim_{x\to\infty}f(x)=L$ ou $\lim_{x\to-\infty}f(x)=L$. Uma função pode ter nenhuma ($\sin x$), uma ($e^x$ tem $y=0$ apenas em $-\infty$) ou duas ($\arctan x$ tem $y=\pi/2$ e $y=-\pi/2$).
- Uma **assíntota vertical** é uma reta $x=a$ em que pelo menos um limite lateral é $\pm\infty$.
- Uma **assíntota oblíqua** é uma reta $y=mx+b$ com $f(x)-(mx+b)\to0$ quando $x\to\pm\infty$. Funções racionais cujo grau do numerador é exatamente um a mais que o do denominador têm uma.

Duas correções a imagens comuns. Uma assíntota não é uma barreira que o gráfico nunca toca: $\dfrac{\sin x}{x}$ tem a assíntota horizontal $y=0$ e a cruza em cada múltiplo não nulo de $\pi$, infinitas vezes. E um ponto em que a fórmula dá $0/0$ não gera automaticamente uma assíntota vertical; pode ser um buraco, onde o limite é finito (Exemplo 2).

### A hierarquia de dominância

Diga que $f$ cresce mais devagar que $g$ (escreve-se $f\ll g$) quando $\lim_{x\to\infty}f(x)/g(x)=0$. Para todo $k>0$, $p>0$ e $a>1$:

$$(\ln x)^k\ll x^p\ll a^x.$$

Assim, qualquer potência do logaritmo é vencida por qualquer potência positiva de $x$, por menor que seja, e qualquer potência de $x$ é vencida por qualquer exponencial de base maior que $1$, por mais próxima de $1$ que seja. A condição $a>1$ é necessária: para $0<a<1$, $a^x\to0$. As demonstrações ficam mais limpas com `lhopitals-rule`. Para um argumento rápido de que $n^p/a^n\to0$, note que a razão entre termos consecutivos é $\tfrac1a\left(\tfrac{n+1}{n}\right)^p$, que tende a $\tfrac1a<1$, então os termos eventualmente encolhem por um fator aproximadamente constante a cada passo.

**"Eventualmente" pode estar muito longe.** Compare $x^{10}$ com $1{,}1^x$ por meio de $10\ln x$ contra $x\ln1{,}1$. As curvas se cruzam perto de $x=1{,}01$ e de novo perto de $x=685{,}08$, e $1{,}1^x$ fica acima de $x^{10}$ somente a partir do segundo cruzamento. Em $x=500$, $1{,}1^x\approx4{,}97\times10^{20}$ enquanto $x^{10}\approx9{,}77\times10^{26}$; em $x=686$ a exponencial finalmente lidera, $2{,}49\times10^{28}$ contra $2{,}31\times10^{28}$. Da mesma forma, $x^{0{,}1}$ fica acima de $\ln x$ apenas além de cerca de $3{,}43\times10^{15}$; para $3{,}06<x<3{,}43\times10^{15}$ o logaritmo é maior. A hierarquia é uma afirmação sobre o limite, não sobre um tamanho em particular.

### Do limite da razão ao Big-O

Sejam $f,g$ positivas para argumentos grandes e suponha que $\lim f/g=L$ exista em $[0,\infty]$.

- **$L<\infty$ implica $f=O(g)$.** Tomando $\varepsilon=1$ na definição, $f/g<L+1$ depois de algum ponto, então $c=L+1$ e esse ponto servem como constantes.
- **$0<L<\infty$ significa que as duas têm a mesma ordem**: $f=O(g)$ e $g=O(f)$.
- **$L=0$ significa $f\ll g$**: $f=O(g)$ mas $g\ne O(f)$, porque $g/f\to\infty$ supera qualquer constante.
- **$L=\infty$ implica $f\ne O(g)$.**

A hipótese de que o limite existe importa. Quando ele não existe, o teste se cala. Tome $f(n)=n(2+\sin n)$ e $g(n)=n$. A razão $2+\sin n$ fica entre $1$ e $3$ e continua voltando para perto dos dois valores, então não tem limite, e no entanto $f(n)\le3g(n)$ e $g(n)\le f(n)$ valem para todo $n\ge1$: as duas têm a mesma ordem. Logo $f=O(g)$ pode ser verdade sem limite. O teste do limite prova relações quando funciona e não prova nada quando não funciona.

## Exemplos Resolvidos

### Exemplo 1: uma demonstração $\varepsilon$-$N$

Prove que $\lim_{x\to\infty}\dfrac{3x+1}{x+2}=3$. Para $x>-2$,

$$\left\lvert\frac{3x+1}{x+2}-3\right\rvert=\left\lvert\frac{-5}{x+2}\right\rvert=\frac{5}{x+2}.$$

Isso é menor que $\varepsilon$ exatamente quando $x>\dfrac5\varepsilon-2$. Então tome $N=\max\left(1,\dfrac5\varepsilon-2\right)$. Concretamente, $\varepsilon=0{,}1$ dá $N=48$, $\varepsilon=0{,}01$ dá $N=498$ e $\varepsilon=0{,}001$ dá $N=4998$. Varrendo $x$ além de cada $N$, o erro nunca passa de $\varepsilon$, e em $x=N$ ele é exatamente $\varepsilon$, então, para essa escolha de $N$, a desigualdade estrita $x>N$ é necessária. Cada aumento de dez vezes na precisão custa aqui um aumento de cerca de dez vezes em $N$ (de $48$ para $498$ para $4998$): o erro encolhe como $1/x$.

### Exemplo 2: assíntotas versus um buraco

Seja $f(x)=\dfrac{2x^2-3x+1}{x^2-1}=\dfrac{(2x-1)(x-1)}{(x-1)(x+1)}$. Para $x\ne1$ isso é igual a $\dfrac{2x-1}{x+1}$.

- *Horizontal.* Os graus são iguais, então o limite em $\pm\infty$ é a razão dos coeficientes líderes, $2$. Numericamente, $f(1000)=1{,}99700$ e $f(-1000)=2{,}00300$: o gráfico se aproxima de $y=2$ por baixo à direita e por cima à esquerda. A equação $f(x)=2$ não tem solução, então aqui o gráfico nunca a cruza.
- *Vertical em $x=-1$.* O numerador tende a $-3$ e o denominador a $0$. Pela direita, $x+1>0$ e $f\to-\infty$ ($f(-0{,}999)=-2998$); pela esquerda, $f\to+\infty$ ($f(-1{,}001)=3002$). O limite bilateral não existe.
- *Buraco em $x=1$.* A forma é $0/0$. Depois de cancelar, $\lim_{x\to1}f(x)=\dfrac{2-1}{1+1}=\dfrac12$. É um limite finito, então a reta $x=1$ não é assíntota.

### Exemplo 3: $\infty-\infty$ e ponto flutuante

Encontre $\lim_{x\to\infty}\left(\sqrt{x^2+x}-x\right)$. Multiplicando pelo conjugado, para $x>0$:

$$\sqrt{x^2+x}-x=\frac{x}{\sqrt{x^2+x}+x}=\frac{1}{\sqrt{1+1/x}+1}.$$

Como $1/x\to0$, o limite é $\dfrac{1}{1+1}=\dfrac12$. Dividir por $x$ usou $x>0$, o que é legítimo quando $x\to+\infty$. A forma $\infty-\infty$ era indeterminada: $x-x$ tem limite $0$, e $(x^2+x)-x^2$ tem limite $\infty$. Em precisão dupla:

```text
       x   sqrt(x^2+x)-x   x/(sqrt(x^2+x)+x)
   1e+02    0.498756211209      0.498756211209
   1e+04    0.499987500625      0.499987500625
   1e+08    0.500000000000      0.499999998750
   1e+16    2.000000000000      0.500000000000
```

Em $10^8$ a subtração já perdeu dígitos (o valor verdadeiro é menor que $0{,}5$), e em $10^{16}$ ela devolve $2$, porque $x^2+x$ é arredondado para um número cuja raiz quadrada difere de $x$ por uma unidade na última casa. A forma reescrita continua precisa.

### Exemplo 4: decidindo Big-O pela razão

- $n\ln n$ versus $n^2$ (a base do logaritmo só muda um fator constante): a razão é $\dfrac{\ln n}{n}$, que vale $0{,}23$ em $n=10$, $0{,}046$ em $100$ e $1{,}4\times10^{-5}$ em $10^6$, tendendo a $0$. Logo $n\ln n\ll n^2$.
- $n^3$ versus $2^n$: a razão $n^3/2^n$ vale $0{,}98$ em $n=10$, $0{,}0076$ em $20$, $1{,}1\times10^{-10}$ em $50$ e $7{,}9\times10^{-25}$ em $100$. Logo $n^3\ll2^n$. Em $n=10$ as duas são quase iguais, e é assim que uma tabela com $n$ pequeno pode esconder a diferença.
- $100n$ versus $n^2$: a razão $100/n$ vale $10$ em $n=10$, exatamente $1$ em $n=100$ (o cruzamento de `big-o-and-asymptotic-complexity`) e $0{,}1$ em $n=1000$. O limite é $0$, então $100n\ll n^2$, qualquer que seja a constante.
- $n(2+\sin n)$ versus $n$: sem limite, mas mesma ordem, como mostrado acima.

## Equívocos Comuns e Armadilhas

- **"$\infty$ é um número, então $\infty-\infty=0$ e $\infty/\infty=1$."** As formas são indeterminadas. Entre $x/x$, $2x/x$, $x^2/x$ e $x/x^2$, todas do tipo $\infty/\infty$, os limites no infinito são $1$, $2$, $\infty$ e $0$.
- **"Um gráfico não pode cruzar sua assíntota."** Uma assíntota horizontal descreve a ponta distante, e $\sin x/x$ cruza $y=0$ infinitas vezes.
- **"Todo ponto $0/0$ é uma assíntota vertical."** O Exemplo 2 tem um buraco em $x=1$ com limite finito $\tfrac12$.
- **"$\sqrt{x^2}=x$."** Em $-\infty$ é $-x$, o que inverte o sinal de limites como $x/\sqrt{x^2+1}$.
- **"Exponenciais sempre vencem."** Só com base $a>1$. E "eventualmente" pode estar além dos tamanhos práticos: $x^{10}$ fica à frente de $1{,}1^x$ de cerca de $x=1{,}01$ até cerca de $x=685$.
- **"Se $f=O(g)$, então $f/g$ tem limite."** A recíproca do teste da razão é falsa (o exemplo $n(2+\sin n)$).
- **"Ao longo dos inteiros o limite existe, então o limite real existe."** $\sin(\pi x)$ é o contraexemplo.

## Resumo

Um limite no infinito pede um número $N$ além do qual a função permanece a menos de $\varepsilon$ de $L$; as leis dos limites passam sem mudança. Para funções racionais os graus decidem: grau menor no numerador dá $0$, graus iguais dão a razão dos coeficientes líderes, grau maior dá crescimento ilimitado. Assíntotas são horizontais, verticais ou oblíquas, um gráfico pode cruzar uma horizontal, e um buraco $0/0$ não é assíntota vertical. Potências do logaritmo são dominadas por potências, e potências por exponenciais de base maior que um, no sentido de que a razão tende a $0$, embora o cruzamento possa estar muito longe. O limite de uma razão se liga diretamente ao Big-O: um limite finito dá $f=O(g)$, um limite zero dá dominação estrita, um limite infinito descarta $f=O(g)$, e a ausência de limite não decide nada. A próxima lição, `continuity-and-the-intermediate-value-theorem`, volta a pontos finitos e pergunta quando o limite é igual ao valor.

## Documentation Links

- [OpenStax Calculus Volume 1: 4.6 Limits at Infinity and Asymptotes](https://openstax.org/books/calculus-volume-1/pages/4-6-limits-at-infinity-and-asymptotes): limites no infinito, comportamento nas extremidades e assíntotas horizontais, verticais e oblíquas.
- [OpenStax Calculus Volume 1: 2.2 The Limit of a Function](https://openstax.org/books/calculus-volume-1/pages/2-2-the-limit-of-a-function): limites infinitos e assíntotas verticais a partir de limites laterais.
- [MIT OpenCourseWare 18.01SC: Part A, Definition and Basic Rules](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/1.-differentiation/part-a-definition-and-basic-rules/): uma unidade de curso gratuita cujas sessões 4 e 5 cobrem limites, continuidade e descontinuidade, com vídeos e notas.
