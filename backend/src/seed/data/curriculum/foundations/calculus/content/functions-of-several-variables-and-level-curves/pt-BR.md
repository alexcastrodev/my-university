---
version: 1.0
updatedAt: 2026-11-04
title: "Funções de Várias Variáveis e Curvas de Nível"
summary: "Funções de duas ou mais variáveis, seus domínios, gráficos e curvas de nível, e limites e continuidade quando um ponto pode ser alcançado por muitos caminhos."
---
## Objetivos de Aprendizagem

- Descrever uma função $f(x, y)$ por meio de seu domínio, sua imagem, seu gráfico como superfície no espaço tridimensional e suas curvas de nível.
- Ler um mapa de contorno: localizar picos, vales e regiões íngremes, e esboçar as curvas de nível de uma fórmula simples.
- Mostrar que um limite num ponto não existe exibindo dois caminhos com limites diferentes, e explicar por que a concordância ao longo de muitos caminhos ainda não prova que o limite existe.
- Provar que um limite existe com uma majoração (sanduíche) ou com coordenadas polares, dizendo exatamente o que torna o argumento válido.
- Definir continuidade num ponto para uma função de duas variáveis e explicar por que continuidade em cada variável separadamente não basta.

## Contexto e Motivação

Quase nada de interessante depende de um único número. A temperatura de uma sala depende de uma posição no espaço, o custo de um modelo depende de todos os seus parâmetros, e a altura de um morro depende de duas coordenadas. O cálculo de uma variável trata uma entrada por vez. Esta lição abre a metade multivariável da disciplina com o objeto que ela estuda, a função de várias variáveis, e com a primeira ferramenta para enxergá-la: o mapa de contorno. O mapa de contorno é a forma padrão de desenhar uma função de perda de dois parâmetros.

Duas variáveis são o ponto ideal. Tudo o que é novo no cenário multivariável já acontece no plano, e o plano dá para desenhar. A novidade aparece primeiro nos limites. Na reta real, um ponto é abordado por dois lados. No plano, ele é abordado por infinitas direções, ao longo de retas, parábolas e espirais, e o limite precisa concordar com todas ao mesmo tempo. Essa mudança sozinha quebra vários hábitos de `limits-intuition-and-the-formal-definition` e `continuity-and-the-intermediate-value-theorem`, e é por isso que `partial-derivatives-and-the-multivariable-chain-rule` tem cuidado com suas hipóteses.

## Teoria Central

### Funções, domínios e gráficos

Uma função de duas variáveis associa um número real $f(x, y)$ a cada ponto $(x, y)$ de um conjunto $D \subseteq \mathbb{R}^2$, seu **domínio**. Quando só se dá uma fórmula, o domínio é o conjunto de todos os pares em que a fórmula faz sentido. Para $g(x, y) = \ln(x - y^2)$, o logaritmo exige $x - y^2 > 0$, então o domínio é a região aberta $x > y^2$, à direita de uma parábola, e a própria parábola fica de fora. A **imagem** é o conjunto de valores que $f$ assume.

O **gráfico** é o conjunto de pontos $(x, y, f(x, y))$ em $\mathbb{R}^3$, uma superfície sobre o domínio. Ele é fiel, mas difícil de desenhar à mão, e por isso também usamos curvas de nível.

### Curvas de nível e mapas de contorno

A **curva de nível** de $f$ na altura $c$ é o conjunto de pontos do domínio onde $f(x, y) = c$. Geometricamente, é a sombra, projetada no plano $xy$, da fatia em que o gráfico encontra o plano horizontal $z = c$. Desenhar várias curvas de nível em valores de $c$ igualmente espaçados dá um **mapa de contorno**, o mesmo recurso de um mapa topográfico.

Ler um mapa de contorno depende de alguns fatos:

- Curvas de nível de alturas diferentes nunca se tocam, porque um ponto tem um único valor de $f$. (Uma mesma curva de nível pode se cruzar: para $f = x^2 - y^2$, o nível $c = 0$ é o par de retas $y = \pm x$.)
- Onde as curvas se apertam, $f$ muda rápido numa distância curta, então a superfície é íngreme. Onde se afastam, é plana.
- Laços fechados aninhados costumam indicar um pico ou um vale no centro.
- Uma "curva de nível" nem sempre é uma curva. Para $f = x^2 + y^2$, o nível $c = 0$ é um único ponto, e o nível $c < 0$ é vazio.

Para três variáveis, o análogo é a **superfície de nível** $f(x, y, z) = c$.

### Limites quando há muitos caminhos

A definição formal é a da lição de uma variável com o intervalo trocado por um disco: $\lim_{(x,y) \to (a,b)} f(x, y) = L$ significa que, para todo $\varepsilon > 0$, existe $\delta > 0$ tal que $\lvert f(x, y) - L \rvert < \varepsilon$ sempre que $(x, y)$ está no domínio e $0 < \sqrt{(x-a)^2 + (y-b)^2} < \delta$.

Duas consequências importam na prática.

**O teste dos dois caminhos.** Se dois caminhos até $(a, b)$ dão limites diferentes, ou um deles não dá limite, o limite não existe. Esse é um teste de não existência apenas. Concordar nos caminhos que você tentou não prova nada sobre os que você não tentou.

**O sanduíche.** Se $\lvert f(x, y) - L \rvert \le B(x, y)$ perto de $(a, b)$ e $B(x, y) \to 0$, então o limite é $L$. Em coordenadas polares em torno do ponto, $x - a = r\cos\theta$ e $y - b = r\sin\theta$, o limite existe e vale $L$ se $\lvert f - L \rvert \le B(r)$ com uma cota $B$ que depende só de $r$ e tende a $0$. A cota precisa valer para todo $\theta$ ao mesmo tempo. Uma cota que não é uniforme em $\theta$ não prova nada, e uma dependência de $\theta$ que sobrevive quando $r \to 0$ (como no Exemplo 3) mostra que o limite falha.

### Continuidade

$f$ é **contínua** em $(a, b)$ quando $(a, b)$ está no domínio, o limite em $(a, b)$ existe e é igual a $f(a, b)$. Somas, produtos e composições de funções contínuas são contínuas, e quocientes são contínuos onde o denominador é não nulo. Polinômios são, portanto, contínuos em toda parte, e funções racionais são contínuas em seus domínios.

## Exemplos Resolvidos

### Exemplo 1: domínio e curvas de nível de uma semiesfera

Seja $f(x, y) = \sqrt{9 - x^2 - y^2}$. O radicando precisa ser não negativo, então o domínio é o disco fechado $x^2 + y^2 \le 9$, e a imagem é $[0, 3]$. O gráfico é a metade superior de uma esfera de raio $3$.

Fazendo $f = c$ e elevando ao quadrado, obtemos $x^2 + y^2 = 9 - c^2$, válido para $0 \le c \le 3$: um círculo de raio $\sqrt{9 - c^2}$. Em $c = 3$ ele se reduz à origem, e para $c > 3$ ou $c < 0$ é vazio. O ponto $(1, 2)$ dá $f = \sqrt{4} = 2$, então está no círculo de raio $\sqrt{5}$.

```text
c      raio sqrt(9 - c^2)
0      3.000
1      2.828
2      2.236
3      0.000
```

Passos iguais em $c$ dão folgas crescentes entre os círculos: $0{,}17$, $0{,}59$ e depois $2{,}24$. Os contornos se apertam perto da borda do disco, que é onde a semiesfera é mais íngreme.

### Exemplo 2: uma tigela alongada

Seja $L(x, y) = x^2 + 4y^2$, uma perda com sensibilidades diferentes a cada parâmetro. Para $c > 0$, $L = c$ é a elipse $x^2/c + y^2/(c/4) = 1$, com semieixos $\sqrt{c}$ em $x$ e $\sqrt{c}/2$ em $y$. O nível $c = 4$ passa por $(2, 0)$ e $(0, 1)$, e o ponto $(2, 1)$ está no nível $c = 8$. As elipses são esticadas ao longo de $x$ porque $y$ pesa quatro vezes mais que $x$ na fórmula, então a função sobe mais rápido ao longo de $y$. As próximas lições reaproveitam essa função.

### Exemplo 3: um limite que depende do caminho

Seja $f(x, y) = \dfrac{xy}{x^2 + y^2}$, indefinida na origem. Ao longo da reta $y = mx$ com $x \ne 0$,

$$f(x, mx) = \frac{m x^2}{x^2 + m^2 x^2} = \frac{m}{1 + m^2}.$$

Isso vale $0$ para $m = 0$, $1/2$ para $m = 1$, $2/5$ para $m = 2$ e $-1/2$ para $m = -1$. Um valor que não depende de $x$ não pode se aproximar de um único número quando $x \to 0$ para todas as inclinações. Em coordenadas polares o mesmo fato se lê $f = \sin\theta\cos\theta = \tfrac12 \sin 2\theta$: o valor é fixado pela direção e ignora $r$. Numericamente:

```text
ponto            (e, e)    (e, 0)    (e, 2e)
e = 1e-1         0.5       0.0       0.4
e = 1e-3         0.5       0.0       0.4
e = 1e-6         0.5       0.0       0.4
```

O limite em $(0, 0)$ não existe.

### Exemplo 4: um limite que existe

Seja $f(x, y) = \dfrac{x^2 y}{x^2 + y^2}$. Como $x^2 \le x^2 + y^2$, temos $\dfrac{x^2}{x^2 + y^2} \le 1$ e portanto

$$\lvert f(x, y) \rvert \le \lvert y \rvert \to 0.$$

Pelo sanduíche, o limite é $0$. Em coordenadas polares, $f = r\cos^2\theta \sin\theta$, limitada por $r$ para todo $\theta$ ao mesmo tempo, que é a cota uniforme de que o método precisa. Definir $f(0, 0) = 0$ torna $f$ contínua na origem.

### Exemplo 5: todas as retas concordam, e o limite ainda assim falha

Seja $k(x, y) = \dfrac{x y^2}{x^2 + y^4}$. Na reta $y = mx$,

$$k(x, mx) = \frac{m^2 x}{1 + m^4 x^2} \to 0,$$

e no eixo $y$ temos $k = 0$. Toda reta dá $0$. Agora siga a parábola $x = y^2$:

$$k(y^2, y) = \frac{y^4}{y^4 + y^4} = \frac12.$$

Os números confirmam: com $e = 10^{-3}$, o valor em $y = x$ é cerca de $0{,}001$, em $y = 2x$ cerca de $0{,}004$, e em $x = y^2$ exatamente $0{,}5$. O limite não existe. Um teste só com retas teria afirmado que era $0$.

## Equívocos Comuns e Armadilhas

- **"Se o limite é o mesmo ao longo de toda reta, ele existe."** O Exemplo 5 é o contraexemplo. Retas são apenas alguns dos caminhos até um ponto, então a concordância entre elas é indício, nunca prova.
- **"Contínua em $x$ e contínua em $y$ separadamente significa contínua."** Pegue a função do Exemplo 3 e defina $f(0, 0) = 0$. Então $f(x, 0) = 0$ e $f(0, y) = 0$, e as duas fatias pela origem são contínuas, mas $f$ salta para $1/2$ ao longo da diagonal.
- **"Coordenadas polares sempre resolvem um limite."** A cota precisa ser uniforme em $\theta$. Mostrar que $f \to 0$ para cada $\theta$ fixo é o mesmo erro de testar retas: o Exemplo 5 dá $0$ ao longo de todo raio fixo, mas falha ao longo da parábola.
- **"Curvas de nível são sempre curvas, e um mapa de contorno tem uma para cada altura."** Os níveis podem ser um ponto, vazios, ou uma região inteira (numa função constante), e um mapa mostra só as alturas que você escolheu desenhar.
- **"O domínio é um intervalo."** É uma região do plano, e a fronteira pode ou não pertencer a ele. Num ponto de fronteira que não está no domínio, um limite pode existir enquanto a função continua indefinida.

## Resumo

Uma função de duas variáveis leva cada ponto de uma região do plano a um número. Seu gráfico é uma superfície, e suas curvas de nível são as sombras de fatias horizontais, desenhadas juntas num mapa de contorno cujo aperto indica inclinação. Os limites mudam de natureza em várias variáveis: um ponto é abordado por infinitos caminhos, então um limite diferente em dois caminhos, ou nenhum limite em um deles, derruba o limite, enquanto a existência exige uma cota que valha uniformemente, como um sanduíche ou uma cota polar independente do ângulo. Verificar só retas não basta, como mostra $xy^2/(x^2 + y^4)$. Continuidade num ponto significa que o limite existe e é igual ao valor, e continuidade em cada variável separadamente não a garante. Em seguida, `partial-derivatives-and-the-multivariable-chain-rule` deriva ao longo das direções coordenadas e pergunta o que isso garante e o que não garante.

## Documentation Links

- [OpenStax Calculus Volume 3, 4.1 Functions of Several Variables](https://openstax.org/books/calculus-volume-3/pages/4-1-functions-of-several-variables): domínios, imagens, gráficos, curvas de nível e superfícies de nível.
- [OpenStax Calculus Volume 3, 4.2 Limits and Continuity](https://openstax.org/books/calculus-volume-3/pages/4-2-limits-and-continuity): a definição de limite no plano, dependência do caminho, leis dos limites e continuidade.
- [Active Calculus Multivariable, Functions of Several Variables](https://activecalculus.org/multi/S-MV-Functions.html): gráficos e mapas de contorno construídos por atividades guiadas.
- [Active Calculus Multivariable, Limits](https://activecalculus.org/multi/S-mv_deriv-Limits.html): limites ao longo de caminhos e continuidade, com atividades.
- [MIT OCW 18.02SC, Unit 2 Part A: Functions of Two Variables](https://ocw.mit.edu/courses/18-02sc-multivariable-calculus-fall-2010/pages/2.-partial-derivatives/part-a-functions-of-two-variables-tangent-approximation-and-optimization/): sessões de aula sobre gráficos e sobre curvas de nível e mapas de contorno.
