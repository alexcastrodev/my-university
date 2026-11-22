---
title: "Orquestração de pipelines de ML orientada a eventos para a manufatura: uma experiência de mercado na AWS"
summary: Um relato de três anos operando o treinamento contínuo de ML para fábricas automotivas na AWS, construído com filas SQS e dead-letter queues, um dispatcher em Lambda que limita as tarefas de GPU simultâneas e tarefas que drenam as mensagens excedentes. Traz uma taxa reportada de 2% de mensagens na dead-letter queue, uma rotina de limpeza que reenvia falhas transitórias e uma simulação do dispatcher.
researchArea: Sistemas distribuídos
keywords: arquitetura orientada a eventos, dead-letter queue, controle de admissão, SQS, escalonamento de GPU, MLOps, infraestrutura como código, relato de experiência
version: 1.0
updatedAt: 2026-11-22
---

## Visão geral

É um relato de experiência de mercado, aceito na IEEE International Conference on Cloud Engineering (IC2E 2026), sobre a operação da infraestrutura que retreina modelos de aprendizado de máquina para fábricas automotivas. Cada produto em cada linha da fábrica tem dois modelos: um modelo físico do processo e uma política de controle por aprendizado por reforço treinada contra ele, retreinados em cadeia estrita quando as condições de produção mudam. O sistema roda desde 2023 e executou mais de 40.000 jobs. O trabalho foi financiado pela Liveline Technologies, cujos modelos proprietários o sistema treina.

A tese dos autores é que essa carga é um trabalho em lote orientado a eventos: os jobs chegam em rajadas (30 a 50 requisições por fábrica por semana), levam horas de GPU cara e depois não acontece nada por dias. Eles argumentam que ela combina mais com filas, um dispatcher serverless e computação em contêineres do que com um cluster sempre ligado ou uma plataforma gerenciada de ML. Li a versão dos autores publicada no arXiv. O artigo trata do projeto e da operação da infraestrutura, não dos modelos.

## Contribuição

- **Um dispatcher com controle de admissão.** Uma fila SQS dispara uma função Lambda que conta as tarefas de GPU em execução no ECS. Se há capacidade (um limite de 2 em produção, ligado ao máximo do grupo de autoescalonamento por uma única variável do Terraform), ela inicia uma tarefa, e senão encaminha a mensagem para uma fila de tarefas. A Lambda tem concorrência reservada de 1, de modo que as decisões de admissão são serializadas.
- **Drenagem da fila.** Uma tarefa de GPU em execução faz primeiro o seu item de trabalho, depois consulta a fila de tarefas com long polling e processa as mensagens excedentes até ver 3 consultas vazias (60 segundos de silêncio). Um número limitado de instâncias de GPU dá conta, assim, de um fluxo ilimitado de requisições sem iniciar uma nova instância por job.
- **Filas e dead-letter queues.** 8 filas SQS, cada uma com sua própria DLQ, no máximo 5 recebimentos antes de a mensagem ir para a DLQ, criptografia no servidor e retenção de 7 dias. Os tempos de visibilidade são definidos em pelo menos 1,5 vez a duração máxima do job (12 horas nas filas de treino).
- **Limpeza ativa da DLQ.** Funções Lambda disparadas por um alarme do CloudWatch sobre o número de mensagens visíveis em uma DLQ registram cada mensagem, classificam a falha pelos atributos da mensagem (qualidade de dados, capacidade, timeout), reenviam as falhas transitórias para a fila de origem e geram um alerta estruturado para uma pessoa nas persistentes.
- **Uma simulação e uma comparação de arquiteturas.** Um simulador de eventos discretos, liberado como código aberto, e uma comparação qualitativa com SageMaker Pipelines, Step Functions, Airflow e Kubernetes.

## Metodologia

Os números de produção vêm do CloudWatch Container Insights e do Cost Explorer filtrado por uma tag de aplicação, e por isso são autorrelatados pelo operador. O simulador reproduz uma carga de 52 semanas com 2.077 requisições (rajadas semanais de cerca de 40, gaussianas com sigma 10, cada uma usando de 0,5 a 1,5 hora de GPU) contra três estratégias com limite de 2 GPUs: despacho ingênuo (tentar 5 vezes com backoff exponencial e depois descartar a mensagem, sem DLQ), um estado Map do Step Functions e o padrão dos autores. Usa preços de us-east-1 de 2024 a 2026 e uma semente aleatória fixa.

## Resultados

- **Custo.** O texto diz que uma linha de base sempre ligada custa cerca de US$ 3.200 por mês por fábrica. A abordagem orientada a eventos com GPUs sob demanda custa cerca de US$ 910 (72% menos), e com instâncias Spot para o modelo físico, que aceita checkpoint, cerca de US$ 760 (76% menos). O resumo dá de 72% a 78%. O treino de aprendizado por reforço fica sob demanda porque um episódio não pode receber checkpoint. O treino em GPU é 96% do custo mensal.
- **O controle de admissão é necessário.** Na simulação o despacho ingênuo perde 1.342 de 2.077 jobs (65%), porque as falhas de alocação esgotam o orçamento de retentativas durante as rajadas. O Step Functions e o padrão dos autores não perdem nenhum. As latências medianas ficam a menos de 0,7 hora uma da outra (11,8 e 12,5 horas). Os autores atribuem à drenagem, sem partida por job, os 94% de utilização de GPU nas rajadas, contra um cluster sempre ligado com cerca de 50% no pico e menos de 15% na base.
- **Dead letters.** Cerca de 2% das mensagens chegaram a uma DLQ em três anos. Por causa raiz, 65% foram qualidade de dados na origem, 18% falta de memória da GPU, 12% falta transitória de capacidade do EC2 e 5% casos de tempo de visibilidade. Os autores dizem que as mensagens nunca se perdem porque a DLQ as guarda por 7 dias, e que a rotina de limpeza reduziu o tempo médio de resolução em 60% em relação ao monitoramento passivo.
- **Lições.** Um tempo de visibilidade curto demais causou execução duplicada que desperdiçou cerca de US$ 2.000 de computação de GPU no primeiro ano. Sem a concorrência reservada de 1, quatro tarefas de GPU chegaram a ser lançadas em um cluster que comportava duas, dando duas falhas de alocação. As mensagens da DLQ foram chamadas de os dados operacionais de maior sinal.

## Análise crítica

O artigo é aberto quanto aos seus limites: uma organização em uma nuvem, escala pequena (limite de 2 workers, comportamento com centenas de tarefas não verificado), custos vindos dos painéis do próprio operador e um simulador que deixa de fora jitter de rede, limites de taxa de API e falhas de zona.

Os pontos abaixo são uma leitura minha do artigo, não afirmações dele.

- **O custo principal não bate com os preços declarados.** A US$ 1,21 por hora, uma instância ligada o mês inteiro custa cerca de US$ 870, não US$ 3.200. O texto nomeia uma instância g4dn.4xlarge como linha de base sempre ligada e não diz o que mais entra nos US$ 3.200 (várias instâncias, outros serviços). As porcentagens dependem desse número, então ele deve ser conferido antes de ser reutilizado.
- **A linha de base ingênua é fraca por construção.** Ela descarta a mensagem após 5 tentativas falhas e não tem fila. Os 65% de perda descrevem um projeto que ninguém rodaria, e a comparação que importa é com o Step Functions, em que o resultado é empate em perda e latência, com diferença no custo de partida.
- **Os números de dead letter não trazem os métodos.** A queda de 60% no tempo de resolução não tem definição da linha de base, nem tamanho de amostra, e não é coberta pela seção de ameaças. Como a mensagem recebe o atributo que separa qualidade de dados, capacidade e timeout, e com que frequência ele erra, não é descrito. A legenda da figura 9 diz que os casos de falta de memória de GPU e de capacidade "se resolvem sozinhos pela retentativa do SQS", mas uma mensagem na DLQ já falhou em cinco recebimentos, então a resolução ali deve ser o reenvio ou um ajuste de configuração, que o texto menciona para o caso de memória.
- **Transitória versus persistente é uma regra, não um teste.** A limpeza reenvia o que classifica como transitório. O artigo não relata com que frequência uma mensagem reenviada falhou de novo, nem se existe um limite de reenvios, que é o risco que [Falhas metaestáveis no mundo real](/papers/metastable-failures-in-the-wild) descreve para a retentativa cega.
- **Um raro relato medido do uso de DLQ.** A revisão de microsserviços [Microsserviços resilientes](/papers/resilient-microservices-systematic-review-recovery-patterns) alerta para o "purgatório da DLQ" e aconselha uma política de reprocessamento e um SLA para a fila. Este artigo é um caso que mostra uma, embora com resultados autorrelatados.

## Pesquisas futuras

- Refazer a comparação de custo com a linha de base definida (número de instâncias, horas, serviços incluídos) e com dados de cobrança independentes.
- Medir o laço de reenvio: a fatia de mensagens reenviadas que falham de novo, o tempo até a segunda falha e o efeito de um limite de reenvios.
- Testar o dispatcher com centenas de tarefas de GPU simultâneas, em que uma Lambda serializada passa a ser gargalo.
- Comparar com o Step Functions Distributed Map e com escalonadores gerenciados que não existiam na simulação.
