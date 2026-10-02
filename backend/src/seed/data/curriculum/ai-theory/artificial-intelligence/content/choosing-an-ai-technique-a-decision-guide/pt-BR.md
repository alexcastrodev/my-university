---
version: 1.0
updatedAt: 2026-09-06
title: "Escolhendo uma Técnica de IA: Um Guia de Decisão"
summary: Um capstone que compara cada técnica coberta por esta disciplina (busca adversarial, CSPs, lógica, redes bayesianas, MDPs) pelo formato de problema a que cada uma de fato se encaixa, e um mapa honesto de onde esta disciplina para. Aprendizado por reforço e as técnicas de machine learning que estimam esses modelos a partir de dados pertencem às disciplinas seguintes, não a esta.
---
## Objetivos de Aprendizagem

- Relembrar, de uma vez, cada técnica coberta nesta disciplina e o formato específico de ambiente de tarefa (da classificação do segundo conceito) que cada uma tem como alvo.
- Aplicar a técnica certa a um problema recém-descrito identificando primeiro as propriedades do seu ambiente de tarefa, antes de partir para um algoritmo.
- Comparar diretamente, em uma única tabela, busca adversarial, CSPs, lógica, redes bayesianas e MDPs quanto ao formato específico de problema para o qual cada uma foi construída.
- Explicar, de forma explícita e honesta, o que esta disciplina NÃO cobre e quais disciplinas posteriores do módulo `ai-theory` deste currículo são responsáveis por esse material.
- Rastrear, de ponta a ponta, um único cenário realista que plausivelmente usa várias técnicas desta disciplina ao mesmo tempo, mostrando como elas se compõem em vez de competir.

## Contexto e Motivação

Esta disciplina começou definindo um agente inteligente e classificando ambientes de tarefa em seis dimensões (observabilidade, determinismo, estrutura episódica/sequencial, estático/dinâmico, discreto/contínuo, um/vários agentes) e prometeu que cada técnica seguinte seria uma resposta deliberada e bem motivada a uma combinação específica dessas propriedades. Depois de cobrir busca adversarial, satisfação de restrições, lógica e planejamento, raciocínio bayesiano e modelos ocultos de Markov, e processos de decisão de Markov, este capstone fecha o ciclo: não é um reensino de nenhuma dessas técnicas, mas um mapa explícito de quando cada uma é a ferramenta certa e, tão importante quanto, um relato honesto de onde a cobertura desta disciplina para e as próximas disciplinas do módulo `ai-theory` deste currículo assumem.

A habilidade prática mais importante que este capstone quer reforçar não é "conhecer todos os algoritmos", e sim "diagnosticar corretamente o formato de um problema novo antes de partir para qualquer algoritmo", exatamente o exercício de diagnóstico que o framework PEAS e de dimensões do segundo conceito foi introduzido para possibilitar.

## Teoria Central

### O mapa completo: técnica para formato de ambiente de tarefa

```text
Técnica                   Formato de ambiente de tarefa que ela atende
--------------------------------------------------------------------------
Minimax / alfa-beta       Vários agentes, determinístico, totalmente
                          observável, soma zero, adversarial
Expectimax                Vários agentes ou agente único com acaso genuíno
                          (probabilidades conhecidas, não um adversário
                          estratégico)
CSPs (backtracking,       Agente único, estático, discreto, estruturado por
  forward checking, AC-3) restrições explícitas entre variáveis
Lógica proposicional/de   Conhecimento totalmente observável, determinístico
  primeira ordem,         e discreto que precisa ser representado e
  resolução               consultado
Planejamento clássico     Igual à lógica, mas a pergunta é "que sequência
  (STRIPS)                de ações chega a um objetivo", e não "o que é
                          verdade agora"
Redes bayesianas          Parcialmente observável, estático (uma única fatia
                          de tempo), incerto: raciocinar sobre causas ocultas
                          a partir de efeitos observados
Modelos ocultos de Markov Parcialmente observável, sequencial, incerto: o
  (filtragem)             mesmo raciocínio das redes bayesianas, estendido
                          ao longo do tempo
MDPs (iteração de valor/  Sequencial, estocástico, baseado em utilidade: um
  de política)            agente escolhendo ações agora para otimizar uma
                          recompensa acumulada ao longo de muitos passos futuros
```

Nenhuma técnica desta lista substitui as outras de forma geral; cada uma é a resposta certa para uma combinação genuinamente diferente das dimensões de ambiente de tarefa do segundo conceito, e aplicar uma delas ao formato errado de problema (tratar um adversário genuíno como acaso aleatório, ou ignorar a observabilidade parcial e raciocinar como se o estado real fosse totalmente conhecido) produz decisões concretamente erradas, e não apenas subótimas, exatamente como demonstrado nos próprios exemplos resolvidos desta disciplina (o descasamento entre expectimax e minimax, a consequência da "bomba de dinheiro" de ignorar a teoria da decisão adequada).

### O que esta disciplina NÃO cobre, e para onde isso vai

Três limites deliberados, cada um já sinalizado no ponto relevante desta disciplina, valem ser enunciados juntos, em um só lugar, agora que o quadro inteiro está visível:

- **Aprendizado por reforço** (um agente que não conhece de antemão o modelo de transição nem a função de recompensa do MDP e precisa aprender uma política pela experiência, por tentativa e erro) é uma extensão direta do material de MDP recém-visto, mas genuinamente diferente quanto ao que é conhecido de antemão versus aprendido pela interação. Isso pertence a `ai-theory/machine-learning`, uma disciplina irmã neste mesmo módulo, ainda não escrita.
- **Abordagens baseadas em aprendizado em geral** (estimar um modelo, uma função de valor ou uma política a partir de dados, em vez de recebê-los prontos), incluindo tudo desde aprendizado estatístico simples até redes neurais profundas, são o assunto de `ai-theory/machine-learning` e `ai-theory/deep-learning`, duas disciplinas irmãs ainda vazias. Tudo nesta disciplina presumiu que o modelo relevante (regras do jogo, restrições do CSP, uma base de conhecimento, as CPTs de uma rede bayesiana, as funções de transição e de recompensa de um MDP) já estava totalmente especificado e entregue ao agente.
- **Abordagens modernas, aprendidas e em larga escala para busca, planejamento e raciocínio** (heurísticas aprendidas, jogo neural, modelos de mundo aprendidos) são extensões posteriores exatamente das técnicas clássicas vistas aqui e são tratadas, onde este currículo chega a elas, dentro de `machine-learning`/`deep-learning`, e não encaixadas retroativamente no escopo já completo desta disciplina.

### As técnicas se compõem, não são mutuamente exclusivas

Um sistema inteligente realista raramente usa apenas uma dessas técnicas isoladamente. Um único agente real pode usar inferência bayesiana para manter uma crença sobre um mundo parcialmente observado, um MDP (construído sobre essa crença) para decidir o que fazer em seguida e, se esse mundo incluir outro agente competidor, busca adversarial por cima de tudo isso. Nenhuma técnica desta disciplina foi construída para ser usada sozinha em todos os contextos; elas são mais como uma caixa de ferramentas em que ferramentas diferentes são combinadas para partes diferentes de um único problema maior, exatamente do jeito que os próprios exemplos resolvidos desta disciplina fizeram referência a algoritmos e estruturas de dados já vistos em outros pontos deste currículo, em vez de tratar a IA como um assunto isolado.

## Exemplos Resolvidos

### Exemplo 1: diagnosticando o formato do ambiente de tarefa de um problema novo antes de escolher uma técnica

```text
Problema: "Um drone autônomo precisa entregar pacotes em uma cidade com
rajadas de vento imprevisíveis (padrões estatísticos conhecidos), enquanto
também evita um pequeno número de drones de entrega de uma empresa
concorrente, que podem ajustar rotas para interceptar trajetos preferidos."

Diagnóstico:
  - Rajadas de vento: estocásticas, mas NÃO adversariais; distribuição de
    probabilidade conhecida, sem intenção estratégica → esta parte pede
    algo da família expectimax/MDP, não minimax.
  - Drones concorrentes: potencialmente adversariais (se de fato tentam
    interferir) → esta parte pode pedir um raciocínio no estilo de busca
    adversarial por cima.
  - Observabilidade parcial: se o drone não consegue perceber o tempo todo
    as posições/intenções exatas dos drones concorrentes → é preciso uma
    camada de acompanhamento de crença no estilo rede bayesiana ou HMM por
    baixo de todo o resto.

Composição recomendada: acompanhamento de crença no estilo HMM sobre as
  partes incertas do mundo (posições dos concorrentes, vento), alimentando
  um MDP (ou uma variante adversarial dele) que seleciona ações para
  maximizar a utilidade esperada; e não uma única técnica usada sozinha.
```

### Exemplo 2: um problema de CSP diagnosticado errado como busca adversarial (e por que isso seria um erro)

```text
Problema: "Alocar cada um de 30 funcionários em um de 5 turnos, respeitando
a disponibilidade declarada de cada funcionário e garantindo que nenhum
turno fique com pessoal insuficiente."

Diagnóstico errado comum: "há preferências concorrentes entre funcionários,
  então isto precisa de busca adversarial (minimax) entre os interesses deles."

Diagnóstico correto: é um problema de agente único (um único escalonador
  central faz todas as alocações), estático, discreto e definido
  inteiramente por restrições entre variáveis (a disponibilidade de cada
  funcionário, a exigência de pessoal de cada turno); o formato clássico de
  um CSP, e não um jogo adversarial. Ninguém neste problema é um adversário
  racional escolhendo jogadas especificamente para minimizar o resultado do
  escalonador; a "preferência" de cada funcionário é simplesmente uma
  restrição (ou uma preferência flexível a otimizar) sobre a única decisão
  do escalonador.

Aplicar minimax aqui faria uma busca sobre uma "árvore de jogo" que não
  corresponde a nada no problema (não há alternância adversarial genuína),
  enquanto uma formulação de CSP (variáveis = funcionários, domínios =
  turnos, restrições = disponibilidade/pessoal) se encaixa direta e
  corretamente na busca com backtracking, forward checking e consistência
  de arco, exatamente como visto antes nesta disciplina.
```

### Exemplo 3: uma tabela de comparação em escala de capstone para quatro cenários descritos

```text
Cenário                                     Técnica(s) mais adequada(s)
--------------------------------------------------------------------------
"Dois jogadores alternam jogadas, info       Minimax / poda alfa-beta
 completa, sem aleatoriedade, competitivo"
"Atribuir cores/horários/vagas sujeitos a    CSP: backtracking + forward
 um conjunto fixo de restrições entre pares" checking + consistência de arco
"Derivar o que necessariamente decorre de    Lógica proposicional/de primeira
 um conjunto fixo de fatos e regras          ordem + resolução, ou STRIPS se o
 conhecidos"                                 objetivo for uma sequência de ações
"Inferir uma causa oculta a partir de        Rede bayesiana (um único
 observações ruidosas e parciais, em um      instante) ou HMM (se isso se
 único momento"                              repete ao longo do tempo)
"Escolher ações agora para maximizar a       MDP: iteração de valor ou
 recompensa acumulada em um futuro longo e   iteração de política
 incerto, quando o modelo já é conhecido"
```

Esta tabela é um resumo deliberadamente compacto do mesmo processo de diagnóstico trabalhado nos Exemplos 1 e 2: sempre começando pelo formato real do problema (observabilidade, determinismo, adversarial ou não, sequencial ou não), nunca por "qual algoritmo eu já conheço".

## Equívocos Comuns e Armadilhas

- **"Existe um único 'algoritmo de IA' que deve ser tentado primeiro em qualquer problema novo."** Como esta disciplina inteira mostrou, a técnica certa depende inteiramente das propriedades reais do ambiente de tarefa; aplicar busca adversarial a um CSP não adversarial (Exemplo 2), ou expectimax a um oponente genuinamente adversarial, produz decisões concretamente erradas, e não apenas um caminho mais lento até a resposta certa.
- **"Machine learning é um substituto mais avançado de tudo que esta disciplina cobre."** Machine learning (coberto nas disciplinas posteriores deste módulo, ainda não escritas) é uma forma de *estimar* os modelos (probabilidades de transição, funções de recompensa, CPTs, funções de avaliação) que esta disciplina presumiu já conhecidos e entregues ao agente; ele não substitui os próprios frameworks de decisão (minimax, CSPs, inferência bayesiana, MDPs), que continuam exatamente tão relevantes quando um modelo é aprendido quanto quando é especificado à mão.
- **"As técnicas desta disciplina devem ser usadas uma de cada vez, nunca combinadas."** Como mostra o Exemplo 1, sistemas realistas empilham essas técnicas rotineiramente (acompanhamento de crença alimentando um procedimento de decisão, um procedimento de decisão se adaptando a um adversário detectado), e reconhecer quando um problema real precisa de mais de uma ferramenta desta disciplina ao mesmo tempo é parte da habilidade de diagnóstico que este capstone quer reforçar.
- **"Esta disciplina cobre tudo que importa em inteligência artificial."** Ela deliberadamente não cobre: aprendizado por reforço e toda técnica baseada em aprendizado estão explicitamente fora do escopo aqui, reservados para `machine-learning` e `deep-learning`, justamente para que esta disciplina pudesse se aprofundar no kit clássico de tomada de decisão com modelo dado, sem pular esse kit nem tentar espremer um tema fundamentalmente diferente (aprender a partir de dados) nas mesmas 80 horas.

## Resumo

As técnicas desta disciplina (busca adversarial, satisfação de restrições, lógica e planejamento, redes bayesianas e modelos ocultos de Markov, e processos de decisão de Markov) respondem, cada uma, a uma combinação distinta e precisamente caracterizada das dimensões de ambiente de tarefa apresentadas logo no início (observabilidade, determinismo, estrutura adversarial, estrutura sequencial), e diagnosticar o formato real de um problema novo, antes de partir para qualquer algoritmo específico, é a habilidade mais transferível que esta disciplina pretende deixar. Sistemas reais normalmente compõem várias dessas técnicas em vez de depender de uma só, e esta disciplina deliberadamente para antes do aprendizado por reforço e de toda técnica baseada em aprendizado para estimar um modelo a partir de dados; esse material pertence a `machine-learning` e `deep-learning`, as disciplinas irmãs que continuam o módulo `ai-theory` deste currículo exatamente do ponto em que esta termina: modelos totalmente conhecidos e entregues ao agente, versus modelos que precisam ser aprendidos.

## Documentation Links

- [UC Berkeley CS188: Introduction to Artificial Intelligence](https://inst.eecs.berkeley.edu/~cs188/sp24/): curso cuja estrutura geral (busca, jogos, CSPs, lógica, raciocínio bayesiano, MDPs e depois machine learning) o escopo e a sequência desta disciplina seguem diretamente.
- [ACM/IEEE CS2013: AI and the Intelligent Systems Knowledge Area](https://dl.acm.org/doi/abs/10.1145/2735392.2735394): fonte de diretrizes curriculares que confirma Sistemas Inteligentes como uma área de conhecimento própria e distinta dentro do currículo mais amplo de ciência da computação.
