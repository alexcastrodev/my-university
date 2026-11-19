---
title: "O Google File System"
summary: Ghemawat, Gobioff e Leung descrevem o GFS, o sistema de arquivos escalável do Google para arquivos enormes e quase só de append em hardware comum, construído com um master único para metadados, chunkservers para os dados, consistência relaxada e falha tratada como regra.
researchArea: Sistemas distribuídos
keywords: sistema de arquivos distribuído, chunkservers, master único, record append, consistência relaxada, tolerância a falhas, replicação, leases
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Projetamos e implementamos o Google File System, um sistema de arquivos distribuído escalável para grandes aplicações distribuídas que consomem muitos dados. Ele oferece tolerância a falhas rodando em hardware comum e barato, e entrega alto desempenho agregado a um grande número de clientes. Embora compartilhe muitos objetivos com sistemas de arquivos distribuídos anteriores, nosso projeto foi guiado por observações das nossas cargas de trabalho e do ambiente tecnológico, atuais e previstas, que refletem uma ruptura clara com algumas suposições antigas sobre sistemas de arquivos. Isso nos levou a reexaminar escolhas tradicionais e explorar pontos de projeto radicalmente diferentes. O sistema de arquivos atendeu bem às nossas necessidades de armazenamento. Ele é amplamente usado no Google como plataforma de armazenamento para a geração e o processamento dos dados usados pelo nosso serviço, além de esforços de pesquisa e desenvolvimento que exigem grandes conjuntos de dados. O maior cluster até hoje oferece centenas de terabytes de armazenamento em milhares de discos, em mais de mil máquinas, e é acessado simultaneamente por centenas de clientes. Neste artigo apresentamos extensões da interface do sistema de arquivos pensadas para aplicações distribuídas, discutimos vários aspectos do projeto e relatamos medições de micro-benchmarks e de uso no mundo real.

## Visão geral

Em 2003 o Google guardava os dados por trás dos seus serviços web em clusters de máquinas Linux baratas, onde discos, memória, redes e fontes de energia falhavam o tempo todo. Os autores argumentam que as suposições clássicas de sistemas de arquivos (arquivos pequenos, escritas aleatórias, semântica POSIX, consistência forte) não serviam a esse cenário, e decidiram projetar o sistema de arquivos e as aplicações em conjunto. O resultado virou o sistema com o qual projetos de armazenamento posteriores costumam ser comparados.

O artigo é um relato de engenharia de um sistema em produção. Ele não usa a palavra Paxos e não roda um protocolo de consenso entre seus servidores: um master guarda todos os metadados, e as réplicas de um chunk são mantidas em ordem por uma réplica primária que detém um lease. Os outros sistemas do Google deste catálogo ficam ao redor dele. O [serviço de locks Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) é descrito no próprio artigo como o lugar onde GFS e Bigtable elegem seus masters, e o [Spanner](/papers/spanner-globally-distributed-database) coloca seus tablets no Colossus, que seus autores chamam de sucessor do GFS.

Vale conhecer antes: a interface comum de sistema de arquivos (criar, ler, escrever, acrescentar), a replicação para tolerar falhas e a ideia de lease (uma promessa de agir como líder que expira). Compare a replicação daqui com a abordagem por consenso de [Paxos simplificado](/papers/paxos-made-simple), com a [abordagem de máquina de estados](/papers/state-machine-approach-fault-tolerant-services-tutorial) e com o modelo estrito de [linearizabilidade](/papers/linearizability-correctness-condition-concurrent-objects).

## Contribuição

- **Quatro observações de carga como insumo de projeto.** Falhas de componentes são a regra, os arquivos são enormes (vários GB é comum), a maioria é modificada por append e não por sobrescrita, e projetar aplicações e API do sistema de arquivos juntos dá mais flexibilidade.
- **Arquitetura com um master.** Um cluster tem um único master e muitos chunkservers. Os arquivos são divididos em chunks de 64 MB de tamanho fixo, cada um com um chunk handle de 64 bits e três réplicas por padrão. O master guarda o namespace, o mapeamento arquivo-chunk e as localizações dos chunks; os clientes perguntam a ele onde estão os dados e depois falam direto com os chunkservers.
- **Metadados em memória com log replicado.** O namespace e o mapeamento arquivo-chunk vão para um log de operações replicado em máquinas remotas, com checkpoints. As localizações dos chunks não são persistidas: o master as descobre consultando os chunkservers.
- **Um modelo de consistência relaxado.** Depois de uma mutação, as regiões são consistentes, definidas ou nenhuma das duas, e as aplicações se adaptam com appends, checkpoints e registros que se autovalidam e se autoidentificam.
- **Record append.** O cliente informa só os dados, e o GFS os acrescenta atomicamente pelo menos uma vez, num offset que ele escolhe, de modo que centenas de produtores escrevem num mesmo arquivo sem um gerenciador de locks distribuído.
- **Leases, fluxo de dados em pipeline e snapshots baratos.** Uma réplica primária ordena as mutações sob um lease do master, os dados são empurrados por uma cadeia de chunkservers separada das mensagens de controle, e os snapshots usam copy-on-write.

## Metodologia

O artigo combina descrição de projeto e medições. As seções 2 a 5 explicam a interface, a arquitetura e os mecanismos de mutação, a operação do master (locking do namespace, posicionamento de réplicas, re-replicação, rebalanceamento, coleta de lixo preguiçosa, detecção de réplicas obsoletas) e a tolerância a falhas (recuperação rápida, replicação de chunks e do master, shadow masters, checksums, logs de diagnóstico).

A seção 6 traz micro-benchmarks num cluster com um master, duas réplicas do master, 16 chunkservers e 16 clientes, cada máquina com dois processadores Pentium III de 1,4 GHz, 2 GB de memória e um link Ethernet de 100 Mbps, depois números de dois clusters de produção (A, de pesquisa e desenvolvimento, e B, de processamento de dados de produção). Também analisa outros dois clusters (X e Y) a partir de logs de RPC reconstruídos por heurística. A seção 7 lista experiências operacionais, e a seção 8 compara o GFS com AFS, xFS, Swift, Frangipani, GPFS, Lustre, NASD e River.

## Resultados

- **Leituras.** Um cliente lê a 10 MB/s, 80% do limite de 12,5 MB/s do seu link. Com 16 leitores o agregado é de 94 MB/s, cerca de 75% do limite de 125 MB/s.
- **Escritas.** Um cliente escreve a 6,3 MB/s, cerca de metade do limite. O agregado chega a 35 MB/s com 16 clientes (2,2 MB/s cada), contra um limite de 67 MB/s. Os autores culpam a interação da pilha de rede com o esquema de pipeline.
- **Record appends.** Começam em 6,0 MB/s para um cliente e caem para 4,8 MB/s com 16 clientes, limitados pelos chunkservers que guardam o último chunk.
- **Clusters de produção.** O cluster A tem 342 chunkservers, 72 TB de disco dos quais 55 TB usados, e cerca de 48 MB de metadados no master. O cluster B tem 227 chunkservers, 180 TB e 155 TB, com 60 MB no master. O cluster A sustentou uma taxa de leitura de 580 MB/s por uma semana, e o master recebia de 200 a 500 operações por segundo, portanto não era gargalo ali.
- **Recuperação.** Matar um chunkserver com cerca de 15.000 chunks e 600 GB restaurou todos os chunks em 23,2 minutos (440 MB/s). Matar dois chunkservers deixou 266 chunks com uma réplica só, todos de volta a pelo menos duas réplicas em 2 minutos.
- **Carga de trabalho.** Sobrescritas ficaram abaixo de 0,0001% dos bytes mutados no cluster X e em 0,05% no Y, na maior parte por retentativas de clientes. A razão entre escritas e record appends foi 108:1 em bytes no X e 3,7:1 no Y.
- **Surpresas operacionais.** Discos IDE que declaravam a versão do protocolo errada corromperam dados em silêncio, o que motivou os checksums. O custo do fsync() no Linux 2.2 e um único lock do mmap levaram a contornos como trocar mmap() por pread().

## Análise crítica

O artigo é franco sobre o contexto: "o Google controla por completo tanto o GFS quanto suas aplicações", então o projeto é ajustado a uma carga só e os autores avisam para não generalizar. Alguns limites merecem atenção.

- **A consistência é fraca de propósito.** Escritas concorrentes deixam regiões "consistentes mas indefinidas", o record append pode duplicar registros, e as réplicas não precisam ser idênticas byte a byte. Isso joga trabalho (checksums, ids únicos de registro, checkpoints) para cada aplicação.
- **O master único é um trade-off declarado.** Os autores escolhem simplicidade e conhecimento global para posicionar réplicas, e tiram o master do caminho dos dados com chunks grandes, localizações em cache e leases. As medições mostram que ele não era gargalo com 200 a 500 operações por segundo, e uma versão anterior tinha sido gargalo em varreduras de diretórios grandes.
- **O failover não é automático dentro do GFS.** Um master que falha é reiniciado por uma infraestrutura de monitoramento externa ao GFS, e os shadow masters dão só leitura com metadados um pouco defasados. O artigo sugere adaptar um esquema primary-copy como o do Harp para ter garantias mais fortes, mas não o faz.
- **Avaliação limitada.** Os micro-benchmarks usam um cluster pequeno de 16 máquinas com links de 100 Mbps, e os números de carga vêm de logs reconstruídos.

O que a pesquisa posterior acrescentou (isto não está no PDF). Na entrevista "GFS: Evolution on Fast-Forward" da ACM Queue (McKusick e Quinlan, 2009, republicada na CACM em 2010), Quinlan diz que o master único foi escolhido para simplificar o projeto e que virou problema de escala conforme cresceram o armazenamento e o número de operações. O artigo do Spanner citado acima diz que o GFS foi sucedido pelo Colossus. Os detalhes de como o Colossus distribui os metadados ficam fora deste artigo.

## Pesquisas futuras

- Distribuir os metadados por vários masters ou por um namespace particionado, em vez de um master único.
- Erasure codes e paridade no lugar da replicação tripla, que os autores já citam como direção para dados de leitura predominante.
- Consistência mais forte ou failover primary-copy para o master, como os autores sugerem com o Harp.
- Semântica de append atômico e de consistência em object stores e logs compartilhados, e sistemas de arquivos que mantêm compatibilidade POSIX.
- Estudos de como a corrupção silenciosa de discos e kernels afeta sistemas de armazenamento em escala.
