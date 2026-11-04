---
version: 1.0
updatedAt: 2026-11-04
title: "Condicionamento e Estabilidade Numérica"
summary: "O condicionamento de um problema versus a estabilidade de um algoritmo, erro direto e erro reverso, e por que um problema bem condicionado ainda pode ser arruinado por uma fórmula instável."
---
## Objetivos de Aprendizagem

- Definir o número de condição relativo de um problema, calculá-lo com suas hipóteses e dizer onde ele explode.
- Distinguir condicionamento, uma propriedade do problema, de estabilidade, uma propriedade do algoritmo.
- Calcular o erro direto e o erro reverso de uma resposta calculada.
- Usar a regra de que o erro direto é no máximo cerca do número de condição vezes o erro reverso, e dizer o que ela promete e o que não promete.
- Diagnosticar uma fórmula instável e trocá-la por uma estável, ou reconhecer que nenhuma troca pode ajudar.

## Contexto e Motivação

O Exemplo 2 de `sources-of-error-truncation-rounding-propagation` perdeu todos os dígitos de $1 - \cos x$, e uma reescrita recuperou todos. Essa reescrita nem sempre vai existir. Duas falhas parecem idênticas na tela e pedem respostas opostas. Às vezes a resposta é tão sensível à entrada que arredondar a entrada já a destrói, e só dados melhores ou outra pergunta podem ajudar. Às vezes o problema é perfeitamente saudável e quem desperdiça os dígitos é a fórmula.

Separar esses casos é o assunto desta lição, e isso decide o próximo passo: reescrever o código, aumentar a precisão ou questionar a entrada. O mesmo vocabulário atravessa a disciplina. `bisection-and-convergence-rate` lê um resíduo pequeno como erro reverso, e `the-matrix-condition-number` estende o número de condição para $Ax = b$.

## Teoria Central

### Condicionamento: quão sensível é o problema

Trate um problema como uma função $f$ dos dados para a resposta. O condicionamento pergunta quanto a resposta exata se move quando os dados se movem, sem nenhum algoritmo envolvido. Se $x \ne 0$, $f(x) \ne 0$ e $f$ é derivável em $x$, o **número de condição relativo** é

$$\kappa_f(x) = \left\lvert\frac{x f'(x)}{f(x)}\right\rvert,$$

o limite, quando a perturbação encolhe, da variação relativa de $f$ sobre a variação relativa de $x$. Assim, uma perturbação relativa $\eta$ na entrada move a resposta em cerca de $\kappa_f(x)\lvert\eta\rvert$. Entradas guardadas têm erro relativo de até $u$, então mesmo um algoritmo perfeito deve esperar um erro relativo perto de $\kappa u$ em float64, uma perda de cerca de $\log_{10}\kappa$ dígitos. A afirmação é de primeira ordem. Um problema com $\kappa$ perto de $1$ é **bem condicionado**, e um com $\kappa$ grande é **mal condicionado**.

| Problema | $\kappa_f(x)$ | Grande quando | Fórmula no ponto de amostra | Medido |
|---|---|---|---|---|
| $\sqrt{x}$ | $1/2$ | nunca | $0{,}5$ em $x=2$ | $0{,}5$ |
| $e^x$ | $\lvert x\rvert$ | $\lvert x\rvert$ grande | $20$ em $x=20$ | $20$ |
| $\ln x$ | $1/\lvert\ln x\rvert$ | $x$ perto de $1$ | $10000{,}5$ em $x=1{,}0001$ | $10000{,}5$ |
| $\sin x$ | $\lvert x\cot x\rvert$ | $x$ perto de $n\pi$, $n\ne0$; a maioria dos $\lvert x\rvert$ grandes | $1971{,}6$ em $x=3{,}14$ | $1971{,}6$ |
| $x - 1$ | $\lvert x\rvert/\lvert x-1\rvert$ | $x$ perto de $1$ | $10001$ em $x=1{,}0001$ | $10001$ |

A coluna medida perturba $x$ por um relativo de $10^{-20}$ em aritmética de alta precisão e divide as duas variações relativas. Para $\sin$, o tamanho sozinho também pesa: $\kappa = 2{,}68\times10^6$ em $x = 10^6$, a menos que $x$ esteja perto de $\pi/2 + n\pi$, onde $\cot x$ se anula. A última linha é a subtração $x - y$ com $y = 1$ exato, então só $x$ carrega erro. O fator $(\lvert x\rvert + \lvert y\rvert)/\lvert x - y\rvert$ da lição anterior supõe erro nos dois operandos, e aqui daria $20001$.

As hipóteses importam. Num zero de $f$ o número relativo não existe, e a versão absoluta $\lvert f'(x)\rvert$ assume. `math.sin(math.pi)` devolve $1{,}2246\times10^{-16}$, e isso não é defeito de `sin`: o `math.pi` guardado difere de $\pi$ exatamente por esse valor, e $\sin$ tem inclinação $-1$ ali.

O condicionamento também depende do que conta como dado. Como função de $x$, $\ln x$ é mal condicionado em $x = 1 + \delta$, porque arredondar $x$ já danificou $\delta$. Como função de $\delta$, $\ln(1+\delta)$ tem $\kappa$ perto de $1$. É por isso que `math.log1p(delta)` existe: quando $\delta$ é conhecido exatamente, passe $\delta$.

### Estabilidade: quão bom é o algoritmo

Um algoritmo calcula $\hat f(x)$. Seu **erro direto** é a distância até a resposta verdadeira, $\lvert\hat f(x) - f(x)\rvert$, em geral tomada em relação a $\lvert f(x)\rvert$. Seu **erro reverso** faz outra pergunta: que problema o algoritmo resolveu exatamente? É a menor perturbação relativa $\lvert\Delta x\rvert/\lvert x\rvert$ com $\hat f(x) = f(x + \Delta x)$.

Um algoritmo é **reversamente estável** (backward stable) se seu erro reverso é um múltiplo modesto de $u$ para toda entrada. De modo mais solto, um algoritmo é **estável** se seu erro direto não é muito maior que $\kappa u$, o que o condicionamento já impõe. Um algoritmo **instável** perde mais do que o problema exige.

### Ligando os dois

Se $\hat f(x) = f(x + \Delta x)$, a definição de $\kappa$ dá, em primeira ordem,

$$\frac{\lvert\hat f(x) - f(x)\rvert}{\lvert f(x)\rvert} \lesssim \kappa_f(x)\,\frac{\lvert\Delta x\rvert}{\lvert x\rvert}.$$

Isso é uma cota superior, e se lê como diagnóstico:

- Erro reverso perto de $u$ e $\kappa$ moderado: a resposta é precisa.
- Erro reverso perto de $u$ e $\kappa$ enorme: a resposta pode ser ruim, e o algoritmo não tem culpa.
- Erro direto muito acima de $\kappa u$: o algoritmo tem culpa.

### Como fórmulas ficam instáveis

Um algoritmo é uma cadeia de passos, e cada passo é um pequeno problema com seu próprio número de condição. Uma rota comum de falha é um todo bem condicionado que passa por um passo mal condicionado: os erros dos passos anteriores são ampliados, e nada adiante os recupera. Os dígitos perdidos de $1 - \cos x$ seguem esse padrão. A função inteira tem $\kappa = \lvert x\sin x/(1 - \cos x)\rvert$, que tende a $2$ quando $x \to 0$, então o problema é bem condicionado. O passo ruim é o último: $y \mapsto 1 - y$ em $y = \cos x$ tem $\kappa = \lvert y\rvert/\lvert 1 - y\rvert \approx 2/x^2$, que vale $2\times10^{16}$ em $x = 10^{-8}$. A reescrita $2\sin^2(x/2)$ não tem esse passo. Os dois exemplos instáveis abaixo falham assim.

## Exemplos Resolvidos

### Exemplo 1: um problema saudável, uma fórmula ruim

Resolva $x^2 + bx + c = 0$ com $b = -10^8$ e $c = 1$. As raízes são $r_1 \approx 10^8$ e $r_2 \approx 10^{-8}$. Derivar $r^2 + br + c = 0$ dá os números de condição de uma raiz $r$ em relação a cada coeficiente: $\kappa_b = \lvert b/(2r+b)\rvert$ e $\kappa_c = \lvert c/(r(2r+b))\rvert$. Para $r_2$ os dois valem $1$ com muitos dígitos. O problema é bem condicionado.

A fórmula de livro $r_2 = (-b - \sqrt{b^2-4c})/2$ subtrai $99999999{,}99999999$ de $10^8$. Esse único passo tem número de condição em torno de $10^{16}$. A alternativa estável calcula $r_1$ com os sinais que se somam e depois usa $r_1 r_2 = c$:

```text
fórmula            r2                       erro direto     erro reverso em c
(-b - sqrt(D))/2   7.450580596923828e-09    2.5e-01         2.5e-01
c / r1             1e-08                    7.9e-17         7.9e-17
```

O erro reverso vem de $c' = -\hat r^2 - b\hat r$, o coeficiente para o qual $\hat r$ é raiz exata. A fórmula ruim resolveu uma equação com $c$ errado em 25 por cento e, com $\kappa \approx 1$, o erro direto coincide, como a cota prevê. `numpy.roots([1, -1e8, 1])` também vai bem aqui, com erro relativo de $8{,}6\times10^{-17}$ nessa raiz.

A reescrita supõe $r_1 \ne 0$ e ajuda com o cancelamento entre $b$ e a raiz quadrada. Se $b^2 \approx 4c$, as raízes quase coincidem, o próprio problema é mal condicionado e nenhuma reescrita devolve os dígitos perdidos.

### Exemplo 2: os mesmos números, calculados em duas direções

Seja $I_n = \int_0^1 \frac{x^n}{x+10}\,dx$. Como $\frac{x^n + 10x^{n-1}}{x+10} = x^{n-1}$, vale $I_n = \frac1n - 10 I_{n-1}$ para $n \ge 1$, com $I_0 = \ln 1{,}1$. De $10 \le x + 10 \le 11$ em $[0,1]$ sai também $\frac{1}{11(n+1)} \le I_n \le \frac{1}{10(n+1)}$. A recorrência para a frente, em float64:

```text
n    I_n para a frente      I_n exato             erro       razão
0    0.09531017980432493    0.09531017980432487   7.48e-17
1    0.04689820195675065    0.0468982019567514    7.48e-16   10.00
5    0.015352900839845474   0.015352900847328939  7.48e-12   10.00
10   0.008328713865253717   0.008327965518886312  7.48e-07   10.00
14   0.013578878977397152   0.006095415303348168  7.48e-03   10.00
16   0.7537212310730486     0.005374863668150086  7.48e-01   10.00
18   74.83944336874276      0.004806628252917123  7.48e+01   10.00
```

Cada passo multiplica o erro por $-10$, como a recorrência diz, então um erro de arredondamento comum de $7{,}5\times10^{-17}$ em $I_0$ chega a $75$ em $n = 18$. Em $n = 14$ o valor já está acima da cota superior $1/150$.

Rode para trás, $I_{n-1} = \frac{1}{10}\left(\frac1n - I_n\right)$, e cada passo divide o erro por $10$. Partindo do chute grosseiro $I_{40} = 0$ (valor verdadeiro $0{,}00222$), o erro é $2{,}2\times10^{-13}$ em $n = 30$ e $7{,}0\times10^{-19}$ em $n = 22$, onde o resultado $0{,}003967651066880172$ difere de `scipy.integrate.quad` só no último dígito. Os mesmos números, por dois caminhos: um instável, outro estável. O problema nunca foram os números. A rota para a frente passa pelo subproblema $I_0 \mapsto I_n$, que amplia o erro absoluto por $10^n$.

### Exemplo 3: um bom algoritmo, um problema terrível

Tome o polinômio de Wilkinson de grau 20, $p(x) = \prod_{k=1}^{20}(x-k)$, com coeficientes $a_i$. Perturbar cada $a_i$ por um relativo $\eta_i$ move a raiz $k$ em cerca de $-\sum_i a_i\eta_i k^i/p'(k)$, então seu número de condição em relação aos coeficientes é

$$\kappa_k = \frac{\sum_i \lvert a_i\rvert k^i}{k\,\lvert p'(k)\rvert}.$$

`numpy.roots`, que calcula autovalores da matriz companheira, dá nos coeficientes expandidos:

```text
k    raiz calculada        erro direto relativo     kappa_k
1    0.9999999999999833    1.7e-14                  4.2e+02
5    5.000000877361879     1.8e-07                  8.2e+08
10   9.990574635182616     9.4e-04                  5.6e+12
14   13.935190089077999    4.6e-03                  5.4e+13
20   19.999888806572073    5.6e-06                  1.4e+11
```

Agora expanda $\prod_i(x - \hat r_i)$ em aritmética exata. Seus coeficientes diferem dos verdadeiros por um relativo de no máximo $1{,}2\times10^{-14}$. Logo, as raízes calculadas são as raízes exatas de um polinômio que é quase o certo: o erro reverso é minúsculo, enquanto o erro direto chega a $4{,}6\times10^{-3}$. Para $k = 14$ a cota dá $5{,}4\times10^{13} \times 1{,}2\times10^{-14} \approx 0{,}65$, que o erro real respeita com muita folga.

O próprio dado já vem arredondado: cinco desses coeficientes inteiros não cabem exatamente num float64. A aritmética exata confirma a sensibilidade. Mudar o coeficiente de $x^{19}$ de $-210$ para $-210 - 2^{-23}$, uma variação relativa de $5{,}7\times10^{-10}$, manda raízes para $16{,}73 \pm 2{,}81i$. Nenhum algoritmo que receba coeficientes arredondados consegue desfazer isso. A cura é outra representação: um programa que guarda os fatores $(x-k)$ não tem problema nenhum para resolver.

## Equívocos Comuns e Armadilhas

- **"Mal condicionado quer dizer que o algoritmo é ruim."** O condicionamento não envolve algoritmo. O Exemplo 3 tem erro reverso minúsculo e erro direto grande.
- **"Resíduo pequeno quer dizer resposta precisa."** Quer dizer erro reverso pequeno. A precisão depende também de $\kappa$.
- **"Uma resposta precisa prova estabilidade reversa."** Tome $f(x) = 1 + x$ em $x = 10^{-20}$. O `1.0` calculado tem erro direto $10^{-20}$, mas é a resposta exata só para $x = 0$, um erro reverso relativo de $1$.
- **"Mais precisão conserta instabilidade."** No Exemplo 2 cada dígito decimal extra compra um passo a mais. A cura é a direção para trás.
- **"Uma função tem um número de condição."** $\kappa$ depende do ponto e do que conta como dado: $\ln$ tem $\kappa = 10000{,}5$ em $1{,}0001$ e $0{,}22$ em $100$.
- **"A cota é uma estimativa."** O Exemplo 3 mostra $0{,}65$ contra um valor real de $4{,}6\times10^{-3}$. Ela limita a pior perturbação, e a perturbação real não precisa ser a pior.

## Resumo

O número de condição $\kappa_f(x) = \lvert x f'(x)/f(x)\rvert$ mede quanto o problema amplia perturbações relativas, antes de qualquer algoritmo rodar. Ele exige $x \ne 0$, $f(x) \ne 0$ e derivabilidade, e depende do que se toma como dado. O erro direto compara a resposta com a verdade, e o erro reverso pergunta que problema próximo foi resolvido exatamente. Em primeira ordem, o erro direto é no máximo $\kappa$ vezes o erro reverso. Um algoritmo reversamente estável num problema bem condicionado dá uma resposta precisa. Num problema mal condicionado, dá erro reverso pequeno e talvez uma resposta ruim, e um algoritmo melhor não muda isso. Quando o erro direto passa muito de $\kappa u$, a culpa é da fórmula, muitas vezes por um único passo mal condicionado, e reescrevê-la ou rodá-la em outra direção pode recuperar os dígitos.

## Documentation Links

- [Fundamentals of Numerical Computation, 1.2 Problems and conditioning](https://fncbook.com/conditioning): o número de condição relativo, sua fórmula e o condicionamento de raízes trabalhado em exemplos.
- [Fundamentals of Numerical Computation, 1.4 Stability](https://fncbook.com/stability): fórmulas instáveis, erro reverso e a comparação com o condicionamento.
- [MIT OpenCourseWare 18.335J, Week 2](https://ocw.mit.edu/courses/18-335j-introduction-to-numerical-methods-spring-2019/pages/week-2/): resumo da aula sobre soma em ponto flutuante e estabilidade direta e reversa.
- [Goldberg (1991), What Every Computer Scientist Should Know About Floating-Point Arithmetic](https://docs.oracle.com/cd/E19957-01/806-3568/ncg_goldberg.html): como reorganizar a fórmula quadrática e outras expressões para evitar cancelamento catastrófico.
- [NumPy documentation, numpy.roots](https://numpy.org/doc/stable/reference/generated/numpy.roots.html): raízes de polinômios pelos autovalores da matriz companheira.
- [SciPy documentation, scipy.integrate.quad](https://docs.scipy.org/doc/scipy/reference/generated/scipy.integrate.quad.html): quadratura adaptativa, usada como conferência independente.
- [Python documentation, math](https://docs.python.org/3/library/math.html): `log1p`, `expm1` e funções relacionadas para argumentos perto de um cancelamento.
