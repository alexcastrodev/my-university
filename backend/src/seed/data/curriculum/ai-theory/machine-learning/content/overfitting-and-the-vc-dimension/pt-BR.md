---
version: 1.0
updatedAt: 2026-09-06
title: Overfitting e a Dimensão VC
summary: Uma medida precisa de quanto uma classe de modelos pode sofrer overfitting antes mesmo de ver qualquer dado. A dimensão VC conta o maior conjunto de pontos que um modelo consegue fragmentar (shatter) e prevê diretamente quantos dados são necessários para aprender de forma confiável.
---
## Objetivos de Aprendizagem

- Definir overfitting com precisão: o erro de treino continua diminuindo enquanto o erro verdadeiro (fora da amostra) começa a aumentar.
- Definir o que é "fragmentar" (shatter) um conjunto de pontos e enunciar a dimensão VC de uma classe de modelos como o maior número de pontos que ela consegue fragmentar em todas as rotulações possíveis.
- Calcular à mão a dimensão VC de uma classe de modelos simples (um classificador linear em 2D).
- Explicar como a dimensão VC estende o limite de Hoeffding de hipótese única, visto antes nesta disciplina, ao caso realista de um algoritmo de aprendizado que busca entre muitas hipóteses.

## Contexto e Motivação

O primeiro conceito do bloco de fundamentos desta disciplina levantou a pergunta da viabilidade do aprendizado, e o limite de Hoeffding deu uma garantia real, mas só para uma única hipótese fixada de antemão, sinalizando explicitamente que um algoritmo de aprendizado que *busca* entre muitas hipóteses e escolhe a que melhor se ajusta precisa de um argumento mais forte. A dimensão VC (Vapnik-Chervonenkis) é esse argumento mais forte: um número preciso e calculável que mede quanto uma classe de modelos consegue "trapacear" ajustando essencialmente qualquer rotulação de um conjunto finito de pontos, e que estende a garantia de generalização para cobrir algoritmos de aprendizado realistas.

## Teoria Central

### Overfitting, definido com precisão

O **overfitting** ocorre quando, conforme a complexidade do modelo aumenta, o erro de treino continua diminuindo enquanto o erro fora da amostra (de teste) diminui por um tempo e depois volta a aumentar. O ponto em que o erro fora da amostra é mínimo (antes que a queda contínua do erro de treino comece a prejudicar ativamente a generalização) é o nível de complexidade que a troca viés-variância (conceito anterior) diz ser ótimo. Overfitting não é simplesmente "ajustar bem os dados"; é especificamente ajustar o ruído dos dados de treino à custa do sinal subjacente verdadeiro.

### Fragmentação e a dimensão VC

Uma classe de modelos **fragmenta** (shatters) um conjunto de `N` pontos se, para cada uma das `2^N` formas possíveis de rotular esses pontos (atribuir cada um à classe +1 ou −1), existe alguma hipótese na classe de modelos que acerta exatamente toda essa rotulação. A **dimensão VC** de uma classe de modelos é o maior `N` para o qual algum conjunto de `N` pontos pode ser fragmentado por essa classe. É uma propriedade só da classe de modelos: não depende de nenhum conjunto de dados real, só de quão expressiva é a classe de hipóteses.

### Estendendo Hoeffding a uma hipótese buscada

O limite de Hoeffding anterior se aplicava a uma hipótese fixada de antemão. O **limite de generalização VC** estende isso para cobrir um algoritmo de aprendizado que escolhe a hipótese de melhor ajuste de uma classe de modelos inteira, substituindo o limite de hipótese única por um que escala com a dimensão VC `d_VC` da classe de modelos e com o tamanho da amostra `N`:

```text
E_out(g) ≤ E_in(g) + O( √( d_VC · log(N) / N ) )
```

em que `g` é a hipótese que o algoritmo de aprendizado de fato seleciona. A lição qualitativa central: a diferença entre o erro de treino e o erro verdadeiro cresce com a dimensão VC (uma classe de modelos mais expressiva pode sofrer mais overfitting) e encolhe conforme o tamanho da amostra `N` cresce. É a versão rigorosa de "um modelo mais complexo precisa de mais dados para generalizar tão bem quanto um mais simples".

## Exemplos Resolvidos

### Exemplo 1: a dimensão VC de um classificador linear 2D é 3

Considere classificadores lineares em duas dimensões (uma reta que separa pontos +1 de pontos −1). Quaisquer 3 pontos em "posição geral" (não todos numa mesma reta) podem ser fragmentados: todas as `2³ = 8` rotulações podem ser atingidas por alguma reta, incluindo, por exemplo, isolar qualquer ponto isolado dos outros dois com uma reta traçada perto dele e separar qualquer divisão 2 contra 1 com uma reta entre eles.

No entanto, nenhum conjunto de 4 pontos pode ser fragmentado por uma reta em todos os casos. Um contraexemplo específico: 4 pontos dispostos num padrão "XOR" (dois pontos rotulados +1 em diagonais opostas e dois pontos rotulados −1 na outra diagonal) não podem ser separados por nenhuma reta única, já que os pontos +1 e −1 estão intercalados de um jeito que nenhuma reta consegue desembaraçar. Como alguma configuração de 4 pontos não pode ser fragmentada, mas toda configuração de 3 pontos (em posição geral) pode, a dimensão VC de um classificador linear 2D é exatamente 3.

### Exemplo 2: o que dimensão VC 3 significa na prática

Aplicando o limite de generalização acima com `d_VC = 3`: um classificador linear 2D precisa de relativamente poucos dados para generalizar de forma confiável, porque sua dimensão VC é pequena e fixa, por maior que fique o conjunto de treino. Compare isso com um classificador polinomial de grau 9 em 2D, cuja dimensão VC é bem maior (ele consegue representar fronteiras muito mais complexas e sinuosas): o mesmo limite de generalização prevê que ele precisa de substancialmente mais dados de treino antes que seus erros dentro e fora da amostra tenham garantia de andar juntos, coincidindo com a observação informal do conceito de viés-variância de que modelos flexíveis precisam de mais dados para evitar overfitting.

## Equívocos Comuns e Armadilhas

- **"A dimensão VC é igual ao número de parâmetros de um modelo."** É um atalho comum, mas falso. A dimensão VC mede o *poder expressivo* real de fragmentar rotulações, que pode diferir da contagem de parâmetros (um modelo pode ter muitos parâmetros, mas dimensão VC baixa se esses parâmetros forem fortemente restringidos, ou vice-versa).
- **"Um modelo com dimensão VC menor é sempre a melhor escolha."** Uma dimensão VC menor significa uma garantia de generalização mais apertada (menos risco de overfitting para um dado tamanho de amostra), mas, se a classe de modelos for simples demais para sequer representar o padrão verdadeiro, ela terá alto viés por mais que seus erros dentro e fora da amostra andem juntos. Uma estimativa precisa e de baixa variância de uma resposta sistematicamente errada continua errada.
- **"Overfitting só acontece com 'parâmetros demais'."** Ele acontece sempre que a capacidade efetiva de um modelo (medida pela dimensão VC, e não pela contagem bruta de parâmetros) é grande em relação ao tamanho da amostra de treino disponível. É exatamente por isso que a regularização (o próximo conceito), que restringe a capacidade *efetiva* que um modelo usa sem necessariamente mudar sua contagem de parâmetros, é uma contramedida eficaz.

## Resumo

Overfitting é o fenômeno em que o erro de treino continua melhorando enquanto o erro verdadeiro fora da amostra piora. A dimensão VC dá uma medida rigorosa, específica de cada classe de modelos, de quanto uma classe de hipóteses consegue fragmentar rotulações arbitrárias, o que por sua vez estende o limite de Hoeffding de hipótese única, visto antes nesta disciplina, numa garantia de generalização que leva corretamente em conta um algoritmo de aprendizado buscando numa classe de modelos inteira. Uma dimensão VC maior significa mais poder expressivo, mas exige proporcionalmente mais dados de treino para generalizar de forma confiável: o fundamento rigoroso por baixo da intuição informal de viés-variância do conceito anterior.

## Documentation Links

- [Caltech CS 156: Learning From Data, Lecture 7: The VC Dimension](https://work.caltech.edu/telecourse.html): a aula real que deriva por completo a fragmentação e a dimensão VC.
- [Caltech CS 156: Learning From Data, Lecture 11: Overfitting](https://work.caltech.edu/telecourse.html): a aula complementar que liga a dimensão VC ao fenômeno prático do overfitting.
