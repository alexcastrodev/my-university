---
version: 1.0
updatedAt: 2026-09-06
title: Ambientes de Tarefa e Tipos de Agente
summary: O framework PEAS (Performance, Environment, Actuators, Sensors) para especificar uma tarefa com precisão, as propriedades que tornam um ambiente mais difícil que outro (parcialmente observável, estocástico, sequencial, dinâmico, contínuo, com vários agentes) e a hierarquia de quatro níveis de projetos de agente (reflexo, baseado em modelo, baseado em objetivo, baseado em utilidade), em que cada nível acrescenta um mecanismo que faltava ao anterior.
---
## Objetivos de Aprendizagem

- Usar o framework PEAS (Performance, Environment, Actuators, Sensors, ou seja, medida de desempenho, ambiente, atuadores e sensores) para especificar um ambiente de tarefa com precisão suficiente para projetar um agente para ele.
- Classificar um ambiente de tarefa em cada uma das suas dimensões definidoras: totalmente vs. parcialmente observável, determinístico vs. estocástico, episódico vs. sequencial, estático vs. dinâmico, discreto vs. contínuo, um agente vs. vários agentes.
- Explicar por que cada dimensão muda que tipo de projeto de agente é sequer possível, e não só quão difícil é o problema.
- Descrever a hierarquia de quatro níveis de projetos de agente (reflexo simples, reflexo baseado em modelo, baseado em objetivo, baseado em utilidade) e que capacidade cada nível acrescenta ao anterior.
- Identificar quais propriedades de ambiente os conceitos posteriores desta disciplina (jogos, CSPs, lógica, redes bayesianas, MDPs) foram construídos especificamente para tratar.

## Contexto e Motivação

O conceito anterior definiu, em abstrato, o que são um agente e a racionalidade. Mas a racionalidade é sempre racionalidade *em relação a um ambiente de tarefa*: o mundo específico em que o agente é colocado, junto com o que ele está tentando alcançar ali. Antes que quem projeta o agente possa escolher uma abordagem (busca? lógica? probabilidade?), o próprio ambiente de tarefa precisa ser definido com precisão, porque ambientes diferentes tornam técnicas totalmente diferentes apropriadas, ou mesmo possíveis. Um agente que joga xadrez e um carro autônomo são ambos "agentes", mas nada do mecanismo de jogos e busca adversarial que esta disciplina cobre a seguir faria sentido aplicado à direção, e nada de um modelo probabilístico de sensores ajudaria em nada no xadrez.

O framework PEAS e a classificação por dimensões apresentados neste conceito dão um vocabulário compartilhado para essa análise inicial. Não é trabalho burocrático antes de o conteúdo "de verdade" começar: tanto o CS188 quanto o *Artificial Intelligence: A Modern Approach* abrem exatamente com essa classificação, porque cada técnica posterior da área é, na prática, uma resposta a uma combinação específica dessas propriedades. A busca adversarial responde "e se o ambiente contiver outro agente trabalhando contra mim?" Os CSPs respondem "e se minhas escolhas estiverem interligadas por restrições?" As redes bayesianas respondem "e se eu só observar o estado parcialmente?" Os processos de decisão de Markov respondem "e se minhas ações tiverem efeitos estocásticos e eu me importar com o futuro, e não só com o próximo passo?" Nomear corretamente as propriedades de uma tarefa é a maior parte do trabalho de escolher a ferramenta certa.

## Teoria Central

### PEAS: especificando um ambiente de tarefa

**PEAS** significa medida de desempenho (**Performance**), ambiente (**Environment**), atuadores (**Actuators**) e sensores (**Sensors**): as quatro coisas que precisam ser fixadas antes que "construa um agente para isto" seja sequer um pedido bem formulado.

```text
Exemplo: um táxi automatizado
Medida de desempenho: segurança, velocidade, legalidade, conforto do passageiro, lucro
Ambiente:             ruas, outros veículos, pedestres, clima, clientes
Atuadores:            direção, acelerador, freio, seta, buzina, painel
Sensores:             câmeras, lidar, velocímetro, GPS, sensores do motor
```

Duas pessoas que recebessem apenas "construa um carro autônomo" poderiam construir sistemas totalmente diferentes e igualmente defensáveis; o PEAS força a discordância sobre objetivos e restrições a aparecer antes de qualquer algoritmo ser escolhido.

### As dimensões que classificam um ambiente de tarefa

- **Totalmente observável vs. parcialmente observável.** Totalmente observável significa que os sensores do agente dão acesso completo ao estado relevante para sua decisão a cada instante (um tabuleiro de xadrez, visto por inteiro). Parcialmente observável significa que parte do estado relevante está oculta (um táxi não enxerga depois de uma curva cega; um jogador de cartas não vê as mãos dos outros). Só essa dimensão já determina se o agente precisa de alguma noção de crença ou probabilidade.
- **Determinístico vs. estocástico.** Determinístico significa que o próximo estado é completamente determinado pelo estado atual e pela ação do agente (em um mundo de aspirador sem outros atores). Estocástico significa que há aleatoriedade genuína ou um adversário imprevisível (dados, a estratégia oculta de um oponente, ruído de sensor). É exatamente a linha entre o minimax simples e o expectimax, vistos a seguir.
- **Episódico vs. sequencial.** Em um ambiente episódico, cada "episódio" (perceber e depois agir) é independente dos demais: classificar uma única imagem não depende de qual imagem foi classificada antes. Em um ambiente sequencial, a decisão atual pode afetar todas as decisões futuras (uma jogada de xadrez restringe todas as posições seguintes; o objetivo inteiro de um MDP é que ações têm consequências de longo prazo).
- **Estático vs. dinâmico.** Um ambiente estático não muda enquanto o agente delibera (o ambiente "espera" por você); um ambiente dinâmico pode mudar no meio da decisão (direção em tempo real, em que o mundo se move não importa quanto o agente pense).
- **Discreto vs. contínuo.** Ambientes discretos têm um conjunto contável, muitas vezes finito, de estados, percepções e ações distintos (xadrez, um CSP sobre domínios finitos); ambientes contínuos têm estados ou ações que variam suavemente (ângulo da direção, velocidade).
- **Um agente vs. vários agentes.** Ambientes de um agente contêm apenas o próprio agente agindo contra um mundo passivo (um Sudoku); ambientes com vários agentes contêm outros agentes cujos objetivos podem estar alinhados, em conflito ou ser desconhecidos (um oponente de xadrez é o caso competitivo; a busca adversarial, vista a seguir, é construída inteiramente para essa dimensão).

### A hierarquia de quatro níveis de projetos de agente

- **Agentes reflexos simples** agem apenas com base na percepção atual, por meio de regras condição-ação ("se está sujo, aspire"), sem memória do passado. Só funcionam em ambientes totalmente observáveis em que a ação correta realmente não depende de mais nada.
- **Agentes reflexos baseados em modelo** mantêm um estado interno que acompanha aspectos do mundo não visíveis no momento, atualizado conforme novas percepções chegam; o mecanismo mínimo necessário em qualquer ambiente parcialmente observável.
- **Agentes baseados em objetivo** também raciocinam sobre o futuro: dado um modelo de como as ações mudam o mundo, eles buscam ou planejam uma sequência de ações que chegue a um objetivo explícito, em vez de reagir regra a regra. É exatamente aqui que os algoritmos de busca já vistos (BFS, DFS, A\*) se encaixam como o mecanismo que um agente baseado em objetivo usa.
- **Agentes baseados em utilidade** vão um passo além de "chegar a algum estado objetivo" ao ordenar estados com uma função de utilidade, o que permite ao agente equilibrar objetivos concorrentes e parcialmente conflitantes (velocidade vs. segurança vs. combustível) e agir de forma sensata mesmo quando nenhum objetivo único e nítido captura o que "sucesso" significa. Toda técnica desta disciplina a partir do expectimax presume um agente baseado em utilidade.

### Mapeando os conceitos posteriores desta disciplina nessas dimensões

```text
Conceito (desta disciplina)         Propriedades de ambiente que ele atende
----------------------------------------------------------------------
Minimax / alfa-beta                 Vários agentes, determinístico, adversarial
Expectimax                          Vários agentes ou estocástico, nós de acaso
CSPs                                Um agente, estático, discreto, estruturado por restrições
Lógica (proposicional/FOL)          Totalmente observável, determinístico, discreto
Redes bayesianas                    Parcialmente observável, estocástico
Modelos ocultos de Markov           Parcialmente observável, sequencial, estocástico
MDPs / iteração de valor            Sequencial, estocástico, baseado em utilidade
```

Nenhuma técnica vista nesta disciplina pretende tratar todas as dimensões de uma vez; cada uma é uma especialização deliberada para um canto dessa classificação.

## Exemplos Resolvidos

### Exemplo 1: PEAS e dimensões de um agente que joga xadrez

```text
PEAS:
  Desempenho: vencer a partida, de preferência de forma rápida e decisiva
  Ambiente:   o tabuleiro e as jogadas do oponente
  Atuadores:  mover uma peça
  Sensores:   a posição atual do tabuleiro

Dimensões:
  Totalmente observável: o tabuleiro inteiro é visível aos dois jogadores o tempo todo
  Determinístico:        sem aleatoriedade; o resultado de cada jogada é totalmente determinado
  Sequencial:            cada jogada restringe e é restringida pelas jogadas futuras
  Estático (por turno):  o tabuleiro não muda enquanto um jogador pensa
  Discreto:              número finito de casas, peças e jogadas legais
  Vários agentes:        um adversário com objetivo oposto
```

Essa combinação exata (totalmente observável, determinístico, sequencial, vários agentes) é precisamente o ambiente para o qual o minimax e a poda alfa-beta (os próximos dois conceitos) são construídos. Nesse framework, o xadrez é o caso clássico de busca adversarial justamente porque não tem informação oculta nem aleatoriedade para complicar o quadro.

### Exemplo 2: PEAS e dimensões de um agente que joga pôquer

```text
PEAS:
  Desempenho: maximizar os ganhos ao longo de muitas mãos
  Ambiente:   a mesa, o baralho, as ações visíveis dos oponentes
  Atuadores:  apostar, pagar, aumentar, desistir
  Sensores:   as próprias cartas, as cartas comunitárias, as apostas dos oponentes

Dimensões:
  Parcialmente observável: as cartas fechadas dos oponentes estão ocultas
  Estocástico:             o baralho é embaralhado aleatoriamente
  Sequencial:              apostas anteriores afetam a estratégia e a informação depois
  Discreto:                número finito de cartas, apostas e ações
  Vários agentes:          competitivo, com oponentes ocultos e possivelmente enganadores
```

Compare isso diretamente com o xadrez: foi o par determinístico/totalmente observável que permitiu ao minimax simples funcionar. A observabilidade parcial e a estocasticidade do pôquer são exatamente o motivo de ele precisar do mecanismo probabilístico (raciocínio bayesiano sobre mãos ocultas) de que o xadrez simplesmente não precisa, e o motivo de "é só fazer minimax, mas para pôquer" não ser uma resposta suficiente.

### Exemplo 3: classificando um filtro de spam de e-mail

```text
PEAS:
  Desempenho: classificar corretamente e-mails como spam ou não spam
  Ambiente:   uma caixa de entrada, uma mensagem por vez
  Atuadores:  rotular como spam / não spam
  Sensores:   o texto do e-mail, o remetente, os cabeçalhos

Dimensões:
  Totalmente observável: o conteúdo completo do e-mail está disponível na hora de classificar
  Determinístico:        o mesmo e-mail sempre tem o mesmo rótulo "verdadeiro"
  Episódico:             classificar um e-mail não depende de ter classificado o anterior
  Discreto:              um vocabulário finito (ainda que enorme) e uma decisão binária
  Um agente:             nenhum adversário reagindo ao classificador em tempo real (na formulação básica)
```

Repare que isto é episódico, ao contrário do xadrez ou do pôquer: nada em classificar o e-mail de hoje depende da classificação de ontem. É exatamente a dimensão que determina se um agente precisa de algum mecanismo sequencial (busca, planejamento, MDPs) visto mais adiante nesta disciplina, ou se um procedimento de decisão mais simples, por instância, é suficiente.

## Equívocos Comuns e Armadilhas

- **"Parcialmente observável significa só 'mais difícil', não fundamentalmente diferente."** A observabilidade parcial é uma diferença qualitativa, e não apenas quantitativa: ela exige manter um estado de crença (uma distribuição de probabilidade sobre os possíveis estados reais) em vez de agir diretamente sobre o estado real, e é exatamente isso que as redes bayesianas e os HMMs, vistos mais adiante, são construídos para representar e atualizar.
- **"Estocástico e adversarial são o mesmo tipo de incerteza."** Um ambiente estocástico (como dados) tem probabilidades conhecidas e fixas sobre as quais o agente pode raciocinar com expectimax; um ambiente adversarial tem outro agente racional tentando ativamente prejudicar você, tratado com a premissa de pior caso do minimax. Tratar um adversário como se fosse uma rolagem aleatória de dados subestima sistematicamente o quanto um oponente habilidoso pode explorar um erro.
- **"Um agente baseado em objetivo é estritamente melhor que um agente reflexo."** O raciocínio baseado em objetivo (busca/planejamento) custa mais computação que uma regra reflexa; em um ambiente genuinamente simples, totalmente observável e estático, um agente reflexo bem projetado pode ser correto e dramaticamente mais barato. A hierarquia trata de capacidade, não de superioridade universal.
- **"Episódico significa só 'curto'."** Episódico se refere a se o resultado de uma decisão é independente da seguinte, e não a quanto tempo passa. Uma única deliberação muito longa sobre a classificação de uma imagem isolada continua sendo episódica; uma sequência de jogadas de xadrez muito curtas continua sendo sequencial, porque cada uma restringe a seguinte.

## Resumo

PEAS (Performance, Environment, Actuators, Sensors) é o framework para especificar um ambiente de tarefa com precisão; seis dimensões (observabilidade, determinismo, episódico/sequencial, estático/dinâmico, discreto/contínuo e um/vários agentes) classificam quão difícil e que tipo de dificuldade aquele ambiente de fato tem, e a hierarquia de quatro níveis de agentes (reflexo simples, reflexo baseado em modelo, baseado em objetivo, baseado em utilidade) aumenta o mecanismo interno do agente para acompanhar. Cada técnica que esta disciplina cobre daqui em diante é uma resposta deliberada a um ponto específico dessa classificação: busca adversarial para jogos determinísticos com vários agentes, CSPs para problemas estruturados de um agente, lógica para conhecimento totalmente observável e determinístico, redes bayesianas e HMMs para observabilidade parcial e estocasticidade, e MDPs para decisões sequenciais sob incerteza. O próximo conceito começa pelo caso determinístico, sequencial e com vários agentes (jogos adversariais), porque é o mais próximo, em espírito, dos algoritmos de busca já vistos, mudando só uma premissa: agora há outro agente racional trabalhando contra você.

## Documentation Links

- [Russell & Norvig: Artificial Intelligence: A Modern Approach](https://aima.cs.berkeley.edu/contents.html): a fonte canônica do PEAS e das dimensões de ambiente de tarefa usadas em toda a área.
- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso que usa exatamente essa classificação para motivar a sequência de técnicas (busca, jogos, CSPs, probabilidade, MDPs) que vem depois.
