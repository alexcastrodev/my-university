---
version: 1.0
updatedAt: 2026-11-04
title: "Equações Diferenciais Separáveis"
summary: "Separação de variáveis, a equação logística, a lei de resfriamento de Newton e a verificação de uma solução por substituição."
---
## Objetivos de Aprendizagem

- Reconhecer uma equação separável $y' = g(t)\,h(y)$ e executar a separação de variáveis, incluindo a justificativa por trás da notação.
- Achar as soluções constantes (equilíbrios) de $h(y) = 0$ e explicar por que dividir por $h(y)$ pode perdê-las.
- Resolver a equação logística, identificar seus equilíbrios e a capacidade de suporte, e dizer qual solução a fórmula não cobre.
- Resolver a lei de resfriamento de Newton e ajustar sua constante a partir de uma medida.
- Verificar qualquer solução substituindo-a de volta e indicar o intervalo em que vale.

## Contexto e Motivação

A lição anterior, `differential-equations-and-initial-value-problems`, resolveu $y' = ky$ chutando a exponencial e provando que era a única solução. Chutar não escala. Uma população não cresce exponencialmente para sempre, e uma xícara que esfria não perde calor a uma taxa fixa: a taxa depende do valor atual de um modo que não é simplesmente proporcional a ele. Uma grande família dessas equações se resolve com duas integrais.

Essa família são as equações **separáveis**, em que o lado direito se fatora em uma parte que depende só de $t$ e outra que depende só de $y$. Dois membros famosos são a equação logística, que modela crescimento com saturação, e a lei de resfriamento de Newton. A curva logística também aparece em computação como a sigmoide usada em regressão logística e redes neurais. No caminho você vai encontrar o principal perigo do método: uma divisão que descarta uma solução sem avisar.

## Teoria Central

### A forma separável e o método

Uma equação é **separável** se pode ser escrita como

$$y' = g(t)\,h(y),$$

com $g$ contínua em um intervalo e $h$ contínua. Então:

1. Resolva $h(y) = 0$. Cada raiz $y^*$ dá uma solução constante $y \equiv y^*$, porque os dois lados valem $0$.
2. Onde $h(y) \neq 0$, divida: $\dfrac{y'}{h(y)} = g(t)$.
3. Integre os dois lados em relação a $t$. Seja $H$ uma primitiva de $1/h$ e $G$ uma de $g$. Pela regra da cadeia, $\frac{d}{dt}H(y(t)) = H'(y)\,y' = y'/h(y) = g(t)$, então $H(y(t)) - G(t)$ tem derivada nula.
4. Em um **intervalo**, função de derivada nula é constante, logo $H(y(t)) = G(t) + C$.
5. Isole $y$ se der; senão, deixe a relação implícita. Use a condição inicial para fixar $C$.
6. Substitua o resultado na equação e na condição inicial e indique o intervalo.

O passo 4 em uma linha:

$$H(y(t)) = G(t) + C.$$

A notação usual $\frac{dy}{h(y)} = g(t)\,dt$, integrada de cada lado, comprime os passos 2 a 4, e a integral da esquerda é uma substituição (`integration-by-substitution-and-by-parts`). O argumento da regra da cadeia é o que legitima a notação, porque $dy/dt$ é limite de quocientes, não uma fração que se possa partir livremente. Ele exige $h(y(t)) \neq 0$ para todo $t$ do intervalo, que é o que o passo 2 supôs.

### Soluções perdidas ao dividir

O passo 2 divide por $h(y)$, então exclui sem avisar as soluções em que $h(y) = 0$. Essas são as soluções constantes do passo 1, chamadas **equilíbrios**, e a fórmula geral dos passos 3 a 5 pode ou não contê-las.

- Às vezes um valor especial da constante recupera o equilíbrio. Para $y' = 2ty$, a fórmula $y = Ae^{t^2}$ contém $y \equiv 0$ em $A = 0$.
- Às vezes não. Na equação logística abaixo, nenhum valor finito da constante dá $P \equiv 0$.

Por isso, liste sempre as raízes de $h$ primeiro e decida, uma a uma, se a fórmula final as cobre. Se não cobre, a resposta é a fórmula **mais** a solução extra.

Quando a divisão é segura no resto do plano? Suponha $g$ contínua e $h$ com derivada contínua, de modo que $g(t)h(y)$ e sua derivada em $y$, $g(t)h'(y)$, sejam contínuas e o teorema de unicidade da lição anterior se aplique. Então uma solução não constante nunca alcança um equilíbrio, pois isso poria duas soluções por um mesmo ponto. Cada solução fica em uma faixa entre raízes consecutivas de $h$, onde $h \neq 0$, e a divisão se justifica. Sem essa hipótese, soluções podem sair de um equilíbrio, como em $y' = 3y^{2/3}$ da lição anterior.

### A equação logística

O crescimento exponencial $P' = kP$ não tem teto. A **equação logística** acrescenta um:

$$P' = kP\left(1 - \frac{P}{M}\right), \qquad k > 0,\ M > 0.$$

Quando $P$ é pequeno perto de $M$, o fator entre parênteses fica próximo de $1$ e o crescimento é quase exponencial. Quando $P$ se aproxima de $M$, o fator tende a $0$ e o crescimento para. O número $M$ é a **capacidade de suporte** (carrying capacity). A equação é separável com $h(P) = kP(1 - P/M)$, então os equilíbrios são $P = 0$ e $P = M$.

Para $0 < P < M$ (os mesmos passos valem nas outras faixas, com $A$ de qualquer sinal), as frações parciais dão $\dfrac{1}{P(1 - P/M)} = \dfrac{1}{P} + \dfrac{1}{M - P}$. Separando e integrando:

$$\ln\lvert P\rvert - \ln\lvert M - P\rvert = kt + c \quad\Longrightarrow\quad \frac{P}{M - P} = Ae^{kt}, \quad A = \pm e^{c} \neq 0.$$

Isolando $P$ e escrevendo $C = 1/A$:

$$P(t) = \frac{M}{1 + Ce^{-kt}}, \qquad C = \frac{M - P_0}{P_0}.$$

**O que a fórmula cobre e o que perde.** $C = 0$ dá o equilíbrio $P \equiv M$. Nenhum $C$ finito dá $P \equiv 0$, que foi removido quando dividimos por $P$, então nesta parametrização $P \equiv 0$ é uma solução perdida e deve ser declarada à parte. A lacuna é da parametrização, não da equação. Escrevendo a família como $P = MAe^{kt}/(1 + Ae^{kt})$, recupera-se $P \equiv 0$ em $A = 0$ e perde-se $P \equiv M$. Parametrizando pelo valor inicial, $P(t) = \dfrac{M P_0 e^{kt}}{M - P_0 + P_0 e^{kt}}$, cobrem-se os dois: $P_0 = 0$ e $P_0 = M$ dão os dois equilíbrios (em qualquer intervalo em que o denominador não se anula).

A forma da curva sai da fórmula. Para $0 < P_0 < M$ ela é um S: crescente, com crescimento mais rápido em $P = M/2$, onde $P' = kM/4$, tendendo a $M$. Para $P_0 > M$, a solução decresce até $M$. Para $P_0 < 0$ (sem sentido para uma população) o denominador se anula em tempo finito e a solução explode. O equilíbrio $0$ repele e $M$ atrai toda solução que começa em valor positivo.

### A lei de resfriamento de Newton

A lei de resfriamento de Newton diz que a temperatura $T$ de um objeto varia a uma taxa proporcional à diferença para o ambiente:

$$T' = -k\,(T - T_{\text{env}}), \qquad k > 0,$$

com $T_{\text{env}}$ constante. É separável, com um único equilíbrio $T = T_{\text{env}}$. Para $T \neq T_{\text{env}}$,

$$\ln\lvert T - T_{\text{env}}\rvert = -kt + c \quad\Longrightarrow\quad T(t) = T_{\text{env}} + (T_0 - T_{\text{env}})\,e^{-kt}.$$

Aqui a solução perdida é recuperada: $T_0 = T_{\text{env}}$ dá $T \equiv T_{\text{env}}$. A temperatura se aproxima de $T_{\text{env}}$ mas, neste modelo, não a alcança em tempo finito.

A lei é uma aproximação empírica. Descreve razoavelmente o resfriamento quando a perda de calor é sobretudo por convecção e a diferença de temperatura é moderada. A radiação cresce mais que linearmente com a temperatura, e a evaporação de uma bebida quente acrescenta perda própria, então dados reais se afastam de uma exponencial única. A constante $k$ depende do objeto e do entorno e se obtém de uma medida.

## Exemplos Resolvidos

### Exemplo 1: solução perdida que a constante recupera

Resolva $y' = 2ty$, $y(0) = 3$. Aqui $g(t) = 2t$ e $h(y) = y$, com equilíbrio $y \equiv 0$. Para $y \neq 0$:

$$\frac{y'}{y} = 2t \quad\Longrightarrow\quad \ln\lvert y\rvert = t^2 + c \quad\Longrightarrow\quad y = Ae^{t^2}, \quad A = \pm e^{c}.$$

Então $y(0) = A = 3$, e $y = 3e^{t^2}$. Substituição: $y' = 6te^{t^2} = 2t\cdot 3e^{t^2} = 2ty$, e $y(0) = 3$. Vale para todo real $t$. A solução perdida $y \equiv 0$ é o membro $A = 0$ da família, e a condição inicial escolhe $A = 3$ de qualquer modo. Uma integração numérica dá $y(1) = 8{,}1548$, igual a $3e = 8{,}1548$.

### Exemplo 2: solução implícita e intervalo restrito

Resolva $y' = -t/y$, $y(0) = 2$. Aqui $h(y) = 1/y$ não está definida em $y = 0$, então $y = 0$ não é equilíbrio, e sim um ponto que a solução precisa evitar. Separando, $y\,y' = -t$, logo

$$\frac{y^2}{2} = -\frac{t^2}{2} + c \quad\Longrightarrow\quad t^2 + y^2 = C.$$

A condição inicial dá $C = 4$. Essa relação é um círculo, mas solução é função, e a condição $y(0) = 2 > 0$ escolhe a metade de cima: $y = \sqrt{4 - t^2}$. Substituição: $y' = -t/\sqrt{4 - t^2} = -t/y$ e $y(0) = 2$. A fórmula vale em $(-2, 2)$: em $t = \pm 2$ temos $y = 0$, onde a equação não está definida e a inclinação da semicircunferência é infinita. Para $y(0) = -2$ a solução é a metade de baixo, $-\sqrt{4 - t^2}$. Uma integração numérica até $t = 1{,}9$ dá $0{,}6245$, igual a $\sqrt{4 - 1{,}9^2}$.

### Exemplo 3: a equação logística com números

Sejam $k = 0{,}4$, $M = 100$, $P(0) = 10$. Então $C = (100 - 10)/10 = 9$ e

$$P(t) = \frac{100}{1 + 9e^{-0{,}4t}}.$$

Substituição: com $E = e^{-0{,}4t}$, $P' = \dfrac{100\cdot 9\cdot 0{,}4\,E}{(1 + 9E)^2}$, e $0{,}4\,P\,(1 - P/100) = 0{,}4\cdot\dfrac{100}{1 + 9E}\cdot\dfrac{9E}{1 + 9E}$, que é igual; além disso $P(0) = 100/10 = 10$. Valores, comparados com uma integração numérica da EDO:

```text
t      P(t)       numérico
0      10.0000    10.0000
5      45.0853    45.0853
10     85.8486    85.8486
15     97.8178    97.8178
20     99.6990    99.6990
30     99.9945    99.9945
```

A população chega a $M/2 = 50$ quando $9e^{-0{,}4t} = 1$, em $t = \ln 9/0{,}4 \approx 5{,}49$, onde a taxa de crescimento é a máxima, $kM/4 = 10$. Começando acima da capacidade, com $P(0) = 150$, tem-se $C = -1/3$ e $P = 100/(1 - e^{-0{,}4t}/3)$, que cai em direção a $100$ (vale $100{,}011$ em $t = 20$). Essa fórmula vale para $t > -\ln 3/0{,}4 \approx -2{,}75$, então cobre todo $t \ge 0$. A solução perdida $P \equiv 0$ é o caso $P(0) = 0$: a fórmula falha ali porque $C = (M - P_0)/P_0$ não está definido.

### Exemplo 4: café esfriando

Uma xícara de café a $90\,^\circ\text{C}$ está em uma sala a $20\,^\circ\text{C}$ e marca $70\,^\circ\text{C}$ após $5$ minutos. Então $T = 20 + 70e^{-kt}$ e $70 = 20 + 70e^{-5k}$, logo $e^{-5k} = 5/7$ e $k = \ln(7/5)/5 \approx 0{,}0673\ \text{min}^{-1}$. Após $10$ minutos, $T = 20 + 70\cdot(5/7)^2 \approx 55{,}71$. Para chegar a $40\,^\circ\text{C}$: $70e^{-kt} = 20$, então $t = \ln 3{,}5/k \approx 18{,}62$ minutos. Substituição: $T' = -70ke^{-kt} = -k(T - 20)$ e $T(0) = 90$.

### Exemplo 5: a sigmoide é solução de uma logística

A sigmoide $\sigma(t) = 1/(1 + e^{-t})$ satisfaz $\sigma' = \sigma(1 - \sigma)$, a equação logística com $k = M = 1$. Com $\sigma(0) = 1/2$, a constante é $C = (1 - 1/2)/(1/2) = 1$, o que dá a sigmoide. Verificação: $\sigma' = e^{-t}/(1 + e^{-t})^2$ e $\sigma(1 - \sigma) = \frac{1}{1 + e^{-t}}\cdot\frac{e^{-t}}{1 + e^{-t}}$, iguais. Em $t = 3$, a fórmula e uma integração numérica dão $0{,}9526$. Pelo teorema de unicidade, esse PVI não tem outra solução. Por isso o código de gradiente de uma ativação sigmoide pode calcular a derivada só a partir da saída.

## Equívocos Comuns e Armadilhas

- **"É só dividir, e a fórmula é a resposta toda."** Dividir por $h(y)$ descarta as raízes de $h$. Na equação logística, a resposta é a fórmula mais $P \equiv 0$.
- **"$dy/dx$ é uma fração, então vale tudo."** A reescrita é justificada pela regra da cadeia e por uma substituição. Ela deixa de valer em qualquer $t$ onde $h(y(t)) = 0$.
- **Esquecer o módulo em $\ln\lvert y\rvert$.** Escrever $\ln y$ restringe, sem avisar, a $y$ positivo. Mantenha $\lvert\cdot\rvert$ e depois absorva $\pm e^{c}$ em uma constante só.
- **Pôr uma constante em cada lado.** Uma basta; duas são redundantes.
- **Pegar o sinal errado da raiz.** No Exemplo 2, $t^2 + y^2 = 4$ não é uma função. A condição inicial escolhe o ramo.
- **"A solução vive na reta toda."** A do Exemplo 2 vive em $(-2, 2)$, e as soluções logísticas com $P_0 < 0$ explodem em tempo finito. Indique o intervalo.
- **"Toda equação de primeira ordem é separável."** $y' = t + y$ não é: a razão entre suas inclinações em duas alturas depende de $t$, o que um produto $g(t)h(y)$ não produz.

## Resumo

Uma equação separável $y' = g(t)h(y)$ se resolve achando as raízes de $h$, dividindo onde $h \neq 0$ e integrando, com a regra da cadeia justificando a notação e o fato de derivada nula em intervalo implicar constante dando a constante única. A divisão descarta os equilíbrios, então toda solução deve ser conferida contra eles: $y' = 2ty$ recupera $y \equiv 0$ pela constante, enquanto a equação logística $P' = kP(1 - P/M)$ tem a fórmula $P = M/(1 + Ce^{-kt})$, que contém $P \equiv M$ e perde $P \equiv 0$. A lei de resfriamento de Newton dá $T = T_{\text{env}} + (T_0 - T_{\text{env}})e^{-kt}$, uma aproximação cuja constante se ajusta a uma medida. Toda resposta é verificada substituindo-a na equação e na condição inicial, e vem acompanhada do intervalo de validade.

## Documentation Links

- [OpenStax Calculus Volume 2, 4.3 Separable Equations](https://openstax.org/books/calculus-volume-2/pages/4-3-separable-equations): separação de variáveis e aplicações, incluindo a lei de resfriamento de Newton.
- [OpenStax Calculus Volume 2, 4.4 The Logistic Equation](https://openstax.org/books/calculus-volume-2/pages/4-4-the-logistic-equation): capacidade de suporte, campos de direções, equilíbrios e a solução da equação logística.
- [MIT OpenCourseWare 18.01SC, Part C: Mean Value Theorem, Antiderivatives and Differential Equations](https://ocw.mit.edu/courses/18-01sc-single-variable-calculus-fall-2010/pages/unit-2-applications-of-differentiation/part-c-mean-value-theorem-antiderivatives-and-differential-equations/): notas de aula, vídeos e problemas, incluindo a sessão "Separation of Variables".
