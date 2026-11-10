---
version: 1.0
updatedAt: 2026-11-04
title: "Integração por Substituição e por Partes"
summary: "A substituição como a regra da cadeia ao contrário e a integração por partes como a regra do produto ao contrário, com orientação sobre como escolher a substituição e as partes."
---
## Objetivos de Aprendizagem

- Deduzir a substituição a partir da regra da cadeia e as partes a partir da regra do produto, e enunciar as hipóteses de cada uma.
- Calcular integrais definidas por substituição, convertendo os limites para a nova variável e nunca voltando à antiga.
- Reconhecer uma substituição inválida (uma troca de variável indefinida ou descontínua dentro do intervalo) e um módulo perdido depois de uma raiz quadrada.
- Escolher $u$ e $dv$ na integração por partes, e lidar com aplicações repetidas e cíclicas.
- Usar $\int\ln x\,dx$ para obter cotas para uma soma de logaritmos, o cálculo por trás de $\log(n!)=\Theta(n\log n)$.

## Contexto e Motivação

`the-fundamental-theorem-of-calculus` reduziu uma integral definida a achar uma antiderivada, mas não deu método para achá-la. A derivação tem uma regra para cada composição e produto; a integração não tem regra tão completa. O que ela tem são duas técnicas que rodam uma regra de derivação ao contrário. A substituição desfaz a regra da cadeia e a integração por partes desfaz a regra do produto. Juntas, resolvem a maioria das integrais que aparecem na prática.

As técnicas importam também onde a integral em forma fechada não é o objetivo. Obter cotas para $\ln(n!)$, o núcleo da cota inferior $\Omega(n\log n)$ para ordenação por comparação, dá cotas precisas via $\int\ln x\,dx$, um serviço natural para partes.

## Teoria Central

### Substituição: a regra da cadeia ao contrário

Se $F'=f$, a regra da cadeia dá $\frac{d}{dx}F(g(x)) = f(g(x))\,g'(x)$. Lendo isso da direita para a esquerda:

$$\int f(g(x))\,g'(x)\,dx = F(g(x)) + C$$

A notação abreviada é $u=g(x)$, $du = g'(x)\,dx$, que transforma a integral em $\int f(u)\,du$. O método funciona quando o integrando contém uma função interna junto com (um múltiplo constante de) sua derivada.

**Teorema (forma definida).** Seja $g$ com derivada contínua em $[a,b]$ e $f$ contínua num intervalo que contém $g([a,b])$. Então

$$\int_a^b f(g(x))\,g'(x)\,dx = \int_{g(a)}^{g(b)} f(u)\,du$$

A prova é a Parte 2 do TFC nos dois lados: cada um vale $F(g(b))-F(g(a))$. Três consequências. Os novos limites são $g(a)$ e $g(b)$, e não $a$ e $b$. Eles podem sair invertidos ($g(a)>g(b)$) ou iguais. E $g$ não precisa ser injetora nem monótona. Convertidos os limites, a resposta é calculada inteiramente em $u$; voltar para $x$ é desnecessário, e misturar os dois é o erro clássico.

### Substituição no outro sentido

A substituição trigonométrica escreve $x=\varphi(\theta)$ e usa $\int_a^b f(x)\,dx = \int_\alpha^\beta f(\varphi(\theta))\,\varphi'(\theta)\,d\theta$ com $\varphi(\alpha)=a$, $\varphi(\beta)=b$. As hipóteses agora são rígidas: $\varphi'$ contínua em $[\alpha,\beta]$ e $\varphi$ permanecendo dentro do domínio de $f$ durante todo o percurso de $\alpha$ a $\beta$. Duas coisas dão errado na prática. Primeiro, $\sqrt{\cos^2\theta}=\lvert\cos\theta\rvert$, que só é igual a $\cos\theta$ onde $\cos\theta\ge0$, então o intervalo escolhido para $\theta$ precisa ser declarado. Segundo, $\varphi$ pode ser indefinida em algum ponto entre as extremidades (Exemplo 4).

### Integração por partes: a regra do produto ao contrário

De $(uv)'=u'v+uv'$, integrando obtemos

$$\int u\,v'\,dx = uv - \int u'\,v\,dx, \qquad \int_a^b u\,v'\,dx = \big[uv\big]_a^b - \int_a^b u'\,v\,dx$$

A forma definida exige que $u$ e $v$ tenham derivadas contínuas em $[a,b]$. O objetivo é trocar $\int uv'$ por um $\int u'v$ mais fácil. Escolha como $u$ o fator que fica mais simples ao derivar ($\ln x$, $\arctan x$, um polinômio) e como $v'$ o fator cuja antiderivada é fácil ($e^x$, $\sin x$, $\cos x$, uma potência). O mnemônico LIATE (logarítmica, trigonométrica inversa, algébrica, trigonométrica, exponencial, em ordem de preferência para $u$) resume isso; é uma heurística, não um teorema. Três padrões se repetem: um polinômio vezes $e^x$ ou $\sin x$ pede uma aplicação por grau; um $\ln x$ ou $\arctan x$ sozinho usa $v'=1$; e $e^x\sin x$ volta a si mesma depois de duas aplicações, então se resolve algebricamente.

## Exemplos Resolvidos

### Exemplo 1: uma substituição padrão

$\int_0^2 \frac{x}{x^2+1}\,dx$. Seja $u=x^2+1$, então $du=2x\,dx$ e $x\,dx=\tfrac12du$. Quando $x=0$, $u=1$; quando $x=2$, $u=5$.

$$\int_0^2 \frac{x}{x^2+1}\,dx = \frac12\int_1^5\frac{du}{u} = \frac12\ln 5 \approx 0{,}80472$$

A avaliação simbólica e a quadratura dão ambas $0{,}804718956$. O $\ln$ é seguro porque $u\ge1>0$ em todo o percurso.

### Exemplo 2: os limites são o trabalho todo

$\int_0^2 2x\cos(x^2)\,dx$ com $u=x^2$: os limites viram $0$ e $4$, dando $\int_0^4\cos u\,du = \sin4 \approx -0{,}7568$. Aplicar os limites antigos à nova antiderivada dá $\sin 2 \approx +0{,}9093$, que tem o sinal errado além do tamanho errado. Um caso em que $g$ não é monótona: $\int_0^\pi \cos x\,\sin^2x\,dx$ com $u=\sin x$ tem limites $\sin0=0$ e $\sin\pi=0$, então a integral é $\int_0^0u^2du=0$. Isso está correto: $\sin^2 x\cos x$ é positiva em $[0,\pi/2]$ e tem imagem espelhada negativa em $[\pi/2,\pi]$. Compare com $\int_0^{\pi/2}\sin^2x\cos x\,dx=\int_0^1u^2du=\tfrac13$, em que o mesmo $u=\sin x$ vai de $0$ a $1$ e o sinal nunca muda.

### Exemplo 3: uma substituição trigonométrica

$\int_0^1\sqrt{1-x^2}\,dx$ é um quarto do disco unitário. Seja $x=\sin\theta$, $dx=\cos\theta\,d\theta$, e $\theta$ vai de $0$ a $\pi/2$. Nesse intervalo $\cos\theta\ge0$, então $\sqrt{1-\sin^2\theta}=\cos\theta$:

$$\int_0^{\pi/2}\cos^2\theta\,d\theta = \frac{\pi}{4}\approx0{,}7854$$

Bater com a área de um quarto de círculo é uma conferência embutida. A simplificação $\sqrt{1-\sin^2\theta}=\cos\theta$ vale apenas onde $\cos\theta\ge0$. Em $[0,\pi]$ ela falha: $\int_0^\pi\sqrt{1-\sin^2\theta}\,d\theta=\int_0^\pi\lvert\cos\theta\rvert\,d\theta=2$, enquanto $\int_0^\pi\cos\theta\,d\theta=0$. Esse intervalo também seria errado para esta substituição, pois $\sin\theta$ sobe até $1$ e volta a $0$ em vez de percorrer $[0,1]$ uma só vez.

### Exemplo 4: uma substituição que não é permitida

$\int_{-1}^{1}\frac{dx}{1+x^2}=2\arctan1=\frac\pi2\approx1{,}5708$. Tente $u=1/x$: $dx=-du/u^2$ e $\frac{1}{1+x^2}=\frac{u^2}{u^2+1}$, então o integrando vira $-\frac{du}{1+u^2}$, com limites de $u=-1$ a $u=1$. O resultado seria $-\frac\pi2$, negativo para um integrando positivo. A função $x\mapsto1/x$ é indefinida em $x=0$, que está dentro de $[-1,1]$, então as hipóteses falham. Em $[1,2]$ a mesma substituição é válida.

### Exemplo 5: partes, de três maneiras

$\int_0^1 xe^x\,dx$: $u=x$, $v'=e^x$, então $[xe^x]_0^1-\int_0^1e^x\,dx = e-(e-1)=1$.

$\int_1^e\ln x\,dx$: $u=\ln x$, $v'=1$, então $[x\ln x]_1^e-\int_1^e1\,dx = e-(e-1)=1$. Isso dá a antiderivada $x\ln x-x$.

$\int_0^1x^2e^x\,dx$: duas aplicações dão $[x^2e^x-2xe^x+2e^x]_0^1 = e-2\approx0{,}71828$. Cada passada reduz em um a potência de $x$.

Os três resultados batem com a avaliação simbólica e a numérica.

### Exemplo 6: uma integral cíclica

Seja $I=\int e^x\sin x\,dx$. Com $u=\sin x$, $v'=e^x$: $I=e^x\sin x-\int e^x\cos x\,dx$. Aplicando partes de novo com os mesmos papéis ($u=\cos x$): $\int e^x\cos x\,dx = e^x\cos x+I$. Portanto $I=e^x\sin x-e^x\cos x-I$, e $I=\tfrac12e^x(\sin x-\cos x)+C$. Em $[0,\pi]$ o valor é $\frac{e^\pi+1}{2}\approx12{,}0703$, confirmado numericamente. Trocar os papéis na segunda passada desfaria a primeira e devolveria $0=0$.

### Exemplo 7: cotas para $\ln(n!)$

Como $\ln x$ é crescente, cada termo satisfaz $\int_{k-1}^{k}\ln x\,dx\le\ln k\le\int_k^{k+1}\ln x\,dx$. Somando $k=2,\dots,n$ e usando $\int\ln x\,dx = x\ln x-x$:

$$n\ln n-n+1\ \le\ \ln(n!)\ \le\ (n+1)\ln(n+1)-(n+1)-2\ln2+2$$

| n | cota inferior | ln(n!) | cota superior |
|---|---|---|---|
| 10 | 14,026 | 15,104 | 15,991 |
| 100 | 361,52 | 363,74 | 365,74 |
| 1000 | 5908,76 | 5912,13 | 5915,28 |

Logo $\ln(n!)=\Theta(n\ln n)$. Uma ordenação por comparação precisa distinguir $n!$ ordens possíveis usando respostas sim/não, então exige pelo menos $\log_2(n!)=\ln(n!)/\ln2$ comparações no pior caso, o que é $\Theta(n\log n)$.

## Equívocos Comuns e Armadilhas

- **Manter os limites antigos depois de substituir.** Os limites pertencem à variável. Depois de $u=g(x)$ eles são $g(a)$ e $g(b)$ (Exemplo 2).
- **Misturar variáveis.** Uma integral com $x$ e $u$ no integrando não está terminada. Expresse o integrando inteiro numa só variável, senão a troca de variável não aconteceu.
- **Substituir atravessando uma singularidade.** $u=1/x$ ou $u=\tan x$ num intervalo que contém um ponto onde a função explode é inválido (Exemplo 4). Confira que a função é definida e contínua ao longo de todo o percurso.
- **Perder o módulo.** $\sqrt{u^2}=\lvert u\rvert$. Declare o intervalo do ângulo numa substituição trigonométrica.
- **Esperar que toda antiderivada tenha forma fechada.** Toda função contínua tem uma (a função de acúmulo), mas $e^{-x^2}$ e $\frac{\sin x}{x}$ não têm nenhuma entre as funções elementares, e nenhuma técnica daqui vai produzi-la.
- **Partes que andam em círculos.** Se a nova integral é mais difícil, troque os papéis. Em problemas cíclicos, mantenha os mesmos papéis nas duas passadas.
- **As constantes diferem.** $\int\sin x\cos x\,dx$ é $\frac12\sin^2x$ com $u=\sin x$ e $-\frac12\cos^2x$ com $u=\cos x$. As duas estão certas: diferem pela constante $\frac12$.

## Resumo

A substituição é a regra da cadeia ao contrário: $\int_a^b f(g(x))g'(x)\,dx=\int_{g(a)}^{g(b)}f(u)\,du$ quando $g'$ é contínua em $[a,b]$ e $f$ é contínua na imagem de $g$, e os limites convertidos fazem parte da resposta. No outro sentido (substituição trigonométrica), a função também precisa ser definida e contínua ao longo do intervalo, e uma raiz quadrada exige módulo a menos que o sinal seja conhecido. A integração por partes é a regra do produto ao contrário: $\int_a^b uv'=[uv]_a^b-\int_a^bu'v$ para $u,v$ continuamente deriváveis. Escolha como $u$ o que simplifica ao derivar, repita para fatores polinomiais, use $v'=1$ para $\ln$ e $\arctan$ sozinhos, e resolva algebricamente quando a integral reaparece. A antiderivada de $\ln x$ também dá cotas para $\ln(n!)$, levando à cota inferior $\Omega(n\log n)$ para ordenação por comparação. A próxima lição, `applications-area-volume-and-average-value`, põe essas ferramentas para trabalhar na geometria.

## Documentation Links

- [OpenStax Calculus Volume 1, 5.5 Substitution](https://openstax.org/books/calculus-volume-1/pages/5-5-substitution): a regra da substituição para integrais indefinidas e definidas, com exemplos resolvidos.
- [OpenStax Calculus Volume 2, 3.1 Integration by Parts](https://openstax.org/books/calculus-volume-2/pages/3-1-integration-by-parts): a fórmula, a escolha de $u$ e $dv$, partes repetidas e cíclicas.
- [Active Calculus, 5.3 Integration by substitution](https://activecalculus.org/single/sec-5-3-substitution.html): a substituição motivada pela regra da cadeia, incluindo integrais definidas.
- [Active Calculus, 5.4 Integration by parts](https://activecalculus.org/single/sec-5-4-parts.html): partes como a regra do produto ao contrário, com problemas de prática.
- [MIT OCW 18.01SC, Unit 4 Part B](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-4-techniques-of-integration/part-b-partial-fractions-integration-by-parts-arc-length-and-surface-area/): aulas sobre integração por partes junto com frações parciais.
