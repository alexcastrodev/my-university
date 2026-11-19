---
title: "Paxos na prática: uma perspectiva de engenharia"
summary: Chandra, Griesemer e Redstone relatam o que foi preciso para transformar o Paxos no log replicado por baixo do Chubby, do Google, cobrindo corrupção de disco, leases do master, mudança de membros, snapshots, uma estratégia de testes baseada em falhas aleatórias injetadas e as surpresas que apareceram em produção.
researchArea: Sistemas distribuídos
keywords: paxos, multi-paxos, log replicado, chubby, snapshots, mudança de membros, testes com injeção de falhas
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Descrevemos nossa experiência construindo um banco de dados tolerante a falhas com o algoritmo de consenso Paxos. Apesar da literatura existente na área, construir esse banco de dados se mostrou uma tarefa nada trivial. Descrevemos problemas selecionados, algorítmicos e de engenharia, que encontramos, e as soluções que achamos para eles. Nossas medições indicam que construímos um sistema competitivo.

## Visão geral

[Paxos simplificado](/papers/paxos-made-simple) e [O parlamento de meio período](/papers/paxos-part-time-parliament) descrevem o algoritmo em mais ou menos uma página. Este artigo, publicado no PODC 2007 por três engenheiros do Google, descreve o outro lado do caminho: a troca do banco de dados replicado comercial ("3DB") que ficava sob o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems), o serviço de locks do Google, por um log tolerante a falhas construído sobre o Paxos. Os autores dizem que o algoritmo cabe em uma página de pseudocódigo, enquanto a implementação tem vários milhares de linhas de C++.

O cenário é a [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial): um log replicado alimenta um banco de dados local em cada réplica, e o Chubby fica por cima. As células do Chubby têm cinco réplicas, uma delas é o master, e sistemas como o [Google File System](/papers/google-file-system) e o Bigtable dependem dele.

Vale conhecer antes: o Paxos de decreto único, o Multi-Paxos (um coordenador estável, chamado de master, pula a fase de propose nas instâncias seguintes) e a ideia de log mais snapshot como a forma persistente de uma estrutura de dados replicada.

## Contribuição

- **Uma lista de lacunas entre o Paxos e um sistema real.** O artigo não propõe um novo algoritmo de consenso. Ele documenta mecanismos que os autores precisaram acrescentar, alguns vindos da literatura e outros não.
- **Tratamento de corrupção de disco.** Uma réplica que perde o disco poderia voltar atrás em promessas antigas, então a corrupção é detectada (checksums, mais um marcador deixado no GFS) e a réplica é reconstruída como membro sem voto.
- **Leases do master e números de época.** Os leases deixam o master atender leituras localmente, e um número de época global permite ao Chubby abortar requisições quando a posição de master foi perdida ou retomada.
- **Snapshots com um snapshot handle.** A aplicação tira o snapshot, o framework trunca o log e o handle amarra os dois.
- **MultiOp.** Uma primitiva atômica (um guard, uma lista de operações se verdadeiro, outra se falso) que implementa todas as operações do banco, exceto a iteração.
- **Prática de engenharia.** O algoritmo central é escrito em uma linguagem de especificação de máquinas de estados compilada para C++, com verificações de consistência em tempo de execução e testes de falha aleatórios e repetíveis.

## Metodologia

O artigo é um relato de experiência, não um estudo controlado. Ele descreve a arquitetura (log do Paxos, banco replicado, Chubby) e depois percorre os problemas em três grupos: lacunas algorítmicas, engenharia de software e falhas inesperadas em produção. A evidência vem da implementação dos próprios autores, incluindo três incidentes de inconsistência no banco e uma lista de falhas em produção ao longo de "bem mais de 100 anos-máquina de execução".

A única avaliação quantitativa compara um Chubby baseado em Paxos com um Chubby idêntico sobre o 3DB, ambos nos mesmos cinco servidores da classe Pentium, com clientes em estações de trabalho. Cada worker cria um arquivo repetidamente e espera a resposta. Os testes são deliberadamente pesados em escrita, já que as leituras são atendidas no master e não exercitam o Paxos.

## Resultados

O que o artigo afirma sobre os temas que mais importam:

- **Falhas de disco.** Um disco corrompido ou apagado pode quebrar a premissa de promessas do Paxos. Uma réplica nova deixa um marcador no GFS, então um disco vazio com marcador é reconhecido como corrupção. A réplica volta como membro sem voto e espera até observar uma instância completa do Paxos iniciada depois que começou a se reconstruir. Os autores notam que isso poderia permitir dispensar o flush imediato em disco, mas não implementaram. Arquivos que voltam a um estado antigo não são pegos pelos checksums por arquivo (o checksum distribuído descrito mais adiante pode pegá-los).
- **Snapshots.** Sem eles o log cresce sem limite e o tempo de recuperação também. Os snapshots não são sincronizados entre réplicas, e cada réplica decide quando tirar o seu. Tirar um snapshot tem três passos (pedir um handle, tirar o snapshot, avisar o framework), e o log só é truncado depois do aviso, de modo que um snapshot que falhou pode ser descartado. Uma réplica atrasada que não encontra entradas antigas do log é mandada buscar um snapshot em outra réplica, e pode precisar de um mais novo se o provedor já tiver avançado.
- **Mudança de membros.** O artigo diz que é simples no Paxos básico, mas sutil com Multi-Paxos e corrupção de disco, que a literatura não traz uma prova para isso, e que os detalhes estão "além do escopo deste artigo". Tarde no desenvolvimento, uma regra pela qual uma réplica que saía do grupo nunca mais voltava foi trocada por um modelo de dois estados (dentro ou fora), porque as falhas intermitentes eram mais comuns que o esperado. A mudança levou cerca de uma hora, e três dias para ajustar os testes.
- **Leases do master.** Os masters mantêm leases por vários dias seguidos. O master usa um timeout de lease menor que o das réplicas para se proteger contra deriva de relógio. Ele roda periodicamente uma rodada completa do Paxos para aumentar seu número de sequência, o que impede que um master antigo com número maior desloque o novo; em um sistema carregado, menos de um por cento das instâncias rodam o algoritmo completo.
- **Testes.** Dois testes aleatórios rodam em modo de segurança (só consistência) e depois em modo de vivacidade (progresso exigido depois que as falhas param). O teste do log é repetível porque usa a semente de um gerador de números aleatórios e roda em uma única thread, o que funciona porque o log não cria threads. Ele achou erros de protocolo na mudança de membros e no tratamento de corrupção de disco, e alguns bugs levaram semanas de execução simulada com taxas de falha extremas em uma frota de centenas de máquinas. O segundo teste injeta quedas, desconexões e perda falsa de master, e achou cinco bugs do Chubby em duas semanas. Uma célula de cinco réplicas com o nome de uma réplica digitado errado rodou como se estivesse saudável, mas tolerava uma falha em vez de duas.
- **Surpresas em produção.** Um rollback usou um snapshot antigo e perdeu 15 horas de dados; uma falha de upgrade posterior perdeu cerca de 30 minutos. Um flush no Linux 2.4 podia travar por segundos depois da escrita de um snapshot, então arquivos grandes são escritos em pedaços pequenos. Os checksums entre réplicas pegaram três inconsistências no banco.
- **Desempenho.** Com um worker: 91 contra 75 ops/s (1,2x). Com 10 workers: 490 contra 134 (3,7x). Com 20 workers: 640 contra 178 (3,6x). Com arquivos de 8 KB: 345 contra 172 KB/s (2x) para um worker e 777 a 949 contra 217 KB/s para quatro. O sistema com Paxos guardava um banco de 100 MB, o 3DB um banco pequeno, e os snapshots saíam a cada cerca de 100 segundos nos dois últimos testes.

## Análise crítica

- **Honesto sobre os limites.** Os autores admitem que o sistema final "será baseado em um protocolo não comprovado" e que precisaram preencher lacunas da literatura, então a correção se apoia em testes, revisão e verificações em tempo de execução, não em prova.
- **Raso na parte mais difícil.** A mudança de membros é declarada sutil e depois omitida, então o leitor não consegue reproduzi-la a partir deste artigo.
- **O benchmark é limitado.** É uma única comparação contra um produto, pesada em escrita, com os dois bancos em tamanhos diferentes. Os próprios autores dizem que ele subestima o banco e que o sistema não está otimizado.
- **Leases e leituras.** O artigo explica por que um master com lease pode ler localmente e como a deriva de relógio é tratada por um timeout menor no master. Ele não usa a palavra linearizabilidade; para a propriedade formal por trás disso, veja [Linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects). Também não menciona o FLP, embora seu modo de vivacidade, que exige que as falhas parem antes de checar o progresso, combine com o que o [FLP](/papers/flp-impossibility-of-distributed-consensus) implica para consenso assíncrono.
- **Literatura posterior, fora deste artigo.** O [Raft](/papers/raft-understandable-consensus-algorithm) depois especificou eleição de líder, replicação de log, snapshots e mudança de membros juntos em um único algoritmo, o que ataca a lacuna de que este artigo reclama. Especificações formais do Multi-Paxos e provas verificadas por máquina também vieram depois.

## Pesquisas futuras

- Protocolos completos e provados de Multi-Paxos com mudança de membros, corrupção de disco e snapshots (a lacuna que os autores apontam).
- Leases de réplica para que qualquer réplica atenda leituras localmente, algo que os autores examinaram mas não implementaram.
- Ferramentas para construir sistemas tolerantes a falhas, comparáveis aos geradores de parsers dos compiladores.
- Testes sistemáticos de falhas e erros de configuração mascarados, para os quais os autores dizem não ter solução sistemática.
- Escritas sem sync imediato em disco quando as falhas são independentes, dado o tratamento de corrupção acima.
