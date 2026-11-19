---
title: "Mantendo o CALM: quando a consistência distribuída é fácil"
summary: Hellerstein e Alvaro fazem uma introdução informal ao Teorema CALM, segundo o qual um programa tem implementação distribuída consistente e livre de coordenação se e somente se é monotônico, e o usam para explicar quando a coordenação é intrínseca e quando é apenas uma escolha de implementação.
researchArea: Sistemas distribuídos
keywords: teorema CALM, monotonicidade, livre de coordenação, confluência, consistência eventual, CRDTs, Bloom, teorema CAP
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Uma preocupação central em sistemas distribuídos modernos é evitar o custo da coordenação sem abrir mão de uma semântica consistente. Até pouco tempo atrás, não havia resposta para a pergunta de quando a coordenação é de fato necessária. Neste artigo apresentamos uma introdução informal ao Teorema CALM, que responde a essa pergunta com precisão ao sair da consistência tradicional de armazenamento e passar a considerar propriedades dos programas. CALM é a sigla de "consistency as logical monotonicity" (consistência como monotonicidade lógica). O Teorema CALM mostra que os programas que têm implementações distribuídas consistentes e livres de coordenação são exatamente os programas que podem ser expressos em lógica monotônica. Esse resultado teórico tem implicações práticas para quem desenvolve aplicações distribuídas. Mostramos como o CALM oferece uma contrapartida construtiva, no nível da aplicação, para a sabedoria convencional de "sistemas", como os resultados aparentemente negativos do Teorema CAP. Também discutimos como o pensamento monotônico pode influenciar o projeto de sistemas distribuídos e como novas linguagens e ferramentas podem ajudar a escrever código consistente e livre de coordenação.

(Este é o resumo do arXiv. O PDF lido não tem resumo.)

## Visão geral

Protocolos de coordenação como o Paxos e o Two-Phase Commit fazem as máquinas concordarem sobre uma ordem de acesso ao estado compartilhado, e são caros: o artigo cita um resultado segundo o qual key-value stores multiprocessados de ponta podem gastar 90% do tempo esperando coordenação, enquanto uma versão livre de coordenação, o Anna, rodou mais de duas ordens de grandeza mais rápido. James Hamilton, da Amazon, é citado aconselhando empurrar os mecanismos de consistência para fora do caminho crítico. A pergunta do artigo é quando isso é possível, tratada como questão de computabilidade e não de engenharia: o que é intrínseco ao problema e o que é escolha de implementação.

A resposta, neste artigo da CACM (2020), é um passeio informal pelo Teorema CALM, conjecturado numa palestra do PODS 2010 e provado depois em artigos de teoria de bancos de dados. Esta nota foi escrita a partir da versão do arXiv (v2, janeiro de 2019); o texto da CACM pode diferir. O artigo conversa com a [conjectura de Brewer e sua prova](/papers/brewers-conjecture-cap-feasibility-web-services), os [CRDTs](/papers/conflict-free-replicated-data-types), o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store) e a [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects).

Vale conhecer antes: consultas monotônicas e não monotônicas (acrescentar entrada alguma vez retira uma saída?) e a diferença entre consistência de memória (o que as leituras devolvem) e de programa (o que ele produz como saída).

## Contribuição

- **Consistência de programa como confluência.** Uma operação é confluente se produz o mesmo conjunto de saídas para qualquer ordem e agrupamento das entradas, ou seja, é uma função determinística de conjuntos em conjuntos. Operações confluentes se compõem, então partes confluentes formam um programa confluente.
- **Definição 1.** Um programa P é monotônico se, para quaisquer conjuntos de entrada S e T com S contido em T, P(S) está contido em P(T).
- **Teorema 1 (CALM).** Um programa tem implementação distribuída consistente e livre de coordenação se e somente se é monotônico. Programas não monotônicos "mudam de ideia", logo dependem da ordem e precisam esperar que toda a informação chegue.
- **Uma contrapartida positiva ao CAP.** A Observação 1 diz que ausência de coordenação equivale a disponibilidade sob partição, então programas monotônicos podem ter consistência, disponibilidade e tolerância a partições ao mesmo tempo.
- **Orientação de projeto.** Exemplos e padrões (carrinhos, tombstones, dados imutáveis, CRDTs, Bloom) e uma lista de questões em aberto.

## Metodologia

Não há experimentos. O argumento corre por exemplos e um esboço de prova. A detecção distribuída de deadlock (um ciclo é evidência de existência, então a saída só cresce) é contraposta à coleta de lixo distribuída (inalcançável é a inexistência de um caminho, então a máquina precisa ouvir todas as outras). O esboço segue Ameloot, Neven e Van den Bussche: cada máquina é um transdutor relacional com um laço de eventos de Ingest, Query e Send. Monotônico significa que toda consulta é sintaticamente monótona (seleção, projeção, interseção, junção, fecho transitivo; diferença de conjuntos e quantificação universal não são). Os autores remetem a quem quiser a prova formal aos artigos citados.

## Resultados

São afirmações do artigo, não medições.

- **A direção "se"** é fácil: uma rede de transdutores monotônicos acaba ingerindo e enviando um conjunto determinístico de mensagens e produzindo uma saída determinística.
- **A direção "somente se"** é mais difícil. Um programa "contém coordenação" se precisa de mensagens em todos os particionamentos dos dados iniciais, inclusive naquele que põe tudo numa única máquina. Mensagens que só movem dependências de dados não contam. Mostra-se que operações não monotônicas exigem essas mensagens.
- **Membership.** Os programas monotônicos são exatamente os que não precisam conhecer a composição da rede (a relação All); há ligação parecida com a máquina saber o próprio endereço.
- **Carrinho de compras.** Seguindo o Dynamo como o artigo o descreve, o carrinho são dois conjuntos que só crescem, adições e remoções, que comutam, então as réplicas não precisam de coordenação. O checkout não comuta com elas, e portanto precisa de coordenação. Trabalho posterior dos autores torna o checkout monotônico com um manifesto dos IDs de atualização anteriores.
- **Coordenação no seu lugar.** Mantê-la fora do caminho crítico (checkout, coleta de lixo em segundo plano, recuperação preguiçosa de tombstones) ou compensar, como o e-mail de desculpas com cupom quando o estoque some depois de um decremento.
- **Questões em aberto** (não são resultados): expressividade (Immerman-Vardi e PTIME com relação de sucessor), síntese de programas monotônicos, análise de código não monotônico "consertado" e um CALM estocástico que cobriria a convergência tipo Hogwild!.

## Análise crítica

Os próprios autores declaram os limites: o CALM "fica aquém de ser um resultado construtivo". Ele não diz como achar uma especificação monotônica, e a teoria não orienta como extrair uma de uma implementação. O texto é uma introdução informal, e a prova é um esboço do argumento de outro grupo. A definição de consistência deles também não promete nada sobre recência ou ordem, o que o artigo diz ser justamente o ponto.

Os pontos a seguir são leitura do artigo, não afirmações dos autores.

- **Noção forte de "livre de coordenação".** Significa nenhuma mensagem além do movimento de dados em qualquer particionamento, então "precisa de coordenação" é uma afirmação sobre o programa, não sobre um protocolo barato que um sistema poderia usar.
- **Confluência não é o que o usuário vê.** Ela permite anomalias de armazenamento por construção, então uma aplicação confluente ainda pode mostrar dados defasados no meio da execução.
- **O número de 90% e duas ordens de grandeza é autocitado.** Vem do Anna (Wu, Faleiro, Lin, Hellerstein), sistema do primeiro autor, e o artigo não o avalia.
- **O detalhe do Dynamo é de segunda mão.** A descrição do carrinho é o resumo dos autores sobre o artigo do Dynamo, não uma rederivação.
- **Literatura posterior, só resumos (não li os artigos).** "Keep CALM and CRDT On" (Laddad et al., arXiv 2022) estende CRDTs com um modelo de consultas que usa monotonicidade para decidir quais leituras dispensam coordenação. "New Directions in Cloud Programming" (Cheung, Crooks, Hellerstein, Milano, CIDR 2021 segundo o arXiv) propõe separar a semântica do programa das escolhas de disponibilidade e consistência.

## Pesquisas futuras

- Quais invariantes de aplicações reais têm especificação monotônica, e com que frequência uma coordenação como a do checkout é inevitável?
- Ferramentas que verifiquem programas "consertados", em que se acrescentou coordenação a código não monotônico, como o artigo pede.
- Compensação e coordenação como uma só ideia semântica, que o artigo sugere chamar de acordo não determinístico eventual.
- Comparar o [projeto baseado em entidades de Helland](/papers/life-beyond-distributed-transactions-an-apostates-opinion), que este artigo não cita mas que também leva o acordo para o fluxo de negócio, com a compensação por desculpas descrita no CALM.
