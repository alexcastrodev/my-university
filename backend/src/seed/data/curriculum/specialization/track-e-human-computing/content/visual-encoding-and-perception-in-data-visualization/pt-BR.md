---
version: 1.0
updatedAt: 2026-11-04
title: "Codificação Visual e Percepção em Visualização de Dados"
summary: "O ranking de codificações perceptuais de Cleveland e McGill, as características pré-atentivas e como escolher um gráfico pela comparação que ele precisa sustentar."
---
## Objetivos de Aprendizagem

- Enunciar a tarefa, os estímulos e a medida de erro por trás do ranking de Cleveland e McGill.
- Distinguir posição em escala comum de posição em escalas não alinhadas, e ambas de comprimento, num gráfico real.
- Dizer o que a replicação de Heer e Bostock confirmou e mudou, e o que estudos posteriores acrescentam.
- Explicar o que significa "pré-atentivo" e nomear seus limites.
- Escolher um gráfico pela comparação e discutir "nunca use gráfico de pizza" com evidência dos dois lados.

## Contexto e Motivação

`intuition-and-visualization-of-results` trata o gráfico como checagem da intuição: um outlier, uma assimetria ou uma segunda moda aparecem no gráfico e se escondem atrás de uma média. Aquela lição diz para olhar os dados. Esta pergunta o que o olho consegue ler de volta das marcas e quanto erro cada tipo de marca acrescenta. O erro de decodificação pode ser medido, e depende da codificação, da tarefa e da pessoa.

## Teoria Central

### Percepção gráfica

Heer e Bostock (2010), seguindo Cleveland, usam *graphical perception* para a capacidade de interpretar codificações visuais e assim decodificar a informação de um gráfico. Os rankings que discutem tratam de dados quantitativos. Eles também apontam um limite: as variáveis interagem, então extrapolar de variáveis isoladas não é confiável. Posição e forma são decodificadas de modo bastante independente, enquanto matiz e saturação são integrais.

### O que Cleveland e McGill mediram

O desenho do estudo de 1984, no *JASA*:

- **Tarefa.** Dois valores são marcados no gráfico. A pessoa estima que porcentagem o menor representa do maior.
- **Estímulos.** O experimento de posição e comprimento tinha cinco tipos de julgamento, e cada participante recebia um pacote com cinquenta gráficos em folhas separadas. Um experimento separado de posição e ângulo usou outro formato de tarefa, o que dificulta a comparação (Heer e Bostock).
- **Participantes.** Estudo de laboratório em que cada participante julgou tudo. Nas palavras de Cleveland e McGill, citadas por Davis et al. (2022): "each subject judged all of the experimental units in an experiment". As replicações abertas não repetem o número de pessoas, então esse dado precisa vir do artigo de 1984.
- **Medida.** Erro absoluto em log, depois midmeans (médias dos dois quartis do meio) por gráfico, depois médias com intervalos de 95% por bootstrap:

$$\text{erro}=\log_2\left(\lvert\text{julgado}-\text{real}\rvert+\tfrac18\right).$$

O $\tfrac18$ trata respostas exatas, e o log torna a escala relativa.

Xu, Williams e Wall (2023) relatam a hierarquia de um estudo de 1986 com estímulos isolados, do mais para o menos preciso: posição em escala comum, posição em escalas idênticas não alinhadas, comprimento, direção, ângulo, inclinação, área, volume, sombreamento, saturação. Outros resumos listam um conjunto um pouco diferente (Nguyen et al. 2025 juntam direção e inclinação e incluem curvatura). Confie mais no topo que na cauda, e leia cada degrau como afirmação sobre esta tarefa: julgar a razão entre dois valores.

### Escala comum, escalas não alinhadas e comprimento

Os três se confundem com facilidade.

| Tarefa elementar | O que o olho tem | Design típico |
|---|---|---|
| Posição, escala comum | Marcas contra um eixo compartilhado | Gráfico de pontos, ou barras de uma mesma base |
| Posição, escalas não alinhadas | Escalas idênticas deslocadas na página | Painéis empilhados na vertical, cada um com o mesmo eixo y |
| Comprimento | Extensões sem início compartilhado | Segmentos superiores de uma barra empilhada |

A linha do meio ainda é posição: o leitor carrega um valor de um eixo para o outro. A última perde a escala, porque cada segmento começa em outro lugar. Heer e Bostock rotulam seus três primeiros tipos de julgamento como posição em escala comum e os tipos 4 e 5 como comprimento, então, por esse rótulo, a comparação deles não diz nada direto sobre escalas não alinhadas.

### O que os trabalhos posteriores confirmaram e mudaram

Heer e Bostock rodaram a tarefa proporcional no Mechanical Turk com $N=50$ por gráfico. Os participantes viam gráficos de 380 por 380 pixels, davam um "quick visual judgment" e recebiam \$0.05 por julgamento. Como checagem, primeiro apontavam o valor menor, e só 14 de 3.481 respostas estavam erradas (0,4%).

| Pergunta | Resultado |
|---|---|
| Ranking dos tipos 1 a 5 | Preservado, com valores novos parecidos, mas não idênticos |
| Tipos 1 e 2 | Mais próximos que no laboratório, talvez porque uma tela menor reduziu o efeito da distância |
| Tipos 4 e 5 (comprimento) | Mais precisos que no original, e a posição ainda significativamente melhor |
| Ângulo de pizza e área circular, mesmo formato de tarefa | Área pior que ângulo, ambos significativamente piores que posição |
| Ângulo contra comprimento | A teoria prevê ângulo pior. Os resultados não sustentam isso |
| Área retangular | Igual à circular em média. Proporção 1 foi o pior caso, coerente com leitores que usam os lados como aproximação |

A replicação abriu mão do controle de tela, luz e distância, e os autores limitam o método a experimentos insensíveis a isso.

Davis et al. (2022) perguntam se o ranking vale para indivíduos, com 109 participantes de crowdsourcing e 130.800 julgamentos em gráficos de barras, pizza, barras empilhadas e bolhas. As barras foram as melhores em média. Mas cerca de 20 a 25% se saíram consistentemente melhor com outro gráfico, menos de 40% devem compartilhar a ordem canônica de barras em primeiro e pizza em segundo, e as diferenças esperadas entre pizza, bolhas e barras empilhadas (1 a 1,5 ponto) são menores que as diferenças esperadas entre pessoas (1,5 a 3 pontos). Os autores questionam se rankings são a forma certa de orientação e sugerem tamanhos de efeito com incerteza.

A tarefa também muda a resposta. Davis et al. relatam que Hollands e Spence viram que o ranking não explica necessariamente a discriminação (qual é maior), e que Yuan et al. viram que ele não se aplica à comparação de vários valores. Saket et al. (2018) testaram cinco tipos de gráfico em dez tarefas com 180 trabalhadores do Mechanical Turk nos EUA, em conjuntos pequenos (5 a 34 pontos), e a eficácia variou significativamente por tarefa. Para Bertini et al. (2020), ler dois valores com precisão é uma tarefa entre muitas: só pontos pode ser pior que barras ou linhas para ver o quadro geral. Numa pequena replicação tátil, 12 universitários mostraram outra ordem para codificações táteis (Xu et al. 2023).

### Processamento pré-atentivo e seus limites

Wolfe (2021) dá o sentido de trabalho: antes que a atenção seletiva chegue a um item, parte do processamento dele já ocorreu, e "A preattentive feature is a property capable of guiding the deployment of attention." Wolfe e Horowitz (2017) listam cor, movimento, orientação e tamanho como atributos guia indubitáveis, com outros, como forma, entre os prováveis. O pop-out é o efeito visível: o tempo de busca quase não cresce quando se acrescentam distratores.

Cinco limites importam para gráficos.

1. **Não é instantâneo.** Wolfe (2021) diz que relatos anteriores tratavam esse estágio como essencialmente instantâneo e que isso é "not correct". Até a orientação básica por cor leva de 200 a 300 ms para ser plenamente eficaz (Palmer et al. 2019, por ele relatado).
2. **Não é plano.** As inclinações de pop-out ficam perto de 0 ms por item, "but typically a little greater than" isso, e Wolfe relata que os tempos de resposta em buscas por característica básica crescem com o log do tamanho do conjunto (Lleras et al. 2020).
3. **Visível não é o mesmo que orientador.** Uma inclinação de meio grau é fácil de detectar e não guia a atenção. Um alvo de 0° não salta entre distratores de 5° (Wolfe 2020).
4. **O contexto define a força.** A saliência cresce com a diferença entre alvo e distratores e com a homogeneidade dos distratores (Wolfe e Horowitz 2017). Um ponto vermelho salta entre pontos cinza, e bem menos num arco-íris.
5. **Não é toda propriedade.** O tipo de interseção, por exemplo, não é uma característica básica, então um sinal de mais entre formas parecidas não salta.

A orientação diz ao olho para onde ir, mas não lê um valor: uma cor de destaque leva a atenção a uma barra, e a comparação ainda depende de posição ou comprimento. Wolfe avisa que o termo é malvisto em alguns círculos, em parte por sugerir um estágio de duração fixa.

### Escolhendo pela comparação

Síntese desta lição: cada linha é um ponto de partida.

| O leitor precisa | Comece com | Atenção a |
|---|---|---|
| Comparar dois ou mais valores de perto | Pontos ou barras em um eixo, ordenados | Rótulos longos, muitas categorias |
| Descrever uma tendência | Uma linha (em Zacks e Tversky, como relatam Saket et al., as pessoas descreviam tendências a partir de linhas e comparavam valores a partir de barras) | Eixo x nominal, em que a linha sugere ordem |
| Ver uma distribuição | Histograma ou gráfico de pontos, como em `intuition-and-visualization-of-results` | A largura do bin muda a forma |
| Ver um todo e uma parte | Pizza ou uma barra empilhada com poucas partes | Comparar muitas partes parecidas |
| Acompanhar totais e um componente | Barras empilhadas, com esse componente embaixo | Os outros componentes viram julgamentos de comprimento |
| Ter visão geral de muitas séries | Barras ou linhas (Bertini et al.) | A leitura exata fica mais difícil |

### "Nunca use gráfico de pizza"

A evidência a favor é real e estreita: para julgar a razão entre dois valores, o ângulo foi significativamente pior que a posição (Heer e Bostock), e as barras foram as melhores em média (Davis et al.). Mas a regra falha em vários pontos.

- Para estimar parte do todo, Skau e Kosara relatam que Simkin e Hastie viram pizza e barras igualmente adequadas.
- Saket et al. relatam que, para Spence e colegas, a pizza superou as barras ao comparar combinações de proporções.
- No estudo do próprio Saket, a pizza empatou com barras e tabelas em Extremum, Retrieve e várias outras tarefas, e foi menos precisa em Correlation, Anomalies e Distribution. As fatias tinham cores únicas, o que os autores acham que ajudou numa tarefa.
- Skau e Kosara (2016) viram que o ângulo foi a pista menos importante em pizzas e donuts, então "pizza é ruim porque ângulo é ruim" descreve mal como elas são lidas.

Assim, a regra vale para ordenar valores próximos, e falha para um todo com poucas partes, quando o ponto é a fatia do todo.

## Exemplos Resolvidos

### Exemplo 1: lendo a escala de erro

Inverta a medida. Erro $=0$ dá $\log_2(1/8)=-3$, o piso. Um erro de 1 ponto dá $0{,}17$, 3 pontos dão $1{,}64$ e 10 pontos dão $3{,}34$. O eixo da Figura 4 de Heer e Bostock vai de 1,0 a 3,5, o que inverte para cerca de 1,9 e 11,2 pontos percentuais, um guia aproximado, já que são médias de logs.

Agora oito leitores **fictícios** julgam um valor real de 40. Os números só mostram a conta e não são resultado sobre nenhuma codificação:

```text
             judgments                  midmean log error   back to points
position A   41 38 40 42 39 45 40 37    0.63                1.42
angle B      50 33 45 30 47 40 28 52    3.09                8.37
```

Ordene os oito erros em log, descarte os dois menores e os dois maiores e tire a média do resto. Para A sobram $0{,}17,\ 0{,}17,\ 1{,}09,\ 1{,}09$, cuja média é $0{,}63$. Uma resposta exata contribui com $-3$, e o midmean impede que extremos assim dominem.

### Exemplo 2: os mesmos dados, três tarefas elementares

Vendas por região (dados do exemplo):

```text
       A    B    C   total
Q1    30   22   18    70
Q2    44   20   12    76
Q3    26   24   20    70
Q4    50   22    8    80
```

Uma barra empilhada, com um caractere para 2 unidades:

```text
Q1   AAAAAAAAAAAAAAABBBBBBBBBBBCCCCCCCCC
Q2   AAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBCCCCCC
Q3   AAAAAAAAAAAAABBBBBBBBBBBBCCCCCCCCCC
Q4   AAAAAAAAAAAAAAAAAAAAAAAAABBBBBBBBBBBCCCC
```

A série B é estável, de 22 a 22. Sua borda direita vai de 52 a 72, um deslocamento de 20 herdado de A. Para julgar B, o leitor precisa comparar comprimentos com inícios diferentes. A tem base compartilhada, então é posição em escala comum, assim como os totais. Com base própria, a pergunta fica fácil:

```text
Q1   ########### 22
Q2   ########## 20
Q3   ############ 24
Q4   ########### 22
```

Quatro painéis empilhados na vertical, com o mesmo eixo, seriam posição em escalas não alinhadas: abaixo desta vista na hierarquia e acima dos segmentos. Nenhum gráfico vence sozinho: a barra empilhada mostra os totais diretamente.

### Exemplo 3: pizza ou barras para um mesmo conjunto

Fatias (dados do exemplo): Norte 38, Leste 24, Sul 21, Oeste 17, somando 100.

- **"Leste é maior que Sul, e por quanto?"** Sul é $21/24=87{,}5\%$ de Leste, e as fatias diferem em $3\times3{,}6^\circ=10{,}8^\circ$. É uma comparação próxima entre dois valores, então barras ordenadas em um eixo servem melhor.
- **"Norte e Leste juntos passam da metade?"** Chegam a 62%, ou $223{,}2^\circ$. Com as fatias começando no topo, a linha de 180° é um ponto de quadrante, o tipo de marco que Skau e Kosara giraram seus gráficos para reduzir. Uma pizza responde direto, e uma barra empilhada com marca em 50 também.

A segunda resposta é inferência a partir dessas fontes, não resultado testado.

## Equívocos Comuns e Armadilhas

- **"Cleveland e McGill provaram um ranking universal."** Ele vem de julgamentos de razão entre dois valores marcados, e a média esconde indivíduos.
- **"Barras empilhadas são posição não alinhada."** Segmentos acima do primeiro não têm início compartilhado, então são lidos como comprimento.
- **"Ângulo é pior que comprimento."** A hierarquia lista comprimento acima, mas a comparação direta de Heer e Bostock não sustenta isso.
- **"Pré-atentivo significa instantâneo."** Wolfe (2021) rejeita essa formulação, e detecção não é orientação.
- **"Nunca use gráfico de pizza."** Regra sem tarefa é folclore.

## Resumo

Cleveland e McGill pediram a estimativa de um valor como porcentagem de outro e pontuaram com erro absoluto em log. Posição em escala comum lidera, escalas não alinhadas vêm em seguida, e comprimento é outra tarefa. Heer e Bostock preservaram a ordem de posição sobre comprimento e não encontraram sustentação para ângulo ser pior que comprimento. Davis et al. mostram muitos indivíduos fora da ordem média, e outros estudos, que ela muda com a tarefa. Características pré-atentivas guiam a atenção sem serem instantâneas nem bastarem para ler um valor. A escolha do gráfico começa pela comparação.

## Documentation Links

- [Heer e Bostock (2010): Crowdsourcing Graphical Perception](https://homes.cs.washington.edu/~jheer/files/2010-MTurk-CHI.pdf): a replicação, e a tarefa e a medida do original.
- [Davis et al. (2022): The Risks of Ranking](https://arxiv.org/pdf/2212.10533): diferenças individuais.
- [Xu, Williams e Wall (2023): Let's Get Vysical](https://arxiv.org/pdf/2308.04392): a hierarquia e uma replicação tátil.
- [Nguyen et al. (2025): Evaluating Graphical Perception with Multimodal LLMs](https://arxiv.org/pdf/2504.04221): outra lista das tarefas.
- [Saket, Endert e Demiralp (2018): Task-Based Effectiveness of Basic Visualizations](https://arxiv.org/pdf/1709.08546): cinco tipos de gráfico em dez tarefas.
- [Bertini, Correll e Franconeri (2020): Why Shouldn't All Charts Be Scatter Plots?](https://arxiv.org/pdf/2008.11310): limites da precisão.
- [Skau e Kosara (2016): Arcs, Angles, or Areas](https://kosara.net/papers/2016/Skau-EuroVis-2016.pdf): pistas em pizzas e donuts, e estudos anteriores.
- [Wolfe (2021): Guided Search 6.0](https://search.bwh.harvard.edu/new/pubs/Wolfe2021_GS6.pdf): características pré-atentivas.
- [Wolfe (2020): Visual Search](https://search.bwh.harvard.edu/new/pubs/Wolfe2020_VisualSearch_annurev-vision.pdf): orientação e busca.
- [Wolfe e Horowitz (2017): Five Factors That Guide Attention](https://search.bwh.harvard.edu/new/pubs/FiveFactors_Wolfe-Horowitz_2017.pdf): atributos guia e saliência.
