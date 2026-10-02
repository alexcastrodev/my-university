---
version: 1.0
updatedAt: 2026-09-07
title: "Otimizadores Além do Gradiente Descendente: Momentum e Adam"
summary: O gradiente descendente simples, já visto por completo em `machine-learning`, não é derivado de novo aqui, mas estendido. O momentum acumula uma velocidade ao longo dos passos para suavizar gradientes ruidosos e atravessar mais rápido regiões rasas, e o Adam combina esse momentum com uma taxa de aprendizado adaptativa por parâmetro, o otimizador padrão para quase todas as arquiteturas que o resto desta disciplina cobre.
---
## Objetivos de Aprendizagem

- Explicar por que o gradiente descendente simples (em mini-batch), já visto por completo em `ai-theory/machine-learning`, converge devagar ou oscila no tipo de superfície de loss que redes profundas de fato têm.
- Enunciar a regra de atualização do momentum e explicar, geometricamente, como ela suaviza direções de gradiente ruidosas ou oscilantes.
- Enunciar a regra de atualização do Adam e explicar como ela combina momentum com uma taxa de aprendizado adaptativa por parâmetro.
- Rastrear uma comparação concreta entre o gradiente descendente simples e o momentum em uma superfície de loss em que um converge bem mais rápido que o outro.

## Contexto e Motivação

O conceito `gradient-descent-as-a-general-optimizer` de `ai-theory/machine-learning` derivou a regra de atualização `θ := θ − α·∇J(θ)` e cobriu por completo as variantes em lote, estocástica e em mini-batch; nada disso é derivado de novo aqui. O que aquele conceito não precisou enfrentar foi o formato específico das superfícies de loss que redes profundas com milhões de parâmetros de fato produzem: ravinas longas e estreitas, em que a superfície é íngreme em algumas direções e quase plana em outras, e estimativas de gradiente por batch altamente estocásticas, vindas dos mini-batches típicos do treino em larga escala. O gradiente descendente simples lida mal com as duas coisas: ele oscila entre as paredes íngremes de uma ravina estreita enquanto avança de forma dolorosamente lenta pelo fundo plano. O momentum e o Adam são os dois otimizadores construídos especificamente para tratar disso, e um ou outro é a escolha padrão para treinar praticamente toda rede vista mais adiante nesta disciplina.

## Teoria Central

### Momentum: suavizando a direção da atualização

O momentum mantém uma média móvel, com decaimento exponencial, dos gradientes passados (um vetor de **velocidade** `v`) e atualiza os parâmetros usando essa velocidade em vez do gradiente bruto diretamente:

```text
v := β·v − α·∇J(θ)
θ := θ + v
```

`β` (normalmente em torno de 0.9) controla quanto da velocidade anterior é mantido. Intuitivamente, é a mesma ideia de uma bola rolando morro abaixo: ela acelera nas direções em que o gradiente aponta consistentemente para o mesmo lado ao longo de vários passos (ganhando velocidade pelo fundo da ravina), enquanto gradientes oscilantes nas direções perpendiculares se cancelam parcialmente na média móvel (amortecendo o zigue-zague entre as paredes da ravina). O momentum não muda a direção para a qual cada cálculo individual de gradiente aponta; ele muda como essa informação é acumulada e usada ao longo dos passos.

### Adam: momentum mais uma taxa de aprendizado adaptativa por parâmetro

O Adam (Adaptive Moment Estimation) acompanha duas médias móveis por parâmetro: um primeiro momento `m` (essencialmente o mesmo termo de momentum acima) e um segundo momento `s` (uma média móvel do gradiente *ao quadrado*, que acompanha quão grande o gradiente daquele parâmetro costuma ser em magnitude, independentemente do sinal):

```text
m := β₁·m + (1 − β₁)·∇J(θ)
s := β₂·s + (1 − β₂)·(∇J(θ))²
θ := θ − α · m / (√s + ε)
```

(com `β₁ ≈ 0.9`, `β₂ ≈ 0.999` e um `ε` pequeno para evitar divisão por zero; `m` e `s` também passam por correção de viés nos primeiros passos, já que começam em zero.) O termo `m/√s` é a ideia central: parâmetros cujos gradientes historicamente foram grandes recebem uma taxa de aprendizado *efetivamente menor* (dividindo por um `√s` grande), enquanto parâmetros cujos gradientes historicamente foram pequenos e consistentes recebem uma *efetivamente maior*. Isso torna o Adam muito menos sensível ao ajuste manual de uma única taxa de aprendizado global do que o gradiente descendente simples, e é exatamente por isso que ele virou o otimizador padrão da maioria das arquiteturas vistas mais adiante nesta disciplina.

## Exemplos Resolvidos

### Exemplo 1: gradiente descendente simples oscilando em uma tigela alongada

Minimize `J(θ₁, θ₂) = θ₁² + 25θ₂²`, uma superfície de loss muito mais íngreme na direção de `θ₂` que na de `θ₁`, uma versão simplificada do formato de "ravina estreita" comum em redes reais. Partindo de `(θ₁, θ₂) = (5, 1)` com `α = 0.03`:

```text
∇J = (2θ₁, 50θ₂)
Iteração 0: θ = (5.000, 1.000),  ∇J = (10.00, 50.00), θ ← (5.000 − 0.30, 1.000 − 1.50) = (4.700, −0.500)
Iteração 1: θ = (4.700, −0.500), ∇J = (9.40, −25.00), θ ← (4.700 − 0.282, −0.500 + 0.750) = (4.418, 0.250)
Iteração 2: θ = (4.418, 0.250),  ∇J = (8.836, 12.500), θ ← (4.418 − 0.265, 0.250 − 0.375) = (4.153, −0.125)
```

`θ₂` troca de sinal a cada passo (`1.000 → −0.500 → 0.250 → −0.125`) enquanto mal diminui em magnitude, e `θ₁` só cai muito devagar; o gradiente descendente simples está gastando a maior parte do seu progresso quicando na direção íngreme em vez de avançar pela direção rasa.

### Exemplo 2: a mesma superfície, com o momentum amortecendo a oscilação

Repetindo com momentum (`β = 0.8`, o mesmo `α = 0.03`), acompanhando só `θ₂` e sua velocidade `v₂` (começando em `v₂ = 0`):

```text
Iteração 0: v₂ ← 0.8(0) − 0.03(50.00) = −1.500,  θ₂ ← 1.000 + (−1.500) = −0.500
Iteração 1: ∇θ₂ = 50(−0.500) = −25.00
             v₂ ← 0.8(−1.500) − 0.03(−25.00) = −1.200 + 0.750 = −0.450
             θ₂ ← −0.500 + (−0.450) = −0.950
Iteração 2: ∇θ₂ = 50(−0.950) = −47.50
             v₂ ← 0.8(−0.450) − 0.03(−47.50) = −0.360 + 1.425 = 1.065
             θ₂ ← −0.950 + 1.065 = 0.115
```

`θ₂` ainda troca de sinal, mas sua magnitude está encolhendo de forma visivelmente mais rápida que no Exemplo 1 (`1.000 → −0.500 → −0.950 → 0.115` contra o mais lento `1.000 → −0.500 → 0.250 → −0.125` do gradiente descendente simples); é o efeito de amortecimento do momentum começando a agir, convergindo para o mínimo em menos iterações efetivas exatamente na superfície em formato de ravina em que o gradiente descendente simples tinha dificuldade.

## Equívocos Comuns e Armadilhas

- **"Momentum e Adam calculam um gradiente diferente do gradiente descendente simples."** Os dois usam exatamente o mesmo `∇J(θ)` vindo do backpropagation; nada no modo de calcular o próprio gradiente muda. O que muda é como gradientes sucessivos são acumulados e transformados em uma atualização de parâmetros.
- **"O Adam é estritamente melhor que o gradiente descendente simples ou o momentum, então deve ser sempre usado."** A escala adaptativa por parâmetro do Adam é uma vantagem real nas superfícies de loss ruidosas e mal condicionadas típicas de redes profundas, mas não é universalmente superior: SGD simples com momentum, bem ajustado, ainda é preferido em alguns cenários de treino em larga escala por uma generalização final um pouco melhor na prática. A escolha é uma decisão de engenharia real e debatida, e não um padrão resolvido.
- **"Um coeficiente de momentum `β` maior sempre converge mais rápido."** Um `β` alto demais (perto de 1) faz a velocidade reter histórico demais, levando os parâmetros a passar do mínimo e oscilar em uma escala de tempo mais longa do que o gradiente descendente simples oscilaria; o momentum troca progresso mais rápido em direções consistentes pelo risco de passar do ponto se for ajustado de forma agressiva demais.

## Resumo

O momentum acumula uma média móvel e decrescente dos gradientes passados em um termo de velocidade, amortecendo a oscilação nas direções íngremes e acelerando o progresso nas direções de inclinação consistente; isso trata diretamente das superfícies de loss alongadas, em formato de ravina, com as quais o gradiente descendente simples (`ai-theory/machine-learning`) tem dificuldade. O Adam estende isso com uma segunda média móvel dos gradientes ao quadrado, dando a cada parâmetro sua própria taxa de aprendizado efetivamente escalada. Nenhum dos dois otimizadores muda como o próprio gradiente é calculado (isso continua sendo o backpropagation, sem mudança); os dois mudam só como gradientes sucessivos são transformados em atualizações de parâmetros, e um dos dois é o padrão prático para treinar praticamente toda arquitetura que o resto desta disciplina cobre.

## Documentation Links

- [CS231n: Neural Networks Part 3: Parameter Updates](https://cs231n.github.io/neural-networks-3/): momentum, momentum de Nesterov e os métodos adaptativos (Adagrad, RMSprop, Adam) que este conceito cobre.
- [Dive into Deep Learning: Adam](https://d2l.ai/chapter_optimization/adam.html): as estimativas de primeiro e segundo momento e o detalhe da correção de viés por trás da regra de atualização do Adam.
