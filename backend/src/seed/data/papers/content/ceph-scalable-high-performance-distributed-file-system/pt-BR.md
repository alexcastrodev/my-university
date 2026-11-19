---
title: "Ceph: um sistema de arquivos distribuído escalável e de alto desempenho"
summary: O Ceph elimina as tabelas de alocação de um sistema de arquivos em escala de petabytes calculando onde os objetos ficam com uma função pseudoaleatória (CRUSH), deixa dispositivos de armazenamento semiautônomos cuidarem de replicação e recuperação e espalha o espaço de nomes por um cluster de servidores de metadados que se rebalanceia por subárvore.
researchArea: Sistemas distribuídos
keywords: ceph, crush, rados, armazenamento de objetos, placement groups, particionamento dinâmico de subárvores, servidor de metadados, posix
version: 1.0
updatedAt: 2026-11-19
---

## Resumo

Desenvolvemos o Ceph, um sistema de arquivos distribuído que oferece excelente desempenho, confiabilidade e escalabilidade. O Ceph maximiza a separação entre o gerenciamento de dados e o de metadados ao substituir tabelas de alocação por uma função pseudoaleatória de distribuição de dados (CRUSH), projetada para clusters heterogêneos e dinâmicos de dispositivos de armazenamento de objetos (OSDs) não confiáveis. Aproveitamos a inteligência dos dispositivos distribuindo replicação, detecção de falhas e recuperação entre OSDs semiautônomos que rodam um sistema de arquivos local de objetos especializado. Um cluster de metadados distribuído e dinâmico oferece gerenciamento de metadados extremamente eficiente e se adapta de forma transparente a uma ampla gama de cargas de trabalho de uso geral e de computação científica. Medições de desempenho sob diversas cargas mostram que o Ceph tem excelente desempenho de E/S e gerenciamento de metadados escalável, com suporte a mais de 250.000 operações de metadados por segundo.

## Visão geral

Em 2006, servidores no estilo NFS já tinham esbarrado em um limite de escala, e os sistemas de arquivos baseados em objetos (Lustre, Panasas e outros) tinham movido a alocação de blocos para os dispositivos de armazenamento, mas ainda mantinham uma lista de objetos por arquivo e, segundo o artigo, distribuíam pouco ou nada a carga de metadados. Este artigo do OSDI 2006, de Sage Weil e colegas da UC Santa Cruz, mira cargas científicas e de HPC, como dezenas de milhares de hosts escrevendo no mesmo arquivo ou criando arquivos no mesmo diretório, que os autores esperam ser indicativas das cargas de uso geral de amanhã. O texto parte da premissa de que sistemas em escala de petabytes estão sempre mudando: crescem aos poucos e falhas são a regra.

O Ceph tem três partes: um cliente que expõe uma interface quase POSIX, um cluster de OSDs que guarda todos os dados e metadados e um cluster de servidores de metadados (MDS) que gerencia o espaço de nomes. Para quem acompanha este catálogo, o vizinho mais próximo é o [Google File System](/papers/google-file-system), que o artigo cita como otimizado para arquivos muito grandes, leituras e appends e com semântica não POSIX. O artigo não cita o [Bigtable](/papers/bigtable-distributed-storage-system-structured-data), o [Chubby](/papers/chubby-lock-service-loosely-coupled-distributed-systems) nem o [Dynamo](/papers/dynamo-amazons-highly-available-key-value-store); as comparações a seguir são minhas. Como o [Chord](/papers/chord-scalable-peer-to-peer-lookup-service) e o Dynamo, o CRUSH calcula a posição em vez de consultá-la, mas acrescenta domínios de falha e pesos. O Chubby é a comparação mais próxima para os monitores do Ceph, um pequeno grupo que mantém o mapa do cluster consistente com eleições, leases e two-phase commits.

Vale conhecer antes: inodes e entradas de diretório, striping, replicação primary-copy e o que o POSIX exige de leituras e escritas.

## Contribuição

- **Dados e metadados desacoplados por uma função.** Os dados do arquivo são divididos em objetos nomeados a partir do número do inode e do número da faixa. Os objetos são mapeados para placement groups (PGs) por um hash, e o CRUSH mapeia cada PG para uma lista ordenada de OSDs usando apenas o PG e um mapa compacto do cluster. Qualquer cliente, OSD ou MDS calcula a posição, então não existe lista de alocação.
- **OSDs autônomos (RADOS).** Os OSDs executam replicação primary-copy, detecção mútua de falhas, peering e re-replicação em paralelo, e guardam os objetos no EBOFS, um sistema de arquivos de objetos em espaço de usuário baseado em extents e B-trees.
- **Particionamento dinâmico de subárvores.** Cada MDS acompanha a popularidade dos metadados com contadores com decaimento e migra subárvores para equilibrar a carga. Diretórios quentes são replicados ou espalhados por hash só quando necessário.
- **Semântica quase POSIX com extensões de HPC.** Capabilities e E/S síncrona preservam o comportamento POSIX em arquivos compartilhados. `O_LAZY`, `lazyio_propagate`, `lazyio_synchronize`, `readdirplus` e `statlite` deixam as aplicações relaxá-lo.
- **Protótipo e avaliação.** Um protótipo funcional em espaço de usuário, medido em um cluster de até 430 nós.

## Metodologia

Clientes, OSDs e MDSs são processos de usuário em um cluster Linux de dois processadores com discos SCSI, comunicando por TCP, em geral com um OSD ou MDS por host. São medidas quatro coisas: a vazão por OSD em um cluster de 14 nós (400 clientes em outros 20 nós), a latência de escrita de um único escritor, a distribuição de dados e a escala com posicionamento por CRUSH, hash e linear, e o desempenho de metadados. Os testes de metadados rodam sem E/S de dados, com os OSDs usados só para guardar metadados. Os testes de escala usaram uma partição de 430 nós do cluster alc, no LLNL (dois dias de acesso dedicado). As cargas: makedirs, makefiles, openshared e dois replays de um trace de compilação do OpenSSH (openssh+lib, openssh+include).

## Resultados

Estes são os resultados relatados pelos autores.

- **EBOFS.** A banda do disco é de cerca de 58 MB/s. O EBOFS quase a satura em escritas maiores que 32 KB e supera ext3, ReiserFS e XFS nas leituras. Escritas pequenas sofrem com locking grosseiro, e o teste foi feito apenas em um sistema de arquivos novo.
- **Latência de escrita.** Uma escrita síncrona de 1 MB leva 13 ms com uma réplica e 33 ms com três. Escritas pequenas custam pouco a mais além de duas réplicas, porque o primário encaminha para as réplicas em paralelo. Os clientes mascaram a latência acima de 128 KB tomando locks de objeto e descarregando de forma assíncrona.
- **Distribuição.** Com 100 PGs por OSD, o desvio padrão da utilização dos OSDs é de 10%; com 1000, é de 3%. A vazão de escrita escala linearmente com os OSDs até o switch saturar em 24 OSDs. O CRUSH é O(log n) e leva dezenas de microssegundos.
- **Caminho dos metadados.** Um readdir traz o diretório inteiro, com os inodes embutidos, em uma única requisição ao MDS, então os stats seguintes saem baratos, e o `readdirplus` os elimina.
- **Escala dos metadados.** No makedirs, a vazão por MDS cai de 2000 ops/s com um cluster pequeno para cerca de 1000 ops/s (50% de eficiência) com 128 MDSs, mais de 100.000 ops/s no total. Na maioria das cargas, a eficiência com 128 nós fica no máximo 50% abaixo do linear. openshared e openssh+include escalam pior, o que os autores atribuem à escolha ruim de réplicas pelos clientes.
- **O número de 250.000.** Vem de 128 nós a 2000 ops/s, não de uma medição nessa escala.
- **Conta de padaria.** Um checkpoint do BlueGene/L com 64 mil nós escrevendo em um diretório, que leva minutos em um sistema com pico de 6.000 ops/s de metadados, poderia terminar em dois segundos.

## Análise crítica

O artigo é franco sobre as lacunas: a recuperação de falha do MDS não está implementada, os monitores estão só parcialmente implementados, o protótipo confia em todos os clientes e faltam algumas chamadas POSIX.

- **Confiabilidade é projetada, não medida.** A Seção 6 não tem experimento sobre falha de OSD, tempo de recuperação ou re-replicação. O desenho da detecção de falhas (down versus out, monitores) aparece só em prosa.
- **O número de destaque é uma extrapolação.** O abstract fala em mais de 250.000 operações por segundo. O total medido no makedirs com 128 nós passa de 100.000, e os autores suspeitam de contenção na rede ou na camada de mensagens, mas não tiveram tempo de investigar.
- **Poucas bases de comparação.** As únicas comparações são o EBOFS contra sistemas de arquivos locais e o CRUSH contra posicionamento por hash e linear. Não há execução contra Lustre, GFS ou outro sistema de arquivos distribuído. A legenda da Figura 11 lista 128 MDSs, enquanto o texto fala em um cluster de 64 nós.
- **Cargas.** Os benchmarks de metadados são sintéticos ou um único trace de compilação reexecutado, e o balanceador de carga do MDS é descrito na seção Experiences como uma das maiores lições do projeto.

Literatura posterior, marcada como tal: o artigo do SOSP 2019 de Aghayev, Weil e outros (li o abstract, a introdução e a seção de contexto, não o artigo inteiro) relata que o EBOFS foi substituído em 2008 pelo FileStore sobre Btrfs, depois XFS, e que o BlueStore, iniciado em 2015, virou o backend padrão de produção em 2017. Seus autores dizem que uma pesquisa de 2018 mostrou 70% dos usuários rodando BlueStore em produção, e descrevem a pilha do Ceph como o RADOS com RGW, RBD e CephFS por cima.

## Pesquisas futuras

- Comportamento sob falha em escala: tempo de recuperação e probabilidade de perda de dados sob falhas correlacionadas, que o desenho do artigo mira mas não mede.
- Recuperação de falha do MDS a partir do journal, snapshots de subárvores arbitrárias e callbacks para regiões estáticas, de modo que aberturas para leitura dispensem o MDS.
- Replicação dinâmica de objetos quentes e distribuição de leituras entre réplicas, que os autores listam como planejadas.
- Qualidade de serviço entre a E/S dos clientes e o tráfego de recuperação, e checksums de dados.
- Uma comparação justa entre particionamento de subárvores e hashing, com o mesmo cluster de MDS e a mesma carga.
