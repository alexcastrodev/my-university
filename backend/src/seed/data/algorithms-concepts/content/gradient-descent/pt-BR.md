---
version: 1.0
updatedAt: 2026-08-14
title: "Gradient Descent"
description: "Um método iterativo geral para encontrar um mínimo local de uma função contínua repetidamente dando passos na direção oposta ao gradiente, com um limite de convergência provado em funções convexas que troca respostas exatas (como o Θ(n^3) da eliminação gaussiana) por uma resposta aproximada mais rápida."
---
## Objetivo

Gradient descent é um método geral para encontrar um mínimo local de uma função contínua f : R^n -> R. Em vez de resolver analiticamente para um mínimo, você começa em algum ponto e repetidamente dá passos pequenos na direção que diminui f mais rápido, com base no gradiente da função, até se estabelecer perto de um ponto baixo.

Esse conceito vem do Capítulo 33, "Machine-Learning Algorithms," um capítulo genuinamente novo adicionado na 4ª edição de *Introduction to Algorithms* de Cormen, Leiserson, Rivest e Stein. Vale deixar claro que este é terreno novo para o livro-texto, e não um clássico consagrado há décadas como ordenação ou busca em grafo. Dito isso, o material em si é estritamente algorítmico: uma regra de atualização iterativa, um parâmetro de tamanho de passo, uma análise de convergência com um limite de erro provado, e uma discussão honesta sobre quando o método encontra a melhor resposta possível e quando não encontra. Esta entrada se limita a esse núcleo algorítmico — a regra de atualização, o tamanho de passo, o comportamento de convergência e a distinção entre mínimo local e global — em vez de virar um primer geral de machine learning.

O exemplo motivador que a fonte usa ao longo do texto é o ajuste de reta: dado um conjunto de pontos, encontre a reta que melhor se ajusta a eles minimizando alguma função das distâncias entre os pontos e a reta (por exemplo, a soma das distâncias ao quadrado). Quando esse objetivo e suas restrições são lineares, é um problema de programação linear (Capítulo 29); gradient descent é para o caso mais geral em que o objetivo é uma função contínua mas não necessariamente linear.

## Casos de Uso

- Ajustar uma reta (ou, mais geralmente, uma função linear) a um conjunto de pontos de dados minimizando uma medida de erro como a soma das distâncias ao quadrado — um ajuste por mínimos quadrados.
- Resolver aproximadamente um sistema de equações lineares Ax = b quando A é grande, como uma alternativa mais rápida ao tempo de execução Θ(n^3) da eliminação gaussiana.
- Regressão linear: calcular um conjunto de pesos que melhor prevê um rótulo numérico a partir de um conjunto de atributos de entrada, minimizando uma função de perda de mínimos quadrados.
- Qualquer problema de otimização em que o objetivo seja uma função contínua e diferenciável que não seja linear (então programação linear não se aplica) mas seja convexa, e onde você esteja disposto a aceitar um minimizador aproximado em troca de velocidade.

## Aprofundamento

### A regra de atualização iterativa

Imagine estar de pé numa paisagem de morros e vales e querer chegar a um ponto baixo o mais rápido possível: você examina o terreno, se move uma distância curta na direção mais íngreme para baixo, depois para e reavalia, porque o terreno — e portanto a melhor direção — mudou. Repetir isso até que toda direção leve para cima faz você chegar a um mínimo local.

Formalizar "direção mais íngreme para baixo" exige o gradiente. Para f : R^n -> R, o gradiente (∇f)(x) é o vetor n-dimensional de derivadas parciais (∂f/∂x1, ∂f/∂x2, ..., ∂f/∂xn). Informalmente, o gradiente aponta na direção em que a função cresce mais rápido, e sua magnitude reflete o quão rápido. O passo-chave do gradient descent é se mover na direção *oposta* ao gradiente, por uma distância influenciada pela magnitude do gradiente.

```
GRADIENT-DESCENT(f, x(0), α, T)
1  sum = 0                          // vetor n-dimensional, inicialmente todo 0
2  para t = 0 até T - 1
3      sum = sum + x(t)             // soma cada uma das n dimensões em sum
4      x(t+1) = x(t) - α · (∇f)(x(t))
5  x-avg = sum / T                  // divide cada uma das n dimensões por T
6  retorne x-avg
```

As entradas são a função f, um ponto inicial x(0) em R^n, um multiplicador de tamanho de passo fixo α > 0, e um número de passos T. Cada iteração calcula o gradiente no ponto atual e se move a distância α na direção oposta, então f(x(t+1)) <= f(x(t)) — cada passo é monotonicamente não crescente no valor da função. O custo dominante por iteração é calcular o gradiente, cuja complexidade depende inteiramente de f e às vezes pode ser cara.

Em vez de retornar o ponto final x(T), o algoritmo retorna x-avg, a média de todos os pontos visitados exceto o último. Pode parecer mais natural retornar x(T) diretamente — e na prática às vezes você preferiria isso — mas a versão analisada na fonte usa x-avg porque sua prova de convergência raciocina sobre a média.

### Tamanho de passo, mínimos locais e convergência

Considere o caso unidimensional, f : R -> R, onde o gradiente é apenas a derivada ordinária f'(x). Começando em x(0), a derivada f'(x(0)) tem inclinação negativa, então um passo *pequeno* a partir de x(0) na direção de x crescente produz um ponto x' com f(x') < f(x(0)) — progresso. Mas um passo grande demais ultrapassa para um ponto x'' onde f(x'') > f(x(0)) — pior que onde você começou. Restringir-se a passos pequenos para baixo eventualmente o leva perto de um ponto que dá um mínimo local, mas começar em x(0) e sempre dar apenas passos pequenos para baixo não dá ao gradient descent nenhuma chance de alcançar o verdadeiro minimizador global se ele estiver do outro lado de um morro.

Duas observações decorrem disso: gradient descent converge para um mínimo local, não necessariamente global; e quão rápido ele converge depende de propriedades da função, do ponto inicial e do tamanho de passo.

Para funções convexas, porém, todo mínimo local também é um mínimo global, o que é o que torna gradient descent útil como uma ferramenta de otimização *geral* em vez de apenas uma busca local. (f é convexa se para todo x, y e todo 0 <= λ <= 1, f(λx + (1-λ)y) <= λf(x) + (1-λ)f(y).) Numa função convexa, cada iteração se move na direção oposta ao gradiente por uma distância proporcional à magnitude do gradiente; conforme as iterações avançam, o gradiente encolhe, então o tamanho de passo também encolhe, e a distância até o ponto ótimo x* diminui a cada passo.

O resultado formal de convergência (Teorema 33.8) limita o quão perto x-avg chega do mínimo verdadeiro após T iterações. Defina:

- R = a distância euclidiana ||x(0) - x*|| entre o ponto inicial e o minimizador,
- L = um limite superior para a magnitude do gradiente ||(∇f)(x)|| sobre todos os pontos que o algoritmo visita.

Com tamanho de passo α = R / (L·sqrt(T)), o teorema garante f(x-avg) - f(x*) <= ε, onde ε = RL / sqrt(T). Resolvendo essa relação para T em vez disso dá T = R^2·L^2 / ε^2 — o número de iterações necessárias depende do quadrado de R e L e, o mais importante, de 1/ε^2. Concretamente: para reduzir pela metade o limite de erro, você precisa de quatro vezes mais iterações.

Na prática você muitas vezes não conhece R e L exatamente, já que R depende de conhecer x* de antemão. Quando limites fixos não estão disponíveis, uma alternativa é a *busca de linha* (line search): em vez de se comprometer com um tamanho de passo fixo, busque um tamanho de passo que consiga uma grande redução em f, por exemplo dobrando um pequeno tamanho de passo de teste s até parar de ajudar, depois fazendo busca binária no intervalo resultante [s, 2s].

### Gradient descent restrito

Às vezes a minimização está sujeita a um requisito adicional de que x esteja dentro de um corpo convexo fechado K (um conjunto onde o segmento de reta entre quaisquer dois pontos em K permanece em K, e que contém seus pontos limite). Restringir-se a essa versão restrita não acaba aumentando significativamente o número de iterações necessárias.

```
GRADIENT-DESCENT-CONSTRAINED(f, x(0), α, T, K)
1  sum = 0
2  para t = 0 até T - 1
3      sum = sum + x(t)
4      x'(t+1) = x(t) - α · (∇f)(x(t))
5      x(t+1) = Π_K(x'(t+1))         // projeta de volta em K
6  x-avg = sum / T
7  retorne x-avg
```

A única mudança em relação à versão irrestrita é a linha 5: depois do passo de gradiente comum (agora chegando num ponto intermediário x'), projete-o de volta em K se ele caiu fora. A projeção Π_K(x) de um ponto x em K é o ponto y mais próximo em K de x. Um lema-chave mostra que projetar em K nunca pode afastá-lo *mais* do minimizador verdadeiro x* do que o ponto não projetado estava — então o mesmo limite de convergência se transfere essencialmente inalterado (Teorema 33.11): com a mesma escolha de α = R / (L·sqrt(T)), f(x-avg) - f(x*) <= ε = RL / sqrt(T).

### Aplicações: sistemas lineares e regressão linear

**Resolvendo Ax = b.** A eliminação gaussiana resolve um sistema de n equações lineares em tempo Θ(n^3), o que pode ser proibitivo para matrizes grandes. Como alternativa, observe que minimizar f(x) = (1/2)x^T·A·x - b^T·x tem gradiente Ax - b; igualando o gradiente a zero e resolvendo dá exatamente x = A^-1·b. Então, quando A é semidefinida positiva (tornando f convexa), gradient descent pode resolver Ax = b aproximadamente ao minimizar f — geralmente mais rápido que a eliminação gaussiana exata quando R e L não são grandes demais.

**Regressão linear (ajuste por mínimos quadrados).** Dados m pontos de dados, cada um um vetor de atributos n-dimensional x^(i) com um rótulo numérico y^(i), o objetivo é encontrar uma função linear f(x) = w0 + soma_j(wj·xj) — definida por um vetor de pesos w — que preveja cada rótulo o mais precisamente possível. O erro para o ponto i é e^(i) = f(x^(i)) - y^(i), e a função de perda a minimizar é a soma dos erros ao quadrado, soma_i((f(x^(i)) - y^(i))^2). Como essa perda é uma soma de quadrados de funções lineares, ela é convexa, então gradient descent se aplica diretamente. O gradiente dessa perda pode ser calculado em tempo O(nm) — linear no tamanho da entrada — comparado à abordagem de inversão de matriz do Capítulo 28, tornando gradient descent tipicamente muito mais rápido na prática.

Regularização — penalizar hipóteses excessivamente complexas para evitar overfitting — pode ser adicionada como uma restrição, por exemplo exigindo ||w|| <= B para algum limite B, o que é exatamente um problema de gradient descent restrito. O passo de projeção se torna um simples escalonamento: se a atualização irrestrita produz w', e ||w'|| > B, escale-o para w'·(B / ||w'||), o ponto mais próximo na fronteira da região de restrição.

## Trade-offs

- **Mínimo local, não garantidamente global** — gradient descent só se move para baixo a partir de onde quer que esteja atualmente, então numa função não convexa ele pode convergir para um mínimo local enquanto um mínimo melhor, global, está em outro lugar totalmente fora de alcance. Em funções convexas isso não é um problema, já que todo mínimo local também é global.
- **O tamanho de passo é um ato de equilíbrio** — um passo pequeno demais desperdiça iterações fazendo progresso minúsculo; um passo grande demais pode ultrapassar o mínimo e cair em algum lugar pior que o ponto inicial. O tamanho de passo fixo teoricamente ótimo α = R/(L·sqrt(T)) exige conhecer R e L de antemão, o que geralmente significa conhecer a resposta (ou um limite dela) antes de começar — na prática, busca de linha (dobrar um passo de teste e depois fazer busca binária) é frequentemente usada em vez disso.
- **A contagem de iterações escala com 1/ε^2** — o número de iterações necessário para garantir erro no máximo ε é T = R^2·L^2/ε^2. Por causa do quadrado, reduzir pela metade o erro desejado exige aproximadamente quatro vezes mais iterações, não duas.
- **Aproximado, mas frequentemente muito mais rápido que métodos exatos** — para resolver Ax = b, gradient descent troca a resposta exata garantida da eliminação gaussiana Θ(n^3) por uma resposta aproximada que pode ser alcançada mais rápido quando R e L são moderados. Da mesma forma, calcular o gradiente da regressão por mínimos quadrados custa O(nm) por iteração versus a abordagem de inversão de matriz dos mínimos quadrados exatos.
- **Restrições são quase de graça** — adicionar um conjunto de restrição convexo K e projetar de volta nele após cada passo (gradient descent restrito) não piora assintoticamente o limite de convergência comparado à versão irrestrita, contanto que a própria projeção seja barata de calcular (como é para um limite simples de norma como ||w|| <= B, que é só um reescalonamento).

## Documentation Links

- [Cormen, Leiserson, Rivest, Stein — Introduction to Algorithms, 4th Edition, Section 33.3 "Gradient descent", pp. 1023-1037](https://mitpress.mit.edu/9780262046305/introduction-to-algorithms/) — doc
