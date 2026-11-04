---
version: 1.0
updatedAt: 2026-11-03
title: "Métricas Ágeis: Velocity, Burndown e Burnup"
summary: "Velocity, burndown e burnup: como ler esses gráficos, o que eles permitem prever (com intervalos, não com um número único) e por que a velocity não é uma medida de produtividade, com o que o Scrum Guide de fato diz sobre eles."
---
## Objetivos de Aprendizagem

- Enunciar com precisão o que o Scrum Guide diz sobre ferramentas de previsão e quais termos populares (velocity, story points) ele nunca usa.
- Calcular um intervalo de velocity a partir do histórico de sprints e transformá-lo em uma previsão de entrega, tanto para data fixa quanto para escopo fixo.
- Ler um gráfico de burndown e um de burnup do mesmo projeto e explicar por que só o burnup separa progresso de mudança de escopo.
- Explicar por que a velocity é um auxílio de planejamento de um time e não uma medida de produtividade, e reconhecer os sintomas do seu mau uso.

## Contexto e Motivação

`user-stories-epics-and-the-product-backlog` terminou com itens que têm tamanhos. Os tamanhos existem para que o time responda à pergunta que os stakeholders sempre fazem: quando vai ficar pronto, ou quanto estará pronto até uma data? `estimation-and-risk-in-software-projects` argumentou que uma estimativa honesta é um intervalo, e o mesmo vale aqui.

O Scrum Guide é contido neste ponto. No texto da edição de 2020, as palavras "velocity", "story point" e "estimate" não aparecem. Sobre dimensionamento, ele diz apenas que "os Developers que farão o trabalho são responsáveis pelo dimensionamento". A confiança dos Developers em uma previsão de Sprint depende de conhecerem "seu desempenho passado, sua capacidade futura e sua Definition of Done". E, na seção sobre o Sprint, ele diz: "Existem várias práticas para prever o progresso, como burn-downs, burn-ups ou fluxos cumulativos. Embora comprovadamente úteis, elas não substituem a importância do empirismo. Em ambientes complexos, o que vai acontecer é desconhecido. Só o que já aconteceu pode ser usado para tomar decisões voltadas ao futuro".

Então burn-downs e burn-ups são citados, como opções, e a velocity não é citada em lugar nenhum. A velocity aparece no planning game do XP, em que os desenvolvedores determinam a velocidade com que conseguem trabalhar (Wikipedia, práticas do XP). Esta lição trata esses gráficos e números como ferramentas cujo valor depende de como são usadas.

## Teoria Central

### Dimensionamento e velocity

Os times costumam dimensionar itens em **story points**: uma estimativa relativa de quão grande um item parece ao lado de itens que o time já entende. Na explicação de Mike Cohn, uma estimativa em pontos não diz que um item levará três dias, e um cinco para um time pode não significar o mesmo que um cinco para outro. A **velocity** é então o tamanho total dos itens que um time concluiu em uma iteração. A convenção é contar apenas itens totalmente Done, o que combina com a regra do Scrum Guide de que o trabalho "não pode ser considerado parte de um Increment a menos que atenda à Definition of Done". Crédito parcial esconderia trabalho inacabado no número que deveria prever trabalho acabado.

### Previsão com um intervalo

Uma média única esconde a variação normal entre iterações. Cohn recomenda um **intervalo de velocity** tirado do histórico recente. Duas perguntas passam a ter respostas simples:

```text
Data fixa:    sprints restantes x velocity baixa  ..  x velocity alta
              = quanto provavelmente será entregue até a data
Escopo fixo:  tamanho restante / velocity alta  ..  / velocity baixa
              = quantos sprints provavelmente serão necessários
```

Cohn também acrescenta uma margem para o trabalho ainda não descoberto, porque backlogs crescem, e atualiza a previsão a cada sprint, em linha com o empirismo do Guide.

### Burndown e burnup

Um **gráfico de burndown** mostra o trabalho restante ao longo do tempo. Costuma trazer uma linha "ideal" do total inicial direto até zero. Alguns praticantes objetam ao nome, porque a linha é um cálculo feito a partir de estimativas, e as estimativas têm mais chance de estar erradas do que o trabalho (Wikipedia, Burn down chart), então ela é uma linha de referência e não uma meta. Um **gráfico de burnup** mostra o trabalho concluído subindo ao longo do tempo, junto com uma linha separada para o escopo total.

A diferença importa sempre que o escopo muda. O trabalho restante é o escopo total menos o trabalho feito, então no burndown um item novo parece idêntico a progresso perdido: a linha sobe ou se achata, e o leitor precisa adivinhar o que aconteceu. No burnup, o progresso aparece em uma linha e o escopo na outra. O Scrum Guide lista os dois, mais o fluxo cumulativo (veja `kanban-and-flow-based-process`), como práticas de previsão, sem hierarquizá-los.

### Por que velocity não é produtividade

O texto "Cannot Measure Productivity" (2003), de Martin Fowler, dá a razão de fundo: produtividade é saída dividida por entrada, e "não conseguimos medir a saída". Ele rejeita linhas de código, desconfia de pontos de função e sustenta que "qualquer medida verdadeira de produtividade de desenvolvimento de software precisa se basear em valor de negócio entregue". A velocity não escapa do problema: é a própria estimativa de tamanho do time, em uma unidade privada dele.

Quando a velocity vira meta, ela deixa de descrever qualquer coisa. Cohn diz que a velocity "deve apoiar a previsão, não virar uma meta de desempenho" e alerta que fixar uma conversão entre pontos e dias cria pressão: stakeholders tratam estimativas como compromissos, gestores comparam totais de pontos entre times, a velocity vira meta e os times inflam estimativas para se proteger. O artigo da Wikipedia sobre velocity invoca a lei de Goodhart em sua forma popular, a de que toda medida que vira meta deixa de ser uma boa medida. Essa formulação é uma paráfrase posterior (de Marilyn Strathern, 1997), não a frase do próprio Goodhart; `software-quality-metrics` traz a original e a atribuição. O princípio do próprio Manifesto Ágil é que "software funcionando é a principal medida de progresso".

Livro vs hoje: velocity e story points pertencem à literatura de praticantes, não ao Scrum Guide de 2020, que não nomeia nenhuma unidade e trata os gráficos como práticas opcionais. Medidas de fluxo, como cycle time e eficiência de fluxo (`kanban-and-flow-based-process`, `lean-principles-for-software`), são uma alternativa quando o trabalho não cabe em iterações estáveis.

## Exemplos Resolvidos

### Exemplo 1: uma previsão a partir de seis sprints

Velocities inventadas para seis sprints concluídos: 21, 28, 24, 30, 26, 23. A média é 25,3 e o intervalo vai de 21 a 30. O backlog restante é de 180 pontos.

```text
Só pela média:        180 / 25,3 = 7,1 -> "8 sprints"
Pelo intervalo:       180 / 30 = 6,0 -> 6 sprints   (melhor caso)
                      180 / 21 = 8,6 -> 9 sprints   (pior caso)
Com margem de 15% para trabalho não descoberto: 180 x 1,15 = 207
                      207 / 30 = 6,9 -> 7 sprints
                      207 / 21 = 9,9 -> 10 sprints
```

A afirmação honesta é "de 7 a 10 sprints", não "8". Para uma data fixa com seis sprints restantes, o mesmo histórico dá de 6 x 21 = 126 a 6 x 30 = 180 pontos de capacidade, com média 152. Aplique a mesma margem de 15%: se o trabalho conhecido é só 1/1,15 do que de fato será pedido, 126 pontos de capacidade cobrem cerca de 110 pontos do backlog conhecido, 152 cobrem cerca de 132 e 180 cobrem cerca de 157. Itens dentro dos primeiros 110 pontos do backlog ordenado são prováveis, os entre cerca de 110 e 157 são incertos e o resto é improvável. Tomar o menor e o maior valor dos sprints é como Cohn monta o intervalo no próprio exemplo dele, em que seis velocities entre 27 e 36 viram "entre 27 e 36".

### Exemplo 2: um projeto no burndown e no burnup

O escopo total começa em 120 pontos. O time conclui 20, 22, 18, 21, 19 e 20 pontos nos sprints 1 a 6 (média 20). O Product Owner acrescenta 15 pontos no sprint 3 e 10 no sprint 5.

```text
Sprint  escopo  feito (acum.)  restante  restante ideal
  1      120        20           100          100
  2      120        42            78           80
  3      135        60            75           60
  4      135        81            54           40
  5      145       100            45           20
  6      145       120            25            0
```

No burndown, o trabalho restante fica 15 acima da linha ideal no sprint 3 e 25 acima nos sprints 5 e 6, o que parece um time ficando para trás. Essas diferenças são exatamente os 15 e os 25 pontos de escopo acrescentados. No burnup, a linha de feito sobe cerca de 20 por sprint, quase reta, e a linha de escopo dá dois degraus. O progresso foi estável; o escopo cresceu. Os últimos 25 pontos a 18 a 22 por sprint levam de 25 / 22 = 1,1 a 25 / 18 = 1,4 sprint, ou seja, mais dois: o projeto termina no sprint 8, e um stakeholder enxerga que os dois sprints extras vieram dos 25 pontos acrescentados.

### Exemplo 3: velocity como meta

Um time conclui 8 histórias por sprint, dimensionadas em 3 pontos em média, então sua velocity é 24. A gestão define uma meta: "aumentar a velocity em 30%". Nada no trabalho muda, mas o time passa a dimensionar as histórias em 3,9 pontos em média. A velocity vira 8 x 3,9 = 31,2, 30% a mais, enquanto os usuários recebem as mesmas 8 histórias por sprint de antes. A métrica melhorou e a saída não, o padrão que a forma popular da lei de Goodhart descreve.

## Equívocos Comuns e Armadilhas

- **"O Scrum exige velocity e um gráfico de burndown."** O Scrum Guide nunca usa a palavra velocity nem o termo story point, e cita burn-downs e burn-ups apenas como exemplos de práticas que existem e que "não substituem a importância do empirismo".
- **"A velocity mede a produtividade do time, então vamos comparar times."** O Exemplo 3 mostra com que facilidade a unidade de um time pode ser alterada, e Cohn diz para não comparar velocities brutas entre times. O argumento de Fowler é que a própria saída é difícil de medir.
- **"A linha ideal é o plano, e ficar acima dela é fracasso."** No Exemplo 2, o time ficou acima da linha só porque o escopo cresceu. A linha é construída a partir de estimativas, então é uma referência, não uma meta.
- **"A velocity média dá a data."** O Exemplo 1 dá 8 sprints pela média e de 7 a 10 por um intervalo com margem. Uma data única expressa uma certeza que os dados não têm.
- **"Boas métricas significam que o produto é bom."** Os gráficos de burn contam itens dimensionados, não se os usuários se beneficiam.

## Resumo

O Scrum Guide menciona burn-downs, burn-ups e fluxo cumulativo como práticas de previsão úteis, mas que "não substituem a importância do empirismo", e nunca usa as palavras velocity nem story point. A velocity, que aparece no planning game do XP, é o tamanho total dos itens totalmente Done por iteração, e o jeito sólido de usá-la é como intervalo, aplicado ao tamanho restante ou aos sprints restantes, com margem para trabalho não descoberto e atualização a cada sprint. Um gráfico de burnup separa progresso de mudança de escopo, o que o burndown embaralha. A velocity é a unidade privada de planejamento de um time, não uma medida de produtividade: Fowler argumenta que produtividade não se mede por contagens de saída, e quando a velocity vira meta ela deixa de medir qualquer coisa, como mostra o exemplo dos 30%.

## Documentation Links

- [Schwaber & Sutherland: The Scrum Guide](https://scrumguides.org/scrum-guide.html): as declarações exatas sobre dimensionamento, previsão, burn-downs e burn-ups, e sobre a Definition of Done.
- [Agile Manifesto: Principles](https://agilemanifesto.org/principles.html): "Working software is the primary measure of progress."
- [Fowler: Cannot Measure Productivity](https://martinfowler.com/bliki/CannotMeasureProductivity.html): por que linhas de código e pontos de função não medem a saída, e por que valor é a medida real.
- [Mountain Goat Software: Agile Planning and Forecasting](https://www.mountaingoatsoftware.com/agile/agile-planning-and-forecasting): o tratamento de Cohn para intervalos de velocity, previsões de data fixa e escopo fixo e trabalho desconhecido.
- [Mountain Goat Software: Story Points](https://www.mountaingoatsoftware.com/agile/story-points): story points como tamanho relativo, e os alertas contra usar a velocity como meta ou comparar times.
- [Wikipedia: Burn down chart](https://en.wikipedia.org/wiki/Burn_down_chart): como ler as linhas ideal e real, a objeção ao termo "ideal" e uma descrição curta dos gráficos de burnup.
- [Wikipedia: Velocity (software development)](https://en.wikipedia.org/wiki/Velocity_%28software_development%29): a definição e a ressalva sobre a lei de Goodhart.
