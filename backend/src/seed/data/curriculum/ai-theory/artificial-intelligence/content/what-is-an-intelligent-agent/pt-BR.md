---
version: 1.0
updatedAt: 2026-09-06
title: O Que É um Agente Inteligente?
summary: Um agente como qualquer coisa que percebe seu ambiente por meio de sensores e age sobre ele por meio de atuadores, e a racionalidade como escolher, a cada passo, a ação que se espera que melhor alcance os objetivos do agente dado o que ele percebeu até ali, e não a ação que se prova ótima em retrospecto.
---
## Objetivos de Aprendizagem

- Definir um agente como qualquer coisa que percebe seu ambiente por meio de sensores e age sobre ele por meio de atuadores, e apresentar a distinção entre função do agente e programa do agente.
- Definir racionalidade com precisão: escolher, a cada instante, a ação que se espera maximizar o desempenho dada a sequência de percepções até ali e o que o agente já sabe; e não a ação que se revela a melhor depois do fato.
- Explicar por que racionalidade não é onisciência e por que um agente racional ainda pode fazer uma escolha que leva a um resultado ruim sem ter sido irracional.
- Distinguir uma medida de desempenho (definida sobre o ambiente, externa ao agente) de um valor que o agente calcula internamente.
- Explicar por que esta disciplina se apoia diretamente nos algoritmos de busca (BFS, DFS, Dijkstra, A*) já vistos em outros pontos deste currículo, em vez de derivá-los de novo.

## Contexto e Motivação

Todo algoritmo visto até aqui neste currículo (uma rotina de ordenação, uma busca de caminho mínimo, um parser) recebe uma entrada fixa e produz uma saída fixa, uma vez, e termina. A inteligência artificial, como área, se organiza em torno de outra unidade de análise: um **agente**, algo que está dentro de um ambiente, percebe esse ambiente continuamente por meio de sensores e age sobre ele continuamente por meio de atuadores, de novo e de novo, muitas vezes sem nunca conhecer por completo o estado do mundo em que está agindo. Um termostato, um programa de xadrez, um carro autônomo e um chatbot de atendimento são todos agentes nesse sentido, por mais diferentes que sejam por dentro.

Esse novo enquadramento importa porque muda a pergunta central. Um algoritmo de ordenação é julgado por sua saída estar correta. Um agente é julgado por seu *comportamento* (toda a sequência de ações que ele toma ao longo do tempo, em resposta a toda uma sequência de percepções) alcançar o que quem o projetou queria, em um ambiente em que o agente normalmente não tem informação completa e não consegue prever todas as consequências. É um objeto muito mais difícil de especificar com precisão, e o *Artificial Intelligence: A Modern Approach* de Russell e Norvig começa exatamente por esse problema: antes de escrever qualquer algoritmo, definir primeiro o que "fazer a coisa certa" sequer significa para um agente preso a perceber e agir dentro de um mundo que ele não controla por completo.

Esta disciplina presume as técnicas de busca já ensinadas em outros pontos deste currículo (busca em largura e em profundidade, o algoritmo de Dijkstra, a busca de caminhos A\*) como mecanismos que um agente pode usar. Ela não reensina nenhuma delas. O que ela acrescenta é a camada acima da busca pura em grafos: oponentes adversariais, restrições entre variáveis, informação incerta e parcial, e decisões sequenciais com recompensa adiada; as situações em que "é só achar um caminho" deixa de ser o problema inteiro.

## Teoria Central

### A função do agente e o programa do agente

Em abstrato, uma **função do agente** mapeia cada sequência de percepções possível que o agente poderia receber para uma ação. É uma tabela completa, ainda que normalmente infinita e impossível de escrever, especificando o que o agente faz em toda situação concebível. O **programa do agente** é a implementação concreta e executável (o código de fato) que calcula essa função (ou uma aproximação dela) conforme as percepções chegam. A distinção importa porque separa a especificação do comportamento correto do mecanismo que o produz: dois programas de agente muito diferentes (uma tabela de consulta gigante versus um programa compacto baseado em regras) podem implementar exatamente a mesma função do agente.

### Racionalidade: a definição precisa

Um agente é **racional** se, para cada sequência de percepções possível, ele seleciona uma ação que se espera maximizar sua medida de desempenho, dada a evidência fornecida pela sequência de percepções até ali e o conhecimento embutido que o agente tiver. Cada parte dessa frase carrega peso:

- **"Que se espera maximizar"**, e não "que com certeza maximiza". A racionalidade trata da melhor decisão dada a informação disponível, e não do resultado real, que pode depender de fatores que o agente não consegue perceber nem controlar.
- **"Dada a evidência... até ali"**: a racionalidade é julgada em relação ao que o agente de fato percebeu, e não a fatos do mundo que ele não tinha como saber.
- **"E o conhecimento embutido que o agente tiver"**: não se espera que um agente derive do zero o que poderia razoavelmente ser informado de antemão (por exemplo, as regras do xadrez).

### Racionalidade não é onisciência

Um agente racional ainda pode perder. Considere um agente atravessando a rua que olha para os dois lados, não vê trânsito e entra na rua, e então um caminhão avança um sinal vermelho vindo de um ponto cego uma fração de segundo depois. A ação do agente foi racional no momento em que foi tomada (ele usou corretamente todas as percepções disponíveis), embora o resultado tenha sido ruim. Exigir que um agente racional nunca tenha um resultado ruim seria exigir onisciência, uma propriedade diferente e, em geral, inalcançável. Essa distinção não é um detalhe técnico; é o motivo inteiro de a racionalidade, e não a perfeição, ser o padrão usado para avaliar cada projeto de agente visto nesta disciplina, inclusive os que comprovadamente às vezes vão perder para o acaso (expectimax) ou para a informação imperfeita (um ambiente parcialmente observável).

### Medida de desempenho vs. valor interno

Uma **medida de desempenho** é um padrão externo e objetivo aplicado à sequência de estados do ambiente que o comportamento do agente produz; para um robô aspirador, talvez "quantidade de sujeira limpa por unidade de eletricidade gasta", julgada por um observador externo ao longo de toda a vida útil do robô. Isso é diferente de qualquer número que o agente calcula internamente (como a estimativa de uma função de avaliação de árvore de jogo para o valor de uma posição) para *decidir* o que fazer. Confundir os dois é uma fonte comum de confusão entre projetar um agente e avaliá-lo: a medida de desempenho define o objetivo do ponto de vista do ambiente; o mecanismo interno do agente (busca, lógica, probabilidade, o que esta disciplina cobrir a seguir) é só o meio pelo qual o agente tenta agir bem segundo esse padrão externo.

### Por que esta disciplina não é "busca, de novo"

BFS, DFS, o algoritmo de Dijkstra e o A\* (todos já vistos) resolvem uma única classe bem definida de problema: encontrar um caminho em um grafo, sozinho, com informação completa, em que o ambiente não reage às escolhas do agente. Quase tudo o que torna uma tarefa genuinamente difícil para um agente inteligente está fora dessa classe: um adversário que reage, um conjunto de restrições entre muitas variáveis ao mesmo tempo, conhecimento que precisa ser representado e raciocinado em vez de apenas percorrido, e resultados incertos em vez de determinísticos. Cada um dos temas que vêm a seguir nesta disciplina (jogos, CSPs, lógica, probabilidade, tomada de decisão sequencial) é um acréscimo genuíno ao kit do agente para exatamente uma dessas situações mais difíceis, e não uma reapresentação da busca com outro nome.

## Exemplos Resolvidos

### Exemplo 1: a função do agente para um mundo de aspirador com dois quadrados

Considere um ambiente de brinquedo: dois locais, A e B, cada um Limpo (Clean) ou Sujo (Dirty), e um agente aspirador que percebe o local atual e se ele está limpo, e pode agir com `Left`, `Right`, `Suck` ou `NoOp`. Uma pequena fatia da sua função do agente, escrita como tabela:

```text
Percepção: (local, estado)          Ação
(A, Dirty)                          Suck
(A, Clean)                          Right
(B, Dirty)                          Suck
(B, Clean)                          Left
```

Esta é a função do agente inteira para uma versão do problema com *uma única percepção* (sem memória do passado). Repare que ela é racional sob uma medida de desempenho natural ("maximizar os quadrados limpos ao longo do tempo, minimizar o movimento"): sempre que um quadrado está sujo, limpa; sempre que já está limpo, vai em direção ao outro quadrado, caso ele precise de limpeza. A função do agente é uma especificação completa do comportamento; nada aqui ainda diz como ela é implementada.

### Exemplo 2: racional, mas sem sorte

Suponha que o agente aspirador acima esteja no quadrado A, perceba Clean e vá racionalmente para a direita, em direção a B. Suponha que, sem o agente saber (nenhuma percepção indicou isso), alguém tenha *acabado* de jogar sujeira no quadrado A um instante depois que o agente saiu. O desempenho do agente neste episódio é pior do que se ele tivesse ficado, mas sua decisão de se mover continua racional: dado tudo o que ele percebeu, ir checar o outro quadrado era a melhor escolha disponível. É o sentido preciso em que a racionalidade é julgada pelo processo de decisão naquele momento, usando a evidência disponível, e não pelo resultado depois do fato.

### Exemplo 3: classificando medidas de desempenho vs. valores internos

```text
Afirmação                                                 Classificação
--------------------------------------------------------------------------
"Minimizar o tempo total de viagem em todos os trajetos   Medida de desempenho
 deste ano"
"Esta posição do tabuleiro vale +3.2 para mim"            Valor interno (ex.: função de avaliação de jogo)
"Maximizar a sujeira limpa por unidade de bateria usada"  Medida de desempenho
"Minha crença atual: 78% de chance de o oponente ter       Valor interno (uma estimativa de probabilidade)
 uma dama"
```

O padrão: uma medida de desempenho é enunciada sobre o *histórico do ambiente*, julgada externamente e depois do fato; um valor interno é o que o agente calcula, no momento, para ajudá-lo a decidir o que fazer em seguida. Os conceitos posteriores desta disciplina (valores de árvores de jogo, checagens de restrições de CSP, log-probabilidades, valores de Bellman) são todos valores internos nesse sentido, sempre a serviço de alguma medida de desempenho que nunca faz parte do próprio algoritmo.

## Equívocos Comuns e Armadilhas

- **"Um agente racional precisa sempre vencer / ter sucesso."** A racionalidade trata da qualidade da decisão dada a informação disponível, e não de resultados garantidos. Um agente racional pode perder por azar, pela informação oculta melhor de um adversário ou por um ambiente que não consegue observar por completo, e ainda assim ter sido racional a cada passo.
- **"Um agente precisa ser consciente ou parecido com um humano para contar como inteligente."** A definição de agente usada em toda a IA (e nesta disciplina) é puramente funcional: percepções entram, ações saem, julgadas por uma medida de desempenho. Um termostato e uma engine de xadrez são ambos agentes segundo essa definição; nenhum dos dois precisa de nada parecido com cognição humana.
- **"O programa do agente e a função do agente são a mesma coisa."** A função do agente é uma especificação abstrata (em geral, uma tabela infinita); o programa do agente é o mecanismo concreto e executável que a calcula. Dois programas muito diferentes podem realizar a mesma função.
- **"IA é só busca com passos a mais."** A busca, já vista, resolve um formato específico de problema: ambientes de um único agente, totalmente conhecidos e que não reagem. Adversários, restrições, conhecimento incompleto e incerteza exigem, cada um, mecanismos genuinamente diferentes, vistos conceito a conceito no resto desta disciplina.

## Resumo

Um agente percebe seu ambiente por meio de sensores e age por meio de atuadores; a função do agente especifica em abstrato o que ele faz para cada sequência de percepções possível, e o programa do agente é o mecanismo concreto que a calcula. Racionalidade significa escolher, a cada passo, a ação que se espera maximizar uma medida de desempenho externa, dada a evidência percebida até ali e o conhecimento prévio que o agente tiver; um padrão que explicitamente não exige onisciência nem resultados bons garantidos. Esta disciplina se apoia diretamente nos algoritmos de busca já vistos em outros pontos (BFS, DFS, Dijkstra, A\*) como mecanismos existentes e, em vez disso, ataca as situações que a busca simples em grafos não resolve: adversários, restrições, conhecimento lógico e incerteza; começando pelo vocabulário do próximo conceito para classificar exatamente o que torna um ambiente de tarefa mais difícil que outro.

## Documentation Links

- [Russell & Norvig: Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html): a definição canônica, em livro-texto, de agentes, funções de agente e racionalidade, que abre a área.
- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso que cobre o mesmo framework de agentes como porta de entrada para busca, jogos, CSPs e raciocínio probabilístico.
