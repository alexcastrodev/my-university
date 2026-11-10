---
version: 1.0
updatedAt: 2026-11-04
title: "Derivadas Direcionais e a Direção de Maior Crescimento"
summary: "Aprofunda a lição existente de gradientes sem repeti-la: a derivada direcional, por que o gradiente aponta na direção de maior crescimento e por que ele é perpendicular às curvas de nível."
---
## Objetivos de Aprendizagem

- Definir a derivada direcional $D_{\mathbf u} f$ como um limite ao longo de um vetor unitário e dizer por que o vetor precisa ter comprimento um.
- Provar que $D_{\mathbf u} f = \nabla f \cdot \mathbf u$ para $f$ diferenciável e apontar o que dá errado quando $f$ não é diferenciável.
- Deduzir de $D_{\mathbf u} f = \lVert\nabla f\rVert \cos\theta$ as direções de maior crescimento, maior decrescimento e variação nula, incluindo o caso $\nabla f = 0$.
- Mostrar que o gradiente é perpendicular à curva de nível que passa por um ponto e usá-lo para escrever a reta tangente.
- Enunciar os limites de "seguir o gradiente negativo": é uma afirmação local e depende de como o comprimento é medido.

## Contexto e Motivação

A lição `gradients-extending-derivatives-to-several-variables` apresenta $\nabla f$ como o vetor das derivadas parciais e afirma duas coisas sobre ele: que aponta na direção de crescimento mais rápido, com seu comprimento como a taxa, e que $\nabla f = 0$ marca pontos planos. Ela as enuncia sem prova, porque evita deliberadamente os limites. Esta lição conquista a primeira afirmação. Ela também responde a três perguntas que a versão informal deixa em aberto: qual é exatamente a taxa de variação numa direção que *não* é um eixo coordenado, por que a melhor direção é o gradiente e não outra, e quando a história inteira deixa de ser verdadeira.

Nada disso é só geometria. A descida do gradiente, o cavalo de batalha do treinamento de modelos, anda ao longo de $-\nabla f$, e o modo como ela faz ziguezague em vales estreitos, ou ultrapassa o alvo com um passo grande, pode ser lido diretamente dos fatos provados abaixo. O pré-requisito é `partial-derivatives-and-the-multivariable-chain-rule`: a prova da fórmula principal é uma aplicação de sua regra da cadeia, e seu aviso sobre diferenciabilidade é exatamente o que limita o resultado.

## Teoria Central

### A derivada direcional

Uma derivada parcial mede a variação ao longo de um eixo coordenado. Para medi-la ao longo de qualquer direção, tome um **vetor unitário** $\mathbf u = (u_1, u_2)$ com $u_1^2 + u_2^2 = 1$ e defina

$$D_{\mathbf u} f(\mathbf a) = \lim_{h \to 0} \frac{f(\mathbf a + h\mathbf u) - f(\mathbf a)}{h}.$$

Equivalentemente, $D_{\mathbf u} f(\mathbf a) = g'(0)$ para a função de uma variável $g(t) = f(\mathbf a + t\mathbf u)$, o perfil de altura de $f$ ao longo da reta que passa por $\mathbf a$ na direção $\mathbf u$. As parciais são os casos particulares $\mathbf u = (1, 0)$ e $\mathbf u = (0, 1)$. O comprimento unitário importa porque então $t$ mede a distância percorrida: para um vetor $\mathbf v$ de comprimento $5$, o perfil $f(\mathbf a + t\mathbf v)$ corre cinco vezes mais rápido e a "derivada" ficaria inflada por cinco.

### A fórmula

**Teorema.** Se $f$ é diferenciável em $\mathbf a$, então $D_{\mathbf u} f(\mathbf a)$ existe para todo vetor unitário $\mathbf u$ e

$$D_{\mathbf u} f(\mathbf a) = \nabla f(\mathbf a) \cdot \mathbf u = f_x(\mathbf a)\,u_1 + f_y(\mathbf a)\,u_2.$$

*Prova.* Sejam $x(t) = a_1 + t u_1$ e $y(t) = a_2 + t u_2$, deriváveis com $x' = u_1$ e $y' = u_2$. A regra da cadeia da lição anterior, que exige $f$ diferenciável, dá $g'(0) = f_x u_1 + f_y u_2$. $\square$

A fórmula tem também uma leitura computacional. Para obter a taxa ao longo de uma direção escolhida não é preciso o gradiente inteiro: a diferenciação automática em modo direto (forward mode), inicializada com $\mathbf u$, devolve $D_{\mathbf u} f$ numa única passada, a um custo comparável ao de avaliar $f$ uma vez, enquanto formar todo o $\nabla f$ desse jeito custaria uma passada por coordenada.

A diferenciabilidade é uma hipótese real. O Exemplo 5 exibe uma função contínua cujas derivadas direcionais todas existem e que mesmo assim viola a fórmula.

### Maior crescimento, com prova

Seja $\theta$ o ângulo entre $\nabla f(\mathbf a)$ e $\mathbf u$. Como $\lVert \mathbf u \rVert = 1$,

$$D_{\mathbf u} f(\mathbf a) = \lVert \nabla f(\mathbf a) \rVert \cos\theta.$$

Se $\nabla f(\mathbf a) \ne 0$, isso é máximo quando $\cos\theta = 1$, então a taxa máxima é $\lVert\nabla f\rVert$ na direção $\nabla f / \lVert\nabla f\rVert$. É mínima, $-\lVert\nabla f\rVert$, na direção oposta. É zero nas duas direções perpendiculares a $\nabla f$. Se $\nabla f(\mathbf a) = 0$, toda derivada direcional é $0$ e não há direção preferida em primeira ordem.

Essa é a afirmação que a lição informal enuncia. A prova não usa nada além da fórmula e de $\lvert\cos\theta\rvert \le 1$.

### O gradiente é perpendicular às curvas de nível

Suponha $f$ de classe $C^1$ e $\nabla f(\mathbf a) \ne 0$ (o mesmo argumento vale em três variáveis, onde o conjunto de nível é uma superfície e o gradiente é normal ao seu plano tangente). Então, perto de $\mathbf a$, o conjunto de nível $f = c$ que passa por $\mathbf a$ é uma curva suave, consequência do teorema da função implícita. Parametrize-a como $\mathbf r(t)$ com $\mathbf r(0) = \mathbf a$ e $\mathbf r'(0) \ne 0$. Como $f(\mathbf r(t)) = c$ é constante, derivar com a regra da cadeia dá

$$\nabla f(\mathbf a) \cdot \mathbf r'(0) = 0.$$

Logo $\nabla f(\mathbf a)$ é perpendicular à tangente da curva de nível, e a reta tangente é $\nabla f(\mathbf a) \cdot (\mathbf x - \mathbf a) = 0$. Isso combina com a imagem do mapa de contorno: andar ao longo de um contorno mantém a altura, e a saída mais íngreme é de través. Também explica por que contornos apertados significam $\lVert\nabla f\rVert$ grande. A hipótese $\nabla f \ne 0$ importa: para $f = x^2 - y^2$ na origem, $\nabla f = 0$ e o nível $c = 0$ são duas retas que se cruzam, sem tangente única.

## Exemplos Resolvidos

### Exemplo 1: taxas em várias direções

Tome $f(x, y) = x^2 + 4y^2$ em $\mathbf a = (2, 1)$, onde $\nabla f = (2x, 8y) = (4, 8)$ e $\lVert\nabla f\rVert = 4\sqrt5 \approx 8{,}944$.

- Direção $\mathbf u = (3/5, 4/5)$: $D_{\mathbf u} f = \tfrac{12}{5} + \tfrac{32}{5} = 8{,}8$.
- Maior crescimento, $\mathbf u = (1, 2)/\sqrt5$: taxa $4\sqrt5 \approx 8{,}944$, um pouco acima de $8{,}8$, como deve ser.
- Direção tangente $\mathbf u = (2, -1)/\sqrt5$: $D_{\mathbf u} f = (8 - 8)/\sqrt5 = 0$.

A reta tangente à curva de nível $x^2 + 4y^2 = 8$ é $4(x - 2) + 8(y - 1) = 0$, isto é, $x + 2y = 4$, com inclinação $-1/2$, a mesma que a fórmula da inclinação implícita da lição anterior deu. Diferenças finitas centradas de $f$ ao longo dessas direções devolvem $8{,}8$, $8{,}944$ e $0$. O vetor $\mathbf v = (3, 4)$ sem normalizar daria $44$, cinco vezes grande demais.

### Exemplo 2: uma direção de decrescimento

Seja $f(x, y) = x e^{y}$ em $(1, 0)$, de modo que $\nabla f = (e^y, x e^y) = (1, 1)$. Ao longo de $\mathbf u = (3, -4)/5$, $D_{\mathbf u} f = (3 - 4)/5 = -0{,}2$: a função decresce. A direção mais íngreme é $(1, 1)/\sqrt2$ com taxa $\sqrt2$, e a de maior decrescimento é $(-1, -1)/\sqrt2$.

### Exemplo 3: a descida do gradiente não aponta para o minimizador

Para $f = x^2 + 4y^2$, o mínimo está na origem. A partir de $(2, 1)$, a direção até o minimizador é $(-2, -1)$ e a direção de maior decrescimento é $-\nabla f = (-4, -8)$. O cosseno entre elas é $\dfrac{8 + 8}{\sqrt{80}\,\sqrt5} = 0{,}8$, um ângulo de cerca de $37°$. O motivo é a geometria acima: o gradiente é perpendicular ao contorno elíptico, e a normal a uma elipse passa pelo centro apenas sobre os eixos.

O tamanho do passo também importa, porque o gradiente descreve um movimento infinitesimal. Atualize $\mathbf p \leftarrow \mathbf p - \eta \nabla f(\mathbf p)$ a partir de $(2, 1)$:

```text
eta = 0.05   f: 8, 4.68, 3.14, 2.31, 1.79, 1.42     (decresce)
eta = 0.20   f: 8, 2.88, 1.04, 0.37, 0.13, 0.05     (decresce mais rápido)
eta = 0.30   f: 8, 8.48, 15.47, 30.13, 59.03, 115.70 (cresce)
```

Para este $f$, a coordenada $y$ é multiplicada por $1 - 8\eta$ a cada passo, então qualquer $\eta > 1/4$ a faz crescer. Um único passo de $0{,}3$ já leva de $(2, 1)$ a $(0{,}8;\ -1{,}4)$, onde $f = 8{,}48 > 8$, embora o passo tenha partido de uma direção de decrescimento.

### Exemplo 4: uma superfície de nível em três variáveis

Para $f(x, y, z) = x^2 + y^2 + z^2$, o nível $f = 14$ é uma esfera que passa por $(1, 2, 3)$. Ali $\nabla f = (2, 4, 6)$, então o plano tangente é $2(x - 1) + 4(y - 2) + 6(z - 3) = 0$, que se simplifica a $x + 2y + 3z = 14$. O gradiente $(2, 4, 6)$ é paralelo ao raio a partir da origem, como deve ser a normal de uma esfera, e $1 + 4 + 9 = 14$ confirma que o plano passa pelo ponto.

### Exemplo 5: onde a fórmula falha

Seja $q(x, y) = \dfrac{x^2 y}{x^2 + y^2}$ com $q(0, 0) = 0$, a função que `functions-of-several-variables-and-level-curves` mostrou ser contínua na origem. Para um vetor unitário $\mathbf u$, $q(h\mathbf u) = h\,u_1^2 u_2$, então

$$D_{\mathbf u} q(0, 0) = u_1^2 u_2.$$

Toda derivada direcional existe. Mas as duas parciais na origem são $0$ (tome $\mathbf u = (1, 0)$ e $(0, 1)$), então a fórmula preveria $D_{\mathbf u} q = 0$ para todo $\mathbf u$. Para $\mathbf u = (1, 1)/\sqrt2$, o valor verdadeiro é $1/(2\sqrt2) \approx 0{,}354$. A maior taxa é $2\sqrt3/9 \approx 0{,}385$ em $\mathbf u = (\sqrt{2/3}, \sqrt{1/3})$, uma direção que o "gradiente" $(0, 0)$ desconhece. A aplicação $\mathbf u \mapsto u_1^2 u_2$ não é linear em $\mathbf u$, que é a assinatura de uma função não diferenciável. Um caso mais simples é o cone $f = \sqrt{x^2 + y^2}$: no vértice, o perfil ao longo de qualquer reta é $g(t) = \lvert t\rvert$, então o limite bilateral que define $D_{\mathbf u} f$ não existe (a taxa unilateral é $1$ em toda direção), e não existe gradiente.

## Equívocos Comuns e Armadilhas

- **"Qualquer vetor de direção serve."** A fórmula exige $\lVert\mathbf u\rVert = 1$. Para outro vetor $\mathbf v$, normalize antes, ou você obtém $\lVert\mathbf v\rVert$ vezes a taxa verdadeira.
- **"Se todas as derivadas direcionais existem, a fórmula do gradiente vale."** O Exemplo 5 é uma função contínua em que ela não vale. Existir o limite em toda direção é mais fraco que ser diferenciável.
- **"$D_{\mathbf u} f = 0$ significa $\nabla f = 0$."** Isso também ocorre em toda direção perpendicular ao gradiente, que são exatamente as tangentes à curva de nível.
- **"O gradiente aponta para o máximo ou o mínimo."** Ele dá a melhor direção local. O Exemplo 3 o mostra desviando cerca de $37°$ da direção do minimizador.
- **"Mais íngreme não depende das coordenadas."** É mais íngreme por unidade de comprimento euclidiano nas coordenadas que você escolheu. A substituição $v = 2y$ transforma $x^2 + 4y^2$ em $x^2 + v^2$, cujo gradiente em $(2, 2)$ é $(4, 4)$. Nas variáveis originais isso é o deslocamento $(dx, dy) = (4, 2)$, e não a direção $(4, 8)$ de $\nabla f$. Reescalar variáveis muda a direção, e por isso a escala das features muda o comportamento dos métodos de gradiente.
- **"O gradiente vive na superfície."** Ele é um vetor no plano das entradas, não um vetor tangente ao gráfico.

## Resumo

A derivada direcional $D_{\mathbf u} f$ é a inclinação de $f$ ao longo da reta por um ponto na direção unitária $\mathbf u$. Para $f$ diferenciável, ela é igual a $\nabla f \cdot \mathbf u = \lVert\nabla f\rVert\cos\theta$, o que prova que o gradiente dá a direção de crescimento mais rápido com taxa $\lVert\nabla f\rVert$, que $-\nabla f$ dá o decrescimento mais rápido, e que as direções perpendiculares a $\nabla f$ mantêm $f$ constante em primeira ordem, de modo que $\nabla f$ é normal à curva de nível. A prova é a regra da cadeia, e as hipóteses são reais: sem diferenciabilidade, derivadas direcionais podem existir e violar a fórmula, e com $\nabla f = 0$ não há direção a escolher. Como método, a descida mais íngreme é local e depende das coordenadas, e não aponta para o minimizador. Essa é a ferramenta que a próxima lição, `critical-points-and-the-second-derivative-test`, usa para perguntar o que acontece onde o gradiente se anula.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.6 Directional Derivatives and the Gradient](https://openstax.org/books/calculus-volume-3/pages/4-6-directional-derivatives-and-the-gradient): derivadas direcionais, o gradiente, maior crescimento e o gradiente normal às curvas de nível.
- [Active Calculus Multivariable, Directional Derivatives and the Gradient](https://activecalculus.org/multi/S-mv_deriv-directional.html): atividades que constroem a derivada direcional e o gradiente a partir de inclinações ao longo de retas.
- [MIT OCW 18.02SC, Unit 2 Part B: Chain Rule, Gradient and Directional Derivatives](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-b-chain-rule-gradient-and-directional-derivatives/): sessões de aula sobre o gradiente e as derivadas direcionais.
