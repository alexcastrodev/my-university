---
title: "Paxos simplificado"
summary: A releitura do Paxos em linguagem simples feita por Lamport, que deriva passo a passo o algoritmo de consenso de decreto único a partir dos seus requisitos de segurança e depois mostra como uma sequência de instâncias dele implementa uma máquina de estados replicada.
researchArea: Sistemas distribuídos
keywords: paxos, consenso, replicação de máquina de estados, tolerância a falhas, quóruns, eleição de líder
version: 1.0
updatedAt: 2026-11-02
---

## Resumo

O algoritmo Paxos, quando apresentado em linguagem simples, é muito simples.

## Visão geral

O Paxos apareceu primeiro em [O parlamento de meio período](/papers/paxos-part-time-parliament), escrito como a história de um parlamento grego fictício. Muitos leitores acharam a alegoria difícil de acompanhar, e o algoritmo ganhou fama de complicado. Nesta nota curta, publicada no ACM SIGACT News em 2001, Leslie Lamport apresenta o mesmo algoritmo sem história e quase sem formalismo, e argumenta que ele decorre quase inevitavelmente das propriedades que um algoritmo de consenso precisa ter.

O problema é fazer um conjunto de processos escolher um único valor entre os propostos, mesmo quando processos falham e reiniciam e mensagens se perdem. Quando isso funciona, rodá-lo uma vez para cada posição de um log permite que um grupo de servidores aplique os mesmos comandos na mesma ordem, que é a abordagem de máquina de estados para sistemas tolerantes a falhas.

Vale conhecer antes: a ideia de quórum por maioria, o modelo assíncrono (sem limite para quanto uma mensagem ou um passo pode demorar) e o modelo de falhas não bizantino, em que processos podem parar e reiniciar e mensagens podem se perder ou se duplicar, mas nada é corrompido e ninguém mente.

## Contribuição

- **Um enunciado claro do problema.** Só um valor proposto pode ser escolhido, só um valor é escolhido, e um processo nunca fica sabendo que um valor foi escolhido sem que ele tenha sido de fato.
- **Três papéis.** Proponentes sugerem valores, aceitadores votam neles e aprendizes descobrem o que foi escolhido. Um processo real costuma ter os três papéis.
- **Uma derivação em vez de uma descrição.** Partindo do requisito de segurança, o artigo fortalece uma propriedade passo a passo (chamadas P1, P2, P2a, P2b e P2c) até chegar a uma que um protocolo consegue garantir diretamente com propostas numeradas.
- **O protocolo em duas fases.** Na fase 1, um proponente envia um pedido de preparação com um número n e cada aceitador promete ignorar números menores, informando a proposta de maior número que já aceitou. Na fase 2, o proponente pede aos aceitadores que aceitem um valor, que precisa ser o valor dessa maior proposta, se houver uma.
- **De um valor a uma máquina de estados.** Um líder designado roda a fase 1 uma vez para todas as posições futuras do log, então cada novo comando precisa só da fase 2. Lacunas deixadas por um líder que falhou são preenchidas com comandos que não fazem nada.

## Metodologia

A nota é uma derivação, não um experimento. Ela parte dos requisitos, observa que um único aceitador seria um ponto único de falha e passa para uma maioria de aceitadores, apoiando-se no fato de que quaisquer duas maiorias têm pelo menos um aceitador em comum. Cada passo pergunta o que um aceitador ou proponente precisa garantir para que, depois que um valor foi escolhido, toda proposta de número maior escolhida depois carregue o mesmo valor, e então transforma essa garantia em uma regra sobre mensagens.

Aprendizado, progresso e implementação são tratados como questões separadas, depois da segurança. O artigo explica como os aprendizes podem ser informados diretamente ou por um conjunto de aprendizes designados, por que o progresso exige um único proponente designado e o que cada processo precisa manter em armazenamento estável. A última seção constrói a máquina de estados replicada por cima. Não há implementação, assistente de provas nem medição; os argumentos são informais, mas precisos.

## Resultados

Estes são os pontos que o artigo estabelece.

- **A segurança decorre da promessa da fase 1.** Como um proponente só propõe o valor da proposta de maior número informada por uma maioria, e os aceitadores cumprem suas promessas, um valor escolhido nunca é substituído por outro.
- **Um aceitador precisa de pouca memória.** Ele só precisa lembrar, mesmo depois de falhas, a proposta de maior número que aceitou e o maior pedido de preparação que respondeu.
- **O progresso não é garantido em geral.** Dois proponentes podem continuar emitindo números maiores e bloquear um ao outro para sempre. Eleger um único proponente designado evita isso, e o artigo observa que o resultado FLP implica que uma eleição confiável precisa de aleatoriedade ou de tempo real, como timeouts.
- **Uma ida e volta por comando em regime estável.** Com um líder estável, a fase 1 é feita uma vez e cada comando custa uma troca de mensagens da fase 2 com uma maioria.
- **A reconfiguração pode fazer parte do log.** O conjunto de servidores pode ser ele próprio um valor da máquina de estados, usado para os comandos um número fixo de posições adiante.

## Análise crítica

A nota cumpre o que promete: o algoritmo de decreto único fica de fato curto e legível, e é a versão que a maioria das pessoas aprende primeiro. Alguns limites merecem atenção.

- **A seção de máquina de estados é breve.** Eleição de líder, interação com clientes, compactação do log e reconfiguração ganham poucos parágrafos. São justamente as partes que sistemas reais acham difíceis, e a distância entre esta nota e um sistema funcionando é grande, como trabalhos posteriores como o [Raft](/papers/raft-understandable-consensus-algorithm) apontam.
- **Os argumentos são informais.** A derivação convence, mas não é uma prova no sentido formal; para isso o leitor volta ao Parlamento de meio período ou a provas mecanizadas posteriores.
- **"Simples" depende do leitor.** A derivação de P2c é o passo que a maioria dos leitores precisa ler várias vezes, e o artigo não traz um exemplo detalhado de um cenário de falha.
- **O modelo de falhas exclui comportamento malicioso,** como no artigo original, então o algoritmo não tolera falhas arbitrárias (bizantinas).
- **Não há avaliação de custo** além da contagem de rodadas de mensagens, o que basta para o propósito da nota, mas deixa abertas as questões de desempenho.

## Pesquisas futuras

- Especificações completas e implementáveis do Multi-Paxos, incluindo eleição de líder, pedidos de clientes e snapshots.
- Variantes que reduzem a latência ou relaxam as regras de quórum, como o Fast Paxos e os quóruns flexíveis.
- Algoritmos projetados para serem compreensíveis desde o início, como o Raft, e estudos sobre como as pessoas aprendem consenso.
- Especificações formais e provas verificadas por máquina do Paxos e de suas variantes, por exemplo em TLA+.
- Versões tolerantes a falhas bizantinas das mesmas ideias.
