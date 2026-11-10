---
title: "O parlamento de meio período"
summary: O artigo que apresentou o Paxos, contado como a história de um parlamento grego cujos legisladores mantêm um registro consistente embora entrem e saiam e seus mensageiros esqueçam, e uma forma de construir sistemas distribuídos tolerantes a falhas como máquinas de estados replicadas.
researchArea: Sistemas distribuídos
keywords: paxos, consenso, replicação de máquina de estados, tolerância a falhas, quóruns, three-phase commit, votação
version: 1.0
updatedAt: 2026-11-02
---

## Resumo

Descobertas arqueológicas recentes na ilha de Paxos revelam que o parlamento funcionava apesar da propensão peripatética de seus legisladores de meio período. Os legisladores mantinham cópias consistentes do registro parlamentar, apesar de suas frequentes saídas do plenário e do esquecimento de seus mensageiros. O protocolo do parlamento de Paxos oferece uma nova forma de implementar a abordagem de máquina de estados no projeto de sistemas distribuídos.

## Visão geral

Um sistema distribuído que precisa sobreviver à falha de algumas de suas máquinas costuma usar a abordagem de máquina de estados: todo servidor roda o mesmo programa determinístico e aplica os mesmos comandos na mesma ordem, e assim todos ficam no mesmo estado. A parte difícil é fazer os servidores concordarem com essa ordem quando máquinas param e reiniciam e mensagens se perdem ou atrasam. Esse acordo é o problema do consenso.

Este artigo de Leslie Lamport, publicado no ACM Transactions on Computer Systems em 1998 depois de circular por anos como relatório técnico, apresenta o algoritmo hoje conhecido como Paxos. Ele é escrito como um relatório arqueológico fictício: os legisladores (sacerdotes) do parlamento da ilha grega de Paxos entram e saem do plenário, trocam mensagens por meio de mensageiros pouco confiáveis e escrevem em livros de registro com tinta indelével, e mesmo assim o parlamento nunca aprova dois decretos conflitantes. A história corresponde diretamente a processos, mensagens e armazenamento estável.

Vale conhecer antes: a abordagem de máquina de estados, a ideia de quórum por maioria e o modelo de falhas usado aqui, em que processos podem parar, reiniciar e esquecer tudo exceto o que gravaram em armazenamento estável, e mensagens podem se perder, se duplicar ou atrasar, mas ninguém mente.

## Contribuição

- **O protocolo Synod de decreto único.** Uma forma de um grupo de sacerdotes concordar com um decreto, baseada em votações numeradas. Uma votação tem sucesso quando todo sacerdote do seu quórum vota nela, e três condições simples sobre as votações (números únicos, quóruns que se intersectam e uma regra sobre qual decreto uma nova votação pode propor) bastam para garantir que duas votações bem-sucedidas nunca escolham decretos diferentes.
- **Um protocolo que tolera o esquecimento.** Um sacerdote só precisa lembrar, no seu livro de registro, a última votação de que participou e as promessas que fez. Mensageiros podem perder ou repetir mensagens e sacerdotes podem sair a qualquer momento sem quebrar a consistência.
- **O parlamento de múltiplos decretos.** Uma instância do protocolo Synod por número de decreto, com um único presidente que faz a primeira fase uma vez para todos os decretos futuros, de modo que cada decreto seguinte precise de só uma rodada de mensagens com uma maioria. É o que hoje se chama Multi-Paxos.
- **Detalhes práticos para um sistema real.** Preencher lacunas na sequência de decretos com decretos inofensivos, ler o estado atual de forma consistente e mudar a composição do parlamento aprovando um decreto que define os legisladores dos decretos seguintes.
- **Uma ligação com a ciência da computação.** Uma seção final explica como o parlamento implementa a abordagem de máquina de estados e o compara com trabalhos relacionados, como a viewstamped replication de Oki e Liskov.

## Metodologia

O artigo é o projeto de um protocolo com provas, e seu método é derivar o protocolo das propriedades que ele precisa manter. Ele parte do requisito de segurança (só um decreto pode ser escolhido), enuncia condições suficientes sobre o conjunto de votações (chamadas B1, B2 e B3 no artigo) e prova que qualquer conjunto de votações que as satisfaça é consistente. Em seguida refina essas condições passo a passo em um protocolo preliminar, um protocolo básico e o protocolo Synod completo, cada um implementando as condições com mensagens e anotações no livro de registro.

O progresso é tratado à parte. O artigo mostra que, se um sacerdote é escolhido como presidente e ele e uma maioria de sacerdotes ficam no plenário por tempo suficiente, sem interferência de outros presidentes, um decreto será aprovado. A escolha do presidente depende de timeouts e não faz parte do argumento de segurança. O parlamento de múltiplos decretos e as extensões para mudança de composição e leituras são construídos sobre a mesma base. O artigo apresenta argumentos de correção, mas nenhuma implementação ou medição.

## Resultados

Estes são os resultados que o artigo defende.

- **Consistência.** Se o conjunto de votações satisfaz as três condições, quaisquer duas votações bem-sucedidas têm o mesmo decreto. A prova usa o fato de que quaisquer dois quóruns têm pelo menos um sacerdote em comum, o que vale quando um quórum é qualquer maioria.
- **Segurança sob o modelo de falhas.** O protocolo Synod mantém a consistência quaisquer que sejam as mensagens perdidas ou duplicadas e sempre que sacerdotes saem, desde que cada sacerdote preserve seu livro de registro.
- **O progresso exige um líder estável.** Em geral nenhuma votação tem sucesso garantido, mas um único presidente com uma maioria de sacerdotes presente por tempo suficiente aprova um decreto.
- **Uma rodada por decreto em regime estável.** Com um presidente estável, a primeira fase é feita uma vez, e cada novo decreto precisa de uma troca de mensagens com uma maioria, que é o custo que torna prático o protocolo de múltiplos decretos.
- **A composição pode mudar por decreto.** Os legisladores de um decreto são definidos por uma lei aprovada um número fixo de decretos antes, então o protocolo pode mudar quem vota sem parar.

## Análise crítica

Este é um dos artigos mais importantes de sistemas distribuídos, e muito do funcionamento de bancos replicados e serviços de coordenação de hoje descende dele. Ainda assim, vale lê-lo com algum cuidado.

- **A alegoria dificulta a leitura.** A história é elegante depois de entendida, mas esconde o algoritmo atrás de livros de registro, sacerdotes e decretos. Lamport depois escreveu [Paxos Made Simple](/papers/paxos-made-simple) (2001) para explicar a mesma ideia de forma direta, e o [artigo do Raft](/papers/raft-understandable-consensus-algorithm) (2014) argumenta que o Paxos é difícil de aprender e de usar como base.
- **A parte de múltiplos decretos é mais esboçada do que especificada.** O protocolo de decreto único é preciso, mas a eleição do presidente, o tratamento de pedidos de clientes, a compactação do registro e a reconfiguração são descritos brevemente. Cada sistema real precisou preencher essas lacunas, e preenchimentos diferentes levam a implementações sutilmente diferentes e às vezes incorretas.
- **O progresso fica fora da garantia.** Como em qualquer protocolo de consenso assíncrono, a terminação depende de suposições de tempo e da eleição de um único líder. O artigo deixa isso claro, mas um sistema que usa Paxos ainda precisa resolver bem a eleição de líder.
- **O modelo de falhas exclui comportamento malicioso.** Sacerdotes podem esquecer e sair, mas nunca mentem, então o protocolo não tolera falhas arbitrárias (bizantinas).
- **Não há avaliação.** O artigo argumenta correção e custo em mensagens, mas não tem implementação nem medição, algo comum em artigos de protocolos desse tipo.

## Pesquisas futuras

- Apresentações mais claras e variantes totalmente especificadas, de [Paxos Made Simple](/papers/paxos-made-simple) às descrições de Multi-Paxos usadas em produção e ao Raft.
- Otimizações do protocolo, como variantes que economizam um atraso de mensagem (Fast Paxos), evitam um líder único ou usam quóruns menores ou flexíveis.
- Variantes que toleram falhas arbitrárias, o que levou ao consenso tolerante a falhas bizantinas.
- Especificação formal e verificação mecânica do Paxos e dos sistemas construídos sobre ele, por exemplo em TLA+ e com assistentes de prova.
- Questões de engenharia que o artigo deixa em aberto: eleição de líder, compactação do log, reconfiguração e leituras que mantêm a linearizabilidade sem passar pelo log.
