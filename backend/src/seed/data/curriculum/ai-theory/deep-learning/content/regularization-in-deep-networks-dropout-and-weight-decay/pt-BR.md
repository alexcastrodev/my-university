---
version: 1.0
updatedAt: 2026-09-07
title: "Regularização em Redes Profundas: Dropout e Weight Decay"
summary: O mesmo trade-off viés-variância e o mesmo overfitting já vistos para modelos lineares se aplicam a redes profundas com milhões de parâmetros, só que com mais urgência. O weight decay é exatamente a penalidade ridge já vista, aplicada aos pesos de uma rede, enquanto o dropout é uma técnica sem nenhum análogo em modelos rasos: apagar unidades aleatoriamente durante o treino para impedir que qualquer uma delas se coadapte em um detector de features específico demais e frágil.
---
## Objetivos de Aprendizagem

- Explicar por que redes profundas, com milhões de parâmetros, são especialmente propensas a overfitting no sentido já formalizado pelo trade-off viés-variância e pela dimensão VC.
- Mostrar que o weight decay é exatamente a penalidade ridge (L2) já vista, aplicada aos pesos de uma rede durante o treino baseado em gradiente.
- Explicar com precisão o mecanismo do dropout: o que acontece no treino versus no teste, e por que a diferença importa.
- Explicar, conceitualmente, por que o dropout não tem análogo direto entre os modelos clássicos que `ai-theory/machine-learning` cobriu.

## Contexto e Motivação

`the-bias-variance-tradeoff`, `overfitting-and-the-vc-dimension` e `regularization-ridge-and-lasso` (`ai-theory/machine-learning`) estabeleceram o framework geral que este conceito herda sem derivar de novo: um modelo flexível o bastante para se ajustar arbitrariamente bem aos dados de treino também é flexível o bastante para se ajustar ao ruído, e é preciso alguma forma de penalidade ou restrição sobre essa flexibilidade para generalizar. Uma rede profunda com milhões de pesos é, pelo argumento da dimensão VC já visto, uma classe de modelos de capacidade enorme, rotineiramente capaz de levar o loss de treino para perto de zero e ainda assim generalizar bem, mas só quando treinada com regularização de verdade. Este conceito cobre duas técnicas: o weight decay, que é literalmente a penalidade da regressão ridge trazida sem mudança, e o dropout, uma técnica sem precedente em modelos rasos que explora algo que só uma rede com muitas unidades ocultas redundantes consegue fazer.

## Teoria Central

### O weight decay é a penalidade da regressão ridge, sem mudança

`regularization-ridge-and-lasso` acrescentou ao loss um termo de penalidade `λ‖θ‖²`, encolhendo cada peso em direção a zero e trocando um pequeno aumento no viés por uma redução na variância. O weight decay aplica exatamente a mesma penalidade aos pesos de uma rede profunda:

```text
J(θ) = Loss(θ) + λ‖θ‖²
```

Derivar esse termo de penalidade e incorporá-lo à atualização do gradiente descendente (com qualquer um dos otimizadores do conceito anterior) produz, a cada passo, uma atualização que primeiro encolhe cada peso por um pequeno fator multiplicativo antes de aplicar o passo de gradiente de sempre; daí o nome "weight decay" (decaimento dos pesos). Nada disso é mecanismo novo: é a mesma penalidade L2, sobre o mesmo objetivo de loss mais penalidade, que a regressão ridge já usava, agora aplicada a uma rede cujas "features" são as muitas representações ocultas aprendidas, em vez de um conjunto fixo escolhido à mão.

### Dropout: um regularizador sem análogo em modelos rasos

O dropout funciona de outro jeito. A cada passo de treino, cada unidade oculta é "desligada" (dropped, com sua saída forçada a zero) de forma independente com alguma probabilidade `p` (normalmente entre 0,3 e 0,5), e as saídas das unidades que sobreviveram são reescaladas por `1/(1−p)` para que o sinal total esperado que chega à camada seguinte continue o mesmo. No teste, o dropout é desligado por completo: todas as unidades são usadas, sem desligar nada e sem precisar reescalar (isso já foi levado em conta durante o treino, na implementação comum de "inverted dropout").

O efeito durante o treino é que nenhuma unidade oculta pode contar com um conjunto específico de outras unidades estar presente em um dado passo; ela precisa aprender uma contribuição útil, ao menos parcialmente redundante, por conta própria, já que qualquer um dos seus colaboradores habituais pode ser zerado a qualquer momento. Isso desestimula diretamente a **coadaptação**: unidades ficando tão especializadas em funcionar só em combinação com algumas outras unidades específicas que a rede como um todo fica frágil e com overfitting em padrões precisos dos dados de treino. O dropout não tem análogo entre os modelos clássicos que `ai-theory/machine-learning` cobriu justamente porque esses modelos (regressão linear/logística, SVMs, árvores) não têm grandes quantidades de unidades internas redundantes que se coadaptam; é uma técnica de regularização que só faz sentido para arquiteturas que, de saída, têm muitas unidades ocultas.

### Por que os dois, e por que juntos

O weight decay e o dropout atacam o overfitting por mecanismos genuinamente diferentes (o weight decay restringe a *magnitude* de cada peso de forma uniforme, enquanto o dropout impede a *dependência de combinações específicas* de unidades ocultas), e na prática os dois são usados juntos com frequência na mesma rede, já que nenhum deles engloba o outro.

## Exemplos Resolvidos

### Exemplo 1: o efeito do weight decay em um único passo de gradiente

Considere um peso `w = 2.0`, um gradiente do loss calculado `∂Loss/∂w = 0.5`, taxa de aprendizado `α = 0.1` e coeficiente de weight decay `λ = 0.01`. O gradiente completo, incluindo o termo de penalidade (`∂(λw²)/∂w = 2λw`), é:

```text
∂J/∂w = ∂Loss/∂w + 2λw = 0.5 + 2(0.01)(2.0) = 0.5 + 0.04 = 0.54
w ← w − α(0.54) = 2.0 − 0.054 = 1.946
```

Compare com a atualização sem weight decay: `w ← 2.0 − 0.1(0.5) = 1.95`. O termo de weight decay puxou a atualização um pouco mais para perto de zero (`1.946` contra `1.95`); um encolhimento extra pequeno, mas consistente, aplicado a cada peso a cada passo, exatamente o mecanismo que impede os pesos de crescer além do necessário ao longo do treino.

### Exemplo 2: a contabilidade do valor esperado no dropout

Considere uma camada oculta com 4 unidades produzindo as saídas `(2, 4, 1, 3)` antes do dropout, com probabilidade de dropout `p = 0.5`. Suponha que as unidades 2 e 4 (valores 4 e 3) calhem de ser desligadas neste passo de treino. As unidades sobreviventes são reescaladas por `1/(1−p) = 1/0.5 = 2`:

```text
Sobreviventes brutas:              (2, 0, 1, 0)
Reescaladas por 1/(1-p) = 2:       (4, 0, 2, 0)
```

O valor esperado da contribuição de cada unidade, tirando a média sobre a escolha aleatória de quais unidades sobrevivem, não muda: `E[saída reescalada] = p·0 + (1−p)·(original/( 1−p)) = original`. É exatamente por isso que o fator de reescala é `1/(1−p)`: ele mantém a saída total esperada da camada durante o treino (com dropout) igual à que ela terá no teste (sem dropout), então nenhuma correção separada é necessária no teste.

## Equívocos Comuns e Armadilhas

- **"Dropout e weight decay fazem a mesma coisa, só que implementados de jeitos diferentes."** O weight decay encolhe a magnitude de cada peso de forma uniforme; o dropout remove unidades inteiras aleatoriamente, impedindo a dependência excessiva de combinações específicas de unidades. Uma rede pode ter overfitting de um jeito que o weight decay não trata (coadaptação frágil entre unidades específicas) mesmo com todos os seus pesos individuais pequenos.
- **"O dropout também deve ser aplicado no teste, por consistência com o treino."** O dropout é desligado de propósito no teste; o objetivo inteiro da reescala por `1/(1−p)` durante o treino é fazer o comportamento esperado da rede treinada coincidir com seu comportamento completo, sem dropout, no teste, então a melhor previsão usa todas as unidades, e não um subconjunto aleatório.
- **"Uma probabilidade de dropout `p` maior é sempre mais eficaz contra o overfitting."** Um `p` alto demais remove tanta capacidade da rede a cada passo que ela também pode entrar em *underfitting*; o dropout troca por uma rede efetiva estritamente menor a cada passo, e escolher `p` é um trade-off viés-variância real (`the-bias-variance-tradeoff`), e não um botão que só ajuda quanto mais alto for.

## Resumo

O weight decay é a penalidade L2 da regressão ridge, trazida sem mudança para redes profundas: ele encolhe um pouco a magnitude de cada peso a cada passo de gradiente. O dropout é uma técnica sem análogo entre os modelos clássicos: durante o treino, ele zera aleatoriamente unidades ocultas (reescalando as sobreviventes para preservar o sinal esperado), para que nenhuma unidade possa depender de uma combinação específica de colaboradores, desestimulando diretamente a coadaptação frágil; no teste, o dropout é desligado e a rede completa é usada. Os dois tratam o mesmo risco de overfitting que `the-bias-variance-tradeoff` e `overfitting-and-the-vc-dimension` já formalizaram, por mecanismos genuinamente diferentes, e é por isso que costumam ser combinados em vez de tratados como intercambiáveis.

## Documentation Links

- [CS231n: Neural Networks Part 2: Regularization](https://cs231n.github.io/neural-networks-2/): regularização L2/L1/max-norm e o mecanismo de dropout (incluindo a convenção de "inverted dropout") que este conceito segue.
- [Dive into Deep Learning: Dropout](https://d2l.ai/chapter_multilayer-perceptrons/dropout.html): a formulação `h' = 0` com probabilidade `p`, `h/(1−p)` caso contrário, e a motivação de coadaptação para o dropout.
